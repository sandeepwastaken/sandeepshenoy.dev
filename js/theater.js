/* ============================================================
   theater.js — The Theater.

   THE SHOT
   You are slouched in a second-row seat. The seat backs of the row in
   front are really in front of you: the WebGL canvas sits ON TOP of the
   film with a transparent clear colour, and the screen is a
   punch-through quad (NoBlending, alpha 0) that cuts a hole in the
   render. Depth decides what covers what — no compositing tricks.
   Camera constants are tuned against this model's measured seat rows
   (steep stadium tiering, screen 4.07 x 1.85 at z = -4.05); the
   ?d= ?x= ?y= ?aim= ?fov= overrides let you re-dress the shot live.

   THE LIGHT
   The room takes its colour from the film's real frames. A cross-origin
   YouTube frame can't be pixel-read, but YouTube publishes frames at
   25% / 50% / 75% (hq1..hq3.jpg) and those images DO allow canvas
   sampling. We average each one, split it into chromaticity + luma, and
   interpolate on actual playback position — so the room glows the
   shade the film is currently that colour, and dims when the film
   darkens. Motion flicker rides on top while playing, and freezes when
   you pause, because a paused frame emits steady light.

   THE PLAYER
   A real YouTube player, placed in 3D via CSS3DRenderer, sharing one
   camera with the room so it sways with it. Pointer-inert, controls=0,
   slightly overscanned and dark until playback starts, so none of
   YouTube's own chrome is ever on screen. Every control is the booth
   bar at the bottom.

   THE SOUND
   The film's audio belongs to the YouTube frame and can't be routed
   through Web Audio cross-origin. The room foley — cassette clunk,
   button ticks — runs through a convolution reverb, so the space
   around you sounds like a big empty house.
   ============================================================ */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

const SITE = window.SITE || {};
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && !isNaN(+q.get(k)) ? +q.get(k) : d);

/* Camera is described relative to the screen it looks at, and tuned
   against this model's measured seat rows (six rows at z = -0.5, 0.25,
   1.25, 2.0, 2.75, 3.75; screen 4.07 x 1.85 centred at z = -4.05).
   You sit in the 4th row — the middle of the house — dead on the screen
   centre line so the picture stays square instead of keystoning, with
   the row ahead cutting across the bottom of frame. */
const CONFIG = {
  fov:          num("fov", 38),
  seatDistance: num("d", 7.0),     // metres back from the screen wall
  seatOffsetX:  num("x", 0),       // on the centre line — off-axis keystones
  eyeRise:      num("y", -0.35),   // eye height relative to screen centre
  aimRise:      num("aim", -0.84), // look down a little, to bring seats in
  overscan:     1.22,              // crops YouTube's title bar / wordmark away
  wallLuminance: 0.14,             // cinema walls are dark; clamp the model's
  shake:        reduceMotion ? 0 : 1
};

/* ---------- films from data.js ---------- */
function ytId(s) {
  if (!s) return "";
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1, 12);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(embed|shorts|v)\/([\w-]{11})/);
    if (m) return m[2];
  } catch (e) {}
  const m = String(s).match(/[\w-]{11}/);
  return m ? m[0] : "";
}
const films = (SITE.theater || [])
  .map((f) => ({ id: ytId(f.youtube || f.id || f.src), title: f.title || "", year: f.year || "", blurb: f.blurb || "" }))
  .filter((f) => f.id);

/* ---------- DOM ---------- */
const canvas = document.getElementById("theaterCanvas");
const screenLayer = document.getElementById("screenLayer");
const loading = document.getElementById("theaterLoading");
const intro = document.getElementById("theaterIntro");
const rackList = document.getElementById("cassetteList");
const rackCount = document.getElementById("cassetteCount");
const booth = document.getElementById("booth");
const soundNote = document.getElementById("soundNote");
const els = {
  play: document.getElementById("btnPlay"),
  prev: document.getElementById("btnPrev"),
  next: document.getElementById("btnNext"),
  back10: document.getElementById("btnBack10"),
  fwd10: document.getElementById("btnFwd10"),
  mute: document.getElementById("btnMute"),
  full: document.getElementById("btnFull"),
  vol: document.getElementById("vol"),
  scrub: document.getElementById("scrub"),
  scrubFill: document.getElementById("scrubFill"),
  scrubBuffer: document.getElementById("scrubBuffer"),
  scrubKnob: document.getElementById("scrubKnob"),
  tCur: document.getElementById("tCur"),
  tDur: document.getElementById("tDur"),
  icPlay: document.querySelector("#btnPlay .ic-play"),
  icPause: document.querySelector("#btnPlay .ic-pause"),
  icVol: document.querySelector("#btnMute .ic-vol"),
  icMute: document.querySelector("#btnMute .ic-mute")
};

if (!films.length) loading.textContent = "No films in data.js";

/* ============================================================
   RENDERERS
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.style.position = "absolute";
cssRenderer.domElement.style.inset = "0";
cssRenderer.domElement.style.pointerEvents = "none";
screenLayer.appendChild(cssRenderer.domElement);

const scene = new THREE.Scene();
const cssScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.fov, window.innerWidth / window.innerHeight, 0.05, 200);

/* ---------- lights ---------- */
RectAreaLightUniformsLib.init();
scene.add(new THREE.AmbientLight(0x0a0b0e, 0.5));
// the film itself, as a physical area light — this is what paints the room
const screenLight = new THREE.RectAreaLight(0xffe6a8, 6, 3.3, 1.85);
scene.add(screenLight);
// near-field bounce for the front rows and the floor
const fillLight = new THREE.PointLight(0xffe6a8, 3, 15, 2.2);
scene.add(fillLight);
// aisle lights: the only thing in the room that isn't the movie. They rim
// the seat backs so the rows in front read as shapes, not a black hole.
const aisleL = new THREE.PointLight(0xff9a4e, 0.9, 5.5, 2.4);
const aisleR = new THREE.PointLight(0xff9a4e, 0.9, 5.5, 2.4);
// spill from the projection port behind you, catching the tops of the
// seats ahead — without it they are pure silhouette against a dark room
const boothGlow = new THREE.PointLight(0xffc98f, 2.4, 9, 2.2);
// house lights: up while you're choosing, down when the film rolls
const houseFront = new THREE.PointLight(0xffbe86, 0, 14, 2);
const houseBack = new THREE.PointLight(0xffbe86, 0, 14, 2);
scene.add(aisleL, aisleR, boothGlow, houseFront, houseBack);

const clock = new THREE.Clock();

/* ---------- loaders ---------- */
const gltfLoader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("https://unpkg.com/three@0.165.0/examples/jsm/libs/draco/");
gltfLoader.setDRACOLoader(draco);

const rig = {
  screenCenter: new THREE.Vector3(),
  screenW: 4, screenH: 1.85,
  filmW: 3.3, filmH: 1.85,
  camBase: new THREE.Vector3(),
  camTarget: new THREE.Vector3(),
  ready: false
};
let screenObject = null;
let filmWrap = null;
let filmCover = null;
let filmIdle = null;
/* nothing plays until a cassette is picked. Until then the house lights are
   up, the screen holds its slide, and `houseLevel` drives the crossfade. */
let showStarted = false;
let houseLevel = 1;
const fixtureMats = [];

/* ============================================================
   LAYOUT
   ============================================================ */
function layoutTheater(model) {
  const room = new THREE.Group();
  room.add(model);

  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));

  // screen wall to -Z, seats to +Z: the orientation CSS3DRenderer needs
  // for the film to read unmirrored
  room.rotation.y = Math.PI;
  scene.add(room);
  room.updateMatrixWorld(true);

  let screenNode = null;
  model.traverse((o) => { if ((o.name || "").toLowerCase() === "wall_screen") screenNode = o; });

  const sBox = screenNode ? new THREE.Box3().setFromObject(screenNode)
                          : new THREE.Box3().setFromObject(model);
  sBox.getCenter(rig.screenCenter);
  const sSize = sBox.getSize(new THREE.Vector3());
  rig.screenW = Math.max(sSize.x, 1);
  rig.screenH = Math.max(sSize.y, 1);

  // 16:9 inside the physical screen; the wall left over each side becomes
  // black masking, the way a real house masks a narrower ratio
  rig.filmH = Math.min(rig.screenH, rig.screenW * 9 / 16);
  rig.filmW = rig.filmH * 16 / 9;

  dressMaterials(model, screenNode);

  screenLight.width = rig.filmW;
  screenLight.height = rig.filmH;
  screenLight.position.copy(rig.screenCenter);
  screenLight.position.z += 0.04;
  screenLight.lookAt(rig.screenCenter.x, rig.screenCenter.y, rig.screenCenter.z + 8);
  fillLight.position.set(rig.screenCenter.x, rig.screenCenter.y, rig.screenCenter.z + 2.2);

  rig.camBase.set(
    rig.screenCenter.x + CONFIG.seatOffsetX,
    rig.screenCenter.y + CONFIG.eyeRise,
    rig.screenCenter.z + CONFIG.seatDistance
  );
  rig.camTarget.set(rig.screenCenter.x, rig.screenCenter.y + CONFIG.aimRise, rig.screenCenter.z);
  camera.position.copy(rig.camBase);
  camera.lookAt(rig.camTarget);

  // the practicals sit around the seat, not around the room's origin
  const roomBox = new THREE.Box3().setFromObject(model);
  const aisleY = rig.camBase.y - 0.75;
  aisleL.position.set(roomBox.min.x + 0.4, aisleY, rig.camBase.z - 0.8);
  aisleR.position.set(roomBox.max.x - 0.4, aisleY, rig.camBase.z - 0.8);
  boothGlow.position.set(rig.camBase.x, rig.camBase.y + 1.1, rig.camBase.z + 1.6);
  const ceilY = roomBox.max.y - 0.5;
  houseFront.position.set(rig.screenCenter.x, ceilY, rig.screenCenter.z + 2.6);
  houseBack.position.set(rig.screenCenter.x, ceilY, rig.screenCenter.z + 6.4);

  seatDust();
}

/* The model ships lit for daylight — white walls would turn the screen
   spill into a swimming pool. Pull every surface down to a dark matte
   value and let the film be the only bright thing in the room. */
function dressMaterials(model, screenNode) {
  const screenSet = new Set();
  if (screenNode) screenNode.traverse((o) => screenSet.add(o));

  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const isScreen = screenSet.has(o);
    const isFixture = underNamed(o, "light");
    const isStep = underNamed(o, "floor_metal");
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((src) => {
      const m = src.clone();
      if (m.color) {
        if (isScreen) {
          m.color.setRGB(0.018, 0.018, 0.02);            // matte screen + masking
        } else {
          const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
          if (lum > CONFIG.wallLuminance) m.color.multiplyScalar(CONFIG.wallLuminance / lum);
        }
      }
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness ?? 1, isScreen ? 0.96 : 0.72);
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness ?? 0, 0.12);
      m.envMapIntensity = 0.06;
      // the ceiling fixtures are driven by houseLevel, so they visibly go
      // down when the film starts; the step nosings stay unlit — as
      // emissives they draw a hard glowing line straight across the seats
      if (isFixture) {
        m.emissive = new THREE.Color(0xffb673);
        m.emissiveIntensity = 0.07;
        fixtureMats.push(m);
      }
      if (isStep) { m.emissive = new THREE.Color(0x000000); m.emissiveIntensity = 0; }
      return m;
    });
    o.material = out.length === 1 ? out[0] : out;
  });
}

function underNamed(obj, name) {
  for (let p = obj; p; p = p.parent) if ((p.name || "").toLowerCase() === name) return true;
  return false;
}

/* ============================================================
   THE FILM
   ============================================================ */
const EL_W = 1280, EL_H = 720;
function mountScreen() {
  filmWrap = document.createElement("div");
  filmWrap.className = "screen-el";
  filmWrap.style.width = EL_W + "px";
  filmWrap.style.height = EL_H + "px";

  const scaler = document.createElement("div");
  scaler.className = "screen-el__scaler";
  scaler.style.transform = `scale(${CONFIG.overscan})`;
  const holder = document.createElement("div");
  holder.id = "ytplayer";
  scaler.appendChild(holder);

  // the house stays dark until the film is actually running, so YouTube's
  // poster state and title card never make it to the screen
  filmCover = document.createElement("div");
  filmCover.className = "screen-el__cover";

  // and before anything is picked, the screen holds a slide — the way a
  // house sits on its title card with the lights still up
  filmIdle = document.createElement("div");
  filmIdle.className = "screen-el__idle";
  filmIdle.innerHTML =
    '<img class="screen-idle__mark" src="/logo.svg" alt="" />' +
    '<p class="screen-idle__msg">Slot in a cassette</p>';

  filmWrap.append(scaler, filmCover, filmIdle);

  screenObject = new CSS3DObject(filmWrap);
  screenObject.position.copy(rig.screenCenter);
  screenObject.position.z += 0.02;
  screenObject.scale.setScalar(rig.filmW / EL_W);
  cssScene.add(screenObject);

  // the hole: alpha 0 + depth, so anything nearer draws over the film and
  // anything behind is hidden by it
  const punch = new THREE.Mesh(
    new THREE.PlaneGeometry(rig.filmW, rig.filmH),
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: true, blending: THREE.NoBlending })
  );
  punch.position.copy(screenObject.position);
  scene.add(punch);
}

function setScreenLive(live) {
  if (filmCover) filmCover.classList.toggle("is-clear", !!live);
}

/* ============================================================
   FRAME COLOUR — sampled from the film's own published frames.
   hq1/hq2/hq3.jpg are the frames at 25/50/75%, and they are
   canvas-readable. Each becomes an anchor of {chromaticity, luma}.
   ============================================================ */
const FALLBACK = { chroma: new THREE.Color(0xd8dcea), luma: 0.34 };

function sampleImage(url) {
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 32; c.height = 18;
        const cx = c.getContext("2d", { willReadFrequently: true });
        // hq thumbs are 4:3 with pillar/letterbox bars — read the 16:9 middle
        const sh = im.naturalWidth * 9 / 16;
        const sy = Math.max(0, (im.naturalHeight - sh) / 2);
        cx.drawImage(im, 0, sy, im.naturalWidth, sh, 0, 0, 32, 18);
        const d = cx.getImageData(0, 0, 32, 18).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        r /= n * 255; g /= n * 255; b /= n * 255;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // split colour from brightness: the light's hue is the frame's
        // chromaticity, its intensity is the frame's luminance
        const peak = Math.max(r, g, b, 0.001);
        const chroma = new THREE.Color(r / peak, g / peak, b / peak);
        // real spill is a little less saturated than a raw pixel average
        chroma.lerp(new THREE.Color(0xffffff), 0.12);
        resolve({ chroma, luma });
      } catch (e) { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

async function loadFilmColors(film) {
  if (film.anchors) return film.anchors;
  const shots = await Promise.all(
    [["hq1", 0.25], ["hq2", 0.5], ["hq3", 0.75]]
      .map(async ([name, t]) => {
        const s = await sampleImage(`https://i.ytimg.com/vi/${film.id}/${name}.jpg`);
        return s ? { t, ...s } : null;
      })
  );
  const anchors = shots.filter(Boolean);
  film.anchors = anchors.length ? anchors : [{ t: 0.5, ...FALLBACK }];
  return film.anchors;
}

/* interpolate the anchors at playback position p */
const _chroma = new THREE.Color();
function frameGradeAt(anchors, p) {
  if (!anchors || !anchors.length) return { chroma: _chroma.copy(FALLBACK.chroma), luma: FALLBACK.luma };
  if (p <= anchors[0].t) return { chroma: _chroma.copy(anchors[0].chroma), luma: anchors[0].luma };
  for (let i = 1; i < anchors.length; i++) {
    if (p <= anchors[i].t) {
      const a = anchors[i - 1], b = anchors[i];
      const k = (p - a.t) / (b.t - a.t);
      _chroma.copy(a.chroma).lerp(b.chroma, k);
      return { chroma: _chroma, luma: a.luma + (b.luma - a.luma) * k };
    }
  }
  const last = anchors[anchors.length - 1];
  return { chroma: _chroma.copy(last.chroma), luma: last.luma };
}

/* ============================================================
   YOUTUBE PLAYER
   ============================================================ */
const ytReady = new Promise((resolve) => {
  if (window.YT && window.YT.Player) return resolve(window.YT);
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { if (typeof prev === "function") prev(); resolve(window.YT); };
});

let player = null;
let playerReady = false;
let currentIndex = 0;
let isPlaying = false;
let userVolume = 70;
let soundUnlocked = false;
/* Local source of truth for mute. The IFrame API's mute()/unMute() are
   async postMessage calls, so reading isMuted() straight back after one
   returns the OLD value and the button paints itself a state behind. */
let muted = true;          // the player is created muted so autoplay is allowed

async function buildPlayer() {
  const YT = await ytReady;
  player = new YT.Player("ytplayer", {
    videoId: films[0].id,
    width: EL_W,
    height: EL_H,
    // nothing rolls on its own — the reel waits for a cassette
    playerVars: {
      autoplay: 0, mute: 1, controls: 0, rel: 0, modestbranding: 1,
      playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1
    },
    events: { onReady: onPlayerReady, onStateChange: onPlayerState }
  });
}

function onPlayerReady() {
  playerReady = true;
  player.setVolume(userVolume);
  booth.hidden = false;
  requestAnimationFrame(() => booth.classList.add("is-ready"));
  updateVolUI();
}

function onPlayerState(e) {
  const YT = window.YT;
  isPlaying = e.data === YT.PlayerState.PLAYING;
  // buffering still counts as "running" for the button: the action it
  // offers is pause, even while the picture is catching up
  paintPlayIcon(isPlaying || e.data === YT.PlayerState.BUFFERING);
  // reveal the screen only once frames are actually moving
  if (e.data === YT.PlayerState.PLAYING) {
    setScreenLive(true);
    dimIntro();
    if (!soundUnlocked) soundNote.hidden = false;
    // a newly loaded video can arrive with its own mute state — make the
    // player match what the button is showing
    if (muted) player.mute();
    else { player.unMute(); player.setVolume(userVolume); }
  } else if (e.data !== YT.PlayerState.PAUSED) setScreenLive(false);
  // the house doesn't sit on YouTube's replay card: roll the next reel, or
  // run this one again if it's the only cassette on the shelf
  if (e.data === YT.PlayerState.ENDED) {
    if (films.length > 1) loadFilm(currentIndex + 1, { fromUser: false });
    else { player.seekTo(0, true); player.playVideo(); }
  }
}

/* First real interaction brings the sound up. The volume controls are
   exempt — otherwise pressing "unmute" would unmute here and then get
   toggled straight back to muted by the button's own handler. */
function unlockSound(e) {
  if (soundUnlocked) return;
  soundUnlocked = true;
  soundNote.hidden = true;
  ensureAudio();
  const fromVolume = e && e.target && e.target.closest && e.target.closest("#btnMute, #vol");
  if (!fromVolume) setMuted(false);
}
window.addEventListener("pointerdown", unlockSound);
window.addEventListener("keydown", unlockSound);

function setMuted(next) {
  muted = !!next;
  if (playerReady) {
    if (muted) player.mute();
    else {
      player.unMute();
      if (userVolume === 0) userVolume = 60;
      player.setVolume(userVolume);
    }
  }
  updateVolUI();
}

function loadFilm(index, { fromUser = true } = {}) {
  if (!films.length) return;
  currentIndex = (index + films.length) % films.length;
  setLoaded(currentIndex);
  dimIntro();
  setScreenLive(false);
  // first cassette of the session: take the house lights down and clear
  // the title slide off the screen
  showStarted = true;
  if (filmIdle) filmIdle.classList.add("is-off");
  loadFilmColors(films[currentIndex]);
  if (fromUser) playClunk();
  if (player && playerReady) player.loadVideoById(films[currentIndex].id);
}

function setLoaded(index) {
  [].forEach.call(rackList.children, (c, i) => {
    c.classList.toggle("is-loaded", i === index);
    c.setAttribute("aria-selected", i === index ? "true" : "false");
  });
  // prev/next in the booth can pick a tape that's off the end of the shelf —
  // walk the rack to it so the lit spine is always where you can see it
  const loaded = rackList.children[index];
  if (loaded && loaded.scrollIntoView) {
    loaded.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center"
    });
  }
}

/* ============================================================
   CASSETTE RACK
   ============================================================ */
function buildRack() {
  rackCount.textContent = films.length + (films.length === 1 ? " film" : " films");
  films.forEach((f, i) => {
    const c = document.createElement("button");
    c.className = "cassette";
    c.type = "button";
    c.setAttribute("role", "option");
    c.innerHTML =
      '<span class="cassette__spine" aria-hidden="true"></span>' +
      '<span class="cassette__body">' +
        '<span class="cassette__win"><img alt="" loading="lazy"></span>' +
        '<span class="cassette__meta">' +
          '<span class="cassette__title"></span>' +
          '<span class="cassette__sub"></span>' +
        '</span>' +
      '</span>';
    c.querySelector(".cassette__title").textContent = f.title || ("Film " + (i + 1));
    c.querySelector(".cassette__sub").textContent = f.year || "Film";
    const img = c.querySelector("img");
    img.addEventListener("load", () => img.classList.add("is-ready"));
    img.src = "https://i.ytimg.com/vi/" + f.id + "/hqdefault.jpg";
    c.addEventListener("click", () => { unlockSound(); loadFilm(i); });
    rackList.appendChild(c);
    if (!f.title) enrichTitle(f, c.querySelector(".cassette__title"));
  });
}

async function enrichTitle(f, node) {
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=" + f.id);
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.title) { f.title = j.title; node.textContent = j.title; }
  } catch (e) { /* offline or CORS — the fallback label stands */ }
}

let introDimmed = false;
function dimIntro() {
  if (introDimmed || !intro) return;
  introDimmed = true;
  intro.classList.add("is-dimmed");
}

/* ============================================================
   BOOTH CONTROLS
   ============================================================ */
function fmt(t) {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}

els.play.addEventListener("click", () => {
  if (!playerReady) return;
  // from the idle slide, play means "start the show" — roll the cassette
  // that's sitting in the deck
  if (!showStarted) { loadFilm(currentIndex); paintPlayIcon(true); return; }
  if (isPlaying) player.pauseVideo(); else player.playVideo();
  paintPlayIcon(!isPlaying);   // answer the click now; the state event confirms
});
els.prev.addEventListener("click", () => loadFilm(currentIndex - 1));
els.next.addEventListener("click", () => loadFilm(currentIndex + 1));
els.back10.addEventListener("click", () => { if (playerReady) { player.seekTo(Math.max(0, player.getCurrentTime() - 10), true); playTick(); } });
els.fwd10.addEventListener("click", () => { if (playerReady) { player.seekTo(player.getCurrentTime() + 10, true); playTick(); } });

els.mute.addEventListener("click", () => {
  setMuted(!muted);
  playTick();
});
els.vol.addEventListener("input", () => {
  userVolume = +els.vol.value;
  if (userVolume === 0) setMuted(true);
  else if (muted) setMuted(false);            // dragging up un-mutes
  else if (playerReady) player.setVolume(userVolume);
});
/* icon swaps go through a class: see the note in theater.css — assigning
   .hidden on an SVG element silently does nothing */
function paintPlayIcon(running) {
  els.icPlay.classList.toggle("is-off", running);
  els.icPause.classList.toggle("is-off", !running);
  els.play.setAttribute("aria-label", running ? "Pause" : "Play");
}

/* paints from the local `muted` flag, never from a read-back */
function updateVolUI() {
  els.vol.value = muted ? 0 : userVolume;
  els.icVol.classList.toggle("is-off", muted);
  els.icMute.classList.toggle("is-off", !muted);
  els.mute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
}

els.full.addEventListener("click", () => {
  const shell = document.querySelector(".theater-shell");
  if (document.fullscreenElement) document.exitFullscreen();
  else if (shell.requestFullscreen) shell.requestFullscreen();
});

let scrubbing = false;
const scrubFrac = (clientX) => {
  const r = els.scrub.getBoundingClientRect();
  return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
};
function paintScrub(frac) {
  els.scrubFill.style.width = frac * 100 + "%";
  els.scrubKnob.style.left = frac * 100 + "%";
}
els.scrub.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  booth.classList.add("is-scrubbing");
  els.scrub.setPointerCapture(e.pointerId);
  paintScrub(scrubFrac(e.clientX));
});
els.scrub.addEventListener("pointermove", (e) => {
  if (!scrubbing) return;
  const frac = scrubFrac(e.clientX);
  paintScrub(frac);
  if (playerReady) els.tCur.textContent = fmt(frac * (player.getDuration() || 0));
});
els.scrub.addEventListener("pointerup", (e) => {
  if (!scrubbing) return;
  scrubbing = false;
  booth.classList.remove("is-scrubbing");
  if (playerReady) {
    const dur = player.getDuration() || 0;
    if (dur) player.seekTo(scrubFrac(e.clientX) * dur, true);
  }
  playTick();
});
els.scrub.addEventListener("keydown", (e) => {
  if (!playerReady) return;
  const dur = player.getDuration() || 0;
  if (!dur) return;
  if (e.key === "ArrowRight") { player.seekTo(Math.min(dur, player.getCurrentTime() + 5), true); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { player.seekTo(Math.max(0, player.getCurrentTime() - 5), true); e.preventDefault(); }
});

window.addEventListener("keydown", (e) => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if (e.key === " " || e.key === "k") { e.preventDefault(); els.play.click(); }
  else if (e.key === "m") els.mute.click();
  else if (e.key === "f") els.full.click();
  else if (e.key === "n") els.next.click();
  else if (e.key === "p") els.prev.click();
  else if (e.key === "ArrowRight" && playerReady) player.seekTo(player.getCurrentTime() + 5, true);
  else if (e.key === "ArrowLeft" && playerReady) player.seekTo(Math.max(0, player.getCurrentTime() - 5), true);
});

function updateBooth() {
  if (!playerReady) return;
  const dur = player.getDuration ? player.getDuration() : 0;
  const cur = player.getCurrentTime ? player.getCurrentTime() : 0;
  if (!scrubbing && dur) {
    paintScrub(cur / dur);
    els.scrub.setAttribute("aria-valuenow", Math.round((cur / dur) * 100));
  }
  if (player.getVideoLoadedFraction) els.scrubBuffer.style.width = player.getVideoLoadedFraction() * 100 + "%";
  els.tCur.textContent = fmt(cur);
  els.tDur.textContent = fmt(dur);
}

/* ============================================================
   THE LIGHT ON THE ROOM
   ============================================================ */
const lit = { color: new THREE.Color(0xd8dcea), level: 0.1 };
let shakeEnergy = 0;

function updateLight(dt) {
  const film = films[currentIndex];
  let p = 0.25;
  if (playerReady && player.getDuration) {
    const dur = player.getDuration() || 0;
    if (dur) p = Math.min(1, Math.max(0, player.getCurrentTime() / dur));
  }
  const grade = frameGradeAt(film && film.anchors, p);

  // the screen is only emitting if there is actually a picture on it
  const showing = isPlaying || (playerReady && player.getPlayerState && player.getPlayerState() === 2);
  let target = showing ? grade.luma : 0.02;
  if (isPlaying) {
    // motion inside the shot. A paused frame emits steady light, so this
    // only rides along while the film is running.
    const t = clock.elapsedTime;
    target *= 1 + (Math.sin(t * 11.3) * 0.5 + Math.sin(t * 19.7 + 1.3) * 0.3 + Math.sin(t * 3.1) * 0.2) * 0.1;
  }
  lit.level += (target - lit.level) * Math.min(1, dt * 3.2);
  lit.color.lerp(grade.chroma, Math.min(1, dt * 1.6));

  const L = Math.max(0.015, lit.level);
  screenLight.color.copy(lit.color);
  screenLight.intensity = 1 + L * 46;
  fillLight.color.copy(lit.color);
  fillLight.intensity = 0.3 + L * 9;
  paintBleed(L);

  // house lights ride down as the show begins and back up when it's over
  houseLevel += ((showStarted ? 0 : 1) - houseLevel) * Math.min(1, dt * 1.1);
  houseFront.intensity = houseLevel * 4.5;
  houseBack.intensity = houseLevel * 3.5;
  aisleL.intensity = aisleR.intensity = 0.9 + houseLevel * 1.2;
  for (let i = 0; i < fixtureMats.length; i++) {
    fixtureMats[i].emissiveIntensity = 0.07 + houseLevel * 1.5;
  }

  if (isPlaying) shakeEnergy = Math.min(1, shakeEnergy + dt * 0.25);
}

/* light bleeding off the panel edges — a DOM shadow on the film element,
   so it follows the 3D transform for free. Paint-only, and throttled. */
let bleedTick = 0;
function paintBleed(L) {
  if (!filmWrap || ++bleedTick % 4) return;
  const c = lit.color;
  const r = (c.r * 255) | 0, g = (c.g * 255) | 0, b = (c.b * 255) | 0;
  filmWrap.style.boxShadow =
    `0 0 ${Math.round(50 + L * 130)}px ${Math.round(4 + L * 26)}px rgba(${r},${g},${b},${(0.06 + L * 0.3).toFixed(3)})`;
}

/* ============================================================
   CAMERA — a person sitting still, breathing.
   ============================================================ */
const _tar = new THREE.Vector3();
const _tmp = new THREE.Vector3();
function updateCamera(dt) {
  shakeEnergy = Math.max(0, shakeEnergy - dt * 0.22);
  if (!CONFIG.shake) {
    camera.position.copy(rig.camBase);
    camera.lookAt(rig.camTarget);
    return;
  }
  const t = clock.elapsedTime;
  const amp = 0.7 + shakeEnergy * 0.4;
  _tmp.set(
    (Math.sin(t * 0.83) * 0.6 + Math.sin(t * 2.11 + 1.1) * 0.2) * 0.006 * amp,
    (Math.sin(t * 1.31 + 0.5) * 0.5 + Math.sin(t * 0.57) * 0.4) * 0.005 * amp,
    Math.sin(t * 0.68 + 2) * 0.004 * amp
  );
  camera.position.copy(rig.camBase).add(_tmp);
  _tmp.set(
    (Math.sin(t * 1.07 + 0.3) * 0.5 + Math.sin(t * 2.7) * 0.2) * 0.008 * amp,
    Math.sin(t * 0.79 + 1.4) * 0.006 * amp,
    0
  );
  // no roll: a head resting on a seat back doesn't tilt, and any z-rotation
  // reads as the whole room being crooked
  camera.lookAt(_tar.copy(rig.camTarget).add(_tmp));
}

/* ============================================================
   DUST — a few motes in the light in front of the lens
   ============================================================ */
let motes = null;
const DUST = { n: 150, pos: null };
function buildDust() {
  DUST.pos = new Float32Array(DUST.n * 3);
  for (let i = 0; i < DUST.n; i++) {
    DUST.pos[i * 3] = (Math.random() - 0.5) * 4;
    DUST.pos[i * 3 + 1] = (Math.random() - 0.5) * 2.4;
    DUST.pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
  }
  const sc = document.createElement("canvas");
  sc.width = sc.height = 48;
  const ctx = sc.getContext("2d");
  const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, "rgba(255,250,240,1)");
  g.addColorStop(0.45, "rgba(255,245,232,0.4)");
  g.addColorStop(1, "rgba(255,242,226,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 48, 48);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(DUST.pos, 3));
  motes = new THREE.Points(geo, new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(sc), size: 0.02, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  motes.frustumCulled = false;
  scene.add(motes);
}
function seatDust() {
  if (motes) motes.position.set(rig.camBase.x, rig.camBase.y + 0.3, rig.camBase.z - 1.6);
}
function updateDust(dt) {
  if (!motes) return;
  const p = DUST.pos, t = clock.elapsedTime;
  for (let i = 0; i < DUST.n; i++) {
    const ix = i * 3;
    p[ix] += (Math.sin(t * 0.31 + i) * 0.5 + 0.3) * dt * 0.045;
    p[ix + 1] += Math.sin(t * 0.47 + i * 1.7) * dt * 0.04;
    if (p[ix] > 2) p[ix] = -2;
    if (p[ix + 1] > 1.2) p[ix + 1] = -1.2;
    else if (p[ix + 1] < -1.2) p[ix + 1] = 1.2;
  }
  motes.geometry.attributes.position.needsUpdate = true;
  motes.material.opacity = 0.08 + lit.level * 0.3;
}

/* ============================================================
   LOOP
   ============================================================ */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateLight(dt);
  updateCamera(dt);
  updateDust(dt);
  cssRenderer.render(cssScene, camera);
  renderer.render(scene, camera);
  updateBooth();
}

/* ============================================================
   ROOM FOLEY
   ============================================================ */
let actx = null, reverb = null, dryGain = null, wetGain = null;
function ensureAudio() {
  if (actx) { if (actx.state === "suspended") actx.resume(); return; }
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const secs = 1.9, rate = actx.sampleRate, len = (secs * rate) | 0;
  const imp = actx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = imp.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  reverb = actx.createConvolver();
  reverb.buffer = imp;
  wetGain = actx.createGain(); wetGain.gain.value = 0.3;
  dryGain = actx.createGain(); dryGain.gain.value = 0.75;
  reverb.connect(wetGain).connect(actx.destination);
  dryGain.connect(actx.destination);
}
function voice(node, peak, dur) {
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, actx.currentTime + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  node.connect(g);
  g.connect(dryGain);
  g.connect(reverb);
}
function noiseBurst(peak, dur, freq) {
  const len = (actx.sampleRate * dur) | 0;
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const bp = actx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = 0.9;
  src.connect(bp);
  voice(bp, peak, dur);
  src.start();
}
function playClunk() {
  ensureAudio(); if (!actx) return;
  noiseBurst(0.42, 0.09, 190);
  setTimeout(() => { if (actx) noiseBurst(0.5, 0.14, 95); }, 70);
  const osc = actx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(115, actx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(52, actx.currentTime + 0.12);
  voice(osc, 0.14, 0.18);
  osc.start();
  osc.stop(actx.currentTime + 0.2);
}
function playTick() {
  ensureAudio(); if (!actx) return;
  noiseBurst(0.12, 0.03, 2600);
}

/* ============================================================
   RESIZE
   ============================================================ */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============================================================
   GO — last, so every binding above is live before init() runs
   ============================================================ */
async function init() {
  if (!films.length) return;
  buildRack();
  buildDust();
  loadFilmColors(films[0]);
  try {
    const gltf = await gltfLoader.loadAsync("/theater/theater.glb");
    layoutTheater(gltf.scene);
    mountScreen();
    buildPlayer();
    loading.classList.add("is-hidden");
    rig.ready = true;
    animate();
  } catch (err) {
    console.error(err);
    loading.textContent = "Theater failed to load";
    loading.classList.remove("is-hidden");
  }
}
init();
