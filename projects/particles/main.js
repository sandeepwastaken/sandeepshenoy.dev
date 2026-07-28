import { CONFIG } from "./config.js";
import { Simulation } from "./simulation.js";
import { UI } from "./ui.js";
import { wrap } from "./utils.js";

/** Ring colour per brush, matching the tool buttons in the panel. */
const BRUSH_COLORS = {
  attract: "rgb(120,180,255)",
  repel: "rgb(255,120,120)",
  stir: "rgb(190,150,255)",
  feed: "rgb(140,220,150)",
  seed: "rgb(255,205,120)",
  erase: "rgb(255,255,255)",
  zap: "rgb(255,230,80)"
};

/**
 * Canvas renderer.
 *
 * Deliberately plain: opaque background cleared every frame (no trails, no
 * motion blur), one flat colour per species, no additive blending, no glow, no
 * background gradients. Every particle is a solid dot.
 *
 * The world is a torus, so the view is tiled: the same world is drawn once per
 * visible repetition, which makes panning feel like an endless map.
 */
class Renderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.simulation = simulation;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.camera = { x: CONFIG.worldSize / 2, y: CONFIG.worldSize / 2, zoom: 1 };
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    // When set, every other species is drawn faint so one lineage can be
    // followed through a crowded world. Held as the species object rather than
    // its id, because ids are reassigned when extinct lineages are retired.
    this.highlightSpecies = null;
    // Cursor position in world space, kept current whenever the pointer is over
    // the canvas so the brush ring can be drawn even before a drag starts.
    this.pointerWorld = { x: 0, y: 0, inside: false };
    // Reused counting-sort scratch, so batching never allocates per frame.
    this.offsets = new Int32Array(64);
    this.cursor = new Int32Array(64);
    this.order = new Int32Array(0);
    this.bindCamera();
    this.resize();
  }

  /**
   * Panning is always available on the middle button or with shift held, no
   * matter which tool is selected. Otherwise the left button drives the brush,
   * which is the whole point of having tools: reaching for a modifier every
   * time you want to push a colony out of the way defeats it.
   */
  isPanGesture(event) {
    return this.simulation.brush.mode === "pan" || event.button === 1 || event.shiftKey;
  }

  bindCamera() {
    const canvas = this.canvas;
    const brush = this.simulation.brush;

    canvas.addEventListener("pointerdown", (event) => {
      this.updatePointerWorld(event);
      canvas.setPointerCapture(event.pointerId);

      if (this.isPanGesture(event)) {
        this.isDragging = true;
        this.lastPointer.x = event.clientX;
        this.lastPointer.y = event.clientY;
        canvas.classList.add("is-dragging");
        return;
      }

      // Seed is a stamp, not a stroke: one colony per click, or a drag would
      // bury the region in thousands of particles within a second.
      if (brush.mode === "seed") {
        this.simulation.seedAt(
          this.pointerWorld.x,
          this.pointerWorld.y,
          this.highlightSpecies ? this.highlightSpecies.id : null
        );
        return;
      }

      brush.active = true;
      brush.x = this.pointerWorld.x;
      brush.y = this.pointerWorld.y;
    });

    canvas.addEventListener("pointermove", (event) => {
      this.updatePointerWorld(event);
      if (brush.active) {
        brush.x = this.pointerWorld.x;
        brush.y = this.pointerWorld.y;
      }
      if (!this.isDragging) return;
      const world = CONFIG.worldSize;
      this.camera.x = wrap(this.camera.x - (event.clientX - this.lastPointer.x) / this.camera.zoom, world);
      this.camera.y = wrap(this.camera.y - (event.clientY - this.lastPointer.y) / this.camera.zoom, world);
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
    });

    canvas.addEventListener("pointerleave", () => {
      this.pointerWorld.inside = false;
    });

    const endDrag = (event) => {
      brush.active = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!this.isDragging) return;
      this.isDragging = false;
      canvas.classList.remove("is-dragging");
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        // Zoom about the cursor: keep the world point under it fixed.
        const before = this.screenToWorld(event.clientX, event.clientY);
        const scale = Math.exp(-event.deltaY * 0.001);
        this.camera.zoom = Math.max(0.12, Math.min(6, this.camera.zoom * scale));
        const after = this.screenToWorld(event.clientX, event.clientY);
        const world = CONFIG.worldSize;
        this.camera.x = wrap(this.camera.x + before.x - after.x, world);
        this.camera.y = wrap(this.camera.y + before.y - after.y, world);
      },
      { passive: false }
    );
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.height = Math.max(1, Math.floor(rect.height * this.dpr));
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
  }

  resetCamera() {
    this.camera.x = CONFIG.worldSize / 2;
    this.camera.y = CONFIG.worldSize / 2;
    this.camera.zoom = Math.min(this.width / this.dpr, this.height / this.dpr) / CONFIG.worldSize;
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - rect.width / 2) / this.camera.zoom + this.camera.x,
      y: (clientY - rect.top - rect.height / 2) / this.camera.zoom + this.camera.y
    };
  }

  /** Cursor in world space, wrapped onto the torus like everything else. */
  updatePointerWorld(event) {
    const point = this.screenToWorld(event.clientX, event.clientY);
    const world = CONFIG.worldSize;
    this.pointerWorld.x = wrap(point.x, world);
    this.pointerWorld.y = wrap(point.y, world);
    this.pointerWorld.inside = true;
  }

  draw() {
    this.resize();
    const ctx = this.ctx;
    ctx.fillStyle = "#07090c";
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawConnections(ctx);
    this.drawParticles(ctx);
    this.drawBrush(ctx);
  }

  /**
   * The brush's reach, as a ring on the world. Drawn from the same wrapped
   * world coordinate the physics uses, so the ring lands exactly where the
   * force does even when the cursor is sitting across the torus seam.
   */
  drawBrush(ctx) {
    const brush = this.simulation.brush;
    if (brush.mode === "pan" || !this.pointerWorld.inside) return;

    const scale = this.camera.zoom * this.dpr;
    const tileSize = CONFIG.worldSize * scale;
    const radius = brush.radius * scale;
    if (radius < 2) return;

    let screenX = (this.pointerWorld.x - this.camera.x) * scale + this.width / 2;
    let screenY = (this.pointerWorld.y - this.camera.y) * scale + this.height / 2;
    // Pick the tile nearest the viewport centre, so the ring follows the cursor
    // across the seam instead of jumping to the far side of the map.
    screenX -= Math.round((screenX - this.width / 2) / tileSize) * tileSize;
    screenY -= Math.round((screenY - this.height / 2) / tileSize) * tileSize;

    ctx.save();
    ctx.lineWidth = Math.max(1, this.dpr);
    ctx.strokeStyle = BRUSH_COLORS[brush.mode] || "rgba(255,255,255,0.5)";
    ctx.globalAlpha = brush.active ? 0.95 : 0.45;
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.stroke();
    // A dot at the centre, so a large ring still reads as "this is a cursor".
    ctx.globalAlpha = brush.active ? 0.8 : 0.35;
    ctx.beginPath();
    ctx.arc(screenX, screenY, Math.max(1.5, 2 * this.dpr), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
  }

  drawConnections(ctx) {
    const simulation = this.simulation;
    const pool = simulation.pool;
    const count = pool.count;
    if (count === 0) return;

    const px = pool.x;
    const py = pool.y;
    const mass = pool.mass;
    const speciesIds = pool.species;
    const species = simulation.speciesManager.species;
    const world = CONFIG.worldSize;
    const halfWorld = world * 0.5;
    const scale = this.camera.zoom * this.dpr;
    const tileSize = world * scale;
    const originX = (0 - this.camera.x) * scale + this.width / 2;
    const originY = (0 - this.camera.y) * scale + this.height / 2;
    const firstTileX = Math.floor(-originX / tileSize);
    const firstTileY = Math.floor(-originY / tileSize);
    const tilesX = Math.ceil((this.width - originX - firstTileX * tileSize) / tileSize);
    const tilesY = Math.ceil((this.height - originY - firstTileY * tileSize) / tileSize);
    const margin = Math.max(8, simulation.settings.interactionRadius * scale);
    const highlight = this.highlightSpecies;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < count; i++) {
      for (let slot = 0; slot < 2; slot++) {
        const j = slot === 0 ? pool.link[i] : pool.linkB[i];
        if (j <= i || j >= count) continue;
        if (pool.link[j] !== i && pool.linkB[j] !== i) continue;

        const speciesI = species[speciesIds[i]];
        const speciesJ = species[speciesIds[j]];
        if (!speciesI || !speciesJ) continue;

        let dx = px[j] - px[i];
        let dy = py[j] - py[i];
        if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
        if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;

        const phase = slot === 0 ? pool.linkPhase[i] : pool.linkPhaseB[i];
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normalX = -dy / distance;
        const normalY = dx / distance;
        const bend = Math.sin(phase * 1.45) * Math.min(6, distance * 0.12) * scale;
        const lineWidth = Math.max(0.75, (0.8 + Math.sqrt(Math.max(mass[i], mass[j])) * 0.28) * this.dpr);
        const alpha = highlight && speciesI !== highlight && speciesJ !== highlight ? 0.08 : 0.46;

        ctx.strokeStyle = speciesI.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lineWidth;

        for (let tileY = 0; tileY <= tilesY; tileY++) {
          const offsetY = originY + (firstTileY + tileY) * tileSize;
          for (let tileX = 0; tileX <= tilesX; tileX++) {
            const offsetX = originX + (firstTileX + tileX) * tileSize;
            const x1 = px[i] * scale + offsetX;
            const y1 = py[i] * scale + offsetY;
            const x2 = (px[i] + dx) * scale + offsetX;
            const y2 = (py[i] + dy) * scale + offsetY;
            if (
              (x1 < -margin && x2 < -margin) ||
              (x1 > this.width + margin && x2 > this.width + margin) ||
              (y1 < -margin && y2 < -margin) ||
              (y1 > this.height + margin && y2 > this.height + margin)
            ) {
              continue;
            }

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.quadraticCurveTo((x1 + x2) * 0.5 + normalX * bend, (y1 + y2) * 0.5 + normalY * bend, x2, y2);
            ctx.stroke();
          }
        }
      }
    }

    ctx.restore();
  }

  drawParticles(ctx) {
    const simulation = this.simulation;
    const pool = simulation.pool;
    const species = simulation.speciesManager.species;
    const count = pool.count;
    if (count === 0) return;

    const scale = this.camera.zoom * this.dpr;
    const tileSize = CONFIG.worldSize * scale;
    // Screen position of world (0, 0) for the primary tile.
    const originX = (0 - this.camera.x) * scale + this.width / 2;
    const originY = (0 - this.camera.y) * scale + this.height / 2;
    // How many copies of the world are needed to cover the viewport.
    const firstTileX = Math.floor(-originX / tileSize);
    const firstTileY = Math.floor(-originY / tileSize);
    const tilesX = Math.ceil((this.width - originX - firstTileX * tileSize) / tileSize);
    const tilesY = Math.ceil((this.height - originY - firstTileY * tileSize) / tileSize);

    const radius = Math.max(1, 2 * scale);
    const useRects = radius < 1.6; // Rectangles are noticeably cheaper when tiny.
    const diameter = radius * 2;
    const margin = radius + 1;

    // Group particle indices by species with a counting sort into typed arrays,
    // so fillStyle is set once per species, every dot of that species lands in
    // a single path fill, and the frame allocates nothing at all.
    const speciesCount = species.length;
    if (this.offsets.length < speciesCount + 2) this.offsets = new Int32Array(speciesCount * 2 + 2);
    if (this.order.length < count) this.order = new Int32Array(Math.max(count, this.order.length * 2 || 4096));
    const offsets = this.offsets;
    const order = this.order;
    const ids = pool.species;

    offsets.fill(0, 0, speciesCount + 2);
    for (let i = 0; i < count; i++) offsets[ids[i] + 1]++;
    for (let s = 0; s < speciesCount; s++) offsets[s + 1] += offsets[s];
    // `cursor` walks the slices during the scatter; offsets[s] is restored by
    // reading the previous slice end, so no second array is needed.
    const cursor = this.cursor.length < speciesCount ? (this.cursor = new Int32Array(speciesCount * 2)) : this.cursor;
    for (let s = 0; s < speciesCount; s++) cursor[s] = offsets[s];
    for (let i = 0; i < count; i++) order[cursor[ids[i]]++] = i;

    const px = pool.x;
    const py = pool.y;
    const mass = pool.mass;

    const highlight = this.highlightSpecies;

    for (let s = 0; s < speciesCount; s++) {
      const bucketStart = offsets[s];
      const bucketEnd = offsets[s + 1];
      if (bucketStart === bucketEnd) continue;

      ctx.globalAlpha = !highlight || species[s] === highlight ? 1 : 0.12;
      ctx.fillStyle = species[s].color;
      ctx.beginPath();

      for (let tileY = 0; tileY <= tilesY; tileY++) {
        const offsetY = originY + (firstTileY + tileY) * tileSize;
        for (let tileX = 0; tileX <= tilesX; tileX++) {
          const offsetX = originX + (firstTileX + tileX) * tileSize;

          for (let index = bucketStart; index < bucketEnd; index++) {
            const i = order[index];
            const screenX = px[i] * scale + offsetX;
            if (screenX < -margin || screenX > this.width + margin) continue;
            const screenY = py[i] * scale + offsetY;
            if (screenY < -margin || screenY > this.height + margin) continue;

            const m = mass[i];
            if (m <= 1) {
              if (useRects) {
                ctx.rect(screenX - radius, screenY - radius, diameter, diameter);
              } else {
                ctx.moveTo(screenX + radius, screenY);
                ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
              }
            } else {
              const r = radius * Math.sqrt(m);
              ctx.moveTo(screenX + r, screenY);
              ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
            }
          }
        }
      }

      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

const canvas = document.getElementById("worldCanvas");
const simulation = new Simulation();
const renderer = new Renderer(canvas, simulation);
const ui = new UI(simulation, renderer);
renderer.resetCamera();

let lastTime = performance.now();
let smoothedFps = 60;
let uiAccumulator = 0;

// Exposed for inspection from the console: window.particleLife.timings shows
// where a frame goes, which is the only honest way to tune the simulation.
const timings = { stepMs: 0, drawMs: 0 };
window.particleLife = { simulation, renderer, ui, timings };

function animate(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  smoothedFps = smoothedFps * 0.92 + (1 / Math.max(0.001, dt)) * 0.08;

  const stepStart = performance.now();
  simulation.step(dt);
  const drawStart = performance.now();
  renderer.draw();
  const drawEnd = performance.now();
  timings.stepMs = timings.stepMs * 0.9 + (drawStart - stepStart) * 0.1;
  timings.drawMs = timings.drawMs * 0.9 + (drawEnd - drawStart) * 0.1;

  // The DOM panels are far more expensive than the canvas; refresh them at
  // roughly 5 Hz instead of every frame.
  uiAccumulator += dt;
  if (uiAccumulator > 0.2) {
    ui.update(smoothedFps);
    uiAccumulator = 0;
  }

  requestAnimationFrame(animate);
}

window.addEventListener("resize", () => renderer.resize());
requestAnimationFrame(animate);
