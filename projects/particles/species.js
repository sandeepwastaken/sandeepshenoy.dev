import { CONFIG } from "./config.js";
import { clamp, random, randomRange, randomSigned, rgbColor, wrapHue } from "./utils.js";

/**
 * Owns the species registry and the NxN interaction matrix.
 *
 * The matrix is a flat Float32Array with a fixed row stride so the physics loop
 * can index it as `values[a * stride + b]` — one multiply-add, no nested array
 * dereference. It is reallocated (stride doubled) only when a mutation pushes
 * the species count past the current stride.
 *
 * Rows are "how species A feels about species B" and are deliberately NOT
 * symmetric: A -> B may be attraction while B -> A is repulsion. That asymmetry
 * is what produces chases, orbits and predator/prey oscillation.
 */
/**
 * Symbol pool for species names.
 *
 * Latin `I` and `l` are dropped because they are indistinguishable from each
 * other in most UI fonts, and the Greek letters that are homoglyphs of Latin
 * ones (Ι Κ Υ ι κ ρ υ χ) are dropped for the same reason — two species whose
 * names differ only by script would be a trap when comparing a matrix row
 * label against the species list. What is left is 73 unambiguous symbols.
 *
 * The density is the point. A name has about ten characters of room before the
 * panel ellipses it, and 73 symbols carry as much in two characters as four
 * digits would.
 */
const SYMBOLS =
  "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyzΓΔΘΛΞΣΦΨΩβγδζηθλξπστφψω";

export class SpeciesManager {
  constructor() {
    this.species = [];
    // Lineages that have died out. They keep their colour, their name, their
    // ancestry and their population history forever — they simply no longer
    // occupy a row of the interaction matrix. See `compactExtinct`.
    this.fossils = [];
    this.rootCount = CONFIG.initialSpeciesCount;
    // Next unused name index within each clade, and every lineage ever by name.
    this.cladeCounts = [];
    this.byName = new Map();
    // Monotonic counter of population samples taken, which is the graph's
    // clock: every series records which sample its first entry belongs to.
    this.sampleIndex = 0;
    this.stride = 16;
    this.values = new Float32Array(this.stride * this.stride);
    this.mutationCount = 0;
  }

  get count() {
    return this.species.length;
  }

  getValue(row, column) {
    return this.values[row * this.stride + column];
  }

  setValue(row, column, value) {
    this.values[row * this.stride + column] = value;
  }

  reset(elapsedSeconds = 0) {
    this.species = [];
    this.fossils = [];
    this.mutationCount = 0;
    // Names for root species — the founders, plus any added by hand later.
    this.rootCount = CONFIG.initialSpeciesCount;
    this.cladeCounts = [];
    this.byName = new Map();
    this.sampleIndex = 0;
    this.values.fill(0);

    // Six founders, evenly spaced hues, completely random interaction values.
    const hueStep = 360 / CONFIG.initialSpeciesCount;
    for (let index = 0; index < CONFIG.initialSpeciesCount; index++) {
      const hue = wrapHue(CONFIG.initialHueOffset + index * hueStep);
      this.addSpecies({
        name: this.nameFor(index),
        clade: index,
        hue,
        saturation: CONFIG.initialSaturation,
        lightness: CONFIG.initialLightness,
        parent: null,
        generation: 0,
        elapsedSeconds
      });
      this.randomizeRowAndColumn(index);
    }
  }

  addSpecies({ name, clade, hue, saturation, lightness, parent, generation, elapsedSeconds }) {
    const id = this.species.length;
    this.ensureStride(id + 1);
    const record = {
      id,
      name,
      clade,
      hue,
      saturation,
      lightness,
      color: rgbColor(hue, saturation, lightness),
      population: 0,
      births: 0,
      deaths: 0,
      averageAge: 0,
      generation,
      /**
       * Ancestry is one parent *name*, not an id and not a copied chain.
       *
       * Ids are matrix rows and get renumbered when extinct lineages retire, so
       * they cannot anchor a permanent record. A copied chain of names is worse
       * still: it costs O(generation) per species, which at generation 57
       * across a few thousand lineages was megabytes of duplicated strings.
       * Names are unique forever, so one reference is enough and `lineageOf`
       * walks it on demand.
       */
      parentName: parent ? parent.name : null,
      bornAt: elapsedSeconds,
      extinctAt: null,
      isExtinct: false,
      hasLived: false,
      history: new Uint16Array(0),
      historyCount: 0,
      // Absolute index of the world sample `history[0]` was taken at. Without
      // it a series has no idea *when* it happened, and a species born late
      // would be drawn from the left edge alongside the founders.
      historyStart: 0
    };
    this.species.push(record);
    // Every lineage ever, live or fossil, resolvable by name. This is what
    // makes `parentName` enough to reconstruct an ancestry chain.
    this.byName.set(name, record);
    return record;
  }

  /** Grow the flat matrix, copying existing rows into the wider stride. */
  ensureStride(required) {
    if (required <= this.stride) return;
    const stride = Math.max(required, this.stride * 2);
    const values = new Float32Array(stride * stride);
    for (let row = 0; row < this.species.length; row++) {
      for (let column = 0; column < this.species.length; column++) {
        values[row * stride + column] = this.values[row * this.stride + column];
      }
    }
    this.stride = stride;
    this.values = values;
  }

  /**
   * Random row + column for a brand new (non-descendant) species.
   *
   * Cross-species values span the full range. The diagonal — how a species
   * feels about its own kind — is drawn from a range skewed positive, because
   * a world where most species repel themselves never clumps at all: it just
   * spreads into evenly spaced dust with nothing for selection to work on.
   */
  randomizeRowAndColumn(id) {
    for (let other = 0; other < id; other++) {
      this.setValue(id, other, randomRange(-1, 1));
      this.setValue(other, id, randomRange(-1, 1));
    }
    this.setValue(id, id, randomRange(CONFIG.selfAffinityMin, CONFIG.selfAffinityMax));
  }

  /**
   * Nudge every living species' traits along a random walk.
   *
   * This is evolution between speciation events: no new lineage appears, but
   * the ones that exist keep changing, so the world never reaches a matrix it
   * can sit in forever. The step is scaled by the square root of the elapsed
   * time, which is what makes the walk's total distance independent of how
   * often this is called.
   *
   * The diagonal is clamped to the same positive-skewed range the founders are
   * drawn from: left free it eventually wanders negative for everyone, and a
   * world where nothing likes its own kind cannot clump at all.
   */
  driftTraits(seconds, rateScale = 1) {
    if (seconds <= 0 || rateScale <= 0) return;
    const step = CONFIG.traitDriftRate * rateScale * Math.sqrt(seconds);
    const hueStep = CONFIG.hueDriftRate * rateScale * Math.sqrt(seconds);
    const count = this.species.length;

    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        const value = this.getValue(row, column) + randomSigned(step);
        this.setValue(
          row,
          column,
          row === column
            ? clamp(value, CONFIG.selfAffinityMin, CONFIG.selfAffinityMax)
            : clamp(value, -1, 1)
        );
      }

      const species = this.species[row];
      species.hue = wrapHue(species.hue + randomSigned(hueStep));
      species.color = rgbColor(species.hue, species.saturation, species.lightness);
    }
  }

  randomizeMatrix() {
    for (let row = 0; row < this.species.length; row++) {
      for (let column = 0; column < this.species.length; column++) {
        const value =
          row === column
            ? randomRange(CONFIG.selfAffinityMin, CONFIG.selfAffinityMax)
            : randomRange(-1, 1);
        this.setValue(row, column, value);
      }
    }
  }

  /**
   * Speciation. The child copies its parent's row and column and perturbs them
   * slightly, so descendants behave like relatives and the tree stays legible.
   * Occasionally the perturbation is large — that is where surprises come from.
   * Existing relationships between older species are never touched.
   */
  mutateFrom(parentId, elapsedSeconds) {
    const parent = this.species[parentId];
    const isLargeMutation = random() < CONFIG.largeMutationChance;
    const hueDrift = isLargeMutation ? CONFIG.hueDriftLarge : CONFIG.hueDriftSmall;
    const spread = isLargeMutation ? CONFIG.largeMutationSpread : CONFIG.smallMutationSpread;

    const child = this.addSpecies({
      // Same clade as the parent, so the whole radiation shares a first symbol.
      name: this.nameFor(parent.clade),
      clade: parent.clade,
      hue: wrapHue(parent.hue + randomSigned(hueDrift)),
      saturation: clamp(parent.saturation + randomSigned(isLargeMutation ? 12 : 5), 46, 88),
      lightness: clamp(parent.lightness + randomSigned(isLargeMutation ? 9 : 4), 46, 70),
      parent,
      generation: parent.generation + 1,
      elapsedSeconds
    });

    const childId = child.id;
    for (let other = 0; other < childId; other++) {
      // Row: how the child feels about everyone else.
      this.setValue(childId, other, clamp(this.getValue(parentId, other) + randomSigned(spread), -1, 1));
      // Column: how everyone else feels about the child.
      this.setValue(other, childId, clamp(this.getValue(other, parentId) + randomSigned(spread), -1, 1));
    }
    // Self-affinity is inherited from the parent's self-affinity.
    this.setValue(childId, childId, clamp(this.getValue(parentId, parentId) + randomSigned(spread), -1, 1));

    this.mutationCount++;
    return child;
  }

  /**
   * Retire lineages that have died out, freeing their rows of the matrix.
   *
   * Extinct species are kept forever, as they should be — but in `fossils`,
   * where they still feed the graph and the records without costing anything
   * per frame. That is worth real speed: the matrix is read twice for every
   * particle pair, thousands of times per tick, and it only stays in L1 cache
   * while it is small. Left to grow with every mutation a long session ever
   * made, the hot loop slowly turns into a cache-miss generator, and the
   * matrix viewer ends up restyling tens of thousands of dead cells a second.
   *
   * `isLive` decides what survives — the caller passes a live census rather
   * than the sampled populations, so a species that lost its last particle in
   * this very tick is not retired out from under it.
   *
   * Returns an old-id -> new-id map (-1 for retired) so the caller can
   * renumber the particle pool, or null when nothing needed retiring.
   */
  compactExtinct(isLive) {
    const previous = this.species;
    const remap = new Int32Array(previous.length).fill(-1);
    const survivors = [];

    for (let id = 0; id < previous.length; id++) {
      const item = previous[id];
      if (isLive(id, item)) {
        remap[id] = survivors.length;
        survivors.push(item);
      } else {
        // Snapshot its affinities on the way out, keyed by the *names* of the
        // species it knew. Ids are about to be renumbered, so they are useless
        // to a lineage that might be revived long after this.
        item.traits = this.snapshotTraits(id, previous);
        this.fossils.push(item);
      }
    }
    // Never retire the last row: an empty registry would leave the world with
    // no matrix to reseed from. A totally dead world keeps its final lineage.
    if (survivors.length === previous.length || survivors.length === 0) {
      if (survivors.length === 0) this.fossils.length -= previous.length;
      return null;
    }

    let stride = 16;
    while (stride < survivors.length) stride *= 2;
    const values = new Float32Array(stride * stride);
    for (let row = 0; row < previous.length; row++) {
      const newRow = remap[row];
      if (newRow < 0) continue;
      for (let column = 0; column < previous.length; column++) {
        const newColumn = remap[column];
        if (newColumn < 0) continue;
        values[newRow * stride + newColumn] = this.values[row * this.stride + column];
      }
    }

    for (let index = 0; index < survivors.length; index++) survivors[index].id = index;
    this.species = survivors;
    this.stride = stride;
    this.values = values;
    return remap;
  }

  snapshotTraits(id, registry) {
    const toward = {};
    const from = {};
    for (let other = 0; other < registry.length; other++) {
      if (other === id) continue;
      toward[registry[other].name] = this.getValue(id, other);
      from[registry[other].name] = this.getValue(other, id);
    }
    return { self: this.getValue(id, id), toward, from };
  }

  /**
   * Bring a lineage back from the fossil record.
   *
   * The fossil record object itself is reused rather than copied, so the
   * revived species keeps its name, its ancestry and its old population
   * history — the graph shows one line with a gap in it, which is the honest
   * picture. It resumes its former opinions of the species it used to know and
   * meets anything that evolved since it died with fresh, random ones.
   */
  reviveFossil(fossil, elapsedSeconds) {
    const index = this.fossils.indexOf(fossil);
    if (index < 0) return null;
    this.fossils.splice(index, 1);

    const id = this.species.length;
    this.ensureStride(id + 1);
    fossil.id = id;
    fossil.population = 0;
    fossil.isExtinct = false;
    fossil.extinctAt = null;
    // Re-dated so the rare-species novelty bonus treats it as a genuine new
    // arrival. Without this a revived lineage is born already stripped of the
    // foothold every other new species gets, and dies again within seconds.
    fossil.bornAt = elapsedSeconds;
    // Pad the interval it spent dead with zeros, so the series stays contiguous
    // in sample space. Without this the graph would splice its pre-death and
    // post-revival curves together as if no time had passed.
    while (fossil.historyCount > 0 && fossil.historyStart + fossil.historyCount < this.sampleIndex) {
      this.pushSample(fossil, 0, this.sampleIndex);
    }
    // Cleared so a colony that has not been counted yet is not immediately
    // retired again by the next compaction pass.
    fossil.hasLived = false;
    this.species.push(fossil);

    const traits = fossil.traits;
    for (let other = 0; other < id; other++) {
      const name = this.species[other].name;
      const toward = traits && traits.toward[name];
      const from = traits && traits.from[name];
      this.setValue(id, other, toward === undefined ? randomRange(-1, 1) : toward);
      this.setValue(other, id, from === undefined ? randomRange(-1, 1) : from);
    }
    this.setValue(id, id, traits ? traits.self : randomRange(CONFIG.selfAffinityMin, CONFIG.selfAffinityMax));
    return fossil;
  }

  /**
   * Names are binomial: the first symbol is the clade, inherited unchanged by
   * every descendant forever, and the second identifies the species within it.
   *
   * That keeps names at a fixed two characters no matter how deep the tree
   * gets — the old scheme appended to the parent's name every generation, so
   * by generation 57 names were sixty characters of unreadable prefix — while
   * still showing relatedness at a glance, which is the thing worth having. A
   * clade that outgrows the alphabet starts appending a number.
   */
  nameFor(cladeIndex) {
    const sequence = this.cladeCounts[cladeIndex] || 0;
    this.cladeCounts[cladeIndex] = sequence + 1;
    const clade = SYMBOLS[cladeIndex % SYMBOLS.length];
    const own = SYMBOLS[sequence % SYMBOLS.length];
    const overflow = Math.floor(sequence / SYMBOLS.length);
    return overflow > 0 ? `${clade}${own}${overflow}` : `${clade}${own}`;
  }

  /** A brand new founder: no ancestry, no inheritance, entirely random traits. */
  addRandomSpecies(elapsedSeconds) {
    const id = this.species.length;
    const ordinal = this.rootCount++;
    const species = this.addSpecies({
      name: this.nameFor(ordinal),
      clade: ordinal,
      hue: random() * 360,
      saturation: CONFIG.initialSaturation,
      lightness: CONFIG.initialLightness,
      parent: null,
      generation: 0,
      elapsedSeconds
    });
    this.randomizeRowAndColumn(id);
    return species;
  }

  /** Chain of ancestor names back to a founder, walked on demand. */
  lineageOf(species) {
    const chain = [species.name];
    let cursor = species;
    // Guarded against a malformed chain from a hand-edited save file.
    for (let depth = 0; depth < 4096 && cursor && cursor.parentName; depth++) {
      cursor = this.byName.get(cursor.parentName);
      if (!cursor) break;
      chain.unshift(cursor.name);
    }
    return chain;
  }

  /**
   * Sample population/age per species and append to the history ring.
   * Extinct species are kept forever — they stay in the graph and the records.
   */
  /**
   * Append `population` to a series, tagged with the sample it belongs to.
   *
   * History is kept in a growable Uint16Array rather than a plain array and is
   * never trimmed: the whole point is to be able to look back at an entire run.
   * Two bytes a sample is what makes that affordable — a day-long run across a
   * hundred living species is about 40MB, where boxed JS numbers would be 180MB.
   * Populations cannot exceed CONFIG.maxParticles, so 16 bits is ample.
   */
  pushSample(series, population, sample) {
    if (series.historyCount === 0) series.historyStart = sample;
    if (series.historyCount === series.history.length) {
      const grown = new Uint16Array(Math.max(128, series.history.length * 2));
      grown.set(series.history);
      series.history = grown;
    }
    series.history[series.historyCount++] = population;
  }

  recordPopulation(pool, elapsedSeconds) {
    const sample = this.sampleIndex++;
    const speciesCount = this.species.length;
    const counts = new Int32Array(speciesCount);
    const ageSums = new Float64Array(speciesCount);

    for (let i = 0; i < pool.count; i++) {
      const id = pool.species[i];
      counts[id]++;
      ageSums[id] += pool.age[i];
    }

    // Fossils are not sampled at all. A dead lineage's series simply ends at
    // the moment it died, which is both the honest record and the reason the
    // memory cost of keeping every run forever stays bounded.
    for (let id = 0; id < speciesCount; id++) {
      const species = this.species[id];
      const population = counts[id];
      species.population = population;
      species.averageAge = population > 0 ? ageSums[id] / population : 0;

      if (population > 0) {
        species.hasLived = true;
        species.isExtinct = false;
        species.extinctAt = null;
      } else if (species.hasLived && !species.isExtinct) {
        species.isExtinct = true;
        species.extinctAt = elapsedSeconds;
      }

      this.pushSample(species, population, sample);
    }
  }
}
