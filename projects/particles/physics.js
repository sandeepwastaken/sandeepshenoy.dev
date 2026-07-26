import { CONFIG } from "./config.js";
import { random } from "./utils.js";

/**
 * One physics tick for the whole pool: forces, integration and the energy
 * budget.
 *
 * Force profile (classic Particle-Life shape, per neighbour):
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

function ensureAccumulators(count) {
  if (accForceX.length >= count) return;
  let capacity = Math.max(4096, accForceX.length);
  while (capacity < count) capacity *= 2;
  accForceX = new Float32Array(capacity);
  accForceY = new Float32Array(capacity);
  accFeeding = new Float32Array(capacity);
  accFedUpon = new Float32Array(capacity);
  accCrowd = new Int32Array(capacity);
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

  const radius = settings.interactionRadius;
  const radiusSquared = radius * radius;
  const inverseRadius = 1 / radius;
  const coreRadius = radius * CONFIG.coreRadiusRatio;
  const inverseCoreRadius = 1 / coreRadius;
  const bandWidth = radius - coreRadius;
  const inverseBandWidth = 1 / bandWidth;

  const cols = grid.cols;
  const rows = grid.rows;
  const cellStart = grid.cellStart;

  const matrix = speciesManager.values;
  const stride = speciesManager.stride;

  // Hoist everything the inner loop touches out of objects and into locals.
  const px = pool.x;
  const py = pool.y;
  const pSpecies = pool.species;
  const forceX = accForceX;
  const forceY = accForceY;
  const feeding = accFeeding;
  const fedUpon = accFedUpon;
  const crowd = accCrowd;

  const forceScale = CONFIG.forceScale;
  const coreRepulsion = CONFIG.coreRepulsion;

  forceX.fill(0, 0, count);
  forceY.fill(0, 0, count);
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
      const speciesI = pSpecies[i];
      const rowOffset = speciesI * stride;
      let sumX = 0;
      let sumY = 0;
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
        if (distanceSquared >= radiusSquared || distanceSquared < 1e-6) continue;

        const distance = Math.sqrt(distanceSquared);
        const speciesJ = pSpecies[j];
        // The matrix is asymmetric, so a pair needs both directions. It is a
        // couple of kilobytes at most, so both reads stay in L1.
        const attractionIJ = matrix[rowOffset + speciesJ];
        const attractionJI = matrix[speciesJ * stride + speciesI];

        // Direction from i to j, reused for both halves of the pair. One
        // reciprocal instead of two divides: division is the most expensive
        // arithmetic in the loop and this runs on every pair in range.
        const inverseDistance = 1 / distance;
        const unitX = dx * inverseDistance;
        const unitY = dy * inverseDistance;

        let magnitudeIJ;
        let magnitudeJI;
        if (distance < coreRadius) {
          // Below the core radius everything repels, harder the closer it is.
          magnitudeIJ = coreRepulsion * (distance * inverseCoreRadius - 1);
          magnitudeJI = magnitudeIJ;
        } else {
          // Tent function peaking halfway through the outer band.
          const band = 1 - Math.abs(2 * distance - coreRadius - radius) * inverseBandWidth;
          const shaped = band * forceScale;
          magnitudeIJ = attractionIJ * shaped;
          magnitudeJI = attractionJI * shaped;
        }

        sumX += unitX * magnitudeIJ;
        sumY += unitY * magnitudeIJ;
        forceX[j] -= unitX * magnitudeJI;
        forceY[j] -= unitY * magnitudeJI;

        // Predation is the mirror image of the matrix: chasing something is
        // how you eat, and being chased is how you are eaten.
        const falloff = 1 - distance * inverseRadius;
        if (attractionIJ > 0) {
          const transfer = attractionIJ * falloff;
          eaten += transfer;
          fedUpon[j] += transfer;
        }
        if (attractionJI > 0) {
          const transfer = attractionJI * falloff;
          feeding[j] += transfer;
          preyedOn += transfer;
        }
        // One neighbour, plus a same-species neighbour in the high half — they
        // are the ones competing for your exact food.
        const tally = speciesJ === speciesI ? KIN_SHIFT + 1 : 1;
        seen += tally;
        crowd[j] += tally;
      }

      forceX[i] += sumX;
      forceY[i] += sumY;
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

  return integrate(pool, settings, climate, dt);
}

/**
 * Second pass: turn the accumulated forces and predation tallies into motion
 * and an energy balance. Split out from the pair sweep because it is a single
 * linear walk over the arrays and wants to stay that way.
 */
function integrate(pool, settings, climate, dt) {
  const count = pool.count;
  const worldSize = CONFIG.worldSize;

  const px = pool.x;
  const py = pool.y;
  const pvx = pool.vx;
  const pvy = pool.vy;
  const pEnergy = pool.energy;
  const pAge = pool.age;
  const pSpecies = pool.species;

  const forceX = accForceX;
  const forceY = accForceY;
  const feeding = accFeeding;
  const fedUpon = accFedUpon;
  const crowd = accCrowd;

  const maxForce = CONFIG.maxForce;
  const maxVelocity = CONFIG.maxVelocity;
  const maxVelocitySquared = maxVelocity * maxVelocity;
  // Friction as a velocity half-life: identical behaviour at any frame rate.
  const damping = Math.pow(0.5, dt / CONFIG.frictionHalfLife);
  const noise = settings.noise;
  const maxEnergy = CONFIG.maxEnergy;
  const windX = climate.windX;
  const windY = climate.windY;

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
  const baseDrain = settings.baseEnergyDrain;

  let consumed = 0;

  for (let i = 0; i < count; i++) {
    let fx = forceX[i];
    let fy = forceY[i];

    // Clamp the accumulated force: a dense pile-up must never explode.
    if (fx > maxForce) fx = maxForce; else if (fx < -maxForce) fx = -maxForce;
    if (fy > maxForce) fy = maxForce; else if (fy < -maxForce) fy = -maxForce;

    fx += (random() * 2 - 1) * noise + windX;
    fy += (random() * 2 - 1) * noise + windY;

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
    const packed = crowd[i];
    const neighborCount = packed & 0xffff;
    const kinCount = packed >>> 16;
    const harvest = neighborCount > 0 ? feeding[i] / Math.sqrt(neighborCount) : 0;
    const crowding = neighborCount > comfortable ? (neighborCount - comfortable) * crowdingPenalty : 0;

    // Draw from the shared stock. Demand is per species (rarity bonus) and
    // per place (resource hotspots), but the share is global — that coupling
    // is what makes the whole population self-regulating.
    const fieldX = (nextX * richnessScale) | 0;
    const fieldY = (nextY * richnessScale) | 0;
    const grazed = speciesDemand[pSpecies[i]] * richnessField[fieldY * richnessCols + fieldX] * foodShare;
    consumed += grazed;

    const gain = grazed + harvest * predationGain;
    const drain =
      (baseDrain +
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

  return consumed * dt;
}
