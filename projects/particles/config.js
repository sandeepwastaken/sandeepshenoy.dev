/**
 * Central tuning constants. Nothing in the simulation should contain magic
 * numbers: every knob lives here (or in Simulation.settings, for the subset the
 * UI can change at runtime).
 */
export const CONFIG = {
  // --- World -------------------------------------------------------------
  // The world is a torus: leaving one edge re-enters the opposite one, so the
  // map has no boundary and the renderer tiles it forever in every direction.
  // Sized against the equilibrium population set by the food economy below, so
  // that roughly half the world is empty space at any moment: too sparse and
  // colonies never meet, too dense and everything jams into uniform grain.
  worldSize: 1600,

  // --- Founding species --------------------------------------------------
  // Six founders. Hues are spread evenly so lineages stay visually separable;
  // every interaction value is random.
  initialSpeciesCount: 6,
  initialHueOffset: 12,
  initialSaturation: 74,
  initialLightness: 58,
  initialParticlesPerSpecies: 800,
  initialEnergy: 130,
  /**
   * Founders are seeded as a handful of patches each, plus a scattering of
   * drifters, rather than sprinkled uniformly.
   *
   * A uniform sprinkle is the worst of both worlds: every species starts
   * perfectly mixed with every other, so nothing has the local coherence needed
   * to condense into a structure before it is stirred back into grain. Pure
   * segregated colonies are the opposite failure — they never meet, and
   * inter-species structure is where all the interesting shapes live. Patches
   * plus drifters give both: coherent cores that can form something, and enough
   * loose population that the cores find each other within the first minute.
   */
  initialPatchesPerSpecies: 5,
  initialPatchRadiusRatio: 0.085,
  initialDrifterFraction: 0.22,
  // Cross-species affinities are drawn from the full [-1, 1] range, but a
  // species' feeling about *itself* is drawn from a range skewed positive.
  // Fully random self-affinity makes most worlds mutually repulsive, which is
  // exactly the "evenly spaced dust grid" failure mode: nothing ever clumps,
  // so there is no structure for selection to act on.
  selfAffinityMin: -0.15,
  selfAffinityMax: 1,

  // --- Interaction / force profile ---------------------------------------
  interactionRadius: 50,
  /**
   * Fraction of the radius that is unconditionally repulsive. This "hard core"
   * gives clusters internal structure instead of collapsing them to a point.
   *
   * It has to stay well under the world's average particle spacing. If the two
   * are comparable, every particle is already sitting at its exclusion
   * distance from its neighbours and the world jams into evenly spaced dust
   * that cannot condense anywhere — the failure mode this value guards against.
   */
  coreRadiusRatio: 0.18,
  // Peak core repulsion is kept slightly above peak attraction, so clusters
  // hold their shape instead of collapsing, while still being free to move.
  coreRepulsion: 1600,
  forceScale: 1000,
  maxForce: 9000,
  maxVelocity: 300,

  /**
   * --- Interaction channels ----------------------------------------------
   *
   * A species pair is described by several independent numbers, not one. The old
   * world had only the radial force, which meant a single value had to be both
   * "how I move relative to you" and "whether I eat you" — so every cohesive
   * relationship was also a predatory one, and any structure that held together
   * was simultaneously digesting itself.
   *
   *   force    radial attraction / repulsion  (the classic Particle-Life term)
   *   spin     force *perpendicular* to the separation, which is what makes
   *            self-propelled swimmers and rotors possible at all
   *   trophic  who feeds on whom, now free to disagree with force
   *   align    velocity matching, which gives a structure rigidity of motion
   *   connect  end-to-end bond formation for chains and rings
   *
   * `spinScale`, `alignScale` and the predation constants below convert a
   * channel's [-1, 1] value into world units.
   */
  /**
   * Peak tangential force at |spin| = 1.
   *
   * Perpendicular forces do not obey Newton's third law, so a pair does not
   * conserve momentum — which is the entire point. That broken symmetry is the
   * mathematical source of self-propulsion: a bonded pair with opposite spins
   * translates (a swimmer), one with equal spins orbits (a rotor). Kept below
   * `forceScale` so radial structure still dominates and the spin decorates it
   * rather than tearing it apart.
   */
  spinScale: 620,
  /**
   * Velocity-matching strength at |align| = 1, as a force per unit of velocity
   * difference. This is the closest thing the world has to a *bond*: it costs
   * no persistent state, but it means a member knocked out of a moving
   * structure is dragged back into the group's motion instead of being lost.
   * Without it, every motile structure is a coincidence that survives exactly
   * until the first collision.
   *
   * The accumulated alignment is averaged over neighbours before it is applied,
   * so a particle deep inside a crowd is not flung about by sheer neighbour
   * count the way an unnormalised sum would do.
   */
  alignScale: 4.2,

  /**
   * Per-species interaction reach, as a fraction of the global radius.
   *
   * Every species used to interact at exactly one distance, so every structure
   * in the world came out at the same grain no matter what the matrix said.
   * A short-reach species builds tight, hard, dense bodies; a long-reach one
   * builds diffuse halos — and the two can nest, which is where multi-scale
   * structure comes from.
   *
   * The floor is not cosmetic. The core radius scales with reach, and the
   * timestep is only stable while a particle cannot cross its own core in one
   * step: `reachMin * coreRadiusRatio * interactionRadius / maxVelocity` must
   * stay above `maxTimestep`. At the defaults that is 6.3 / 300 = 0.021s
   * against a 0.0167s step — comfortable, but it is why reach cannot go lower
   * without also slowing the world down.
   */
  reachMin: 0.7,
  reachMax: 1,
  adoptScale: 0.7,
  adoptDriftRate: 0.005,
  clumpMergeRadius: 0.55,
  clumpMergeChance: 0.4,
  clumpSplitChance: 0.2,
  clumpMaxMass: 5,
  clumpMassCost: 0.5,
  clumpDriftRate: 0.005,
  connectionDriftRate: 0.005,
  connectionRadius: 1.05,
  connectionRestRadius: 0.18,
  connectionBreakRadius: 4.2,
  connectionSpring: 14000,
  connectionWobble: 620,
  connectionDamping: 2.4,
  connectionChance: 18,
  connectionBreakChance: 2.2,
  loopSeekStrength: 0.015,
  /**
   * Friction is expressed as a velocity half-life in seconds, which is both
   * frame-rate independent and physically meaningful: it is the time an
   * undisturbed particle takes to lose half its speed.
   *
   * This is the single most important dial for the *look* of the world, and it
   * wants to be short. The world has to be strongly overdamped — velocity
   * essentially proportional to the force acting right now, with almost no
   * momentum — before clusters, membranes and chains can form at all. Give
   * particles momentum and they sail straight through each other's force wells
   * and the whole world stays a hot, evenly spaced gas no matter how the matrix
   * is tuned. Terminal speed is roughly forceScale * frictionHalfLife / ln 2,
   * so the two are raised and lowered together.
   */
  frictionHalfLife: 0.05,
  /**
   * Random jitter, in the same units as the forces above. This is not
   * decoration: an overdamped world with no agitation slides into a force
   * balance and stops dead — a frozen foam that technically has structure but
   * never changes. The noise is the world's temperature, and it is what keeps
   * membranes rippling and clusters trading members forever.
   */
  noise: 170,

  /**
   * --- Energy: a closed food economy -------------------------------------
   *
   * The old model gave every particle a fixed ambient income, which is a
   * knife-edge: if income slightly exceeds upkeep the population grows without
   * bound, and if it is slightly short everything starves at once. Both
   * failure modes were reachable by nudging one slider.
   *
   * Instead the world has a single food stock that refills at a fixed rate.
   * Particles bid for it; when demand exceeds supply everyone gets a
   * proportional share. That makes the population self-regulating by
   * construction:
   *
   *   equilibrium population  ~=  foodRegenPerSecond / upkeep per particle
   *
   * More particles simply means a thinner slice each, so the population cannot
   * explode; and when it dips, the survivors immediately get richer, so it
   * cannot die out either.
   *
   * The regeneration rate therefore sets the equilibrium population, and with
   * it the world's density — which turns out to be the main thing standing
   * between "interesting" and "flat". A crowded world has nowhere to put a
   * void, so clusters cannot have edges and everything smears into uniform
   * grain; an empty one leaves isolated bundles that never meet. Roughly half
   * the space empty at any moment is the band worth staying in.
   */
  foodRegenPerSecond: 34000,
  // A small buffer so a brief lull banks food instead of wasting it. Kept to
  // well under a second of regeneration: a larger larder is a loaded spring,
  // and releasing it all at once is exactly how a boom-bust cycle starts.
  foodStockMax: 16000,
  // What one particle tries to absorb per second when food is unlimited.
  // Must exceed upkeep, otherwise nothing can ever save up enough to breed.
  metabolicDemand: 10,

  /**
   * Rare-species advantage (negative frequency dependence).
   *
   * A newly mutated species starts as a handful of individuals against
   * thousands, so without help it is always outcompeted — which is why
   * mutations never used to establish. Real ecosystems solve this the same way
   * this world does: a rare type is exploiting a niche nobody else is using,
   * so it feeds far more efficiently per capita than the dominant type.
   *
   *   advantage(n) = 1 + strength * scale / (scale + n)
   *
   * The bonus is halved once a species reaches `scale` members, and is
   * negligible for a dominant one. This single term is what keeps diversity
   * alive and stops any lineage from permanently owning the world.
   */
  rareAdvantageStrength: 0.9,
  rareAdvantageScale: 220,
  /**
   * The bonus is strongest while a lineage is new and decays towards
   * `rareAdvantageFloor` with this half-life. A brand new species gets a real
   * trial; an old one that stayed rare has demonstrably failed to find a niche
   * and loses its protection, which is what keeps species turning over instead
   * of every mutation accumulating forever.
   */
  noveltyHalfLifeSeconds: 90,
  rareAdvantageFloor: 0.3,

  // Predation: you feed on the neighbours you are attracted to, and are fed on
  // by the neighbours attracted to you. Summed over the world the two sides
  // see the same total, and gain (divided by sqrt of the crowd) always lands
  // below loss, so predation redistributes energy without ever creating it.
  predationGain: 7,
  predationLoss: 2,
  crowdingPenalty: 0.12,
  comfortableNeighbors: 20,
  /**
   * Cost per neighbour *of your own species*.
   *
   * This is the local counterpart of the rare-species bonus, and it is what
   * stops the world collapsing into one winning monoculture — the state that
   * looks like an evenly spaced frozen grid, because a crowd that all attract
   * each other equally has no reason to form anything but a uniform lattice.
   *
   * Your own kind eats exactly what you eat, so they are your real competitors;
   * a neighbour of another species is not. Ecology's classic condition for
   * coexistence is precisely that competition within a species exceeds
   * competition between species, and it is also what produces the good shapes:
   * a particle does better on the boundary between two species than buried in
   * a pile of its own, so blobs grow shells, membranes and chains.
   */
  kinCompetition: 0.34,
  /**
   * Niche overlap — how much of your food you lose by being surrounded only by
   * your own kind.
   *
   *   efficiency = 1 - nicheOverlap * (1 - fraction of neighbours that are foreign)
   *
   * This is the term that kills the monoculture lattice, and it is worth being
   * precise about why that state was so hard to dislodge. A single species with
   * positive self-affinity settles at the spacing where its attraction balances
   * the hard core — roughly ten neighbours inside the radius, which is under
   * `comfortableNeighbors`, so it paid no crowding penalty at all. An evenly
   * spaced grid was, quite literally, the cheapest way to exist. Nothing in the
   * energy budget could tell the difference between that and a structure.
   *
   * Now it can. Grazing efficiency is a function of who your neighbours *are*:
   * a particle buried in its own kind feeds at `1 - nicheOverlap`, one sitting
   * on a boundary between two lineages feeds at full rate. The uniform lattice
   * becomes the *worst*-fed configuration in the world rather than the best,
   * and membranes, shells, chains and mixed colonies — the shapes worth looking
   * at — become the fittest ones instead of a lucky accident.
   *
   * A particle with no neighbours at all counts as fully overlapped, so this
   * does not simply push the world into evenly spaced dust instead.
   *
   * Scored against the world's average mixedness, so the term is zero-sum: it
   * redistributes food towards boundaries without changing how much of it there
   * is, and the food economy's equilibrium is untouched at any setting. Turning
   * it up sharpens the advantage of living on an interface; it does not shrink
   * the world. Measured against a fixed seed, the largest species' share of the
   * world after 90 seconds falls from about 0.9 at zero to well under that
   * here — the difference between "one species owns the map" and "several
   * coexist".
   */
  nicheOverlap: 0.5,
  motionCost: 0.004,
  baseEnergyDrain: 5,
  energyGain: 1,
  energyLoss: 1,
  maxEnergy: 400,

  // --- Life cycle --------------------------------------------------------
  birthThreshold: 150,
  birthCostRatio: 0.5,
  baseFertility: 0.1,
  surplusFertility: 0.35,
  maxAgeSeconds: 150,
  ageVariance: 0.3,
  /**
   * How hard a famine suppresses breeding: fertility is multiplied by
   * `foodShare ^ scarcityFertilityPower`.
   *
   * This is the single most important stability term in the world. Without it
   * the population is regulated purely by *death*: it overshoots the food
   * supply, and because reproduction leaves everybody sitting in the same
   * narrow energy band, the whole world then starves within a few seconds of
   * itself and the map goes empty. With it, the world stops making babies
   * before it runs out of food, and the population lands softly instead of
   * oscillating between explosion and total extinction.
   */
  scarcityFertilityPower: 2,
  /**
   * Newborns cannot breed until this old. This bounds the maximum rate at
   * which the population can double no matter how the sliders are set, which
   * is what stops "boost births a bit" from turning into an explosion — and it
   * ends the birth/death treadmill where particles split, halve their energy,
   * climb back and split again several times a second.
   */
  maturityAgeSeconds: 6,

  /**
   * --- Trait drift (anagenesis) ------------------------------------------
   *
   * Speciation is punctuation; this is the sentence between it. Every living
   * species' row and column wander continuously as a random walk, so a lineage
   * that never once mutates is still slowly becoming something else — a little
   * more social, a little more predatory — and a matrix that looked settled an
   * hour ago no longer is.
   *
   * The rate is per square-root of a second, because that is how a random walk
   * accumulates: at 0.015 a single affinity wanders about 0.15 in a hundred
   * seconds and about 0.34 in ten minutes. Deliberately slow enough that you
   * notice it only by looking away and looking back.
   */
  traitDriftRate: 0.015,
  /**
   * Reach drifts too, but at a fraction of the rate: it is the one trait that
   * changes the *scale* a lineage builds at, and a body plan that rescales as
   * fast as its affinities change never gets to be a body plan.
   */
  reachDriftRate: 0.004,
  /** Colour follows character, but far more slowly, so species stay findable. */
  hueDriftRate: 0.35,
  /** Drift is applied on the statistics tick rather than every frame. */
  driftIntervalSeconds: 0.45,

  // --- Mutation ----------------------------------------------------------
  mutationRate: 0.0006,
  largeMutationChance: 0.08,
  smallMutationSpread: 0.16,
  largeMutationSpread: 0.45,
  hueDriftSmall: 13,
  hueDriftLarge: 42,
  /**
   * A new species is founded by a burst of siblings rather than a single
   * individual. One particle in a world of thousands is statistically dead on
   * arrival no matter how good its genes; a founding colony is small enough to
   * still be a gamble, but large enough that a genuinely good mutation gets to
   * show what it can do. This is punctuated equilibrium, on purpose.
   */
  founderColonySize: 26,
  founderColonyRadius: 34,
  /**
   * Speciation is rolled per birth, so a world with a high birth rate would
   * otherwise found dozens of species a second and bury the matrix. A minimum
   * spacing in world time turns the mutation slider into "how often novelty
   * appears" rather than "how fast the species list explodes".
   */
  minSpeciationIntervalSeconds: 2.5,

  /**
   * --- Player tools ------------------------------------------------------
   *
   * The cursor is a force in the world, not a camera accessory. Structures here
   * are fragile in the way weather is fragile, and being able to shove one out
   * of the path of an oncoming colony — or stir a stalled region until
   * something new nucleates — is the difference between watching a simulation
   * and playing with one.
   */
  brushRadius: 150,
  brushStrength: 2600,
  brushRadiusMin: 40,
  brushRadiusMax: 520,
  /** A Feed brush drop, as a multiplier on ground richness, and how fast it fades. */
  brushFeedRichness: 2.6,
  brushFeedHalfLife: 9,
  brushFeedMax: 12,

  // --- Environmental pressure -------------------------------------------
  // Slow drifts that stop the ecosystem from ever settling permanently.
  climatePeriodSeconds: 110,
  climateAmplitude: 0.18,
  windStrength: 1.6,
  resourceHotspots: 5,
  hotspotDriftSpeed: 0.014,
  // How much richer a hotspot is than open ground, as a multiplier on demand.
  hotspotRichness: 1.1,

  /**
   * Hard ceiling on the population, as a backstop only.
   *
   * The equilibrium the food economy settles at is roughly
   * `foodRegenPerSecond / upkeep`, and the Food Supply and Metabolism sliders
   * scale exactly those two terms — so the widest slider combination sets the
   * largest world the user can ask for. Their ranges are deliberately narrow
   * enough (see index.html) that the product stays a little over twice the
   * default population, which is what keeps the step inside a frame budget.
   * Dense worlds cost far more per particle than sparse ones, because a
   * particle packed against its neighbours interacts with about a hundred of
   * them rather than a handful, so this ceiling is about frame time and not
   * about memory.
   */
  maxParticles: 100000,
  // If the world ever does empty completely, it is reseeded from the fossil
  // record — but never more than once per this many seconds, so a dying world
  // cannot strobe.
  reseedCooldownSeconds: 10,

  // --- Bookkeeping -------------------------------------------------------
  // How many population samples the graph keeps. At one sample per
  // statsSampleSeconds this is a little under seven minutes of history — more
  // than fits the panel, which is why the graph scrolls horizontally.
  /**
   * Largest physics timestep, and the ceiling on sub-steps per frame.
   *
   * A step must stay under `coreRadiusRatio * interactionRadius / maxVelocity`
   * (about 0.028s at the defaults) or the fastest particles tunnel straight
   * through the hard core. 1/60 leaves comfortable margin even when the
   * interaction radius is dragged to its minimum.
   */
  maxTimestep: 1 / 60,
  maxSubsteps: 24,
  // Longest real frame the world will honour, so a backgrounded tab resumes
  // instead of trying to simulate the minute it was asleep for.
  maxFrameSeconds: 0.05,

  // --- Chronicle ---------------------------------------------------------
  // A challenger has to lead by this factor, and hold it for this many
  // consecutive samples, before an overtake is written down. Both guards exist
  // to keep two evenly matched species from filling the log with noise.
  leadChangeMargin: 1.05,
  leadChangeSamples: 4,
  chronicleLimit: 4000,

  // History itself is unbounded — every sample of a run is kept, at two bytes
  // per species per sample. This is only the width of the window the graph
  // opens on it by default, in samples.
  graphWindowSamples: 900,
  statsSampleSeconds: 0.45,
  timeScale: 1
};
