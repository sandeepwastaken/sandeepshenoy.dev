import { CONFIG } from "./config.js";
import { exportHistory, loadWorld, saveWorld } from "./persistence.js";
import { CHANNELS } from "./species.js";
import { formatInteger, formatSeconds } from "./utils.js";

/** Tool order in the panel, which is also the order of the 1-7 shortcuts. */
const TOOLS = ["pan", "attract", "repel", "stir", "feed", "seed", "erase", "zap"];

/**
 * Control panel, statistics, interaction-matrix viewer and population graph.
 *
 * Everything here is throttled and diffed: the matrix grid is only rebuilt when
 * the species count changes, and the species list only when its contents
 * actually change, so a growing ecosystem never turns into a DOM churn problem.
 */
/** Most species the matrix viewer will draw at once. See `renderMatrix`. */
const MATRIX_MAX_SPECIES = 24;

export class UI {
  constructor(simulation, renderer) {
    this.simulation = simulation;
    this.renderer = renderer;
    this.elements = collectElements();
    this.renderedMatrixSize = 0;
    // Last value painted into each matrix cell, so a repaint only touches the
    // cells that actually moved. Restyling the whole grid every refresh is the
    // most expensive thing this panel does.
    this.paintedMatrix = new Float32Array(0);
    this.speciesListSignature = "";
    // Graph view state, in absolute sample indices. `followLive` keeps the
    // window pinned to the newest sample until the user pans or zooms away.
    this.viewStart = 0;
    this.viewEnd = 1;
    this.viewSpan = CONFIG.graphWindowSamples;
    this.followLive = true;
    this.renderedGraph = "";
    this.renderedChronicle = 0;
    // Which channel the matrix viewer is showing and the shift buttons act on.
    this.activeChannel = CHANNELS[0];
    this.buildChannelRow();
    this.bind();
    this.simulation.refreshBrush();
    this.syncControls();
  }

  bind() {
    const simulation = this.simulation;
    const elements = this.elements;

    elements.pauseButton.addEventListener("click", () => {
      simulation.isPaused = !simulation.isPaused;
      elements.pauseButton.textContent = simulation.isPaused ? "Resume" : "Pause";
    });

    elements.resetButton.addEventListener("click", () => {
      simulation.reset();
      this.renderer.resetCamera();
      this.renderer.highlightSpecies = null;
      this.invalidateSpeciesViews();
    });

    elements.randomizeButton.addEventListener("click", () => {
      simulation.randomizeMatrix();
      this.invalidateSpeciesViews();
    });
    elements.resetCameraButton.addEventListener("click", () => this.renderer.resetCamera());

    // Both shift buttons act on whichever channel the viewer is showing.
    elements.increaseAttractionButton.addEventListener("click", () => {
      simulation.shiftMatrix(0.1, this.activeChannel.key);
    });
    elements.increaseRepelButton.addEventListener("click", () => {
      simulation.shiftMatrix(-0.1, this.activeChannel.key);
    });

    this.bindTools();

    elements.newSpeciesButton.addEventListener("click", () => {
      simulation.introduceRandomSpecies();
      this.invalidateSpeciesViews();
    });

    // Each slider writes straight into the live settings object.
    this.bindSlider("speedControl", "timeScale");
    this.bindSlider("mutationRateControl", "mutationRate");
    this.bindSlider("radiusControl", "interactionRadius");
    this.bindSlider("energyGainControl", "energyGain");
    this.bindSlider("energyLossControl", "energyLoss");
    this.bindSlider("rareAdvantageControl", "rareAdvantage");
    this.bindSlider("traitDriftControl", "traitDrift");
    this.bindSlider("birthThresholdControl", "birthThreshold");
    this.bindSlider("noiseControl", "noise");
    this.bindSlider("spinControl", "spin");
    this.bindSlider("alignmentControl", "alignment");
    this.bindSlider("predationControl", "predation");
    this.bindSlider("nicheOverlapControl", "nicheOverlap");
    this.bindSlider("adoptabilityControl", "adoptability");
    this.bindSlider("clumpabilityControl", "clumpability");
    this.bindSlider("connectionControl", "connection");

    // The brush lives on the simulation rather than in settings, because it is
    // a held tool and not a property of the world.
    this.bindBrushSlider("brushRadiusControl", "radius");
    this.bindBrushSlider("brushPowerControl", "power");

    // Delegated, so it survives every rebuild of the grid.
    elements.matrixView.addEventListener("mouseover", (event) => {
      const cell = event.target;
      if (cell && cell.classList.contains("matrix-cell")) this.describeMatrixCell(cell);
    });

    this.bindGraphNavigation();

    elements.saveButton.addEventListener("click", () => {
      saveWorld(simulation);
      this.flash(`Saved at ${formatSeconds(simulation.elapsedSeconds)}`);
    });

    elements.loadButton.addEventListener("click", async () => {
      try {
        const name = await loadWorld(simulation);
        if (!name) return;
        this.renderer.highlightSpecies = null;
        this.followLive = true;
        this.invalidateSpeciesViews();
        this.syncControls();
        this.flash(`Loaded ${name}`);
      } catch (error) {
        this.flash(`Load failed: ${error.message}`, true);
      }
    });

    elements.exportJsonButton.addEventListener("click", () => {
      const count = exportHistory(simulation, "json");
      this.flash(`Exported ${count} lineages as JSON`);
    });

    elements.exportCsvButton.addEventListener("click", () => {
      const rows = exportHistory(simulation, "csv");
      this.flash(`Exported ${formatInteger(rows)} rows as CSV`);
    });

    elements.matrixToggle.addEventListener("change", () => {
      elements.matrixPanel.classList.toggle("is-hidden", !elements.matrixToggle.checked);
    });
    elements.graphToggle.addEventListener("change", () => {
      elements.graphPanel.classList.toggle("is-hidden", !elements.graphToggle.checked);
    });
  }

  /**
   * Tool selection, by click or by the number keys. The keyboard shortcuts are
   * deliberately unmodified digits: reaching for the panel to swap between
   * Attract and Repel while chasing a structure across the world is exactly the
   * friction that stops anyone from using the tools at all.
   */
  bindTools() {
    const brush = this.simulation.brush;
    const buttons = Array.from(this.elements.toolRow.querySelectorAll(".tool-button"));

    const select = (tool) => {
      if (!TOOLS.includes(tool)) return;
      brush.mode = tool;
      brush.active = false;
      this.simulation.refreshBrush();
      for (const button of buttons) {
        const isActive = button.dataset.tool === tool;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-checked", isActive ? "true" : "false");
      }
      // The canvas cursor is the fastest feedback that a tool is armed.
      this.renderer.canvas.classList.toggle("has-tool", tool !== "pan");
    };

    for (const button of buttons) {
      button.addEventListener("click", () => select(button.dataset.tool));
    }

    window.addEventListener("keydown", (event) => {
      // Never steal a digit from a field the user is actually typing into.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < TOOLS.length) {
        select(TOOLS[index]);
        event.preventDefault();
      }
    });

    this.selectTool = select;
  }

  /**
   * One button per interaction channel, driving both the matrix viewer and the
   * two shift buttons underneath it.
   */
  buildChannelRow() {
    const row = this.elements.channelRow;
    const fragment = document.createDocumentFragment();
    this.channelButtons = [];

    for (const channel of CHANNELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-button";
      button.setAttribute("role", "radio");
      button.textContent = channel.label;
      button.title = channel.note;
      button.addEventListener("click", () => this.selectChannel(channel));
      this.channelButtons.push({ channel, button });
      fragment.appendChild(button);
    }

    row.innerHTML = "";
    row.appendChild(fragment);
    this.selectChannel(this.activeChannel);
  }

  selectChannel(channel) {
    this.activeChannel = channel;
    for (const entry of this.channelButtons) {
      const isActive = entry.channel === channel;
      entry.button.classList.toggle("is-active", isActive);
      entry.button.setAttribute("aria-checked", isActive ? "true" : "false");
    }
    // Force a full repaint: every cell now holds a value from a different
    // matrix, so the paint-diff cache is meaningless.
    this.renderedMatrixSize = 0;
  }

  /** Drag to pan, wheel to zoom about the cursor, button to rejoin the present. */
  bindGraphNavigation() {
    const canvas = this.elements.populationGraph;

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = this.viewStart + ((event.clientX - rect.left) / rect.width) * (this.viewEnd - this.viewStart);
      const factor = Math.exp(event.deltaY * 0.0015);
      const span = Math.max(8, Math.round((this.viewEnd - this.viewStart) * factor));
      const fraction = (anchor - this.viewStart) / Math.max(1, this.viewEnd - this.viewStart);
      this.viewStart = Math.max(0, Math.round(anchor - span * fraction));
      this.viewEnd = this.viewStart + span;
      this.viewSpan = span;
      // Zooming back out far enough to reach the live edge re-attaches to it.
      this.followLive = this.viewEnd >= this.simulation.speciesManager.sampleIndex - 1;
      this.renderedGraph = "";
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      const span = this.viewEnd - this.viewStart;
      const delta = Math.round(((event.clientX - lastX) / rect.width) * span);
      if (delta === 0) return;
      lastX = event.clientX;
      this.viewStart = Math.max(0, this.viewStart - delta);
      this.viewEnd = this.viewStart + span;
      this.followLive = false;
      this.renderedGraph = "";
    });
    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    this.elements.graphLiveButton.addEventListener("click", () => {
      this.followLive = true;
      this.viewSpan = CONFIG.graphWindowSamples;
      this.renderedGraph = "";
    });

    this.elements.graphAllButton.addEventListener("click", () => {
      this.followLive = false;
      this.viewStart = 0;
      this.viewEnd = Math.max(1, this.simulation.speciesManager.sampleIndex - 1);
      this.renderedGraph = "";
    });
  }

  /** Transient status line under the action buttons. */
  flash(message, isError = false) {
    const element = this.elements.actionStatus;
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      element.textContent = "";
      element.classList.remove("is-error");
    }, 4000);
  }

  /**
   * The event log, newest first. Only the tail is rendered — the log itself
   * holds thousands of entries and the export carries all of them.
   */
  renderChronicle() {
    const events = this.simulation.chronicle.events;
    if (events.length === this.renderedChronicle) return;
    this.renderedChronicle = events.length;

    const fragment = document.createDocumentFragment();
    for (let index = events.length - 1; index >= Math.max(0, events.length - 60); index--) {
      const event = events[index];
      const item = document.createElement("div");
      item.className = `chronicle-item is-${event.type}`;

      const time = document.createElement("span");
      time.className = "chronicle-time";
      time.textContent = formatSeconds(event.time);

      const text = document.createElement("span");
      text.className = "chronicle-text";
      text.textContent = event.text;
      if (event.color) text.style.color = event.color;

      item.append(time, text);
      fragment.appendChild(item);
    }

    const list = this.elements.chronicleList;
    list.innerHTML = "";
    list.appendChild(fragment);
    this.elements.chronicleCount.textContent = formatInteger(events.length);
  }

  bindSlider(elementKey, settingKey) {
    const input = this.elements[elementKey];
    input.addEventListener("input", () => {
      this.simulation.settings[settingKey] = Number(input.value);
      this.syncControls();
    });
  }

  /** Same, for the held brush rather than for the world. */
  bindBrushSlider(elementKey, brushKey) {
    const input = this.elements[elementKey];
    input.addEventListener("input", () => {
      this.simulation.brush[brushKey] = Number(input.value);
      this.simulation.refreshBrush();
      this.syncControls();
    });
  }

  syncControls() {
    const settings = this.simulation.settings;
    const brush = this.simulation.brush;
    const elements = this.elements;
    elements.speedValue.value = `${settings.timeScale.toFixed(2)}x`;
    elements.mutationRateValue.value = `${(settings.mutationRate * 100).toFixed(3)}%`;
    elements.radiusValue.value = Math.round(settings.interactionRadius);
    elements.energyGainValue.value = settings.energyGain.toFixed(2);
    elements.energyLossValue.value = settings.energyLoss.toFixed(2);
    elements.rareAdvantageValue.value = settings.rareAdvantage.toFixed(1);
    elements.traitDriftValue.value = settings.traitDrift === 0 ? "off" : `${settings.traitDrift.toFixed(1)}x`;
    elements.birthThresholdValue.value = Math.round(settings.birthThreshold);
    elements.noiseValue.value = Math.round(settings.noise);
    elements.spinValue.value = settings.spin === 0 ? "off" : `${settings.spin.toFixed(2)}x`;
    elements.alignmentValue.value = settings.alignment === 0 ? "off" : `${settings.alignment.toFixed(2)}x`;
    elements.predationValue.value = settings.predation === 0 ? "off" : `${settings.predation.toFixed(2)}x`;
    elements.nicheOverlapValue.value = settings.nicheOverlap.toFixed(2);
    elements.adoptabilityValue.value = settings.adoptability === 0 ? "off" : `${settings.adoptability.toFixed(2)}x`;
    elements.clumpabilityValue.value = settings.clumpability === 0 ? "off" : `${settings.clumpability.toFixed(2)}x`;
    elements.connectionValue.value = settings.connection === 0 ? "off" : `${settings.connection.toFixed(2)}x`;
    elements.brushRadiusValue.value = Math.round(brush.radius);
    elements.brushPowerValue.value = Math.round(brush.power);
  }

  update(fps) {
    const simulation = this.simulation;
    const manager = simulation.speciesManager;
    const elements = this.elements;

    let livingCount = 0;
    // Retired lineages are counted from the fossil record; the registry itself
    // now only carries species that still have a matrix row.
    let extinctCount = manager.fossils.length;
    let oldestAge = 0;
    let newestAge = Infinity;
    let largest = null;
    let maxGeneration = 0;
    let ageWeight = 0;
    let ageTotal = 0;

    for (const species of manager.species) {
      if (species.population > 0) {
        livingCount++;
        const age = simulation.elapsedSeconds - species.bornAt;
        if (age > oldestAge) oldestAge = age;
        if (age < newestAge) newestAge = age;
        if (!largest || species.population > largest.population) largest = species;
        if (species.generation > maxGeneration) maxGeneration = species.generation;
        ageTotal += species.averageAge * species.population;
        ageWeight += species.population;
      } else if (species.hasLived) {
        extinctCount++;
      }
    }

    elements.particleCount.textContent = formatInteger(simulation.particleCount);
    elements.speciesCount.textContent = formatInteger(livingCount);
    elements.mutationCount.textContent = formatInteger(manager.mutationCount);
    elements.fps.textContent = Math.round(fps);

    elements.oldestSpecies.textContent = formatSeconds(oldestAge);
    elements.newestSpecies.textContent = formatSeconds(newestAge === Infinity ? 0 : newestAge);
    elements.largestSpecies.textContent = largest ? `${largest.name} (${formatInteger(largest.population)})` : "-";
    elements.extinctSpecies.textContent = formatInteger(extinctCount);
    elements.birthCount.textContent = formatInteger(simulation.births);
    elements.deathCount.textContent = formatInteger(simulation.deaths);
    elements.averageAge.textContent = formatSeconds(ageWeight > 0 ? ageTotal / ageWeight : 0);
    elements.generationCount.textContent = formatInteger(maxGeneration);
    elements.worldClock.textContent = formatSeconds(simulation.elapsedSeconds);

    if (elements.graphToggle.checked) this.drawPopulationGraph();
    if (elements.matrixToggle.checked) this.renderMatrix();
    this.renderSpeciesList();
    this.renderChronicle();
  }

  /**
   * Live population history: one line per species, extinct lineages faded.
   *
   * The canvas is exactly the width of its panel and shows a *window* onto the
   * history rather than being sized to hold all of it. The previous approach —
   * one wide canvas at two pixels per sample — dies twice over on a long run:
   * browsers cap canvas width near 32,767px (about two hours of samples), and
   * drawing every point of every species is unbounded work.
   *
   * Instead the window is panned and zoomed, and samples are strided so each
   * species contributes at most one point per pixel column. Drawing cost is
   * then species x canvas width regardless of whether the run is one minute or
   * one day. The stride samples rather than taking a column min/max, so very
   * narrow spikes can be skipped when zoomed far out; population curves are
   * smooth enough that this is invisible, and zooming in always recovers the
   * detail.
   */
  drawPopulationGraph() {
    const canvas = this.elements.populationGraph;
    const manager = this.simulation.speciesManager;
    const latest = manager.sampleIndex - 1;
    if (latest < 1) return;

    if (this.followLive) {
      const span = Math.min(this.viewSpan, latest);
      this.viewEnd = latest;
      this.viewStart = Math.max(0, latest - span);
    }
    this.viewStart = Math.max(0, Math.min(this.viewStart, latest - 1));
    this.viewEnd = Math.min(latest, Math.max(this.viewEnd, this.viewStart + 1));
    const viewStart = this.viewStart;
    const viewSpan = this.viewEnd - viewStart;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssWidth = canvas.clientWidth || 320;
    const cssHeight = canvas.clientHeight || 128;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) {
      canvas.width = width;
      canvas.height = height;
    }

    // Repaint only when there is new data, a new view, or a new size.
    const signature = `${latest}:${viewStart}:${this.viewEnd}:${width}`;
    if (!resized && signature === this.renderedGraph) return;
    this.renderedGraph = signature;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = dpr;
    for (let line = 1; line < 4; line++) {
      const y = (height * line) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const series = manager.species.concat(manager.fossils);
    const stride = Math.max(1, Math.floor(viewSpan / Math.max(1, width)));

    let maxPopulation = 12;
    for (const item of series) {
      const from = Math.max(0, viewStart - item.historyStart);
      const to = Math.min(item.historyCount, this.viewEnd - item.historyStart + 1);
      for (let index = from; index < to; index += stride) {
        if (item.history[index] > maxPopulation) maxPopulation = item.history[index];
      }
    }

    this.drawGraphTimeAxis(ctx, width, height, dpr, viewStart, viewSpan);

    const usableHeight = height - 4 * dpr;
    const scaleX = width / viewSpan;
    for (const item of series) {
      const from = Math.max(0, viewStart - item.historyStart);
      const to = Math.min(item.historyCount, this.viewEnd - item.historyStart + 1);
      if (to - from < 2) continue;

      const isLiving = manager.species[item.id] === item;
      ctx.globalAlpha = isLiving ? 0.9 : 0.2;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = (isLiving ? 1.6 : 1) * dpr;
      ctx.beginPath();
      let started = false;
      for (let index = from; index < to; index += stride) {
        const x = (item.historyStart + index - viewStart) * scaleX;
        const y = height - (item.history[index] / maxPopulation) * usableHeight - 2 * dpr;
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    this.elements.graphRange.textContent = `${formatSeconds(viewStart * this.simulation.sampleSeconds)} – ${formatSeconds(this.viewEnd * this.simulation.sampleSeconds)}`;
  }

  /** Faint "how long ago" markers, so a scrolled-back view still means something. */
  drawGraphTimeAxis(ctx, width, height, dpr, viewStart, viewSpan) {
    const secondsPerSample = this.simulation.sampleSeconds;
    const totalSeconds = viewSpan * secondsPerSample;
    if (totalSeconds < 5) return;

    // Aim for a marker every ~110 css pixels, snapped to a round interval.
    const target = (totalSeconds * 110 * dpr) / width;
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200];
    const stepSeconds = steps.find((value) => value >= target) || steps[steps.length - 1];

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.lineWidth = dpr;

    const startSeconds = viewStart * secondsPerSample;
    const first = Math.ceil(startSeconds / stepSeconds) * stepSeconds;
    for (let seconds = first; seconds <= startSeconds + totalSeconds; seconds += stepSeconds) {
      const x = Math.round(((seconds - startSeconds) / totalSeconds) * width) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(formatSeconds(seconds), x + 4 * dpr, 3 * dpr);
    }
    ctx.restore();
  }

  /**
   * Interaction matrix: blue = attraction, red = repulsion, near-white =
   * neutral. Rows are labelled with the species name and colour; columns get a
   * colour chip, because at twenty-odd species there is no room for a legible
   * name above a six-pixel column — the chip is what ties a column back to the
   * row of the same species, and the tooltip names it.
   *
   * The grid is rebuilt only when the species count changes.
   */
  renderMatrix() {
    const manager = this.simulation.speciesManager;
    const view = this.elements.matrixView;

    // Nothing limits how many species can be alive, but a 77-column grid in a
    // 360px panel is four pixels a column — unreadable, and expensive to
    // restyle now that trait drift changes every cell continuously. Show the
    // most populous handful, which is the part anyone is actually reading.
    const all = manager.species;
    const size = Math.min(all.length, MATRIX_MAX_SPECIES);
    const species =
      all.length <= MATRIX_MAX_SPECIES
        ? all
        : all.slice().sort((a, b) => b.population - a.population).slice(0, size);
    const channel = this.activeChannel;
    this.elements.matrixNote.textContent =
      all.length > size
        ? `${channel.note} Showing the ${size} most populous of ${all.length} species.`
        : channel.note;

    if (size !== this.renderedMatrixSize) {
      this.buildMatrixGrid(view, size);
      this.renderedMatrixSize = size;
      this.paintedMatrix = new Float32Array(size * size).fill(NaN);
    }

    // Headers are refreshed every time: trait drift moves species colours, and
    // a stale chip would point at the wrong column.
    for (let index = 0; index < size; index++) {
      const item = species[index];
      const columnHead = this.matrixColumnHeads[index];
      columnHead.style.background = item.color;
      columnHead.title = item.name;

      const rowHead = this.matrixRowHeads[index];
      if (rowHead.textContent !== item.name) rowHead.textContent = item.name;
      rowHead.style.color = item.color;
      rowHead.title = item.name;
    }

    // The visible set is kept for the hover handler, which is what builds the
    // tooltip text. Doing it here instead would mean thousands of template
    // strings and toFixed calls every repaint, for text nobody is reading.
    this.matrixSpecies = species;

    const cells = this.matrixCells;
    const painted = this.paintedMatrix;
    for (let row = 0; row < size; row++) {
      const rowId = species[row].id;
      for (let column = 0; column < size; column++) {
        const index = row * size + column;
        const value = manager.getChannel(channel.key, rowId, species[column].id);
        if (value === painted[index]) continue;
        painted[index] = value;

        // Normalised against the channel's own range, so a channel that only
        // spans [-0.3, 0.3] still uses the full colour scale rather than
        // rendering as an almost uniformly neutral grid.
        const extent = Math.max(Math.abs(channel.crossMin), Math.abs(channel.crossMax)) || 1;
        const unit = Math.max(-1, Math.min(1, value / extent));
        const cell = cells[index];
        const neutral = Math.round((1 - Math.abs(unit)) * 200 + 45);
        cell.style.background =
          unit >= 0
            ? `rgb(${neutral},${Math.round(95 + unit * 120)},${Math.round(155 + unit * 85)})`
            : `rgb(${Math.round(155 + -unit * 85)},${neutral},${neutral})`;
      }
    }
  }

  /** Tooltip text is built for the one cell under the cursor, on demand. */
  describeMatrixCell(cell) {
    const species = this.matrixSpecies;
    if (!species || cell.cellRow === undefined) return;
    const row = species[cell.cellRow];
    const column = species[cell.cellColumn];
    if (!row || !column) return;
    const value = this.simulation.speciesManager.getChannel(this.activeChannel.key, row.id, column.id);
    cell.title = `${row.name} → ${column.name} · ${this.activeChannel.label}: ${value.toFixed(2)}`;
  }

  /** One header row, then one header cell plus `size` value cells per row. */
  buildMatrixGrid(view, size) {
    view.style.gridTemplateColumns = `minmax(34px, auto) repeat(${size}, minmax(6px, 1fr))`;
    const fragment = document.createDocumentFragment();
    this.matrixColumnHeads = [];
    this.matrixRowHeads = [];
    this.matrixCells = [];

    const corner = document.createElement("div");
    fragment.appendChild(corner);
    for (let column = 0; column < size; column++) {
      const head = document.createElement("div");
      head.className = "matrix-col-head";
      this.matrixColumnHeads.push(head);
      fragment.appendChild(head);
    }

    for (let row = 0; row < size; row++) {
      const head = document.createElement("div");
      head.className = "matrix-row-head";
      this.matrixRowHeads.push(head);
      fragment.appendChild(head);

      for (let column = 0; column < size; column++) {
        const cell = document.createElement("div");
        cell.className = "matrix-cell";
        cell.cellRow = row;
        cell.cellColumn = column;
        this.matrixCells.push(cell);
        fragment.appendChild(cell);
      }
    }

    view.innerHTML = "";
    view.appendChild(fragment);
  }

  /** Living species first, then the fossil record. Rebuilt only on change. */
  renderSpeciesList() {
    const manager = this.simulation.speciesManager;
    let signature = `${manager.fossils.length}:`;
    for (const species of manager.species) signature += `${species.population},`;
    if (signature === this.speciesListSignature) return;
    this.speciesListSignature = signature;

    // Living species first, then the most recent fossils.
    const sorted = manager.species
      .slice()
      .sort((a, b) => b.population - a.population || a.bornAt - b.bornAt)
      .concat(manager.fossils.slice(-12).reverse())
      .slice(0, 40);

    const fragment = document.createDocumentFragment();
    for (const species of sorted) {
      const isLiving = manager.species[species.id] === species;

      const item = document.createElement("div");
      item.className = "species-item";
      if (species === this.renderer.highlightSpecies) item.classList.add("is-selected");
      item.style.opacity = isLiving ? "1" : "0.42";
      // Clicking isolates the species in the world, which is the only practical
      // way to see what one lineage is actually doing among twenty others.
      item.addEventListener("click", () => this.toggleHighlight(species));

      const swatch = document.createElement("span");
      swatch.className = "species-swatch";
      swatch.style.background = species.color;

      const name = document.createElement("div");
      name.className = "species-name";
      name.textContent = species.name;
      // The lineage chain doubles as the evolutionary tree, on hover.
      name.title = manager.lineageOf(species).join(" → ");

      const meta = document.createElement("div");
      meta.className = "species-meta";
      meta.textContent = isLiving
        ? `${formatInteger(species.population)} · gen ${species.generation}`
        : `extinct · gen ${species.generation}`;

      const action = document.createElement("button");
      action.className = "species-action";
      action.type = "button";
      if (isLiving) {
        action.textContent = "✕";
        action.title = `Wipe out ${species.name}`;
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          this.simulation.removeSpecies(species.id);
          this.invalidateSpeciesViews();
        });
      } else {
        action.textContent = "↺";
        action.title = `Revive ${species.name} from the fossil record`;
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          this.simulation.reviveSpecies(species);
          this.invalidateSpeciesViews();
        });
      }

      item.append(swatch, name, meta, action);
      fragment.appendChild(item);
    }

    this.elements.speciesList.innerHTML = "";
    this.elements.speciesList.appendChild(fragment);
  }

  toggleHighlight(species) {
    this.renderer.highlightSpecies = this.renderer.highlightSpecies === species ? null : species;
    this.invalidateSpeciesViews();
  }

  /** Force the diffed panels to repaint after the registry changes shape. */
  invalidateSpeciesViews() {
    this.speciesListSignature = "";
    this.renderedMatrixSize = 0;
    this.renderedGraph = "";
    this.renderedChronicle = 0;
  }
}

function collectElements() {
  const ids = [
    "particleCount", "speciesCount", "mutationCount", "fps",
    "pauseButton", "resetButton", "randomizeButton", "resetCameraButton",
    "increaseAttractionButton", "increaseRepelButton",
    "speedControl", "speedValue",
    "mutationRateControl", "mutationRateValue",
    "radiusControl", "radiusValue",
    "energyGainControl", "energyGainValue",
    "energyLossControl", "energyLossValue",
    "rareAdvantageControl", "rareAdvantageValue",
    "traitDriftControl", "traitDriftValue",
    "birthThresholdControl", "birthThresholdValue",
    "noiseControl", "noiseValue",
    "spinControl", "spinValue",
    "alignmentControl", "alignmentValue",
    "predationControl", "predationValue",
    "nicheOverlapControl", "nicheOverlapValue",
    "adoptabilityControl", "adoptabilityValue",
    "clumpabilityControl", "clumpabilityValue",
    "connectionControl", "connectionValue",
    "toolRow", "channelRow",
    "brushRadiusControl", "brushRadiusValue",
    "brushPowerControl", "brushPowerValue",
    "newSpeciesButton",
    "matrixToggle", "graphToggle", "matrixPanel", "graphPanel",
    "matrixView", "matrixNote", "populationGraph", "speciesList",
    "graphRange", "graphAllButton", "graphLiveButton",
    "saveButton", "loadButton", "exportJsonButton", "exportCsvButton", "actionStatus",
    "chronicleList", "chronicleCount",
    "oldestSpecies", "newestSpecies", "largestSpecies", "extinctSpecies",
    "birthCount", "deathCount", "averageAge", "generationCount", "worldClock"
  ];
  const elements = {};
  for (const id of ids) elements[id] = document.getElementById(id);
  return elements;
}
