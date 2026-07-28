import { CONFIG } from "./config.js";
import { ParticlePool } from "./particle.js";
import { stepPhysics } from "./physics.js";
import { CHANNELS, SpeciesManager } from "./species.js";
import { SpatialGrid } from "./spatialGrid.js";
import { Chronicle } from "./chronicle.js";
import { decodeTypedArray, encodeTypedArray, random, randomRange, randomState, rgbColor, seedRandom, setRandomState, wrap } from "./utils.js";

/**
 * Bumped whenever the save layout changes in a way older files cannot satisfy.
 * Version 2 added the spin, feeding and alignment channels and the per-species
 * reach trait — a version 1 world has no values for any of them, and inventing
 * some on load would restore a world that behaves nothing like the saved one.
 */
const SAVE_VERSION = 5;

/** Resolution of the cached resource field. Hotspots are broad and slow, so a
 *  coarse grid is indistinguishable from evaluating them exactly. */
const RICHNESS_COLS = 64;

function serializeSpecies(species) {
  return {
    id: species.id,
    name: species.name,
    clade: species.clade,
    hue: species.hue,
    saturation: species.saturation,
    lightness: species.lightness,
    population: species.population,
    births: species.births,
    deaths: species.deaths,
    averageAge: species.averageAge,
    generation: species.generation,
    parentName: species.parentName,
    bornAt: species.bornAt,
    extinctAt: species.extinctAt,
    isExtinct: species.isExtinct,
    hasLived: species.hasLived,
    historyStart: species.historyStart,
    historyCount: species.historyCount,
    // Trimmed to the samples actually written, not the buffer's spare capacity.
    history: encodeTypedArray(species.history.slice(0, species.historyCount)),
    traits: species.traits || null
  };
}

function deserializeSpecies(record) {
  const history = decodeTypedArray(record.history, Uint16Array);
  return {
    ...record,
    color: rgbColor(record.hue, record.saturation, record.lightness),
    history,
    historyCount: record.historyCount
  };
}
/** How often the resource field is recomputed, in seconds of world time. */
const RICHNESS_REFRESH_SECONDS = 0.25;

/**
 * Owns the world: particles, species, climate and the life cycle.
 * `settings` holds the subset of CONFIG the UI can change while running.
 */
export class Simulation {
  constructor() {
    this.speciesManager = new SpeciesManager();
    this.grid = new SpatialGrid();
    this.pool = new ParticlePool(CONFIG.initialSpeciesCount * CONFIG.initialParticlesPerSpecies * 2);
    this.elapsedSeconds = 0;
    this.sampleAccumulator = 0;
    this.driftAccumulator = 0;
    this.isPaused = false;
    this.births = 0;
    this.deaths = 0;
    this.lastSpeciationAt = -Infinity;
    this.lastReseedAt = -Infinity;
    this.chronicle = new Chronicle();
    this.seed = 1;

    // Live census, refreshed every tick and used for the rare-species bonus.
    this.speciesCounts = new Int32Array(64);

    this.settings = {
      interactionRadius: CONFIG.interactionRadius,
      noise: CONFIG.noise,
      // Global multipliers on the three channels layered over the radial force.
      // At zero each one is skipped entirely in the hot loop, so turning a
      // channel off is also the cheapest the world can run.
      spin: 1,
      alignment: 1,
      predation: 1,
      nicheOverlap: CONFIG.nicheOverlap,
      adoptability: 1,
      clumpability: 1,
      connection: 1,
      energyGain: CONFIG.energyGain,
      energyLoss: CONFIG.energyLoss,
      baseEnergyDrain: CONFIG.baseEnergyDrain,
      birthThreshold: CONFIG.birthThreshold,
      mutationRate: CONFIG.mutationRate,
      rareAdvantage: CONFIG.rareAdvantageStrength,
      traitDrift: 1,
      timeScale: CONFIG.timeScale
    };

    /**
     * The cursor, as a force in the world. Owned here rather than by the
     * climate so that resetting or loading a world does not drop the tool the
     * user is holding; `createClimate` only ever borrows a reference to it.
     */
    this.brush = {
      active: false,
      mode: "pan",
      x: 0,
      y: 0,
      radius: CONFIG.brushRadius,
      // `power` is what the slider sets; `strength` and `swirl` are what the
      // physics loop reads, derived from power and mode by `refreshBrush`.
      power: CONFIG.brushStrength,
      strength: 0,
      swirl: false
    };

    this.climate = this.createClimate();
    this.reset();
  }

  get particleCount() {
    return this.pool.count;
  }

  /** World seconds between population samples — the history's time base. */
  get sampleSeconds() {
    return CONFIG.statsSampleSeconds;
  }

  reset(seed = (Math.random() * 0xffffffff) >>> 0) {
    // The one place Math.random is still used: choosing the seed for a brand
    // new world. Everything after this point draws from the seeded generator,
    // which is what makes a run reproducible and a save file exact.
    this.seed = seed >>> 0;
    seedRandom(this.seed);
    this.chronicle.clear();
    this.elapsedSeconds = 0;
    this.sampleAccumulator = 0;
    this.driftAccumulator = 0;
    this.births = 0;
    this.deaths = 0;
    this.lastSpeciationAt = -Infinity;
    this.lastReseedAt = -Infinity;
    this.pool.clear();
    this.speciesManager.reset(0);
    this.climate = this.createClimate();

    for (const species of this.speciesManager.species) {
      this.seedSpecies(species.id, CONFIG.initialParticlesPerSpecies);
    }
    this.speciesManager.recordPopulation(this.pool, 0);
  }

  /**
   * Seed a species as a few patches plus a scattering of drifters.
   *
   * The world used to open with every species sprinkled uniformly, on the
   * reasoning that mixing is what produces inter-species structure. That is
   * true, but a perfect mix is not a mix — it is a homogeneous soup, and no
   * region of it is ever coherent enough to condense into anything before it is
   * stirred flat again. Patches give each lineage somewhere to actually build,
   * the drifters guarantee the patches find each other, and the boundaries
   * where they meet are exactly where the niche-overlap term pays best.
   */
  seedSpecies(speciesId, count) {
    const world = CONFIG.worldSize;
    const drifters = Math.round(count * CONFIG.initialDrifterFraction);
    const patchCount = Math.max(1, CONFIG.initialPatchesPerSpecies);
    const perPatch = Math.floor((count - drifters) / patchCount);
    const spread = world * CONFIG.initialPatchRadiusRatio;

    for (let patch = 0; patch < patchCount; patch++) {
      this.spawnColony(speciesId, random() * world, random() * world, perPatch, spread, 0);
    }
    this.scatterSpecies(speciesId, drifters);
  }

  /** Sprinkle a species uniformly across the entire world. */
  scatterSpecies(speciesId, count) {
    const world = CONFIG.worldSize;
    for (let index = 0; index < count; index++) {
      const spawned = this.pool.spawn(
        random() * world,
        random() * world,
        randomRange(-20, 20),
        randomRange(-20, 20),
        CONFIG.initialEnergy * randomRange(0.75, 1.15),
        speciesId,
        0
      );
      if (spawned < 0) break;
      this.speciesManager.species[speciesId].births++;
      this.births++;
    }
  }

  /**
   * The climate is the only thing in the world that changes on its own. It is
   * deliberately gentle: slow wind, a slow oscillation of the food supply, and
   * a handful of drifting resource hotspots. Together they guarantee that no
   * configuration of species stays optimal forever.
   */
  createClimate() {
    const world = CONFIG.worldSize;
    const hotspots = [];
    for (let index = 0; index < CONFIG.resourceHotspots; index++) {
      hotspots.push({
        baseX: random() * world,
        baseY: random() * world,
        x: 0,
        y: 0,
        phase: randomRange(0, Math.PI * 2),
        orbit: randomRange(world * 0.08, world * 0.22),
        radiusSquared: randomRange(world * 0.07, world * 0.13) ** 2,
        strength: randomRange(0.5, 1) * CONFIG.hotspotRichness
      });
    }
    return {
      hotspots,
      // Temporary richness dropped by the Feed brush. Each entry decays on its
      // own half-life and is folded into the same cached field the permanent
      // hotspots are, so feeding the world costs the physics loop nothing.
      drops: [],
      brush: this.brush,
      windX: 0,
      windY: 0,
      resourcePulse: 1,
      // The world's shared larder: starts full so the founders get a good run.
      foodStock: CONFIG.foodStockMax,
      foodShare: 1,
      // The world's average mixedness, written by the physics pass and used as
      // the baseline that makes niche overlap zero-sum.
      meanForeignFraction: 0,
      speciesDemand: new Float32Array(64),
      richnessField: new Float32Array(RICHNESS_COLS * RICHNESS_COLS).fill(1),
      richnessCols: RICHNESS_COLS,
      richnessAge: RICHNESS_REFRESH_SECONDS
    };
  }

  updateClimate(dt) {
    const time = this.elapsedSeconds;
    const climate = this.climate;
    const world = CONFIG.worldSize;

    climate.windX = Math.sin(time * 0.037) * CONFIG.windStrength;
    climate.windY = Math.cos(time * 0.031) * CONFIG.windStrength;
    // Two incommensurate periods, so the "seasons" never repeat exactly.
    climate.resourcePulse =
      1 +
      Math.sin(time / CONFIG.climatePeriodSeconds) * CONFIG.climateAmplitude * 0.6 +
      Math.sin(time / (CONFIG.climatePeriodSeconds * 2.37)) * CONFIG.climateAmplitude * 0.4;

    for (let index = 0; index < climate.hotspots.length; index++) {
      const hotspot = climate.hotspots[index];
      const drift = CONFIG.hotspotDriftSpeed;
      hotspot.x = wrap(hotspot.baseX + Math.cos(time * drift + hotspot.phase) * hotspot.orbit, world);
      hotspot.y = wrap(hotspot.baseY + Math.sin(time * drift * 0.83 + hotspot.phase * 1.31) * hotspot.orbit, world);
    }

    // Hand-placed food fades on its own half-life; expired drops are dropped.
    if (climate.drops.length > 0) {
      const decay = Math.pow(0.5, dt / CONFIG.brushFeedHalfLife);
      for (let index = climate.drops.length - 1; index >= 0; index--) {
        const drop = climate.drops[index];
        drop.strength *= decay;
        if (drop.strength < 0.02) climate.drops.splice(index, 1);
      }
    }

    climate.richnessAge += dt;
    if (climate.richnessAge >= RICHNESS_REFRESH_SECONDS) {
      climate.richnessAge = 0;
      this.rebuildRichnessField();
    }

    this.updateFoodMarket(dt);
  }

  /** Recompute the derived force terms after the mode or the power changes. */
  refreshBrush() {
    const brush = this.brush;
    brush.swirl = brush.mode === "stir";
    if (brush.mode === "attract" || brush.mode === "stir") brush.strength = brush.power;
    else if (brush.mode === "repel") brush.strength = -brush.power;
    // Feed, Seed and Erase change the world's contents rather than push it, so
    // they exert no force at all — see `applyBrush`.
    else brush.strength = 0;
  }

  /**
   * Per-tick work for the brushes that change the world rather than push it.
   * The force brushes are applied inside the physics integration, where the
   * particle's position is already in a register; these two are not, because
   * they add and remove particles and so cannot run mid-step.
   */
  applyBrush(dt) {
    const brush = this.brush;
    if (!brush.active) return;

    if (brush.mode === "erase") {
      const pool = this.pool;
      const species = this.speciesManager.species;
      const world = CONFIG.worldSize;
      const halfWorld = world * 0.5;
      const radiusSquared = brush.radius * brush.radius;
      for (let i = pool.count - 1; i >= 0; i--) {
        let dx = pool.x[i] - brush.x;
        let dy = pool.y[i] - brush.y;
        if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
        if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;
        if (dx * dx + dy * dy >= radiusSquared) continue;
        species[pool.species[i]].deaths++;
        this.deaths++;
        pool.remove(i);
      }
      return;
    }

    if (brush.mode === "zap") {
      const pool = this.pool;
      const world = CONFIG.worldSize;
      const halfWorld = world * 0.5;
      const radiusSquared = brush.radius * brush.radius;
      const zapRadius = brush.radius * 0.5;
      const zapRadiusSq = zapRadius * zapRadius;
      const nearby = [];
      for (let i = 0; i < pool.count; i++) {
        let dx = pool.x[i] - brush.x;
        let dy = pool.y[i] - brush.y;
        if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
        if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;
        if (dx * dx + dy * dy < radiusSquared) nearby.push(i);
      }
      const rest = this.settings.interactionRadius * CONFIG.connectionRestRadius;
      let formed = 0;
      for (let a = 0; a < nearby.length && formed < 8; a++) {
        const i = nearby[a];
        if (pool.link[i] >= 0 && pool.linkB[i] >= 0) continue;
        for (let b = a + 1; b < nearby.length && formed < 8; b++) {
          const j = nearby[b];
          if (pool.link[j] >= 0 && pool.linkB[j] >= 0) continue;
          let dx = pool.x[j] - pool.x[i];
          let dy = pool.y[j] - pool.y[i];
          if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
          if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;
          if (dx * dx + dy * dy > zapRadiusSq) continue;
          if (pool.link[i] === j || pool.linkB[i] === j) continue;
          const slotI = pool.link[i] < 0 ? 0 : pool.linkB[i] < 0 ? 1 : -1;
          const slotJ = pool.link[j] < 0 ? 0 : pool.linkB[j] < 0 ? 1 : -1;
          if (slotI < 0 || slotJ < 0) continue;
          const phase = Math.random() * Math.PI * 2;
          if (slotI === 0) { pool.link[i] = j; pool.linkRest[i] = rest; pool.linkPhase[i] = phase; }
          else { pool.linkB[i] = j; pool.linkRestB[i] = rest; pool.linkPhaseB[i] = phase; }
          if (slotJ === 0) { pool.link[j] = i; pool.linkRest[j] = rest; pool.linkPhase[j] = phase; }
          else { pool.linkB[j] = i; pool.linkRestB[j] = rest; pool.linkPhaseB[j] = phase; }
          formed++;
        }
      }
      return;
    }

    if (brush.mode === "feed") {
      // One drop per brush radius, rather than one per frame: holding the
      // button down should enrich a region, not stack sixty overlapping
      // hotspots on the same pixel and pin the field at its ceiling.
      const drops = this.climate.drops;
      const world = CONFIG.worldSize;
      const halfWorld = world * 0.5;
      for (const drop of drops) {
        let dx = drop.x - brush.x;
        let dy = drop.y - brush.y;
        if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
        if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;
        if (dx * dx + dy * dy < drop.radiusSquared * 0.25) {
          drop.strength = CONFIG.brushFeedRichness;
          return;
        }
      }
      if (drops.length >= CONFIG.brushFeedMax) drops.shift();
      drops.push({
        x: brush.x,
        y: brush.y,
        radiusSquared: brush.radius * brush.radius,
        strength: CONFIG.brushFeedRichness
      });
      this.climate.richnessAge = RICHNESS_REFRESH_SECONDS;
    }
  }

  processClumps(dt) {
    const pool = this.pool;
    const count = pool.count;
    const clumpScale = this.settings.clumpability;
    if (count === 0 || clumpScale === 0) return;

    const species = this.speciesManager;
    const clump = species.clumpability;
    const clumpMat = species.clump;
    const clumpStride = species.stride;
    const mass = pool.mass;
    const px = pool.x;
    const py = pool.y;
    const pvx = pool.vx;
    const pvy = pool.vy;
    const pEnergy = pool.energy;
    const pAge = pool.age;
    const pSpecies = pool.species;

    const grid = this.grid;
    const cols = grid.cols;
    const rows = grid.rows;
    const cellStart = grid.cellStart;

    const worldSize = CONFIG.worldSize;
    const halfWorld = worldSize * 0.5;
    const maxMass = CONFIG.clumpMaxMass;
    const interactionRadius = this.settings.interactionRadius;
    const mergeRadius = interactionRadius * CONFIG.coreRadiusRatio * CONFIG.clumpMergeRadius;
    const mergeRadiusSq = mergeRadius * mergeRadius;
    const mergeChance = CONFIG.clumpMergeChance * Math.abs(clumpScale);

    const absorbed = new Uint8Array(count);

    for (let cell = 0; cell < cols * rows; cell++) {
      const start = cellStart[cell];
      const end = cellStart[cell + 1];

      for (let i = start; i < end; i++) {
        if (absorbed[i]) continue;
        const specI = pSpecies[i];
        const clumpI = (clump[specI] * 0.5 + clumpMat[specI * clumpStride + specI] * 0.5) * clumpScale;
        if (clumpI <= 0 || mass[i] >= maxMass) continue;

        for (let j = i + 1; j < end; j++) {
          if (absorbed[j] || pSpecies[j] !== specI) continue;
          if (mass[i] + mass[j] > maxMass) continue;

          let dx = px[j] - px[i];
          let dy = py[j] - py[i];
          if (dx > halfWorld) dx -= worldSize; else if (dx < -halfWorld) dx += worldSize;
          if (dy > halfWorld) dy -= worldSize; else if (dy < -halfWorld) dy += worldSize;

          if (dx * dx + dy * dy > mergeRadiusSq) continue;
          if (random() > mergeChance * dt) continue;

          const totalMass = mass[i] + mass[j];
          const wj = mass[j] / totalMass;
          px[i] = wrap(px[i] + dx * wj, worldSize);
          py[i] = wrap(py[i] + dy * wj, worldSize);
          pvx[i] = pvx[i] * (1 - wj) + pvx[j] * wj;
          pvy[i] = pvy[i] * (1 - wj) + pvy[j] * wj;
          pEnergy[i] += pEnergy[j];
          pAge[i] = Math.max(pAge[i], pAge[j]);
          mass[i] = totalMass;
          pool.link[i] = -1;
          pool.linkB[i] = -1;
          pool.linkRest[i] = 0;
          pool.linkRestB[i] = 0;
          pool.linkPhase[i] = 0;
          pool.linkPhaseB[i] = 0;
          pool.link[j] = -1;
          pool.linkB[j] = -1;
          pool.linkRest[j] = 0;
          pool.linkRestB[j] = 0;
          pool.linkPhase[j] = 0;
          pool.linkPhaseB[j] = 0;
          absorbed[j] = 1;

          if (mass[i] >= maxMass) break;
        }
      }
    }

    for (let i = count - 1; i >= 0; i--) {
      if (absorbed[i]) pool.remove(i);
    }

    for (let i = pool.count - 1; i >= 0; i--) {
      const specI = pSpecies[i];
      const clumpI = (clump[specI] * 0.5 + clumpMat[specI * clumpStride + specI] * 0.5) * clumpScale;
      if (clumpI >= 0 || mass[i] <= 1) continue;
      if (random() > -clumpI * CONFIG.clumpSplitChance * dt) continue;

      const splitEnergy = pEnergy[i] / mass[i];
      mass[i]--;
      pEnergy[i] -= splitEnergy;
      const childIndex = pool.spawn(
        wrap(px[i] + randomRange(-5, 5), worldSize),
        wrap(py[i] + randomRange(-5, 5), worldSize),
        pvx[i] + randomRange(-15, 15),
        pvy[i] + randomRange(-15, 15),
        splitEnergy,
        specI,
        pool.generation[i]
      );
      if (childIndex >= 0) {
        pool.mass[childIndex] = 1;
        pool.age[childIndex] = pAge[i];
        pool.link[i] = -1;
        pool.linkB[i] = -1;
        pool.linkRest[i] = 0;
        pool.linkRestB[i] = 0;
        pool.linkPhase[i] = 0;
        pool.linkPhaseB[i] = 0;
      }
    }
  }

  /**
   * Bake the drifting hotspots into a coarse multiplier field. Cost is fixed
   * (a few thousand exponentials a few times a second) instead of scaling with
   * the population, which is the point.
   */
  rebuildRichnessField() {
    const climate = this.climate;
    const field = climate.richnessField;
    const cols = climate.richnessCols;
    const world = CONFIG.worldSize;
    const halfWorld = world * 0.5;
    const cellSize = world / cols;
    const hotspots = climate.hotspots;
    const drops = climate.drops;

    for (let row = 0; row < cols; row++) {
      const y = (row + 0.5) * cellSize;
      for (let column = 0; column < cols; column++) {
        const x = (column + 0.5) * cellSize;
        let richness = 1;
        for (let index = 0; index < hotspots.length; index++) {
          const hotspot = hotspots[index];
          let dx = x - hotspot.x;
          let dy = y - hotspot.y;
          if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
          if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;
          richness += hotspot.strength * Math.exp(-(dx * dx + dy * dy) / hotspot.radiusSquared);
        }
        for (let index = 0; index < drops.length; index++) {
          const drop = drops[index];
          let dx = x - drop.x;
          let dy = y - drop.y;
          if (dx > halfWorld) dx -= world; else if (dx < -halfWorld) dx += world;
          if (dy > halfWorld) dy -= world; else if (dy < -halfWorld) dy += world;
          richness += drop.strength * Math.exp(-(dx * dx + dy * dy) / drop.radiusSquared);
        }
        field[row * cols + column] = richness * climate.resourcePulse;
      }
    }
  }

  /**
   * Work out this tick's food share.
   *
   * Every particle bids `metabolicDemand` per second, scaled by its species'
   * rarity bonus. If the stock cannot cover the total bid, everyone is served
   * the same fraction of what they asked for. Because the stock refills at a
   * fixed rate, total income across the world is capped no matter how many
   * particles there are — the population regulates itself instead of relying
   * on a knife-edge between income and upkeep.
   */
  updateFoodMarket(dt) {
    const climate = this.climate;
    const counts = this.censusBySpecies();
    const species = this.speciesManager.species;

    // Nothing caps how many species can be alive at once, so this has to grow
    // with the registry. A short read here would hand the physics loop an
    // undefined demand and turn every particle's energy into NaN.
    if (climate.speciesDemand.length < species.length) {
      climate.speciesDemand = new Float32Array(Math.max(species.length, climate.speciesDemand.length * 2));
    }
    const demand = climate.speciesDemand;

    const scale = CONFIG.rareAdvantageScale;
    const strength = this.settings.rareAdvantage;
    const floor = CONFIG.rareAdvantageFloor;
    const now = this.elapsedSeconds;
    let totalDemand = 0;
    for (let id = 0; id < species.length; id++) {
      // Negative frequency dependence: the rarer the lineage, the better it
      // feeds per head. Without this, no mutation ever gets off the ground.
      // The bonus fades with the lineage's age, so protection is a trial
      // period rather than a pension — see CONFIG.noveltyHalfLifeSeconds.
      const novelty = Math.pow(0.5, (now - species[id].bornAt) / CONFIG.noveltyHalfLifeSeconds);
      const advantage = 1 + (strength * scale * (floor + (1 - floor) * novelty)) / (scale + counts[id]);
      const perCapita = CONFIG.metabolicDemand * advantage;
      demand[id] = perCapita;
      totalDemand += perCapita * counts[id];
    }

    // Average richness is ~1 by construction, so the stock only needs to cover
    // the nominal bid; local variation is settled against the same stock. Niche
    // overlap needs no correction here because it is zero-sum — average grazing
    // efficiency is 1 by construction. See the note in physics.js.
    const available = climate.foodStock + CONFIG.foodRegenPerSecond * this.settings.energyGain * dt;
    const requested = totalDemand * dt;
    climate.foodShare = requested > 0 ? Math.min(1, available / requested) : 1;
  }

  /** Population per species id, into a reused array. */
  censusBySpecies() {
    const species = this.speciesManager.species;
    if (this.speciesCounts.length < species.length) {
      this.speciesCounts = new Int32Array(Math.max(species.length, this.speciesCounts.length * 2));
    }
    const counts = this.speciesCounts;
    // Cleared in full, not just up to the current species count: retiring
    // extinct lineages shrinks that count, and stale tallies left beyond it
    // would silently belong to species that no longer exist.
    counts.fill(0);
    const ids = this.pool.species;
    for (let i = 0; i < this.pool.count; i++) counts[ids[i]]++;
    return counts;
  }

  /**
   * Advance the world by one frame's worth of *simulated* time.
   *
   * Speed is applied as extra sub-steps, never as a bigger timestep. Scaling dt
   * directly is what the speed slider used to do, and it breaks the physics
   * rather than merely approximating it: the hard core is only
   * `interactionRadius * coreRadiusRatio` wide — 9 units at the defaults — so
   * once a particle can travel further than that in one step it passes clean
   * through the repulsion that is supposed to stop it. The stability limit is
   * about `coreRadius / maxVelocity` = 0.028s, and the old 2.5x setting reached
   * a 0.0825s step, three times past it.
   *
   * Sub-stepping costs linear time instead, which is exactly what the speed is
   * being spent on. `maxSubsteps` caps the work per frame so a slow machine
   * falls behind real time rather than spiralling into an ever-longer frame.
   */
  step(realDt) {
    if (this.isPaused) return;
    // Clamp the real frame time so a stalled tab cannot teleport particles.
    const simulated = Math.min(CONFIG.maxFrameSeconds, realDt) * this.settings.timeScale;
    if (simulated <= 0) return;

    let substeps = Math.ceil(simulated / CONFIG.maxTimestep);
    if (substeps > CONFIG.maxSubsteps) substeps = CONFIG.maxSubsteps;
    const dt = Math.min(CONFIG.maxTimestep, simulated / substeps);
    for (let index = 0; index < substeps; index++) this.advance(dt);
  }

  advance(dt) {
    this.elapsedSeconds += dt;
    this.sampleAccumulator += dt;

    this.driftAccumulator += dt;
    if (this.driftAccumulator >= CONFIG.driftIntervalSeconds) {
      this.speciesManager.driftTraits(this.driftAccumulator, this.settings.traitDrift);
      this.driftAccumulator = 0;
    }

    this.updateClimate(dt);
    // Cell size is the full interaction radius, which is the widest any species
    // can reach: `reach` only ever scales it *down* (CONFIG.reachMax is 1). If
    // that ever stops being true the grid has to be configured against the
    // largest reach in the registry instead, or long-reach species will start
    // missing neighbours that sit two cells away.
    this.grid.configure(this.settings.interactionRadius);
    this.grid.rebuild(this.pool);

    const consumed = stepPhysics(this.pool, this.grid, this.speciesManager, this.settings, this.climate, dt);

    // Settle the larder: refill, then debit what was actually eaten.
    const climate = this.climate;
    climate.foodStock = Math.min(
      CONFIG.foodStockMax,
      Math.max(0, climate.foodStock + CONFIG.foodRegenPerSecond * this.settings.energyGain * dt - consumed)
    );

    this.applyBrush(dt);
    this.processClumps(dt);
    this.updateLifeCycle(dt);

    if (this.sampleAccumulator >= CONFIG.statsSampleSeconds) {
      this.sampleAccumulator = 0;
      this.speciesManager.recordPopulation(this.pool, this.elapsedSeconds);
      this.chronicle.observe(this.speciesManager.species, this.censusBySpecies(), this.elapsedSeconds);
      this.retireExtinctSpecies();
    }
  }

  /**
   * Hand extinct lineages over to the fossil record and renumber the pool.
   *
   * The census is recomputed here rather than reusing the sampled populations,
   * because a species that lost its last particle since the sample must not be
   * retired while particles still carry its id.
   */
  retireExtinctSpecies() {
    const counts = this.censusBySpecies();
    const manager = this.speciesManager;
    const before = manager.fossils.length;
    const remap = manager.compactExtinct((id, species) => counts[id] > 0 || !species.hasLived);
    if (!remap) return;

    for (let index = before; index < manager.fossils.length; index++) {
      this.chronicle.extinction(manager.fossils[index], this.elapsedSeconds);
    }

    const ids = this.pool.species;
    for (let i = 0; i < this.pool.count; i++) ids[i] = remap[ids[i]];
  }

  /**
   * Births and deaths. Iterating downwards keeps swap-removal safe, and because
   * newborns are appended past the starting index they are not re-processed in
   * the same tick.
   */
  updateLifeCycle(dt) {
    const pool = this.pool;
    const species = this.speciesManager.species;
    const birthThreshold = this.settings.birthThreshold;
    const energies = pool.energy;
    const ages = pool.age;

    // A famine suppresses breeding long before it starves anybody. Without
    // this the population is regulated purely by death: it overshoots the food
    // supply and, because reproduction leaves the whole world sitting in the
    // same narrow energy band, everything then starves at once and the map
    // goes empty. See CONFIG.scarcityFertilityPower.
    const scarcity = Math.pow(this.climate.foodShare, CONFIG.scarcityFertilityPower);
    const maturity = CONFIG.maturityAgeSeconds;
    const baseFertility = CONFIG.baseFertility * scarcity * dt;
    const surplusFertility = CONFIG.surplusFertility * scarcity * dt;

    for (let i = pool.count - 1; i >= 0; i--) {
      if (energies[i] <= 0 || ages[i] >= pool.maxAge[i]) {
        species[pool.species[i]].deaths++;
        this.deaths++;
        pool.remove(i);
        continue;
      }

      const energy = energies[i];
      if (energy <= birthThreshold || ages[i] < maturity) continue;
      // Fertility rises with surplus energy. The per-second rate is converted
      // to a per-step probability directly: over a frame the rate is always
      // far below 1, where 1 - exp(-r) and r differ by less than a percent,
      // and this runs for every well-fed particle every tick.
      const surplus = (energy - birthThreshold) / birthThreshold;
      if (random() < baseFertility + surplus * surplusFertility) this.reproduce(i);
    }

    // Reseeding from "spores": if the world empties completely there is nothing
    // left for selection to act on, so lineages restart from the fossil record.
    // Rate-limited, because a world that is dying faster than it can recover
    // would otherwise strobe whole populations in and out several times a
    // second — and seeded as colonies rather than a uniform sprinkle, which
    // both looks like life and gives the survivors somebody to interact with.
    if (pool.count === 0 && this.elapsedSeconds - this.lastReseedAt > CONFIG.reseedCooldownSeconds) {
      this.lastReseedAt = this.elapsedSeconds;
      this.chronicle.reseed(this.elapsedSeconds);
      this.reseedFromSpores();
    }
  }

  reseedFromSpores() {
    const registry = this.speciesManager.species;
    if (registry.length === 0) return;
    const world = CONFIG.worldSize;

    for (let index = 0; index < 4; index++) {
      const ancestor = registry[Math.floor(random() * registry.length)];
      this.spawnColony(
        ancestor.id,
        random() * world,
        random() * world,
        CONFIG.founderColonySize * 3,
        CONFIG.founderColonyRadius * 2,
        0
      );
    }
  }

  /** A cluster of `count` particles of one species around a point. */
  spawnColony(speciesId, x, y, count, spread, generation) {
    const pool = this.pool;
    const world = CONFIG.worldSize;
    const species = this.speciesManager.species[speciesId];

    for (let index = 0; index < count; index++) {
      const spawned = pool.spawn(
        wrap(x + randomRange(-spread, spread), world),
        wrap(y + randomRange(-spread, spread), world),
        randomRange(-20, 20),
        randomRange(-20, 20),
        CONFIG.initialEnergy * randomRange(0.8, 1.1),
        speciesId,
        generation
      );
      if (spawned < 0) break;
      species.births++;
      this.births++;
    }
  }

  reproduce(parentIndex) {
    const pool = this.pool;
    const parentSpeciesId = pool.species[parentIndex];

    // Rare speciation: the child founds an entirely new species instead, and
    // it arrives as a colony rather than as a single hopeful individual.
    //
    // The roll is per birth, so a busy world gets more chances than a quiet
    // one — but two guards keep that from running away. A minimum spacing in
    // world time stops a high birth rate founding dozens of species a second,
    // and a ceiling on living species keeps the matrix small enough to stay in
    // cache. Both only bind when the world is churning; normally neither does.
    if (random() < this.settings.mutationRate && this.canSpeciate()) {
      this.lastSpeciationAt = this.elapsedSeconds;
      this.foundNewSpecies(parentIndex, parentSpeciesId);
      return;
    }

    const sharedEnergy = pool.energy[parentIndex] * CONFIG.birthCostRatio;
    const world = CONFIG.worldSize;

    const childIndex = pool.spawn(
      wrap(pool.x[parentIndex] + randomRange(-9, 9), world),
      wrap(pool.y[parentIndex] + randomRange(-9, 9), world),
      pool.vx[parentIndex] * 0.7 + randomRange(-12, 12),
      pool.vy[parentIndex] * 0.7 + randomRange(-12, 12),
      sharedEnergy * randomRange(0.82, 1.02),
      parentSpeciesId,
      pool.generation[parentIndex] + 1
    );
    if (childIndex < 0) return; // Pool is full; the birth simply does not happen.

    pool.energy[parentIndex] -= sharedEnergy;
    this.speciesManager.species[parentSpeciesId].births++;
    this.births++;
  }

  canSpeciate() {
    return this.elapsedSeconds - this.lastSpeciationAt >= CONFIG.minSpeciationIntervalSeconds;
  }

  /**
   * Speciation event. The founding colony is seeded around the parent so the
   * new species starts as a coherent patch — a scattered handful would simply
   * be absorbed by whatever it landed in.
   */
  foundNewSpecies(parentIndex, parentSpeciesId) {
    const pool = this.pool;
    const child = this.speciesManager.mutateFrom(parentSpeciesId, this.elapsedSeconds);
    this.chronicle.speciation(child, this.speciesManager.species[parentSpeciesId], this.elapsedSeconds);

    // The parent pays only one birth's worth; the rest of the colony is a gift
    // from the food stock, which the rare-species bonus makes affordable.
    pool.energy[parentIndex] *= 1 - CONFIG.birthCostRatio;

    this.spawnColony(
      child.id,
      pool.x[parentIndex],
      pool.y[parentIndex],
      CONFIG.founderColonySize,
      CONFIG.founderColonyRadius,
      pool.generation[parentIndex] + 1
    );
  }

  /**
   * Complete world state, as a plain object ready for JSON.
   *
   * Bulk numeric data (particles, the matrix, population histories) goes out as
   * base64 of the raw typed-array bytes rather than as arrays of JSON numbers:
   * a pool of 5,000 particles is 180KB of Float32 but would be well over a
   * megabyte written as decimal text.
   *
   * The generator's state travels with it, so a restored world does not merely
   * look the same — it unfolds identically to the one that was saved.
   */
  serialize() {
    const pool = this.pool;
    const count = pool.count;
    const manager = this.speciesManager;

    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      seed: this.seed,
      rngState: randomState(),
      elapsedSeconds: this.elapsedSeconds,
      births: this.births,
      deaths: this.deaths,
      sampleAccumulator: this.sampleAccumulator,
      driftAccumulator: this.driftAccumulator,
      // JSON has no -Infinity; null restores to "never happened".
      lastSpeciationAt: Number.isFinite(this.lastSpeciationAt) ? this.lastSpeciationAt : null,
      lastReseedAt: Number.isFinite(this.lastReseedAt) ? this.lastReseedAt : null,
      settings: { ...this.settings },
      particles: {
        count,
        x: encodeTypedArray(pool.x.slice(0, count)),
        y: encodeTypedArray(pool.y.slice(0, count)),
        vx: encodeTypedArray(pool.vx.slice(0, count)),
        vy: encodeTypedArray(pool.vy.slice(0, count)),
        energy: encodeTypedArray(pool.energy.slice(0, count)),
        age: encodeTypedArray(pool.age.slice(0, count)),
        maxAge: encodeTypedArray(pool.maxAge.slice(0, count)),
        species: encodeTypedArray(pool.species.slice(0, count)),
        generation: encodeTypedArray(pool.generation.slice(0, count)),
        mass: encodeTypedArray(pool.mass.slice(0, count))
      },
      species: {
        stride: manager.stride,
        // One base64 blob per channel, under its own key, so a future channel
        // is an additive change to the format rather than a re-layout of it.
        channels: Object.fromEntries(
          CHANNELS.map((channel) => [channel.key, encodeTypedArray(manager[channel.key])])
        ),
        reach: encodeTypedArray(manager.reach),
        adoptability: encodeTypedArray(manager.adoptability),
        clumpability: encodeTypedArray(manager.clumpability),
        connection: encodeTypedArray(manager.connection),
        sampleIndex: manager.sampleIndex,
        rootCount: manager.rootCount,
        cladeCounts: manager.cladeCounts.slice(),
        mutationCount: manager.mutationCount,
        living: manager.species.map(serializeSpecies),
        fossils: manager.fossils.map(serializeSpecies)
      },
      climate: {
        hotspots: this.climate.hotspots.map((spot) => ({ ...spot })),
        drops: this.climate.drops.map((drop) => ({ ...drop })),
        foodStock: this.climate.foodStock,
        foodShare: this.climate.foodShare,
        richnessAge: this.climate.richnessAge,
        resourcePulse: this.climate.resourcePulse,
        /**
         * The cached resource field is stored rather than recomputed.
         *
         * It is only refreshed a few times a second, so at any given moment it
         * lags the hotspots by up to RICHNESS_REFRESH_SECONDS *by design*.
         * Rebuilding it on load would hand the restored world a field fresher
         * than the one it was saved with, and every particle would graze against
         * slightly different ground — the one difference that made restored
         * worlds drift from their originals. 16KB is a cheap price for exactness.
         */
        richnessField: encodeTypedArray(this.climate.richnessField)
      },
      chronicle: this.chronicle.events.slice()
    };
  }

  restore(data) {
    if (!data || (data.version !== SAVE_VERSION && data.version !== 4 && data.version !== 3 && data.version !== 2)) {
      throw new Error(`Unsupported save format (expected version ${SAVE_VERSION}, got ${data && data.version})`);
    }

    this.seed = data.seed >>> 0;
    this.elapsedSeconds = data.elapsedSeconds;
    this.births = data.births;
    this.deaths = data.deaths;
    this.sampleAccumulator = data.sampleAccumulator || 0;
    this.driftAccumulator = data.driftAccumulator || 0;
    this.lastSpeciationAt = data.lastSpeciationAt === null ? -Infinity : data.lastSpeciationAt;
    this.lastReseedAt = data.lastReseedAt === null ? -Infinity : data.lastReseedAt;
    Object.assign(this.settings, data.settings);
    if (this.settings.connection === undefined) this.settings.connection = 1;

    const pool = this.pool;
    const count = data.particles.count;
    pool.clear();
    pool.ensureCapacity(Math.max(count, 1));
    pool.x.set(decodeTypedArray(data.particles.x, Float32Array));
    pool.y.set(decodeTypedArray(data.particles.y, Float32Array));
    pool.vx.set(decodeTypedArray(data.particles.vx, Float32Array));
    pool.vy.set(decodeTypedArray(data.particles.vy, Float32Array));
    pool.energy.set(decodeTypedArray(data.particles.energy, Float32Array));
    pool.age.set(decodeTypedArray(data.particles.age, Float32Array));
    pool.maxAge.set(decodeTypedArray(data.particles.maxAge, Float32Array));
    pool.species.set(decodeTypedArray(data.particles.species, Int32Array));
    pool.generation.set(decodeTypedArray(data.particles.generation, Int32Array));
    if (data.particles.mass) {
      pool.mass.set(decodeTypedArray(data.particles.mass, Uint8Array));
    } else {
      pool.mass.fill(1, 0, count);
    }
    pool.link.fill(-1, 0, count);
    pool.linkB.fill(-1, 0, count);
    pool.linkRest.fill(0, 0, count);
    pool.linkRestB.fill(0, 0, count);
    pool.linkPhase.fill(0, 0, count);
    pool.linkPhaseB.fill(0, 0, count);
    pool.count = count;

    const manager = this.speciesManager;
    manager.stride = data.species.stride;
    for (const channel of CHANNELS) {
      manager[channel.key] = data.species.channels[channel.key]
        ? decodeTypedArray(data.species.channels[channel.key], Float32Array)
        : new Float32Array(manager.stride * manager.stride);
    }
    manager.reach = decodeTypedArray(data.species.reach, Float32Array);
    if (data.species.adoptability) {
      manager.adoptability = decodeTypedArray(data.species.adoptability, Float32Array);
    } else {
      manager.adoptability = new Float32Array(manager.stride);
    }
    if (data.species.clumpability) {
      manager.clumpability = decodeTypedArray(data.species.clumpability, Float32Array);
    } else {
      manager.clumpability = new Float32Array(manager.stride);
    }
    if (data.species.connection) {
      manager.connection = decodeTypedArray(data.species.connection, Float32Array);
    } else {
      manager.connection = new Float32Array(manager.stride);
    }
    manager.sampleIndex = data.species.sampleIndex;
    manager.rootCount = data.species.rootCount;
    manager.cladeCounts = data.species.cladeCounts.slice();
    manager.mutationCount = data.species.mutationCount;
    manager.species = data.species.living.map(deserializeSpecies);
    manager.fossils = data.species.fossils.map(deserializeSpecies);
    manager.byName = new Map();
    for (const record of manager.species) manager.byName.set(record.name, record);
    for (const record of manager.fossils) manager.byName.set(record.name, record);

    this.climate = this.createClimate();
    this.climate.hotspots = data.climate.hotspots.map((spot) => ({ ...spot }));
    this.climate.drops = (data.climate.drops || []).map((drop) => ({ ...drop }));
    this.climate.foodStock = data.climate.foodStock;
    this.climate.foodShare = data.climate.foodShare;
    this.climate.richnessAge = data.climate.richnessAge;
    this.climate.resourcePulse = data.climate.resourcePulse;
    this.climate.richnessField = decodeTypedArray(data.climate.richnessField, Float32Array);

    this.chronicle.clear();
    this.chronicle.events = data.chronicle ? data.chronicle.slice() : [];

    // Restored last, deliberately. `createClimate` above draws from the
    // generator to place its hotspots, so setting the state any earlier would
    // leave the restored world holding a generator that had been advanced —
    // identical in every visible way, but with a different future.
    setRandomState(data.rngState);
  }

  randomizeMatrix(channelKey = null) {
    this.speciesManager.randomizeMatrix(channelKey);
  }

  shiftMatrix(delta, channelKey = "values") {
    this.speciesManager.shiftMatrix(delta, channelKey);
  }

  /**
   * Drop a small colony wherever the cursor is. Seeds the lineage the user is
   * currently following if there is one, so "watch this species, then put some
   * of it over there" is a single gesture; otherwise it picks a living species
   * at random.
   */
  seedAt(x, y, speciesId = null) {
    const registry = this.speciesManager.species;
    if (registry.length === 0) return null;
    const counts = this.censusBySpecies();
    let target = speciesId !== null && registry[speciesId] ? registry[speciesId] : null;
    if (!target) {
      const living = registry.filter((species) => counts[species.id] > 0);
      const pool = living.length > 0 ? living : registry;
      target = pool[Math.floor(random() * pool.length)];
    }
    this.spawnColony(target.id, wrap(x, CONFIG.worldSize), wrap(y, CONFIG.worldSize), CONFIG.founderColonySize, CONFIG.founderColonyRadius, 0);
    return target;
  }

  /** A new founder with no ancestry, dropped in as a colony. Returns it. */
  introduceRandomSpecies() {
    const world = CONFIG.worldSize;
    const species = this.speciesManager.addRandomSpecies(this.elapsedSeconds);
    this.chronicle.introduction(species, this.elapsedSeconds);
    this.spawnColony(
      species.id,
      random() * world,
      random() * world,
      CONFIG.founderColonySize * 2,
      CONFIG.founderColonyRadius * 1.5,
      0
    );
    return species;
  }

  /** Bring an extinct lineage back, as a colony in one place. Returns it. */
  reviveSpecies(fossil) {
    const revived = this.speciesManager.reviveFossil(fossil, this.elapsedSeconds);
    if (!revived) return null;
    this.chronicle.revival(revived, this.elapsedSeconds);

    const world = CONFIG.worldSize;
    this.spawnColony(
      revived.id,
      random() * world,
      random() * world,
      CONFIG.founderColonySize * 2,
      CONFIG.founderColonyRadius * 1.5,
      revived.generation
    );
    return revived;
  }

  /**
   * Wipe a species out by hand. Its particles die immediately; the lineage
   * itself is retired to the fossil record by the next compaction pass, so a
   * deleted species is recoverable exactly like a naturally extinct one.
   */
  removeSpecies(speciesId) {
    const pool = this.pool;
    const species = this.speciesManager.species[speciesId];
    if (!species) return;

    for (let i = pool.count - 1; i >= 0; i--) {
      if (pool.species[i] !== speciesId) continue;
      species.deaths++;
      this.deaths++;
      pool.remove(i);
    }
    // Marked as having lived so an unlucky species that was deleted before it
    // was ever counted still becomes a fossil rather than lingering empty.
    species.hasLived = true;
    species.population = 0;
    this.chronicle.removal(species, this.elapsedSeconds);
    this.retireExtinctSpecies();
  }
}
