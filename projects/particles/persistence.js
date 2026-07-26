/**
 * Save files and data export.
 *
 * Both go through the filesystem rather than localStorage. A world is roughly a
 * megabyte and a full history export of a long run is tens of megabytes, which
 * is well past the ~5MB an origin gets in localStorage — and files give you
 * unlimited slots, and let you keep a run somewhere other than one browser.
 */

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next turn of the event loop; revoking immediately can race
  // the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(elapsedSeconds) {
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${String(minutes).padStart(3, "0")}m${String(Math.floor(elapsedSeconds % 60)).padStart(2, "0")}s`;
}

export function saveWorld(simulation) {
  const state = simulation.serialize();
  download(`particle-life-${stamp(simulation.elapsedSeconds)}.plsave.json`, JSON.stringify(state), "application/json");
  return state;
}

/** Prompt for a save file and restore it. Resolves to the parsed state. */
export function loadWorld(simulation) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          simulation.restore(JSON.parse(reader.result));
          resolve(file.name);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    input.click();
  });
}

/**
 * Export the run's observable history: every species' population over time,
 * plus the event log. This is the "look at it closely afterwards" export, and
 * it deliberately does *not* include per-frame particle positions — those are
 * about 25GB for a three-hour run, where this is a few tens of megabytes.
 */
export function exportHistory(simulation, format = "json") {
  const manager = simulation.speciesManager;
  const secondsPerSample = simulation.sampleSeconds;
  const all = manager.species.concat(manager.fossils);

  if (format === "csv") {
    // Long format: one row per species per sample. Verbose, but it drops
    // straight into a spreadsheet or a dataframe without reshaping.
    const rows = ["species,generation,parent,sample,seconds,population"];
    for (const item of all) {
      for (let index = 0; index < item.historyCount; index++) {
        const sample = item.historyStart + index;
        rows.push(
          `${item.name},${item.generation},${item.parentName || ""},${sample},` +
            `${(sample * secondsPerSample).toFixed(2)},${item.history[index]}`
        );
      }
    }
    download(`particle-life-history-${stamp(simulation.elapsedSeconds)}.csv`, rows.join("\n"), "text/csv");
    return rows.length - 1;
  }

  const payload = {
    elapsedSeconds: simulation.elapsedSeconds,
    seed: simulation.seed,
    secondsPerSample,
    sampleCount: manager.sampleIndex,
    births: simulation.births,
    deaths: simulation.deaths,
    settings: { ...simulation.settings },
    species: all.map((item) => ({
      name: item.name,
      parent: item.parentName,
      generation: item.generation,
      clade: item.clade,
      color: item.color,
      bornAt: item.bornAt,
      extinctAt: item.extinctAt,
      births: item.births,
      deaths: item.deaths,
      historyStart: item.historyStart,
      population: Array.from(item.history.slice(0, item.historyCount))
    })),
    events: simulation.chronicle.events
  };
  download(
    `particle-life-history-${stamp(simulation.elapsedSeconds)}.json`,
    JSON.stringify(payload),
    "application/json"
  );
  return payload.species.length;
}
