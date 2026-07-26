/* ============================================================
   gallery.js — the Dusk Museum, hybrid-rendered.

   While you scroll:  real-time raster with a low dusk sun and
                      true pillar shadows (PCF soft, follows you).
   When you settle:   three-gpu-pathtracer takes the same scene
                      and progressively resolves the frame into a
                      photoreal render — soft area shadows, bounce
                      light, glossy marble reflections. Any scroll
                      snaps instantly back to raster.

   The hall is fully static (exactly one bay per artwork), which is
   what lets the path tracer build its BVH once and never rebuild.
   ============================================================ */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const SITE = window.SITE || {};
const Site = window.Site || {};
const pieces = SITE.gallery || [];

const CONFIG = {
  introTiles: 1.8,
  minIntroDistance: 14,
  maxTiles: 14,                  // safety cap on hall length
  scrollPixelsPerTile: 820,
  cameraHeight: 1.65,
  cameraDepth: 5.8,
  cameraLerp: 0.09,
  artPadding: 0.88,
  endPadTiles: 0.45,
  // path tracer — experimental, off by default: the synchronous BVH build
  // freezes the page for seconds and the converted scene renders black.
  // Flip to true to experiment; the raster path never depends on it.
  ptEnabled: true,
  ptIdleMs: 450,                 // stillness before refinement kicks in
  ptMaxSamples: 220,
  ptBounces: 4
};

const canvas = document.getElementById("galleryCanvas");
const spacer = document.getElementById("scrollSpacer");
const loading = document.getElementById("galleryLoading");
const intro = document.getElementById("galleryIntro");
const progress = document.getElementById("galleryProgress");

const lightbox = Site.createLightbox
  ? Site.createLightbox(pieces.map((g) => ({
      src: g.src,
      title: g.title,
      meta: [g.medium, g.year].filter(Boolean).join(" - ")
    })))
  : null;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2a1a2e, 0.014);

/* dusk environment: one generated equirect drives BOTH the raster
   image-based lighting and the path tracer's sky */
const envTexture = makeDuskEquirect();
scene.environment = envTexture;
scene.environmentIntensity = 0.42;

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.05, 900);
camera.position.set(0, CONFIG.cameraHeight, CONFIG.cameraDepth);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.2, 0.6, 0.9);
composer.addPass(bloomPass);
// grain is supplied by the site-wide CSS overlay (body::after), so the
// gallery's film-noise matches every other page instead of double-graining

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/");
gltfLoader.setDRACOLoader(dracoLoader);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clickableArt = [];
const ptExcluded = [];           // additive/shader helpers the tracer can't take

const state = {
  moduleWidth: 12,
  titleDistance: 12,
  endX: 40,
  targetX: 0,
  cameraX: 0,
  maxScroll: 1,
  lastScrollAt: performance.now(),
  loaded: false
};
let placeholderArtwork = null;

/* ---------- the dusk sun: LOW on the horizon beyond the colonnade,
   so pillars throw long shadows across the marble toward you ---------- */
const warmLight = new THREE.DirectionalLight(0xffa35f, 3.6);
warmLight.castShadow = true;
warmLight.shadow.mapSize.set(2048, 2048);
warmLight.shadow.camera.near = 1;
warmLight.shadow.camera.far = 90;
warmLight.shadow.camera.left = -26;
warmLight.shadow.camera.right = 26;
warmLight.shadow.camera.top = 20;
warmLight.shadow.camera.bottom = -8;
warmLight.shadow.bias = -0.0004;
warmLight.shadow.normalBias = 0.02;
scene.add(warmLight);
scene.add(warmLight.target);
scene.add(new THREE.HemisphereLight(0x8f9ae0, 0x33201a, 0.28));

const skyGroup = new THREE.Group();
const galleryGroup = new THREE.Group();
scene.add(skyGroup, galleryGroup);

const DUST = { count: 520, window: 48, positions: null, vel: null };
const skyMesh = buildInfiniteSky();
const motes = buildDustMotes();
init();

async function init() {
  try {
    const [gltf] = await Promise.all([
      gltfLoader.loadAsync("/gallery.glb"),
      Promise.all(pieces.map((piece, index) => loadArtwork(piece.src, index)))
    ]);

    const sourceModule = prepareModule(gltf.scene);
    const box = new THREE.Box3().setFromObject(sourceModule);
    state.moduleWidth = Math.max(1, box.max.x - box.min.x);
    sourceModule.position.x -= box.min.x;
    state.titleDistance = Math.max(state.moduleWidth * CONFIG.introTiles, CONFIG.minIntroDistance);

    buildHall(sourceModule);

    state.endX = state.titleDistance + hallTiles * state.moduleWidth
               + state.moduleWidth * CONFIG.endPadTiles - state.moduleWidth * 0.5;
    state.maxScroll = Math.ceil((state.endX / state.moduleWidth) * CONFIG.scrollPixelsPerTile);
    spacer.style.height = `${state.maxScroll + window.innerHeight}px`;

    loading.classList.add("is-hidden");
    state.loaded = true;
    if (CONFIG.ptEnabled) initPathTracer();   // experimental, see CONFIG
    loadIsland();                             // background set piece, non-blocking
    animate();
  } catch (error) {
    console.error(error);
    loading.textContent = "Gallery model failed to load";
  }
}

/* ---------- static hall: one bay per artwork, placed once ---------- */
let hallTiles = 1;
function buildHall(sourceModule) {
  // markers per module tell us how many bays the work needs
  let markersPer = 0;
  sourceModule.traverse((o) => { if (o.name === "ART") markersPer += 1; });
  markersPer = Math.max(1, markersPer);
  hallTiles = Math.min(CONFIG.maxTiles, Math.max(1, Math.ceil(pieces.length / markersPer)));

  for (let tile = 0; tile < hallTiles; tile += 1) {
    const module = SkeletonUtils.clone(sourceModule);
    const wrapper = new THREE.Group();
    wrapper.add(module);
    wrapper.position.x = state.titleDistance + tile * state.moduleWidth;
    galleryGroup.add(wrapper);
    hangArt(module, tile, markersPer);
  }
}

/* Art planes are SIBLINGS at the marker's transform. Parenting them to a
   hidden marker made them invisible-but-clickable (raycasts ignore
   visibility) — that bug is gone for good. */
function hangArt(module, tile, markersPer) {
  const markers = [];
  module.traverse((obj) => { if (obj.name === "ART") markers.push(obj); });

  markers.forEach((marker, markerIndex) => {
    marker.visible = false;
    const pieceIndex = tile * markersPer + markerIndex;
    if (pieceIndex >= pieces.length) return;           // bare wall past the last piece

    const data = artworkCache[pieceIndex] || getPlaceholderArtwork();
    const size = marker.userData.size || 1.8;
    const width = size * data.aspect * CONFIG.artPadding;
    const height = size * CONFIG.artPadding;
    // a touch of self-illumination = the museum's picture lighting; without
    // it the pieces fall into silhouette against the bright openings
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: data.texture,
        emissiveMap: data.texture,
        emissive: 0xffffff,
        emissiveIntensity: 0.55,
        color: 0xffffff,
        roughness: 0.58,
        metalness: 0,
        side: THREE.DoubleSide
      })
    );
    art.name = `Artwork_${pieceIndex}`;
    art.castShadow = true;
    art.receiveShadow = true;
    art.userData.pieceIndex = pieceIndex;
    art.position.copy(marker.position);
    art.quaternion.copy(marker.quaternion);
    art.scale.copy(marker.scale);
    (marker.parent || module).add(art);
    clickableArt.push(art);
  });
}

function prepareModule(root) {
  const module = root.clone(true);
  const toHide = [];
  module.traverse((obj) => {
    // the GLB's baked sky backdrop ends abruptly — the shader dome replaces it
    if (/sky|backdrop|background/i.test(obj.name || "")) toHide.push(obj);
    if (obj.isMesh) {
      const materialName = Array.isArray(obj.material)
        ? obj.material.map((mat) => mat && mat.name).join(" ")
        : obj.material && obj.material.name;
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material) {
        obj.material = cloneMaterial(obj.material);
        applyMuseumMaterialTuning(obj, materialName);
      }
    }
  });
  toHide.forEach((o) => { o.visible = false; });
  return module;
}

function cloneMaterial(material) {
  return Array.isArray(material)
    ? material.map((item) => item && item.clone ? item.clone() : item)
    : material.clone();
}

function applyMuseumMaterialTuning(obj, materialName) {
  const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
  materials.forEach((material) => {
    if (!material) return;
    material.envMapIntensity = 0.6;
    if (/Black Marble Floor Tiling/i.test(materialName || "")) {
      material.color = material.color || new THREE.Color(0xffffff);
      material.color.multiplyScalar(1.85);
      // glossier floor: raster picks up env sheen, the path tracer
      // resolves true blurred reflections of pillars and art
      material.roughness = 0.42;
      material.metalness = 0.05;
    }
  });
}

/* ---------- floating island: a distant set piece over the dunes.
   It bobs on a slow swell and turns almost imperceptibly, with a light
   parallax factor so it reads as far away while you walk. ---------- */
const ISLAND = { root: null, baseY: 9, parallax: 0.82 };
async function loadIsland() {
  try {
    const gltf = await gltfLoader.loadAsync("/gallery/island-opt.glb");
    const island = gltf.scene;
    // normalize whatever scale the model shipped at to ~22 units wide
    const box = new THREE.Box3().setFromObject(island);
    const size = box.getSize(new THREE.Vector3());
    const s = 22 / Math.max(size.x, size.z);
    island.scale.setScalar(s);
    box.setFromObject(island);
    const center = box.getCenter(new THREE.Vector3());
    island.position.sub(center);                    // recentre on origin

    const pivot = new THREE.Group();
    pivot.add(island);
    pivot.position.set(state.endX * 0.5, ISLAND.baseY, -55);
    island.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        if (o.material) o.material.envMapIntensity = 0.4;
      }
    });
    scene.add(pivot);
    ISLAND.root = pivot;
    ptExcluded.push(pivot);
  } catch (e) {
    console.warn("island failed to load:", e);
  }
}

/* dust motes drifting in the beams (raster only). They live in WORLD space
   inside a window that wraps around the camera, so as you scroll the camera
   flies through them and they stream past — plus a slow self-drift for life.
   (Config lives up top with the other state — it must be initialized before
   the top-level buildDustMotes() call, or the whole module dies in the TDZ.) */
function buildDustMotes() {
  const n = DUST.count;
  DUST.positions = new Float32Array(n * 3);
  DUST.vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    DUST.positions[i * 3]     = (Math.random() - 0.5) * DUST.window;
    DUST.positions[i * 3 + 1] = Math.random() * 5.5 + 0.3;
    DUST.positions[i * 3 + 2] = (Math.random() - 0.5) * 7;
    // gentle air currents — mostly a lazy sideways drift with a little lift
    DUST.vel[i * 3]     = (Math.random() - 0.5) * 0.22;
    DUST.vel[i * 3 + 1] = (Math.random() - 0.4) * 0.10;
    DUST.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
  }
  // soft round sprite — square default points read as white pixels, not dust
  const sc = document.createElement("canvas");
  sc.width = sc.height = 64;
  const sctx = sc.getContext("2d");
  const g = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,225,190,1)");
  g.addColorStop(0.4, "rgba(255,215,175,0.55)");
  g.addColorStop(1, "rgba(255,210,170,0)");
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 64, 64);
  const spriteTex = new THREE.CanvasTexture(sc);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(DUST.positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: spriteTex,
    color: 0xffd9b0,
    size: 0.05,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  }));
  points.frustumCulled = false;   // positions are world-space and always relevant
  scene.add(points);
  ptExcluded.push(points);
  return points;
}

function updateMotes(dt) {
  const p = DUST.positions, v = DUST.vel, n = DUST.count;
  const cx = state.cameraX, half = DUST.window * 0.5;
  const t = clock.elapsedTime;
  for (let i = 0; i < n; i += 1) {
    const ix = i * 3;
    // self-drift + a faint turbulent sway so it never looks like a rigid grid
    p[ix]     += (v[ix]     + Math.sin(t * 0.3 + i) * 0.05) * dt;
    p[ix + 1] += (v[ix + 1] + Math.sin(t * 0.5 + i * 1.7) * 0.04) * dt;
    p[ix + 2] += v[ix + 2] * dt;
    // wrap the field around the moving camera → motes stream past on scroll
    let rel = p[ix] - cx;
    if (rel > half) p[ix] -= DUST.window;
    else if (rel < -half) p[ix] += DUST.window;
    // keep them in the room's air column
    if (p[ix + 1] > 6.0) p[ix + 1] = 0.3;
    else if (p[ix + 1] < 0.2) p[ix + 1] = 5.8;
    if (p[ix + 2] > 3.6) p[ix + 2] = -3.6;
    else if (p[ix + 2] < -3.6) p[ix + 2] = 3.6;
  }
  motes.geometry.attributes.position.needsUpdate = true;
}

const artworkCache = [];
async function loadArtwork(src, index) {
  try {
    const texture = await textureLoader.loadAsync(src);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const image = texture.image;
    const aspect = image && image.height ? image.width / image.height : 1;
    const data = { texture, aspect };
    artworkCache[index] = data;
    return data;
  } catch (e) {
    console.warn("artwork failed to load:", src, e);
    const data = getPlaceholderArtwork();
    artworkCache[index] = data;
    return data;
  }
}

function getPlaceholderArtwork() {
  if (placeholderArtwork) return placeholderArtwork;
  const canvas2d = document.createElement("canvas");
  canvas2d.width = 512;
  canvas2d.height = 640;
  const ctx = canvas2d.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 512, 640);
  gradient.addColorStop(0, "#d58f72");
  gradient.addColorStop(.5, "#23395d");
  gradient.addColorStop(1, "#f0d6a8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 640);
  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.fillRect(96, 132, 320, 376);
  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  placeholderArtwork = { texture, aspect: 512 / 640 };
  return placeholderArtwork;
}

/* ---------- dusk equirect: shared sky for IBL + path tracer ---------- */
function makeDuskEquirect() {
  const w = 1024, h = 512;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.00, "#31355f");
  grad.addColorStop(0.42, "#7a5878");
  grad.addColorStop(0.55, "#e89a6e");
  grad.addColorStop(0.62, "#f3b184");
  grad.addColorStop(0.70, "#5c3a52");
  grad.addColorStop(1.00, "#241726");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // sun low on the horizon, on the colonnade side (-z → u = 0.5 in equirect
  // when looking down -z; offset toward -x a touch)
  const sun = ctx.createRadialGradient(w * 0.46, h * 0.56, 1, w * 0.46, h * 0.56, 18);
  sun.addColorStop(0, "rgba(255,238,210,1)");
  sun.addColorStop(0.3, "rgba(255,196,140,0.85)");
  sun.addColorStop(1, "rgba(255,160,110,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* the raster sky dome follows the camera; clouds supply the motion */
function buildInfiniteSky() {
  const skyMat = new THREE.ShaderMaterial({
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uOffset: { value: 0 }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform float uTime;
      uniform float uOffset;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p *= 2.02;
          a *= 0.52;
        }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec2 p = vec2(d.x * 5.0 + uOffset + uTime * 0.012, d.y * 6.5 + uTime * 0.006);
        float clouds = smoothstep(0.42, 0.82, fbm(p));
        vec3 skyA = vec3(0.34, 0.40, 0.62);
        vec3 skyB = vec3(0.95, 0.62, 0.44);
        vec3 cloud = vec3(0.96, 0.85, 0.78);
        float horizon = smoothstep(-0.06, 0.42, d.y);
        vec3 color = mix(skyB, skyA, horizon);
        color = mix(color, cloud, clouds * 0.62 * smoothstep(-0.02, 0.15, d.y));
        // tight disc with a small halo (pow 600 ≈ 1/5 the old glow radius)
        float sunDot = max(dot(d, normalize(vec3(-0.25, 0.10, -0.95))), 0.0);
        float sun = pow(sunDot, 600.0) * 1.6 + pow(sunDot, 90.0) * 0.22;
        color += vec3(1.0, 0.74, 0.48) * sun;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 40, 24), skyMat);
  sky.renderOrder = -10;
  skyGroup.add(sky);
  skyGroup.userData.material = skyMat;
  ptExcluded.push(sky);          // the tracer uses the equirect env instead
  return sky;
}

/* ---------- hybrid path tracer ---------- */
let pathTracer = null;
let ptSceneBuilt = false;
let ptActive = false;

async function initPathTracer() {
  try {
    const { WebGLPathTracer } = await import("three-gpu-pathtracer");
    pathTracer = new WebGLPathTracer(renderer);
    pathTracer.bounces = CONFIG.ptBounces;
    pathTracer.filterGlossyFactor = 0.5;
    pathTracer.renderScale = Math.min(window.devicePixelRatio || 1, 1.25);
    pathTracer.tiles.set(2, 2);
    pathTracer.dynamicLowRes = true;
    pathTracer.lowResScale = 0.4;
  } catch (e) {
    console.warn("path tracer unavailable — raster only:", e);
    pathTracer = null;
  }
}

function setPtExcludedVisible(visible) {
  ptExcluded.forEach((o) => { o.visible = visible; });
}

function buildPtScene() {
  // snapshot the (fully static) hall without the raster-only helpers
  setPtExcludedVisible(false);
  try {
    pathTracer.setScene(scene, camera);
    ptSceneBuilt = true;
  } catch (e) {
    console.warn("path tracer scene build failed — raster only:", e);
    pathTracer = null;
  }
  setPtExcludedVisible(true);
}

function enterPathTracing() {
  if (!ptSceneBuilt) buildPtScene();
  if (!pathTracer) return;
  setPtExcludedVisible(false);
  pathTracer.updateCamera();
  pathTracer.updateLights();
  ptActive = true;
}

function exitPathTracing() {
  if (!ptActive) return;
  ptActive = false;
  setPtExcludedVisible(true);
}

/* ---------- main loop ---------- */
function animate() {
  const dt = Math.min(clock.getDelta(), 0.04);
  const scrollX = window.scrollY / CONFIG.scrollPixelsPerTile * state.moduleWidth;
  state.targetX = Math.min(scrollX, state.endX);
  const before = state.cameraX;
  state.cameraX += (state.targetX - state.cameraX) * (1 - Math.pow(1 - CONFIG.cameraLerp, dt * 60));
  const moving = Math.abs(state.cameraX - before) > 0.0004;
  if (moving) state.lastScrollAt = performance.now();

  camera.position.x = state.cameraX;
  camera.position.y = CONFIG.cameraHeight + Math.sin(state.cameraX * 0.05) * 0.03;
  camera.lookAt(state.cameraX + 2.8, CONFIG.cameraHeight - 0.08, 0);

  // low dusk sun rides with you → every pillar drags a long real shadow
  // (height matched to the visible beam slope so light and shadow agree)
  warmLight.position.set(state.cameraX - 5, 3.4, -13);
  warmLight.target.position.set(state.cameraX + 1.5, 0, 5);

  updateOverlay();

  const still = state.loaded && pathTracer &&
    performance.now() - state.lastScrollAt > CONFIG.ptIdleMs;

  if (still) {
    if (!ptActive) enterPathTracing();
    if (ptActive && pathTracer.samples < CONFIG.ptMaxSamples) {
      pathTracer.renderSample();
    } else if (ptActive) {
      pathTracer.renderSample();   // hold the converged frame
    }
  } else {
    if (ptActive) {
      exitPathTracing();
      if (pathTracer) pathTracer.reset();
    }
    updateAtmosphere(dt);
    composer.render();
  }

  requestAnimationFrame(animate);
}

function updateAtmosphere(dt) {
  skyGroup.position.x = camera.position.x;
  const skyMat = skyGroup.userData.material;
  if (skyMat) {
    skyMat.uniforms.uTime.value += dt;
    skyMat.uniforms.uOffset.value = camera.position.x * 0.02;
  }

  // the island rides a slow swell, turns imperceptibly, and parallaxes
  // against the hall so it reads as genuinely distant
  if (ISLAND.root) {
    const t = clock.elapsedTime;
    ISLAND.root.position.y = ISLAND.baseY + Math.sin(t * 0.22) * 0.55 + Math.sin(t * 0.61) * 0.12;
    ISLAND.root.rotation.y += dt * 0.018;
    ISLAND.root.rotation.z = Math.sin(t * 0.17) * 0.012;
    ISLAND.root.position.x = state.endX * 0.5 + (state.cameraX - state.endX * 0.5) * (1 - ISLAND.parallax);
  }
  updateMotes(dt);
}

function updateOverlay() {
  const pct = Math.min(1, window.scrollY / state.maxScroll);
  if (progress) progress.style.width = `${pct * 100}%`;
  if (intro) intro.classList.toggle("is-dimmed", state.cameraX > state.titleDistance * 0.38);
}

window.addEventListener("scroll", () => { state.lastScrollAt = performance.now(); }, { passive: true });

window.addEventListener("pointerdown", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickableArt, false)
    .filter((h) => h.object.visible);
  if (!hits.length || !lightbox) return;
  lightbox.open(hits[0].object.userData.pieceIndex || 0);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  if (pathTracer && ptSceneBuilt) pathTracer.reset();
  state.lastScrollAt = performance.now();
});
