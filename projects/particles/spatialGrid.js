import { CONFIG } from "./config.js";

/**
 * Uniform spatial hash over the toroidal world, built with a counting sort.
 *
 * Layout: `cellStart[c] .. cellStart[c + 1]` is the slice of `items` holding the
 * particle indices in cell `c`. Rebuilding is two linear passes plus a prefix
 * sum — no Maps, no per-cell arrays, and zero allocation once warmed up, which
 * is what lets the sim carry tens of thousands of particles.
 *
 * Cell size is always >= the interaction radius, so the block of cells around a
 * particle is guaranteed to contain every neighbour within range.
 */
export class SpatialGrid {
  constructor() {
    this.cols = 0;
    this.rows = 0;
    this.cellSize = 0;
    this.cellStart = new Int32Array(0);
    this.cursor = new Int32Array(0);
    this.items = new Int32Array(0);
  }

  /**
   * Resize the grid for a given interaction radius. The world is split into a
   * whole number of cells so wrapping stays exact; a minimum of 4 columns/rows
   * keeps the physics pass's half-neighbourhood walk from meeting the same cell
   * from two directions and resolving a pair twice.
   */
  configure(radius) {
    const world = CONFIG.worldSize;
    const cols = Math.max(4, Math.floor(world / radius));
    if (cols === this.cols) return;
    this.cols = cols;
    this.rows = cols;
    this.cellSize = world / cols;
    const cellCount = cols * cols;
    this.cellStart = new Int32Array(cellCount + 1);
    this.cursor = new Int32Array(cellCount);
  }

  /**
   * Rebuild the grid AND permute the pool into grid order.
   *
   * Because particles end up physically stored cell by cell, `cellStart[c] ..
   * cellStart[c + 1]` is a contiguous range of particle indices — the physics
   * loop can walk neighbours with no indirection at all, and the reads stay in
   * cache. This is the single biggest performance win in the simulation.
   */
  rebuild(pool) {
    const count = pool.count;
    const cols = this.cols;
    const cellCount = cols * this.rows;
    const inverseCellSize = 1 / this.cellSize;
    const cellStart = this.cellStart;
    const cursor = this.cursor;

    if (this.items.length < count) this.items = new Int32Array(Math.max(count, this.items.length * 2 || 1024));
    const items = this.items;

    cellStart.fill(0);

    // Pass 1: tally how many particles land in each cell.
    for (let i = 0; i < count; i++) {
      let cx = (pool.x[i] * inverseCellSize) | 0;
      let cy = (pool.y[i] * inverseCellSize) | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= cols) cy = cols - 1;
      cellStart[cy * cols + cx + 1]++;
    }

    // Prefix sum turns the tallies into slice offsets.
    for (let c = 0; c < cellCount; c++) {
      cellStart[c + 1] += cellStart[c];
      cursor[c] = cellStart[c];
    }

    // Pass 2: scatter particle indices into their slices.
    for (let i = 0; i < count; i++) {
      let cx = (pool.x[i] * inverseCellSize) | 0;
      let cy = (pool.y[i] * inverseCellSize) | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= cols) cy = cols - 1;
      items[cursor[cy * cols + cx]++] = i;
    }

    pool.reorder(items);
  }
}
