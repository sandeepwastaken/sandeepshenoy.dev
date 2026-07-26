import { CONFIG } from "./config.js";
import { Simulation } from "./simulation.js";
import { UI } from "./ui.js";
import { wrap } from "./utils.js";

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
    // Reused counting-sort scratch, so batching never allocates per frame.
    this.offsets = new Int32Array(64);
    this.cursor = new Int32Array(64);
    this.order = new Int32Array(0);
    this.bindCamera();
    this.resize();
  }

  bindCamera() {
    const canvas = this.canvas;

    canvas.addEventListener("pointerdown", (event) => {
      this.isDragging = true;
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!this.isDragging) return;
      const world = CONFIG.worldSize;
      this.camera.x = wrap(this.camera.x - (event.clientX - this.lastPointer.x) / this.camera.zoom, world);
      this.camera.y = wrap(this.camera.y - (event.clientY - this.lastPointer.y) / this.camera.zoom, world);
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
    });

    const endDrag = (event) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      canvas.releasePointerCapture(event.pointerId);
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

  draw() {
    this.resize();
    const ctx = this.ctx;
    ctx.fillStyle = "#07090c";
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawParticles(ctx);
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

            if (useRects) {
              ctx.rect(screenX - radius, screenY - radius, diameter, diameter);
            } else {
              ctx.moveTo(screenX + radius, screenY);
              ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
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
