import * as THREE from 'three';
import { OrbitalCamera } from './camera.js';
import { gmst, sunEquatorial, moonEquatorial, equatorialToWorld } from './astro.js';
import { createStars } from './stars.js';
import * as GLSL from './shaders.js';

// Scene unit = one Earth radius; the planet shader works in km.
const KM_PER_UNIT = 6371;
// Uniform-disc radiance for unit solar illuminance, normalised for limb darkening (u ≈ 0.6).
const SUN_RADIANCE = 1 / (Math.PI * 0.004653 * 0.004653 * 0.8);
// Real-world rates: clouds drift ~3% of Earth's surface speed (10–30 m/s winds).
const TIMELAPSE = 300;
const CLOUD_DRIFT = 0.03;
// City lights are ~10⁵× dimmer than daylight in reality; this keeps them a few stops
// under the day side so they appear with exposure, as in long ISS night exposures.
const LIGHTS_GAIN = 0.009;
const AIRGLOW = 1.6e-8;          // × (E/E_day)^1.8 → ~1.5e-6 per km at night-side exposure
// The metered exposure spans ~12× (day → night side) where a real camera spans ~10⁵×
// (1/1000 s f/8 → 1/10 s f/1.4 ISO 6400). Stars therefore get an extra (E/E_day)^1.8 on
// top of the shared exposure: day-side frames keep a black sky with only Sirius-class
// stars, night-side frames reach roughly magnitude 6.5–7 like a long ISS exposure.
const STAR_GAIN = 14;
const STAR_EXPOSURE_POW = 1.8;
const DAY_EXPOSURE = 7;
// Lens PSF: fraction of energy scattered out of the core, and the per-octave falloff of
// the halo (0.5 → intensity ∝ θ⁻³, typical of measured veiling-glare tails).
const BLOOM_STRENGTH = 0.025;
const BLOOM_FALLOFF = 0.5;

const loadingEl = document.getElementById('loading');
const progressFill = document.getElementById('progress-fill');
const fpsEl = document.getElementById('fps');
const timeEl = document.getElementById('clock');

// ── Renderer & device tier ───────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance',
});
if (!renderer.capabilities.isWebGL2) {
  loadingEl.querySelector('h1').textContent = 'WebGL 2 is required';
  throw new Error('WebGL2 unavailable');
}
renderer.autoClear = false;
renderer.setClearColor(0x000000, 1);
document.body.prepend(renderer.domElement);

const gl = renderer.getContext();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const gpuName = (() => {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
})();
const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const weakGPU = /SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Intel\(R\) (HD|UHD)/i.test(gpuName);
const highTier = renderer.capabilities.maxTextureSize >= 8192 && !mobile && !weakGPU
  && (navigator.deviceMemory ?? 8) >= 4;
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
let renderScale = highTier ? 1 : 0.75;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.001, 100);
const rig = new OrbitalCamera(camera, renderer.domElement);

// ── Passes ───────────────────────────────────────────────────────────────────
const fsGeo = new THREE.BufferGeometry();
fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const fsCam = new THREE.Camera();

class Pass {
  constructor(fragmentShader, uniforms = {}, opts = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: GLSL.FULLSCREEN_VERT, fragmentShader, uniforms,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, ...opts,
    });
    this.uniforms = this.material.uniforms;
    const mesh = new THREE.Mesh(fsGeo, this.material);
    mesh.frustumCulled = false;
    this.scene = new THREE.Scene().add(mesh);
  }
  render(target, clear = true) {
    renderer.setRenderTarget(target);
    if (clear) renderer.clear();
    renderer.render(this.scene, fsCam);
  }
}

const rtOpts = {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
};
const makeRT = (w, h) => new THREE.WebGLRenderTarget(w, h, rtOpts);

// Atmosphere look-up tables, computed once on the GPU.
const transRT = makeRT(256, 64), msRT = makeRT(32, 32), irrRT = makeRT(64, 1);
new Pass(GLSL.TRANSMITTANCE_FRAG).render(transRT);
new Pass(GLSL.MULTISCAT_FRAG, { uTransLUT: { value: transRT.texture } }).render(msRT);
new Pass(GLSL.IRRADIANCE_FRAG, {
  uTransLUT: { value: transRT.texture }, uMSLUT: { value: msRT.texture },
}).render(irrRT);

function solidTexture(bytes, srgb = false) {
  const t = new THREE.DataTexture(new Uint8Array(bytes), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const planet = new Pass(GLSL.PLANET_FRAG, {
  uTransLUT: { value: transRT.texture }, uMSLUT: { value: msRT.texture }, uIrrLUT: { value: irrRT.texture },
  uCamPos: { value: new THREE.Vector3() }, uCamRot: { value: new THREE.Matrix3() },
  uInvProj: { value: new THREE.Matrix4() }, uPixelAngle: { value: 1e-3 },
  uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunRadiance: { value: SUN_RADIANCE },
  uEarthRot: { value: 0 }, uCloudRot: { value: 0 }, uCloudsOn: { value: 1 },
  uMoonPos: { value: new THREE.Vector3(0, 0, 384400) },
  uLightsGain: { value: LIGHTS_GAIN }, uAirglow: { value: AIRGLOW }, uSteps: { value: highTier ? 16 : 11 },
  uExposure: { value: null }, uNightGain: { value: new THREE.Vector2(DAY_EXPOSURE, STAR_EXPOSURE_POW) },
  uAlbedo: { value: solidTexture([60, 60, 60, 0], true) }, uCloudTex: { value: solidTexture([0, 0, 0, 255]) },
  uLights: { value: solidTexture([0, 0, 0, 255]) }, uNormalTex: { value: solidTexture([128, 128, 255, 255]) },
  uMoonTex: { value: solidTexture([150, 150, 150, 255], true) },
  uAlbedoSize: { value: new THREE.Vector2(1, 1) }, uCloudSize: { value: new THREE.Vector2(1, 1) },
}, {
  // rgb: radiance in front of the background; a: background transmittance.
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
});
const pu = planet.uniforms;

const stars = new THREE.Points(createStars(), new THREE.ShaderMaterial({
  vertexShader: GLSL.STARS_VERT, fragmentShader: GLSL.STARS_FRAG,
  uniforms: {
    uFluxScale: { value: 1 }, uPointSize: { value: 5 }, uSigma: { value: 0.8 },
    uExposure: { value: null }, uExposureRef: { value: DAY_EXPOSURE }, uExposurePow: { value: STAR_EXPOSURE_POW },
  },
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
}));
stars.frustumCulled = false;
const starScene = new THREE.Scene().add(stars);

const down = new Pass(GLSL.DOWNSAMPLE_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
const up = new Pass(GLSL.UPSAMPLE_FRAG, {
  uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: BLOOM_FALLOFF },
}, { blending: THREE.AdditiveBlending });
const expRT = [makeRT(1, 1), makeRT(1, 1)];
const exposure = new Pass(GLSL.EXPOSURE_FRAG, {
  uSrc: { value: null }, uPrev: { value: null }, uDt: { value: 0 }, uReset: { value: 1 }, uHold: { value: 0 },
  uKey: { value: 0.3 }, uRange: { value: new THREE.Vector2(1.5, 90) },
});
const composite = new Pass(GLSL.COMPOSITE_FRAG, {
  uHDR: { value: null }, uBloom: { value: null }, uExposure: { value: null },
  uBloomStrength: { value: BLOOM_STRENGTH }, uBloomNorm: { value: 1 }, uTime: { value: 0 }, uGrain: { value: 0.012 },
  uTanHalf: { value: new THREE.Vector2() }, uLook: { value: new THREE.Vector2(1.25, 1.25) },
});

let hdrRT = null;
let bloomMips = [];
function buildTargets() {
  const w = Math.max(2, Math.round(innerWidth * MAX_DPR * renderScale));
  const h = Math.max(2, Math.round(innerHeight * MAX_DPR * renderScale));
  hdrRT?.dispose();
  bloomMips.forEach(rt => rt.dispose());
  hdrRT = makeRT(w, h);
  bloomMips = [];
  let mw = w, mh = h;
  while (bloomMips.length < 8) {
    mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    if (Math.min(mw, mh) < 4) break;
    bloomMips.push(makeRT(mw, mh));
  }
}

function resize() {
  renderer.setPixelRatio(MAX_DPR);
  renderer.setSize(innerWidth, innerHeight);
  buildTargets();
}
resize();
let resizePending = false;   // applied once per frame, so dragging a window edge doesn't thrash targets
addEventListener('resize', () => { resizePending = true; });

// ── Textures ─────────────────────────────────────────────────────────────────
const bitmapLoader = new THREE.ImageBitmapLoader();
bitmapLoader.setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' });

function loadTexture(url, { srgb = false, red = false, aniso = 1 } = {}) {
  return new Promise((resolve, reject) => {
    bitmapLoader.load(url, bitmap => {
      const t = new THREE.Texture(bitmap);
      t.flipY = false;
      t.premultiplyAlpha = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (red) t.format = THREE.RedFormat;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = Math.min(aniso, maxAniso);
      t.needsUpdate = true;
      resolve(t);
    }, undefined, reject);
  });
}

const TEXTURE_SETS = {
  low: { albedo: 'textures/albedo_4k.webp', clouds: 'textures/clouds_4k.jpg', lights: 'textures/lights_4k.jpg', normal: 'textures/normal_2k.jpg' },
  high: { albedo: 'textures/albedo_8k.webp', clouds: 'textures/clouds_8k.jpg', lights: 'textures/lights_8k.jpg', normal: 'textures/normal_4k.jpg' },
};

function installTexture(uniform, tex) {
  const old = pu[uniform].value;
  pu[uniform].value = tex;
  renderer.initTexture(tex);
  if (old && old.image) old.dispose();
  if (uniform === 'uAlbedo') pu.uAlbedoSize.value.set(tex.image.width, tex.image.height);
  if (uniform === 'uCloudTex') pu.uCloudSize.value.set(tex.image.width, tex.image.height);
  perf.cooldown = 1.5;
}

function loadSet(set, onEach) {
  const jobs = [
    ['uAlbedo', set.albedo, { srgb: true, aniso: 8 }],
    ['uCloudTex', set.clouds, { red: true, aniso: 8 }],
    ['uLights', set.lights, { red: true, aniso: 4 }],
    ['uNormalTex', set.normal, { aniso: 4 }],
  ];
  return Promise.all(jobs.map(([uniform, url, opts]) =>
    loadTexture(url, opts).then(tex => { installTexture(uniform, tex); onEach?.(); })));
}

// ── Simulation state ─────────────────────────────────────────────────────────
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
let simMs = Date.now();
let offsetHours = 0;
let timeScale = TIMELAPSE;
const cloudEpoch = simMs;

{
  const s = sunEquatorial(simMs);
  // Open on a three-quarter-lit disc: sub-camera point ~55° east of the sub-solar point,
  // so the evening terminator crosses the right of frame and the night side shows its lights.
  rig.setView(s.ra + 0.95, 0.36, 4.1);
}

// ── UI ───────────────────────────────────────────────────────────────────────
const hint = document.getElementById('controls');
rig.onInteract = () => hint.classList.add('hide');
document.getElementById('timeOffset').addEventListener('input', e => { offsetHours = parseFloat(e.target.value); });
document.getElementById('autoRotate').addEventListener('change', e => { timeScale = e.target.checked ? TIMELAPSE : 1; });
document.getElementById('showClouds').addEventListener('change', e => { pu.uCloudsOn.value = e.target.checked ? 1 : 0; });
const fmtTime = ms => {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

// ── Adaptive resolution ──────────────────────────────────────────────────────
const perf = { acc: 0, frames: 0, timer: 0, cooldown: 3, holdUp: 0 };
function adaptResolution(dt) {
  if (perf.cooldown > 0) { perf.cooldown -= dt; perf.acc = perf.frames = perf.timer = 0; return; }
  perf.acc += dt; perf.frames++; perf.timer += dt; perf.holdUp = Math.max(0, perf.holdUp - dt);
  if (perf.timer < 1.2) return;
  const avg = perf.acc / perf.frames;
  perf.acc = perf.frames = perf.timer = 0;
  let next = renderScale;
  if (avg > 1 / 42 && renderScale > 0.5) { next = Math.max(0.5, renderScale * 0.85); perf.holdUp = 12; }
  else if (avg < 1 / 57 && renderScale < 1 && perf.holdUp <= 0) next = Math.min(1, renderScale * 1.12);
  if (next !== renderScale) { renderScale = next; buildTargets(); perf.cooldown = 1; }
}

// ── Frame ────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let expIndex = 0, resetExposure = true, fpsFrames = 0, fpsTime = 0;
let debugView = null;    // [fullW, fullH, x, y, w, h] — inspect a sub-rectangle at full resolution
let forcedDt = 0;

function frame() {
  if (resizePending) { resizePending = false; resize(); }
  const dt = forcedDt || Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  simMs += dt * 1000 * timeScale;
  const ms = simMs + offsetHours * 3600e3;

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`; fpsFrames = fpsTime = 0; timeEl.textContent = fmtTime(ms); }
  adaptResolution(dt);

  const aspect = innerWidth / innerHeight;
  rig.update(dt, aspect);

  // Sun & Moon from ephemerides; Earth orientation from sidereal time.
  const sun = sunEquatorial(ms);
  equatorialToWorld(sun.ra, sun.dec, sunDir);
  const moon = moonEquatorial(ms);
  equatorialToWorld(moon.ra, moon.dec, moonDir);

  if (debugView) camera.setViewOffset(...debugView); else camera.clearViewOffset();
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom / (debugView ? debugView[1] / debugView[5] : 1);
  pu.uCamPos.value.copy(camera.position).multiplyScalar(KM_PER_UNIT);
  pu.uCamRot.value.setFromMatrix4(camera.matrixWorld);
  pu.uInvProj.value.copy(camera.projectionMatrixInverse);
  pu.uPixelAngle.value = 2 * tanY / hdrRT.height;
  pu.uSunDir.value.copy(sunDir);
  pu.uEarthRot.value = gmst(ms);
  pu.uCloudRot.value = ((ms - cloudEpoch) / 86400e3) * Math.PI * 2 * CLOUD_DRIFT;
  pu.uMoonPos.value.copy(moonDir).multiplyScalar(moon.dist * KM_PER_UNIT);

  const pixelSolidAngle = (2 * tanY / hdrRT.height) ** 2;
  stars.material.uniforms.uFluxScale.value = STAR_GAIN / pixelSolidAngle;
  stars.material.uniforms.uExposure.value = expRT[expIndex].texture;     // last frame's metering
  pu.uExposure.value = expRT[expIndex].texture;

  // 1. stars, 2. planet/atmosphere/Sun/Moon composited over them
  renderer.setRenderTarget(hdrRT);
  renderer.clear();
  renderer.render(starScene, camera);
  planet.render(hdrRT, false);

  // 3. lens PSF: downsample chain, then tent upsample accumulating back up
  let src = hdrRT;
  for (const mip of bloomMips) {
    down.uniforms.uSrc.value = src.texture;
    down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    down.render(mip);
    src = mip;
  }

  // 4. metering + adaptation on a ~1/32 mip before it accumulates (1×1, stays on the GPU)
  const prev = expRT[expIndex], next = expRT[1 - expIndex];
  exposure.uniforms.uSrc.value = bloomMips[Math.min(4, bloomMips.length - 1)].texture;
  exposure.uniforms.uPrev.value = prev.texture;
  exposure.uniforms.uDt.value = dt;
  exposure.uniforms.uReset.value = resetExposure ? 1 : 0;
  exposure.uniforms.uHold.value = debugView ? 1 : 0;
  exposure.render(next);
  expIndex = 1 - expIndex;
  resetExposure = false;

  for (let i = bloomMips.length - 2; i >= 0; i--) {
    const from = bloomMips[i + 1];
    up.uniforms.uSrc.value = from.texture;
    up.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
    up.render(bloomMips[i], false);
  }

  // 5. tone map to screen
  const cu = composite.uniforms;
  cu.uHDR.value = hdrRT.texture;
  cu.uBloom.value = bloomMips[0].texture;
  cu.uBloomNorm.value = (1 - BLOOM_FALLOFF) / (1 - BLOOM_FALLOFF ** bloomMips.length);   // Σ falloff^i = 1
  cu.uExposure.value = next.texture;
  cu.uTime.value = t;
  cu.uTanHalf.value.set(tanY * aspect, tanY);
  composite.render(null);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
let loaded = 0;
const initial = TEXTURE_SETS.low;
const total = Object.keys(initial).length;
loadSet(initial, () => { progressFill.style.transform = `scaleX(${++loaded / total})`; })
  .then(() => {
    renderer.setAnimationLoop(frame);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      loadingEl.classList.add('done');
      document.getElementById('panel').classList.add('show');
      setTimeout(() => loadingEl.remove(), 1500);
    }));
    loadTexture('textures/moon_2k.jpg', { srgb: true, aniso: 4 }).then(t => installTexture('uMoonTex', t));
    if (highTier) return loadSet(TEXTURE_SETS.high);
  })
  .catch(err => {
    console.error(err);
    loadingEl.querySelector('h1').textContent = 'Failed to load textures';
  });

// Inspection handle (console): drive frames while hidden, freeze time, crop-zoom the frame.
window.__earth = {
  renderer, camera, rig, get renderScale() { return renderScale; }, get hdr() { return hdrRT; },
  setTime: ms => { simMs = ms; }, setTimeScale: s => { timeScale = s; },
  step: (n = 1, dt = 1 / 60) => { forcedDt = dt; for (let i = 0; i < n; i++) frame(); forcedDt = 0; },
  // crop(x, y, w, h) in CSS px: magnify that part of the frame (exposure held); crop() resets.
  crop: (x, y, w, h) => { debugView = x === undefined ? null : [innerWidth, innerHeight, x, y, w, h]; },
  exposure: () => {
    const b = new Uint16Array(4);
    renderer.readRenderTargetPixels(expRT[expIndex], 0, 0, 1, 1, b);
    return THREE.DataUtils.fromHalfFloat(b[0]);
  },
};
