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
    const mass = new Uint8Array(capacity);
    const link = new Int32Array(capacity).fill(-1);
    const linkB = new Int32Array(capacity).fill(-1);
    const linkRest = new Float32Array(capacity);
    const linkRestB = new Float32Array(capacity);
    const linkPhase = new Float32Array(capacity);
    const linkPhaseB = new Float32Array(capacity);

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
      mass.set(this.mass.subarray(0, this.count));
      link.set(this.link.subarray(0, this.count));
      linkB.set(this.linkB.subarray(0, this.count));
      linkRest.set(this.linkRest.subarray(0, this.count));
      linkRestB.set(this.linkRestB.subarray(0, this.count));
      linkPhase.set(this.linkPhase.subarray(0, this.count));
      linkPhaseB.set(this.linkPhaseB.subarray(0, this.count));
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
    this.mass = mass;
    this.link = link;
    this.linkB = linkB;
    this.linkRest = linkRest;
    this.linkRestB = linkRestB;
    this.linkPhase = linkPhase;
    this.linkPhaseB = linkPhaseB;
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
    this.mass[index] = 1;
    this.link[index] = -1;
    this.linkB[index] = -1;
    this.linkRest[index] = 0;
    this.linkRestB[index] = 0;
    this.linkPhase[index] = 0;
    this.linkPhaseB[index] = 0;
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
        generation: new Int32Array(this.capacity),
        mass: new Uint8Array(this.capacity),
        link: new Int32Array(this.capacity),
        linkB: new Int32Array(this.capacity),
        linkRest: new Float32Array(this.capacity),
        linkRestB: new Float32Array(this.capacity),
        linkPhase: new Float32Array(this.capacity),
        linkPhaseB: new Float32Array(this.capacity),
        remap: new Int32Array(this.capacity)
      };
    }

    const scratch = this.scratch;
    for (let target = 0; target < count; target++) {
      const source = order[target];
      scratch.remap[source] = target;
      scratch.x[target] = this.x[source];
      scratch.y[target] = this.y[source];
      scratch.vx[target] = this.vx[source];
      scratch.vy[target] = this.vy[source];
      scratch.energy[target] = this.energy[source];
      scratch.age[target] = this.age[source];
      scratch.maxAge[target] = this.maxAge[source];
      scratch.species[target] = this.species[source];
      scratch.generation[target] = this.generation[source];
      scratch.mass[target] = this.mass[source];
      scratch.link[target] = this.link[source];
      scratch.linkB[target] = this.linkB[source];
      scratch.linkRest[target] = this.linkRest[source];
      scratch.linkRestB[target] = this.linkRestB[source];
      scratch.linkPhase[target] = this.linkPhase[source];
      scratch.linkPhaseB[target] = this.linkPhaseB[source];
    }

    for (let target = 0; target < count; target++) {
      const partner = scratch.link[target];
      scratch.link[target] = partner >= 0 && partner < count ? scratch.remap[partner] : -1;
      if (scratch.link[target] === target) scratch.link[target] = -1;
      const partnerB = scratch.linkB[target];
      scratch.linkB[target] = partnerB >= 0 && partnerB < count ? scratch.remap[partnerB] : -1;
      if (scratch.linkB[target] === target || scratch.linkB[target] === scratch.link[target]) scratch.linkB[target] = -1;
    }

    this.scratch = {
      x: this.x, y: this.y, vx: this.vx, vy: this.vy,
      energy: this.energy, age: this.age, maxAge: this.maxAge,
      species: this.species, generation: this.generation, mass: this.mass,
      link: this.link, linkB: this.linkB, linkRest: this.linkRest, linkRestB: this.linkRestB,
      linkPhase: this.linkPhase, linkPhaseB: this.linkPhaseB,
      remap: scratch.remap
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
    this.mass = scratch.mass;
    this.link = scratch.link;
    this.linkB = scratch.linkB;
    this.linkRest = scratch.linkRest;
    this.linkRestB = scratch.linkRestB;
    this.linkPhase = scratch.linkPhase;
    this.linkPhaseB = scratch.linkPhaseB;
  }

  /** Remove by swapping the tail into the hole. Invalidates the last index. */
  remove(index) {
    const last = --this.count;
    this.unlinkPartner(index, this.link[index]);
    this.unlinkPartner(index, this.linkB[index]);
    if (index === last) {
      this.link[last] = -1;
      this.linkB[last] = -1;
      this.linkRest[last] = 0;
      this.linkRestB[last] = 0;
      this.linkPhase[last] = 0;
      this.linkPhaseB[last] = 0;
      return;
    }

    const movedPartner = this.link[last];
    const movedPartnerB = this.linkB[last];
    this.x[index] = this.x[last];
    this.y[index] = this.y[last];
    this.vx[index] = this.vx[last];
    this.vy[index] = this.vy[last];
    this.energy[index] = this.energy[last];
    this.age[index] = this.age[last];
    this.maxAge[index] = this.maxAge[last];
    this.species[index] = this.species[last];
    this.generation[index] = this.generation[last];
    this.mass[index] = this.mass[last];
    this.link[index] = this.link[last];
    this.linkB[index] = this.linkB[last];
    this.linkRest[index] = this.linkRest[last];
    this.linkRestB[index] = this.linkRestB[last];
    this.linkPhase[index] = this.linkPhase[last];
    this.linkPhaseB[index] = this.linkPhaseB[last];
    this.retargetPartner(last, index, movedPartner);
    this.retargetPartner(last, index, movedPartnerB);
    if (this.link[index] === index || this.link[index] >= this.count) {
      this.link[index] = -1;
      this.linkRest[index] = 0;
      this.linkPhase[index] = 0;
    }
    if (this.linkB[index] === index || this.linkB[index] >= this.count || this.linkB[index] === this.link[index]) {
      this.linkB[index] = -1;
      this.linkRestB[index] = 0;
      this.linkPhaseB[index] = 0;
    }
    this.link[last] = -1;
    this.linkB[last] = -1;
    this.linkRest[last] = 0;
    this.linkRestB[last] = 0;
    this.linkPhase[last] = 0;
    this.linkPhaseB[last] = 0;
  }

  unlinkPartner(index, partner) {
    if (partner < 0 || partner >= this.count) return;
    if (this.link[partner] === index) {
      this.link[partner] = -1;
      this.linkRest[partner] = 0;
      this.linkPhase[partner] = 0;
    }
    if (this.linkB[partner] === index) {
      this.linkB[partner] = -1;
      this.linkRestB[partner] = 0;
      this.linkPhaseB[partner] = 0;
    }
  }

  retargetPartner(from, to, partner) {
    if (partner < 0 || partner >= this.count) return;
    if (this.link[partner] === from) this.link[partner] = to;
    if (this.linkB[partner] === from) this.linkB[partner] = to;
  }
}
