import { CONFIG } from "./config.js";

/**
 * The world's event log.
 *
 * Most of what happens here is continuous — populations slide up and down
 * forever — so the interesting part is deciding what counts as an *event*. The
 * hard case is a lead change: two species hovering within a few individuals of
 * each other will swap places dozens of times a minute, and a log that records
 * every one of those is noise that buries the handful of moments that matter.
 *
 * So an overtake has to clear two bars before it is written down. The
 * challenger must lead by `leadChangeMargin` (a bare tie is not a takeover),
 * and it must hold that lead for `leadChangeSamples` consecutive samples. A
 * genuine succession clears both easily; jitter clears neither.
 */
export class Chronicle {
  constructor() {
    this.clear();
  }

  clear() {
    this.events = [];
    this.leaderName = null;
    this.candidateName = null;
    this.candidateSamples = 0;
  }

  record(type, time, text, color = null) {
    this.events.push({ type, time, text, color });
    // Bounded so a run left going overnight cannot exhaust memory. The export
    // writes whatever is still held, which is the most recent window.
    if (this.events.length > CONFIG.chronicleLimit) {
      this.events.splice(0, this.events.length - CONFIG.chronicleLimit);
    }
  }

  /**
   * Called once per population sample. `counts` is indexed by species id.
   */
  observe(species, counts, time) {
    let leader = null;
    let leaderCount = 0;
    for (let id = 0; id < species.length; id++) {
      if (counts[id] > leaderCount) {
        leaderCount = counts[id];
        leader = species[id];
      }
    }
    if (!leader) return;

    if (this.leaderName === null) {
      this.leaderName = leader.name;
      return;
    }
    if (leader.name === this.leaderName) {
      this.candidateName = null;
      this.candidateSamples = 0;
      return;
    }

    // A challenger is only credited once it is clearly ahead, not merely ahead.
    const incumbent = species.find((item) => item.name === this.leaderName);
    const incumbentCount = incumbent ? counts[incumbent.id] : 0;
    if (leaderCount < incumbentCount * CONFIG.leadChangeMargin) {
      this.candidateName = null;
      this.candidateSamples = 0;
      return;
    }

    if (leader.name !== this.candidateName) {
      this.candidateName = leader.name;
      this.candidateSamples = 1;
      return;
    }

    this.candidateSamples++;
    if (this.candidateSamples < CONFIG.leadChangeSamples) return;

    this.record(
      "overtake",
      time,
      `${leader.name} overtakes ${this.leaderName} — ${leaderCount} to ${incumbentCount}`,
      leader.color
    );
    this.leaderName = leader.name;
    this.candidateName = null;
    this.candidateSamples = 0;
  }

  speciation(child, parent, time) {
    this.record("speciation", time, `${child.name} splits from ${parent.name}`, child.color);
  }

  extinction(species, time) {
    this.record("extinction", time, `${species.name} dies out after ${formatSpan(time - species.bornAt)}`, species.color);
  }

  revival(species, time) {
    this.record("revival", time, `${species.name} revived from the fossil record`, species.color);
  }

  introduction(species, time) {
    this.record("introduction", time, `${species.name} introduced`, species.color);
  }

  removal(species, time) {
    this.record("removal", time, `${species.name} wiped out by hand`, species.color);
  }

  reseed(time) {
    this.record("reseed", time, "World emptied — reseeded from spores", null);
  }
}

function formatSpan(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
