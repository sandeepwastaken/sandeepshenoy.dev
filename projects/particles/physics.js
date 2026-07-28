import { CONFIG } from "./config.js";
import { random } from "./utils.js";

/**
 * One physics tick for the whole pool: forces, integration and the energy
 * budget.
 *
 * Radial force profile (classic Particle-Life shape, per neighbour):
 *
 *      f
 *      |      /\            <- attraction, peaks mid-band
 *    0 |_____/  \____ r
 *      |\   |        |
 *      | \  rc       R      <- rc = hard core, R = interaction radius
 *      |__\                 <- unconditional short-range repulsion
 *
 * The hard core is species-independent: it stops particles overlapping and is
 * what gives colonies internal texture (rings, shells, membranes) instead of
 * collapsing them into a dot.
 *
 * Layered on top of the radial force are more channels, each a full
 * asymmetric matrix of its own (see CHANNELS in species.js):
 *
 *   spin     force perpendicular to the separation. Perpendicular forces do
 *            not conserve momentum, which is exactly why they can propel: a
 *            pair with opposite spins swims, a pair with matching spins orbits.
 *   trophic  who feeds on whom, no longer welded to who chases whom, so a
 *            structure can hold itself together without also digesting itself.
 *   align    velocity matching, averaged over neighbours, which is what lets a
 *            moving structure survive being hit instead of shedding members.
 *   connect  end-to-end bond formation, which grows strings and closes longer
 *            chains into rings.
 *
 * `R` is per species as well (`reach`), so different lineages build at
 * different scales. Because that would turn four divisions into per-pair work,
 * the derived quantities are precomputed once per tick into small per-species
 * lookup tables and the inner loop only ever reads from them.
 *
 * Neighbour search visits each *pair* exactly once. A cell interacts with
 * itself and with only four of its eight neighbours — right, and the three
 * below — because the other four will visit it. Both particles of a pair are
 * updated from the one distance calculation, which roughly halves the cost of
 * the hot loop versus the naive "every particle scans its 3x3 block" version.
 * That requires accumulating forces in arrays rather than in loop locals; the
 * extra memory traffic is far cheaper than the square roots it saves.
 */

// Per-tick accumulators, kept at module scope so a tick never allocates.
let accForceX = new Float32Array(0);
let accForceY = new Float32Array(0);
let accAlignX = new Float32Array(0);
let accAlignY = new Float32Array(0);
let accFeeding = new Float32Array(0);
let accFedUpon = new Float32Array(0);
/**
 * Neighbour tallies, two counters packed into one integer: total neighbours in
 * the low 16 bits, same-species neighbours in the high 16. Both are incremented
 * on the same pair, so packing them halves the scattered writes the inner loop
 * makes into integer memory. Neither half can overflow: 16 bits holds 65535
 * neighbours and CONFIG.maxParticles is a quarter of that for the whole world.
 */
let accCrowd = new Int32Array(0);
const KIN_SHIFT = 65536;
const scratchForward = new Int32Array(4);

/**
 * Per-species derived geometry, rebuilt each tick from `reach`. Everything the
 * inner loop needs about a species' force profile is a single array read.
 */
let speciesRadiusSquared = new Float32Array(0);
let speciesCoreRadius = new Float32Array(0);
let speciesInverseCore = new Float32Array(0);
let speciesInverseBand = new Float32Array(0);
let speciesInverseRadius = new Float32Array(0);
let speciesBandCenter = new Float32Array(0);

function linkAt(pool, index, slot) {
  return slot === 0 ? pool.link[index] : pool.linkB[index];
}

function setLinkSlot(pool, index, slot, partner, rest = 0, phase = 0) {
  if (slot === 0) {
    pool.link[index] = partner;
    pool.linkRest[index] = rest;
    pool.linkPhase[index] = phase;
  } else {
    pool.linkB[index] = partner;
    pool.linkRestB[index] = rest;
    pool.linkPhaseB[index] = phase;
  }
}

function linkSlotOf(pool, index, partner) {
  if (pool.link[index] === partner) return 0;
  if (pool.linkB[index] === partner) return 1;
  return -1;
}

function freeLinkSlot(pool, index) {
  if (pool.link[index] < 0) return 0;
  if (pool.linkB[index] < 0) return 1;
  return -1;
}

function linkDegree(pool, index) {
  let degree = 0;
  const a = pool.link[index];
  const b = pool.linkB[index];
  if (a >= 0 && a < pool.count) degree++;
  if (b >= 0 && b < pool.count && b !== a) degree++;
  return degree;
}

function hasLink(pool, a, b) {
  return pool.link[a] === b || pool.linkB[a] === b;
}

function breakLink(pool, index, partner = null) {
  for (let slot = 0; slot < 2; slot++) {
    const other = linkAt(pool, index, slot);
    if (other < 0 || (partner !== null && other !== partner)) continue;
    setLinkSlot(pool, index, slot, -1);
    const otherSlot = linkSlotOf(pool, other, index);
    if (otherSlot >= 0) setLinkSlot(pool, other, otherSlot, -1);
    if (partner !== null) return;
  }
}

function addLink(pool, a, b, rest, phase) {
  if (a === b || hasLink(pool, a, b)) return false;
  const slotA = freeLinkSlot(pool, a);
  const slotB = freeLinkSlot(pool, b);
  if (slotA < 0 || slotB < 0) return false;
  setLinkSlot(pool, a, slotA, b, rest, phase);
  setLinkSlot(pool, b, slotB, a, rest, phase);
  return true;
}

function chainDistance(pool, start, target, limit = 48) {
  const stack = [[start, -1, 0]];
  const seen = new Set([start]);
  while (stack.length) {
    const [index, previous, depth] = stack.pop();
    if (depth > limit) continue;
    for (let slot = 0; slot < 2; slot++) {
      const next = linkAt(pool, index, slot);
      if (next < 0 || next === previous || next >= pool.count) continue;
      if (next === target) return depth + 1;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push([next, index, depth + 1]);
      }
    }
  }
  return -1;
}

function ensureAccumulators(count) {
  if (accForceX.length >= count) return;
  let capacity = Math.max(4096, accForceX.length);
  while (capacity < count) capacity *= 2;
  accForceX = new Float32Array(capacity);
  accForceY = new Float32Array(capacity);
  accAlignX = new Float32Array(capacity);
  accAlignY = new Float32Array(capacity);
  accFeeding = new Float32Array(capacity);
  accFedUpon = new Float32Array(capacity);
  accCrowd = new Int32Array(capacity);
}

/**
 * Rebuild the per-species profile tables and return the widest radius in play,
 * which is what the pair cull and the grid cell size both have to respect.
 */
function ensureSpeciesProfiles(speciesManager, radius) {
  const count = speciesManager.count;
  if (speciesRadiusSquared.length < count) {
    let capacity = Math.max(16, speciesRadiusSquared.length);
    while (capacity < count) capacity *= 2;
    speciesRadiusSquared = new Float32Array(capacity);
    speciesCoreRadius = new Float32Array(capacity);
    speciesInverseCore = new Float32Array(capacity);
    speciesInverseBand = new Float32Array(capacity);
    speciesInverseRadius = new Float32Array(capacity);
    speciesBandCenter = new Float32Array(capacity);
  }

  const reach = speciesManager.reach;
  let widest = 0;
  for (let id = 0; id < count; id++) {
    // A freshly widened stride can leave a zero here; treat that as full reach
    // rather than as a species with no radius at all.
    const scaled = radius * (reach[id] > 0 ? reach[id] : 1);
    const core = scaled * CONFIG.coreRadiusRatio;
    speciesRadiusSquared[id] = scaled * scaled;
    speciesCoreRadius[id] = core;
    speciesInverseCore[id] = 1 / core;
    speciesInverseBand[id] = 1 / (scaled - core);
    speciesInverseRadius[id] = 1 / scaled;
    // Twice where the tent peaks, so the band term is one subtraction.
    speciesBandCenter[id] = core + scaled;
    if (scaled > widest) widest = scaled;
  }
  return widest;
}

/**
 * Advances the pool by `dt` and returns how much energy was drawn out of the
 * world's shared food stock, so the caller can debit it.
 */
export function stepPhysics(pool, grid, speciesManager, settings, climate, dt) {
  const count = pool.count;
  if (count === 0) return 0;
  ensureAccumulators(count);

  const worldSize = CONFIG.worldSize;
  const halfWorld = worldSize * 0.5;

  const widestRadius = ensureSpeciesProfiles(speciesManager, settings.interactionRadius);
  const cullRadiusSquared = widestRadius * widestRadius;

  const cols = grid.cols;
  const rows = grid.rows;
  const cellStart = grid.cellStart;

  const stride = speciesManager.stride;
  const matrix = speciesManager.values;
  const spinMatrix = speciesManager.spin;
  const trophicMatrix = speciesManager.trophic;
  const alignMatrix = speciesManager.align;
  const connectMatrix = speciesManager.connect;
  const adoptMatrix = speciesManager.adopt;
  const clumpMatrix = speciesManager.clump;
  const adoptability = speciesManager.adoptability;
  const connection = speciesManager.connection;

  // Hoist everything the inner loop touches out of objects and into locals.
  const px = pool.x;
  const py = pool.y;
  const pvx = pool.vx;
  const pvy = pool.vy;
  const pSpecies = pool.species;
  const forceX = accForceX;
  const forceY = accForceY;
  const alignX = accAlignX;
  const alignY = accAlignY;
  const feeding = accFeeding;
  const fedUpon = accFedUpon;
  const crowd = accCrowd;

  const forceScale = CONFIG.forceScale;
  const coreRepulsion = CONFIG.coreRepulsion;
  /**
   * Spin is applied to `shaped`, which already carries `forceScale` — so what
   * the twist needs is the *ratio* of the two peaks, not the peak itself.
   * Multiplying by CONFIG.spinScale directly makes every tangential force some
   * six hundred times the radial one, which saturates the force clamp on any
   * pair that has a spin value at all: the whole world becomes particles at
   * terminal velocity streaking past each other, with no radial structure
   * surviving long enough to be visible.
   */
  const spinRatio = (CONFIG.spinScale / CONFIG.forceScale) * settings.spin;
  const trophicScale = settings.predation;
  const useSpin = spinRatio !== 0;
  const useTrophic = trophicScale !== 0;
  const adoptScale = CONFIG.adoptScale * settings.adoptability;
  const useAdopt = adoptScale !== 0;
  const connectionScale = settings.connection || 0;
  const useConnection = connectionScale !== 0;
  const link = pool.link;
  const connectRadius = settings.interactionRadius * CONFIG.connectionRadius;
  const connectRadiusSquared = connectRadius * connectRadius;
  const selfAffinity = new Float32Array(speciesManager.count);
  if (useAdopt) {
    for (let s = 0; s < speciesManager.count; s++) {
      selfAffinity[s] = matrix[s * stride + s];
    }
  }

  const radiusTable = speciesRadiusSquared;
  const coreTable = speciesCoreRadius;
  const inverseCoreTable = speciesInverseCore;
  const inverseBandTable = speciesInverseBand;
  const inverseRadiusTable = speciesInverseRadius;
  const bandCenterTable = speciesBandCenter;

  forceX.fill(0, 0, count);
  forceY.fill(0, 0, count);
  alignX.fill(0, 0, count);
  alignY.fill(0, 0, count);
  feeding.fill(0, 0, count);
  fedUpon.fill(0, 0, count);
  crowd.fill(0, 0, count);

  /**
   * Resolve every pair between two contiguous index ranges. When `sameCell` is
   * set the ranges are identical and only j > i is considered, so a cell does
   * not interact with itself twice.
   */
  function sweep(aStart, aEnd, bStart, bEnd, sameCell) {
    for (let i = aStart; i < aEnd; i++) {
      const x = px[i];
      const y = py[i];
      const vx = pvx[i];
      const vy = pvy[i];
      const speciesI = pSpecies[i];
      const rowOffset = speciesI * stride;

      // i's own force profile, read once for all of its neighbours.
      const radiusSquaredI = radiusTable[speciesI];
      const coreI = coreTable[speciesI];
      const inverseCoreI = inverseCoreTable[speciesI];
      const inverseBandI = inverseBandTable[speciesI];
      const inverseRadiusI = inverseRadiusTable[speciesI];
      const bandCenterI = bandCenterTable[speciesI];

      let sumX = 0;
      let sumY = 0;
      let alignSumX = 0;
      let alignSumY = 0;
      let eaten = 0;
      let preyedOn = 0;
      let seen = 0;

      for (let j = sameCell ? i + 1 : bStart; j < bEnd; j++) {
        // Shortest separation on the torus, so forces reach across the seam.
        let dx = px[j] - x;
        let dy = py[j] - y;
        if (dx > halfWorld) dx -= worldSize; else if (dx < -halfWorld) dx += worldSize;
        if (dy > halfWorld) dy -= worldSize; else if (dy < -halfWorld) dy += worldSize;

        const distanceSquared = dx * dx + dy * dy;
        // Culled at the widest reach in the world; each direction then applies
        // its own, so a long-reach species can feel a short-reach one that
        // cannot feel it back. That one-sided perception is a real behaviour —
        // it is how something tracks a neighbour oblivious to it.
        if (distanceSquared >= cullRadiusSquared || distanceSquared < 1e-6) continue;

        const speciesJ = pSpecies[j];
        const inRangeI = distanceSquared < radiusSquaredI;
        const inRangeJ = distanceSquared < radiusTable[speciesJ];
        if (!inRangeI && !inRangeJ) continue;
        const rowIndex = rowOffset + speciesJ;
        const columnIndex = speciesJ * stride + speciesI;

        if (useConnection && distanceSquared < connectRadiusSquared) {
          const connectionI = (connection[speciesI] * 0.45 + connectMatrix[rowIndex] * 0.85) * connectionScale;
          const connectionJ = (connection[speciesJ] * 0.45 + connectMatrix[columnIndex] * 0.85) * connectionScale;
          const breakerI = connectionI < -0.25;
          const breakerJ = connectionJ < -0.25;
          if (breakerI && linkDegree(pool, j) > 0 && random() < -connectionI * CONFIG.connectionBreakChance * dt) breakLink(pool, j);
          if (breakerJ && linkDegree(pool, i) > 0 && random() < -connectionJ * CONFIG.connectionBreakChance * dt) breakLink(pool, i);

          const degreeI = linkDegree(pool, i);
          const degreeJ = linkDegree(pool, j);
          if (!breakerI && !breakerJ && degreeI < 2 && degreeJ < 2 && !hasLink(pool, i, j)) {
            const existingPath = chainDistance(pool, i, j, 48);
            const wouldCloseTinyLoop = existingPath > 0 && existingPath < 5;
            const canAutoClose = existingPath >= 8 && degreeI === 1 && degreeJ === 1;
            const canCloseLoop = existingPath >= 5 && degreeI === 1 && degreeJ === 1;
            const canExtendChain = existingPath < 0;
            if (!canExtendChain && !canCloseLoop) continue;
            if (wouldCloseTinyLoop) continue;

            if (canAutoClose) {
              const rest = settings.interactionRadius * CONFIG.connectionRestRadius;
              const phase = random() * Math.PI * 2;
              addLink(pool, i, j, rest, phase);
              continue;
            }

            const sameSpecies = speciesI === speciesJ ? 0.38 : 0;
            const affinity = Math.max(matrix[rowIndex], matrix[columnIndex]) * 0.22;
            const invitation = Math.max(connectionI, connectionJ) * 0.35;
            const willingness = Math.min(connectionI, connectionJ);
            const endpointBias = (degreeI === 1 || degreeJ === 1) ? 0.3 : -0.04;
            const loopBonus = canCloseLoop ? 0.6 : 0;
            const score = (connectionI + connectionJ) * 0.7 + sameSpecies + affinity + invitation + endpointBias + loopBonus;
            const linkDistance = Math.sqrt(distanceSquared);
            const proximity = 1 - linkDistance / connectRadius;
            const chance = Math.max(0, score + 0.25) * proximity * CONFIG.connectionChance * dt;
            if (willingness > -0.45 && score > -0.05 && random() < chance) {
              const rest = settings.interactionRadius * CONFIG.connectionRestRadius;
              const phase = random() * Math.PI * 2;
              addLink(pool, i, j, rest, phase);
            }
          }
        }

        const distance = Math.sqrt(distanceSquared);
        // Direction from i to j, reused for both halves of the pair. One
        // reciprocal instead of two divides: division is the most expensive
        // arithmetic in the loop and this runs on every pair in range.
        const inverseDistance = 1 / distance;
        const unitX = dx * inverseDistance;
        const unitY = dy * inverseDistance;
        // The matrices are asymmetric, so a pair needs both directions. They
        // are a few kilobytes at most, so all eight reads stay in L1.

        if (inRangeI) {
          if (distance < coreI) {
            const magnitude = coreRepulsion * (distance * inverseCoreI - 1);
            sumX += unitX * magnitude;
            sumY += unitY * magnitude;
          } else {
            const shaped = (1 - Math.abs(2 * distance - bandCenterI) * inverseBandI) * forceScale;
            let affinity = matrix[rowIndex];
            if (useAdopt) {
              const adopt = adoptability[speciesI] * 0.4 + adoptMatrix[rowIndex] * 0.6;
              if (adopt !== 0) {
                const proximity = 1 - distance * inverseRadiusI;
                const blend = adopt * adoptScale * proximity;
                const clamped = blend < -1 ? -1 : blend > 1 ? 1 : blend;
                affinity += clamped * (selfAffinity[speciesJ] - affinity);
              }
            }
            const magnitude = affinity * shaped;
            sumX += unitX * magnitude;
            sumY += unitY * magnitude;
            if (useSpin) {
              // Perpendicular to the separation — left of the outward direction.
              const twist = spinMatrix[rowIndex] * shaped * spinRatio;
              sumX -= unitY * twist;
              sumY += unitX * twist;
            }
          }

          const falloff = 1 - distance * inverseRadiusI;
          const weight = alignMatrix[rowIndex] * falloff;
          alignSumX += (pvx[j] - vx) * weight;
          alignSumY += (pvy[j] - vy) * weight;

          if (useTrophic) {
            // Positive means i takes from j; negative means i feeds j, which is
            // what makes farming and genuine symbiosis expressible at all.
            const transfer = trophicMatrix[rowIndex] * falloff * trophicScale;
            if (transfer > 0) {
              eaten += transfer;
              fedUpon[j] += transfer;
            } else if (transfer < 0) {
              preyedOn -= transfer;
              feeding[j] -= transfer;
            }
          }
        }

        if (inRangeJ) {
          const coreJ = coreTable[speciesJ];
          if (distance < coreJ) {
            const magnitude = coreRepulsion * (distance * inverseCoreTable[speciesJ] - 1);
            forceX[j] -= unitX * magnitude;
            forceY[j] -= unitY * magnitude;
          } else {
            const shaped =
              (1 - Math.abs(2 * distance - bandCenterTable[speciesJ]) * inverseBandTable[speciesJ]) * forceScale;
            let affinityJ = matrix[columnIndex];
            if (useAdopt) {
              const adopt = adoptability[speciesJ] * 0.4 + adoptMatrix[columnIndex] * 0.6;
              if (adopt !== 0) {
                const proximity = 1 - distance * inverseRadiusTable[speciesJ];
                const blend = adopt * adoptScale * proximity;
                const clamped = blend < -1 ? -1 : blend > 1 ? 1 : blend;
                affinityJ += clamped * (selfAffinity[speciesI] - affinityJ);
              }
            }
            const magnitude = affinityJ * shaped;
            forceX[j] -= unitX * magnitude;
            forceY[j] -= unitY * magnitude;
            if (useSpin) {
              // j's outward direction is -unit, so its perpendicular flips too.
              const twist = spinMatrix[columnIndex] * shaped * spinRatio;
              forceX[j] += unitY * twist;
              forceY[j] -= unitX * twist;
            }
          }

          const falloff = 1 - distance * inverseRadiusTable[speciesJ];
          const weight = alignMatrix[columnIndex] * falloff;
          alignX[j] += (vx - pvx[j]) * weight;
          alignY[j] += (vy - pvy[j]) * weight;

          if (useTrophic) {
            const transfer = trophicMatrix[columnIndex] * falloff * trophicScale;
            if (transfer > 0) {
              feeding[j] += transfer;
              preyedOn += transfer;
            } else if (transfer < 0) {
              fedUpon[j] -= transfer;
              eaten -= transfer;
            }
          }
        }

        // One neighbour, plus a same-species neighbour in the high half — they
        // are the ones competing for your exact food. Tallied at the pair's
        // widest reach rather than per direction, so both halves of a pair
        // always agree about whether they are neighbours at all.
        const tally = speciesJ === speciesI ? KIN_SHIFT + 1 : 1;
        seen += tally;
        crowd[j] += tally;
      }

      forceX[i] += sumX;
      forceY[i] += sumY;
      alignX[i] += alignSumX;
      alignY[i] += alignSumY;
      feeding[i] += eaten;
      fedUpon[i] += preyedOn;
      crowd[i] += seen;
    }
  }

  const forward = scratchForward;
  for (let cellY = 0; cellY < rows; cellY++) {
    const rowBase = cellY * cols;
    const belowBase = (cellY + 1 === rows ? 0 : cellY + 1) * cols;

    for (let cellX = 0; cellX < cols; cellX++) {
      const cell = rowBase + cellX;
      const start = cellStart[cell];
      const end = cellStart[cell + 1];
      if (start === end) continue;

      const right = cellX + 1 === cols ? 0 : cellX + 1;
      const left = cellX === 0 ? cols - 1 : cellX - 1;

      sweep(start, end, start, end, true);

      // The four forward neighbours: right, and the three below. The other
      // four directions reach this cell from their own side of the sweep.
      forward[0] = rowBase + right;
      forward[1] = belowBase + left;
      forward[2] = belowBase + cellX;
      forward[3] = belowBase + right;
      for (let n = 0; n < 4; n++) {
        const other = forward[n];
        const otherStart = cellStart[other];
        const otherEnd = cellStart[other + 1];
        if (otherStart !== otherEnd) sweep(start, end, otherStart, otherEnd, false);
      }
    }
  }

  applyConnectionForces(pool, speciesManager, settings, dt);
  return integrate(pool, settings, climate, dt);
}

function applyConnectionForces(pool, speciesManager, settings, dt) {
  const count = pool.count;
  const scale = settings.connection || 0;
  if (count === 0 || scale === 0) return;

  const worldSize = CONFIG.worldSize;
  const halfWorld = worldSize * 0.5;
  const px = pool.x;
  const py = pool.y;
  const pvx = pool.vx;
  const pvy = pool.vy;
  const pSpecies = pool.species;
  const connection = speciesManager.connection;

  for (let i = 0; i < count; i++) {
    for (let slot = 0; slot < 2; slot++) {
      const j = linkAt(pool, i, slot);
      if (j < 0) continue;
      const reciprocal = j < count ? linkSlotOf(pool, j, i) : -1;
      if (j >= count || j === i || reciprocal < 0) {
        setLinkSlot(pool, i, slot, -1);
        continue;
      }
      if (j < i) continue;

      let dx = px[j] - px[i];
      let dy = py[j] - py[i];
      if (dx > halfWorld) dx -= worldSize; else if (dx < -halfWorld) dx += worldSize;
      if (dy > halfWorld) dy -= worldSize; else if (dy < -halfWorld) dy += worldSize;

      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < 1e-6) continue;
      const distance = Math.sqrt(distanceSquared);
      const averageConnection = (connection[pSpecies[i]] + connection[pSpecies[j]]) * 0.5 * scale;
      const strongestConnection = Math.max(connection[pSpecies[i]], connection[pSpecies[j]]) * scale;
      const strength = Math.max(0, averageConnection + strongestConnection * 0.25);
      const rest =
        (slot === 0 ? pool.linkRest[i] : pool.linkRestB[i]) ||
        settings.interactionRadius * CONFIG.connectionRestRadius;
      if (strength <= 0 || distance > rest * CONFIG.connectionBreakRadius) {
        breakLink(pool, i, j);
        continue;
      }

      const unitX = dx / distance;
      const unitY = dy / distance;
      const currentPhase = slot === 0 ? pool.linkPhase[i] : pool.linkPhaseB[i];
      const phase = currentPhase + dt * (3.6 + strength * 1.2);
      const desired = rest * (1 + Math.sin(phase) * 0.018);
      const relVelocity = (pvx[j] - pvx[i]) * unitX + (pvy[j] - pvy[i]) * unitY;
      const spring = (distance - desired) * CONFIG.connectionSpring * strength;
      const damp = relVelocity * CONFIG.connectionDamping * strength;
      const wobble = Math.sin(phase * 1.45) * CONFIG.connectionWobble * strength;
      const force = spring + damp;

      accForceX[i] += unitX * force - unitY * wobble;
      accForceY[i] += unitY * force + unitX * wobble;
      accForceX[j] -= unitX * force - unitY * wobble;
      accForceY[j] -= unitY * force + unitX * wobble;
      setLinkSlot(pool, i, slot, j, rest, phase);
      setLinkSlot(pool, j, reciprocal, i, rest, phase);
    }
  }

  for (let i = 0; i < count; i++) {
    const a = pool.link[i];
    const b = pool.linkB[i];
    if (a < 0 || b < 0 || a >= count || b >= count || a === b) continue;

    let ax = px[a] - px[i];
    let ay = py[a] - py[i];
    let bx = px[b] - px[i];
    let by = py[b] - py[i];
    if (ax > halfWorld) ax -= worldSize; else if (ax < -halfWorld) ax += worldSize;
    if (ay > halfWorld) ay -= worldSize; else if (ay < -halfWorld) ay += worldSize;
    if (bx > halfWorld) bx -= worldSize; else if (bx < -halfWorld) bx += worldSize;
    if (by > halfWorld) by -= worldSize; else if (by < -halfWorld) by += worldSize;

    const la = Math.max(1, Math.hypot(ax, ay));
    const lb = Math.max(1, Math.hypot(bx, by));
    const nax = ax / la;
    const nay = ay / la;
    const nbx = bx / lb;
    const nby = by / lb;
    const fold = nax * nbx + nay * nby;
    if (fold > -0.4) {
      const push = (fold + 0.4) * CONFIG.connectionWobble * 0.42;
      const bisectX = nax + nbx;
      const bisectY = nay + nby;
      accForceX[i] -= bisectX * push;
      accForceY[i] -= bisectY * push;
      accForceX[a] += nbx * push * 0.35;
      accForceY[a] += nby * push * 0.35;
      accForceX[b] += nax * push * 0.35;
      accForceY[b] += nay * push * 0.35;
    }
  }

  // Loop-seeking: gently pull chain endpoints toward each other so chains
  // curve into rings instead of hoping their ends happen to drift close.
  // The force is deliberately weak — a nudge, not a yank — so the chain
  // bends gradually into a round shape rather than collapsing into a blob.
  const seekStrength = CONFIG.connectionSpring * CONFIG.loopSeekStrength;
  const restLen = settings.interactionRadius * CONFIG.connectionRestRadius;
  const maxSeek = CONFIG.forceScale * 0.6;
  for (let i = 0; i < count; i++) {
    if (linkDegree(pool, i) !== 1) continue;
    const connI = connection[pSpecies[i]] * scale;
    if (connI <= 0.1) continue;

    let cursor = i;
    let prev = -1;
    let chainLen = 0;
    while (chainLen < 48) {
      let next = -1;
      for (let slot = 0; slot < 2; slot++) {
        const partner = linkAt(pool, cursor, slot);
        if (partner >= 0 && partner < count && partner !== prev) {
          next = partner;
          break;
        }
      }
      if (next < 0) break;
      prev = cursor;
      cursor = next;
      chainLen++;
      if (linkDegree(pool, cursor) === 1) break;
    }

    if (chainLen < 6 || cursor === i || i > cursor) continue;

    let dx = px[cursor] - px[i];
    let dy = py[cursor] - py[i];
    if (dx > halfWorld) dx -= worldSize; else if (dx < -halfWorld) dx += worldSize;
    if (dy > halfWorld) dy -= worldSize; else if (dy < -halfWorld) dy += worldSize;

    const distSq = dx * dx + dy * dy;
    if (distSq < 1e-6) continue;
    const dist = Math.sqrt(distSq);

    const avgConn = (connection[pSpecies[i]] + connection[pSpecies[cursor]]) * 0.5 * scale;
    if (avgConn <= 0) continue;

    // Target: the diameter of the ring this chain would form if closed.
    const ringDiameter = chainLen * restLen / Math.PI;
    const pull = Math.min(maxSeek, Math.max(0, dist - ringDiameter) * seekStrength * avgConn);
    const unitX = dx / dist;
    const unitY = dy / dist;

    accForceX[i] += unitX * pull;
    accForceY[i] += unitY * pull;
    accForceX[cursor] -= unitX * pull;
    accForceY[cursor] -= unitY * pull;
  }
}

/**
 * Second pass: turn the accumulated forces and predation tallies into motion
 * and an energy balance. Split out from the pair sweep because it is a single
 * linear walk over the arrays and wants to stay that way.
 */
function integrate(pool, settings, climate, dt) {
  const count = pool.count;
  const worldSize = CONFIG.worldSize;
  const halfWorld = worldSize * 0.5;

  const px = pool.x;
  const py = pool.y;
  const pvx = pool.vx;
  const pvy = pool.vy;
  const pEnergy = pool.energy;
  const pAge = pool.age;
  const pSpecies = pool.species;
  const pMass = pool.mass;

  const forceX = accForceX;
  const forceY = accForceY;
  const alignX = accAlignX;
  const alignY = accAlignY;
  const feeding = accFeeding;
  const fedUpon = accFedUpon;
  const crowd = accCrowd;

  const maxForce = CONFIG.maxForce;
  const maxForceSquared = maxForce * maxForce;
  const maxVelocity = CONFIG.maxVelocity;
  const maxVelocitySquared = maxVelocity * maxVelocity;
  // Friction as a velocity half-life: identical behaviour at any frame rate.
  const damping = Math.pow(0.5, dt / CONFIG.frictionHalfLife);
  const noise = settings.noise;
  const alignScale = CONFIG.alignScale * settings.alignment;
  const useAlign = alignScale !== 0;
  const maxEnergy = CONFIG.maxEnergy;
  const windX = climate.windX;
  const windY = climate.windY;

  // The cursor, as a force in the world. See the brush constants in config.js.
  const brush = climate.brush;
  const brushActive = brush.active && brush.strength !== 0;
  const brushX = brush.x;
  const brushY = brush.y;
  const brushRadius = brush.radius;
  const brushRadiusSquared = brushRadius * brushRadius;
  const brushStrength = brush.strength;
  const brushSwirl = brush.swirl;

  // Everyone's slice of the shared food stock this tick, and the per-species
  // multiplier that gives rare lineages their foothold.
  const foodShare = climate.foodShare;
  const speciesDemand = climate.speciesDemand;
  // Hotspots are sampled from a coarse cached field instead of being evaluated
  // per particle: they drift far too slowly to justify thousands of exp() calls
  // every tick, and at this resolution the difference is invisible.
  const richnessField = climate.richnessField;
  const richnessCols = climate.richnessCols;
  const richnessScale = richnessCols / CONFIG.worldSize;
  const lossScale = settings.energyLoss;
  const comfortable = CONFIG.comfortableNeighbors;
  const crowdingPenalty = CONFIG.crowdingPenalty;
  const predationGain = CONFIG.predationGain;
  const predationLoss = CONFIG.predationLoss;
  const motionCost = CONFIG.motionCost;
  const kinCompetition = CONFIG.kinCompetition;
  const nicheOverlap = settings.nicheOverlap;
  // The world's average mixedness on the previous tick, which is what this
  // tick's efficiencies are measured against. See the note below.
  const meanForeign = climate.meanForeignFraction;
  const baseDrain = settings.baseEnergyDrain;
  const clumpMassCost = CONFIG.clumpMassCost;

  let consumed = 0;
  let foreignSum = 0;

  for (let i = 0; i < count; i++) {
    const particleMass = pMass[i];
    const inverseMass = particleMass > 1 ? 1 / particleMass : 1;
    let fx = forceX[i] * inverseMass;
    let fy = forceY[i] * inverseMass;

    const packed = crowd[i];
    const neighborCount = packed & 0xffff;
    const kinCount = packed >>> 16;

    // Velocity matching, averaged over neighbours rather than summed: an
    // unnormalised sum would throw a particle in a dense crowd around purely
    // because it has more neighbours than one out on an edge.
    if (useAlign && neighborCount > 0) {
      const share = alignScale / neighborCount;
      fx += alignX[i] * share;
      fy += alignY[i] * share;
    }

    /**
     * Clamp the accumulated force: a dense pile-up must never explode.
     *
     * Clamped by magnitude, not per axis. Clamping each axis independently
     * preserves neither the direction nor the ratio of the two components, so a
     * saturated force of any direction collapses to exactly (±max, ±max) — a
     * 45-degree diagonal. Any world that reaches the ceiling then develops
     * unmistakable diagonal streaking that has nothing to do with the physics
     * and everything to do with the clamp. One square root per particle, once
     * per tick, is nothing next to the pair loop that produced the force.
     */
    const forceMagnitudeSquared = fx * fx + fy * fy;
    if (forceMagnitudeSquared > maxForceSquared) {
      const scale = maxForce / Math.sqrt(forceMagnitudeSquared);
      fx *= scale;
      fy *= scale;
    }

    fx += (random() * 2 - 1) * noise + windX;
    fy += (random() * 2 - 1) * noise + windY;

    if (brushActive) {
      let bx = brushX - px[i];
      let by = brushY - py[i];
      if (bx > halfWorld) bx -= worldSize; else if (bx < -halfWorld) bx += worldSize;
      if (by > halfWorld) by -= worldSize; else if (by < -halfWorld) by += worldSize;
      const brushDistanceSquared = bx * bx + by * by;
      if (brushDistanceSquared < brushRadiusSquared && brushDistanceSquared > 1e-6) {
        const brushDistance = Math.sqrt(brushDistanceSquared);
        // Falls off to nothing at the rim, so dragging the brush through a
        // structure shears it rather than shattering it against a hard edge.
        const shaped = brushStrength * (1 - brushDistance / brushRadius);
        const inverse = 1 / brushDistance;
        const towardX = bx * inverse;
        const towardY = by * inverse;
        if (brushSwirl) {
          fx -= towardY * shaped;
          fy += towardX * shaped;
          fx += towardX * shaped * 0.35;
          fy += towardY * shaped * 0.35;
        } else {
          fx += towardX * shaped;
          fy += towardY * shaped;
        }
      }
    }

    let vx = (pvx[i] + fx * dt) * damping;
    let vy = (pvy[i] + fy * dt) * damping;

    let speedSquared = vx * vx + vy * vy;
    if (speedSquared > maxVelocitySquared) {
      const scale = maxVelocity / Math.sqrt(speedSquared);
      vx *= scale;
      vy *= scale;
      speedSquared = maxVelocitySquared;
    }
    if (!Number.isFinite(vx)) vx = 0;
    if (!Number.isFinite(vy)) vy = 0;

    pvx[i] = vx;
    pvy[i] = vy;

    // Integrate, then wrap — the world has no edges.
    let nextX = px[i] + vx * dt;
    let nextY = py[i] + vy * dt;
    if (nextX < 0) nextX += worldSize; else if (nextX >= worldSize) nextX -= worldSize;
    if (nextY < 0) nextY += worldSize; else if (nextY >= worldSize) nextY -= worldSize;
    if (!Number.isFinite(nextX)) nextX = random() * worldSize;
    if (!Number.isFinite(nextY)) nextY = random() * worldSize;
    px[i] = nextX;
    py[i] = nextY;

    pAge[i] += dt;

    // --- Energy budget --------------------------------------------------
    // Feeding has diminishing returns (a crowd of prey is not a proportional
    // meal) while predation losses do not — being surrounded really is fatal.
    const harvest = neighborCount > 0 ? feeding[i] / Math.sqrt(neighborCount) : 0;
    const crowding = neighborCount > comfortable ? (neighborCount - comfortable) * crowdingPenalty : 0;

    /**
     * Niche overlap: grazing efficiency depends on *who* your neighbours are.
     *
     * A particle sitting on a boundary between two lineages is exploiting food
     * its neighbours are not competing for, and feeds better than one buried in
     * a pile of its own kind. This is the term that makes the uniform
     * monoculture lattice the worst-fed state in the world rather than the
     * cheapest one, and it is why membranes, shells and mixed colonies now pay
     * for themselves instead of being lucky accidents. A particle with no
     * neighbours at all counts as fully overlapped, so the pressure pushes
     * towards interfaces and not towards evenly spaced dust.
     *
     * Measured against the world's *average* mixedness rather than against a
     * fixed ceiling, which makes the term exactly zero-sum: the bonuses paid to
     * boundary-dwellers are funded by the penalties on buried ones, and the
     * mean efficiency is 1 whatever shape the world is in.
     *
     * That normalisation is load-bearing, not tidiness. Scored against a fixed
     * ceiling the term is a net tax whose size depends on how clumped the world
     * happens to be, and correcting the food market for that tax closes a
     * vicious loop: clumping lowers efficiency, the market compensates with a
     * larger share, the extra food sustains still tighter clumps, and the kin
     * competition inside them kills more than the extra food supports. The
     * observable symptom is the Food Supply slider running *backwards* —
     * measured on a fixed seed, raising regeneration from 28k to 44k drove the
     * population down from 4013 to 2675. Zero-sum by construction has no such
     * loop, and leaves the food economy's original equilibrium untouched.
     */
    const foreignFraction = neighborCount > 0 ? (neighborCount - kinCount) / neighborCount : 0;
    foreignSum += foreignFraction;
    let efficiency = 1 + nicheOverlap * (foreignFraction - meanForeign);
    if (efficiency < 0) efficiency = 0;

    // Draw from the shared stock. Demand is per species (rarity bonus) and
    // per place (resource hotspots), but the share is global — that coupling
    // is what makes the whole population self-regulating.
    const fieldX = (nextX * richnessScale) | 0;
    const fieldY = (nextY * richnessScale) | 0;
    const grazed =
      speciesDemand[pSpecies[i]] * richnessField[fieldY * richnessCols + fieldX] * foodShare * efficiency;
    consumed += grazed;

    const gain = grazed + harvest * predationGain;
    const massDrain = particleMass > 1 ? (particleMass - 1) * clumpMassCost : 0;
    const drain =
      (baseDrain * particleMass +
        massDrain +
        fedUpon[i] * predationLoss +
        kinCount * kinCompetition +
        crowding +
        Math.sqrt(speedSquared) * motionCost) *
      lossScale;

    let energy = pEnergy[i] + (gain - drain) * dt;
    if (!Number.isFinite(energy)) energy = 0;
    else if (energy > maxEnergy) energy = maxEnergy;
    pEnergy[i] = energy;
  }

  // The baseline the next tick's efficiencies are scored against. It moves far
  // too slowly for the one-tick lag to be observable.
  climate.meanForeignFraction = count > 0 ? foreignSum / count : 0;
  return consumed * dt;
}
