import { CONFIG } from "./config.js";
import { randomRange } from "./utils.js";

/**
 * Particles are stored as a structure of arrays (SoA) rather than as objects.
 *
 * Why: the hot loop touches x/y/vx/vy of thousands of particles every frame.
 * Packing each attribute into its own contiguous typed array keeps those reads
 * cache-friendly, removes per-particle object headers, and means births and
 * deaths never allocate — we only ever move indices around.
 *
 * The pool is unordered: removing a particle swaps the last one into the hole
 * (O(1)) so the live range is always [0, count).
 */
export class ParticlePool {
  constructor(capacity = 8192) {
    this.count = 0;
    this.capacity = 0;
    this.allocate(capacity);
  }

  allocate(capacity) {
    const x = new Float32Array(capacity);
    const y = new Float32Array(capacity);
    const vx = new Float32Array(capacity);
    const vy = new Float32Array(capacity);
    const energy = new Float32Array(capacity);
    const age = new Float32Array(capacity);
    const maxAge = new Float32Array(capacity);
    const species = new Int32Array(capacity);
    const generation = new Int32Array(capacity);

    if (this.capacity > 0) {
      x.set(this.x.subarray(0, this.count));
      y.set(this.y.subarray(0, this.count));
      vx.set(this.vx.subarray(0, this.count));
      vy.set(this.vy.subarray(0, this.count));
      energy.set(this.energy.subarray(0, this.count));
      age.set(this.age.subarray(0, this.count));
      maxAge.set(this.maxAge.subarray(0, this.count));
      species.set(this.species.subarray(0, this.count));
      generation.set(this.generation.subarray(0, this.count));
    }

    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.energy = energy;
    this.age = age;
    this.maxAge = maxAge;
    this.species = species;
    this.generation = generation;
    this.capacity = capacity;
  }

  /** Grow geometrically so repeated births stay amortised O(1). */
  ensureCapacity(required) {
    if (required <= this.capacity) return;
    let capacity = this.capacity;
    while (capacity < required) capacity *= 2;
    this.allocate(Math.min(capacity, CONFIG.maxParticles));
  }

  clear() {
    this.count = 0;
  }

  /** Append a particle; returns its index, or -1 when the pool is full. */
  spawn(x, y, vx, vy, energy, speciesId, generation) {
    if (this.count >= CONFIG.maxParticles) return -1;
    this.ensureCapacity(this.count + 1);
    const index = this.count++;
    this.x[index] = x;
    this.y[index] = y;
    this.vx[index] = vx;
    this.vy[index] = vy;
    this.energy[index] = energy;
    this.age[index] = 0;
    // Individually varied lifespans keep populations from dying in lockstep.
    this.maxAge[index] = CONFIG.maxAgeSeconds * randomRange(1 - CONFIG.ageVariance, 1 + CONFIG.ageVariance);
    this.species[index] = speciesId;
    this.generation[index] = generation;
    return index;
  }

  /**
   * Permute every attribute array into the given order (double-buffered, so a
   * reorder costs one linear copy and zero allocation).
   *
   * The simulation uses this to lay particles out in spatial-grid order each
   * tick: neighbours in the force loop then sit next to each other in memory,
   * which is worth far more at high particle counts than the copy costs.
   */
  reorder(order) {
    const count = this.count;
    if (!this.scratch || this.scratch.x.length !== this.capacity) {
      this.scratch = {
        x: new Float32Array(this.capacity),
        y: new Float32Array(this.capacity),
        vx: new Float32Array(this.capacity),
        vy: new Float32Array(this.capacity),
        energy: new Float32Array(this.capacity),
        age: new Float32Array(this.capacity),
        maxAge: new Float32Array(this.capacity),
        species: new Int32Array(this.capacity),
        generation: new Int32Array(this.capacity)
      };
    }

    const scratch = this.scratch;
    for (let target = 0; target < count; target++) {
      const source = order[target];
      scratch.x[target] = this.x[source];
      scratch.y[target] = this.y[source];
      scratch.vx[target] = this.vx[source];
      scratch.vy[target] = this.vy[source];
      scratch.energy[target] = this.energy[source];
      scratch.age[target] = this.age[source];
      scratch.maxAge[target] = this.maxAge[source];
      scratch.species[target] = this.species[source];
      scratch.generation[target] = this.generation[source];
    }

    this.scratch = {
      x: this.x, y: this.y, vx: this.vx, vy: this.vy,
      energy: this.energy, age: this.age, maxAge: this.maxAge,
      species: this.species, generation: this.generation
    };
    this.x = scratch.x;
    this.y = scratch.y;
    this.vx = scratch.vx;
    this.vy = scratch.vy;
    this.energy = scratch.energy;
    this.age = scratch.age;
    this.maxAge = scratch.maxAge;
    this.species = scratch.species;
    this.generation = scratch.generation;
  }

  /** Remove by swapping the tail into the hole. Invalidates the last index. */
  remove(index) {
    const last = --this.count;
    if (index === last) return;
    this.x[index] = this.x[last];
    this.y[index] = this.y[last];
    this.vx[index] = this.vx[last];
    this.vy[index] = this.vy[last];
    this.energy[index] = this.energy[last];
    this.age[index] = this.age[last];
    this.maxAge[index] = this.maxAge[last];
    this.species[index] = this.species[last];
    this.generation[index] = this.generation[last];
  }
}
