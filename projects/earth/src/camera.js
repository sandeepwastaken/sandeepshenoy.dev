import * as THREE from 'three';

// Spacecraft-style orbital camera.
//  • Position is a sub-satellite point (lon/lat, same convention as RA/Dec) plus altitude.
//  • Dragging "grabs" the globe: angular speed scales with altitude so the ground under the
//    cursor tracks it, with momentum that bleeds off after release.
//  • Zoom is logarithmic in altitude (a scroll step is the same fraction at GEO and LEO),
//    clamped between low Earth orbit and ~30 Earth radii.
//  • Far away the camera frames the whole disc; as the planet outgrows the frame it pitches
//    up toward the horizon, so low orbit looks out at the limb like an ISS window.
//  • Lens: ~50 mm-equivalent far out, widening toward ~30 mm in low orbit.

const MIN_ALT = 420 / 6371;           // ISS altitude, in Earth radii
const MAX_ALT = 30;
const MAX_LAT = 80 * Math.PI / 180;
const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export class OrbitalCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.lon = 0; this.lat = 0; this.logAlt = Math.log(3);
    this.goal = { lon: 0, lat: 0, logAlt: Math.log(3) };
    this.vel = { lon: 0, lat: 0 };
    this.pointers = new Map();
    this.pinchDist = 0;
    this.lastMove = 0;
    this.onInteract = null;
    this.fovV = 30;

    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', e => this.#down(e));
    dom.addEventListener('pointermove', e => this.#move(e));
    dom.addEventListener('pointerup', e => this.#up(e));
    dom.addEventListener('pointercancel', e => this.#up(e));
    dom.addEventListener('wheel', e => this.#wheel(e), { passive: false });
  }

  get altitude() { return Math.exp(this.logAlt); }

  setView(lon, lat, alt) {
    this.lon = this.goal.lon = lon;
    this.lat = this.goal.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    this.logAlt = this.goal.logAlt = Math.log(Math.max(MIN_ALT, Math.min(MAX_ALT, alt)));
    this.vel.lon = this.vel.lat = 0;
  }

  // Radians of orbit per CSS pixel of drag: pixel angle × distance to the ground.
  #dragScale() {
    const pxAngle = THREE.MathUtils.degToRad(this.fovV) / Math.max(this.dom.clientHeight, 1);
    return pxAngle * Math.max(Math.exp(this.goal.logAlt), 0.12) * 1.1;
  }

  #down(e) {
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.vel.lon = this.vel.lat = 0;
    if (this.pointers.size === 2) this.pinchDist = this.#pinchSpan();
    this.onInteract?.();
  }

  #move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 2) {
      const span = this.#pinchSpan();
      if (this.pinchDist > 0) this.#zoom(-Math.log(span / this.pinchDist));
      this.pinchDist = span;
      return;
    }
    const k = this.#dragScale();
    const dLon = -dx * k / Math.max(Math.cos(this.goal.lat), 0.3), dLat = dy * k;
    this.goal.lon += dLon;
    this.goal.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.goal.lat + dLat));
    const now = performance.now();
    const dt = Math.max((now - this.lastMove) / 1000, 1 / 240);
    this.lastMove = now;
    // Velocity estimate (smoothed) for the release fling.
    const a = Math.min(dt * 12, 1);
    this.vel.lon += (dLon / dt - this.vel.lon) * a;
    this.vel.lat += (dLat / dt - this.vel.lat) * a;
  }

  #up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    // A pause before release means no fling.
    if (performance.now() - this.lastMove > 90) this.vel.lon = this.vel.lat = 0;
  }

  #pinchSpan() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  #wheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.#zoom(Math.max(-120, Math.min(120, e.deltaY * unit)) * 0.0022);
    this.onInteract?.();
  }

  #zoom(dLog) {
    this.goal.logAlt = Math.max(Math.log(MIN_ALT), Math.min(Math.log(MAX_ALT), this.goal.logAlt + dLog));
  }

  update(dt, aspect) {
    const dragging = this.pointers.size > 0;
    if (!dragging) {
      this.goal.lon += this.vel.lon * dt;
      this.goal.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.goal.lat + this.vel.lat * dt));
      const decay = Math.exp(-dt / 0.55);
      this.vel.lon *= decay; this.vel.lat *= decay;
    }
    const kPos = 1 - Math.exp(-dt * 9);
    const kAlt = 1 - Math.exp(-dt * 4.5);
    this.lon += (this.goal.lon - this.lon) * kPos;
    this.lat += (this.goal.lat - this.lat) * kPos;
    this.logAlt += (this.goal.logAlt - this.logAlt) * kAlt;

    const alt = Math.exp(this.logAlt);
    const d = 1 + alt;
    const s = smoothstep(Math.log(0.15), Math.log(4), this.logAlt);

    // Lens: horizontal-safe vertical FOV (portrait screens keep the same horizontal view).
    const fov = THREE.MathUtils.lerp(36, 27, s);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    this.fovV = THREE.MathUtils.radToDeg(2 * Math.atan(aspect < 1 ? halfTan / aspect : halfTan));

    const cl = Math.cos(this.lat);
    const pos = new THREE.Vector3(cl * Math.cos(this.lon), Math.sin(this.lat), -cl * Math.sin(this.lon)).multiplyScalar(d);
    const nadir = pos.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, nadir);

    // Pitch toward the horizon once the disc no longer fits: hold the limb at a fixed
    // height in frame (near the top far out, about a third down in low orbit).
    const fovRad = THREE.MathUtils.degToRad(this.fovV);
    const earthAng = Math.asin(1 / d);
    const limbHold = THREE.MathUtils.lerp(0.2, 0.46, s) * fovRad;
    const excess = earthAng - limbHold;
    const soft = 0.06;
    const tilt = excess > soft ? excess : soft * Math.exp(excess / soft - 1);   // smooth max(0, x)

    const forward = nadir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt));
    const camUp = new THREE.Vector3().crossVectors(right, forward);

    this.camera.position.copy(pos);
    this.camera.up.copy(camUp);
    this.camera.lookAt(pos.clone().add(forward));
    this.camera.fov = this.fovV;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
