(function () {
  // Chart: a wapyt wrapper over the vendored Chart.js (vendor-chartjs.min.js,
  // loaded before this file, as globalThis.Chart).
  //
  // Built to live in resizable containers (layout cells, splitters, a
  // gridstack dashboard): the chart always fills its container and Chart.js's
  // own ResizeObserver redraws it when the container changes size, including
  // from zero (a hidden tab, a cell not laid out yet). The canvas sits in a
  // position:relative wrapper with min-width / min-height 0, which is what
  // lets it shrink as well as grow inside flex and grid parents.
  //
  // Styling follows the dataviz rules: a validated 8-hue palette in fixed
  // order with separate light / dark steps, colour keyed by series label so
  // a filter never repaints survivors, one value axis, thin marks, recessive
  // grid, legend for two or more series, an accessible data table. Labels and
  // titles are drawn on the canvas or set as text, never as HTML.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  const PALETTE = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  };
  const INK = {
    light: { text: "#0f172a", muted: "#64748b", grid: "rgba(15, 23, 42, 0.08)", surface: "#ffffff" },
    dark: { text: "#f8fafc", muted: "#94a3b8", grid: "rgba(148, 163, 184, 0.16)", surface: "#0f172a" },
  };
  const OVERFLOW = "#94a3b8"; // a 9th series without a colour: never a new hue
  // Below this size (a small dashboard tile) an automatic legend and the axis
  // titles step aside so the data keeps the room; they return when it grows.
  const COMPACT = { width: 280, height: 180 };
  const ARC_TYPES = new Set(["pie", "doughnut", "polarArea"]);
  const TYPES = new Set(["line", "area", "bar", "pie", "doughnut", "polarArea", "scatter", "bubble", "radar"]);

  const charts = new Set();
  let themeObserver = null;

  function watchTheme() {
    if (themeObserver || typeof MutationObserver !== "function") return;
    themeObserver = new MutationObserver(() => charts.forEach((chart) => chart._themeChanged()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-wapyt-theme"] });
  }

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_charthost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") return document.querySelector(target);
    if (target && target.nodeType === 1) return target;
    return null;
  }

  function withAlpha(hex, alpha) {
    const value = String(hex || "");
    if (!/^#[0-9a-f]{6}$/i.test(value)) return value;
    return value + Math.round(alpha * 255).toString(16).padStart(2, "0");
  }

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  // Raw Chart.js options from the app win over wapyt's, key by key.
  function deepMerge(base, extra) {
    const out = Object.assign({}, base);
    Object.keys(extra || {}).forEach((key) => {
      out[key] = isObject(out[key]) && isObject(extra[key]) ? deepMerge(out[key], extra[key]) : extra[key];
    });
    return out;
  }

  class Chart {
    constructor(target, options = {}) {
      const ChartJS = globalThis.Chart;
      if (!ChartJS || typeof ChartJS !== "function") {
        throw new Error("wapyt.Chart needs Chart.js (vendor-chartjs.min.js) loaded first");
      }
      this.ChartJS = ChartJS;
      this.options = Object.assign(
        {
          type: "line",
          labels: [],
          datasets: [],
          title: null,
          legend: "auto",
          stacked: false,
          horizontal: false,
          xLabel: null,
          yLabel: null,
          yMin: null,
          yMax: null,
          beginAtZero: true,
          format: {},
          animation: true,
          resizeDelay: 0,
          height: null,
          tableToggle: false,
          ariaLabel: null,
          options: {},
        },
        options || {}
      );
      if (!TYPES.has(this.options.type)) throw new Error(`wapyt.Chart: unknown type '${this.options.type}'`);
      this._events = {};
      this._slots = new Map(); // series key -> palette slot, kept for the chart's life
      this._tableShown = false;

      this._host = resolveHost(target);
      if (!this._host) throw new Error("Unable to mount Chart – target not found.");
      this._build();
      this._create();
      charts.add(this);
      watchTheme();
    }

    // ── DOM ──────────────────────────────────────────────────────────────────

    _build() {
      this._host.textContent = "";
      this.root = document.createElement("div");
      this.root.className = "wapyt-chart";
      if (this.options.height != null) {
        this.root.style.height = typeof this.options.height === "number" ? `${this.options.height}px` : String(this.options.height);
      }
      this._wrap = document.createElement("div");
      this._wrap.className = "wapyt-chart-canvas";
      this._canvas = document.createElement("canvas");
      this._canvas.setAttribute("role", "img");
      this._wrap.appendChild(this._canvas);
      this.root.appendChild(this._wrap);

      // The data as a table: visually hidden for screen readers, or shown in
      // place of the chart by the toggle / showTable().
      this._table = document.createElement("div");
      this._table.className = "wapyt-chart-table";
      this._table.dataset.mode = "hidden";
      this.root.appendChild(this._table);

      if (this.options.tableToggle) {
        this._toggle = document.createElement("button");
        this._toggle.type = "button";
        this._toggle.className = "wapyt-chart-toggle";
        this._toggle.addEventListener("click", () => this.showTable(!this._tableShown));
        this.root.appendChild(this._toggle);
        this._syncToggle();
      }
      this._host.appendChild(this.root);
    }

    _theme() {
      const scoped = this._host.closest("[data-wapyt-theme]");
      const theme = (scoped && scoped.getAttribute("data-wapyt-theme")) || document.documentElement.getAttribute("data-wapyt-theme");
      return theme === "dark" ? "dark" : "light";
    }

    _arc() {
      return ARC_TYPES.has(this.options.type);
    }

    // ── Colours ──────────────────────────────────────────────────────────────

    _slotFor(key) {
      const k = String(key);
      if (!this._slots.has(k)) {
        const used = new Set(this._slots.values());
        let slot = 0;
        while (used.has(slot)) slot += 1;
        if (slot >= 8) console.warn(`[wapyt.Chart] more than 8 series: '${k}' is drawn grey; group the rest into "Other"`);
        this._slots.set(k, slot);
      }
      return this._slots.get(k);
    }

    _colorFor(key, explicit) {
      if (explicit) return explicit;
      const slot = this._slotFor(key);
      return slot < 8 ? PALETTE[this._theme()][slot] : OVERFLOW;
    }

    // ── Chart.js config ─────────────────────────────────────────────────────

    _styleDataset(spec, index) {
      const o = this.options;
      const ink = INK[this._theme()];
      const kind = spec.type || o.type;
      const key = spec.label != null ? spec.label : `#${index}`;
      const ds = {
        label: spec.label != null ? String(spec.label) : `Series ${index + 1}`,
        data: Array.isArray(spec.data) ? spec.data.slice() : [],
        hidden: Boolean(spec.hidden),
      };
      if (spec.type) ds.type = spec.type === "area" ? "line" : spec.type;
      if (spec.stack != null) ds.stack = String(spec.stack);

      if (this._arc()) {
        // Pie-like: one colour per slice, keyed by the slice label.
        const colors = (o.labels || []).map((label, i) =>
          this._colorFor(`slice:${label}`, Array.isArray(spec.colors) ? spec.colors[i] : null));
        Object.assign(ds, {
          backgroundColor: colors,
          borderColor: ink.surface,
          borderWidth: 2, // the 2px surface gap between slices
          hoverOffset: 4,
        });
        return ds;
      }

      const color = this._colorFor(key, spec.color);
      const many = ds.data.length > 24;
      if (kind === "bar") {
        Object.assign(ds, {
          backgroundColor: color,
          borderColor: ink.surface,
          // Rounded at the data end only, square on the baseline; stacked
          // segments get a 1px surface edge each, a 2px gap between them.
          borderRadius: o.stacked ? 0 : 4,
          borderSkipped: o.stacked ? false : "start",
          borderWidth: o.stacked ? 1 : 0,
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        });
      } else if (kind === "line" || kind === "area") {
        const area = kind === "area" || spec.fill;
        Object.assign(ds, {
          borderColor: color,
          backgroundColor: area ? withAlpha(color, 0.18) : color,
          borderWidth: 2,
          tension: spec.tension != null ? spec.tension : 0,
          pointRadius: spec.pointRadius != null ? spec.pointRadius : many ? 0 : 4,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          pointBorderColor: ink.surface, // 2px surface ring where lines cross
          pointBorderWidth: 2,
          fill: area ? (o.stacked && index > 0 ? "-1" : "origin") : false,
        });
        if (spec.dashed) ds.borderDash = [6, 4];
      } else if (kind === "scatter" || kind === "bubble") {
        Object.assign(ds, {
          backgroundColor: kind === "bubble" ? withAlpha(color, 0.7) : color,
          borderColor: ink.surface,
          borderWidth: 2,
          pointRadius: spec.pointRadius != null ? spec.pointRadius : 4,
          pointHoverRadius: 6,
        });
      } else if (kind === "radar") {
        Object.assign(ds, {
          borderColor: color,
          backgroundColor: withAlpha(color, 0.15),
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: color,
        });
      }
      return ds;
    }

    _formatter() {
      const f = this.options.format || {};
      const opts = {};
      if (f.decimals != null) {
        opts.minimumFractionDigits = f.decimals;
        opts.maximumFractionDigits = f.decimals;
      }
      if (f.compact) opts.notation = "compact";
      const nf = new Intl.NumberFormat(undefined, opts);
      return (value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return value == null ? "" : String(value);
        return `${f.prefix || ""}${nf.format(value)}${f.suffix || ""}`;
      };
    }

    _config() {
      const o = this.options;
      const theme = this._theme();
      const ink = INK[theme];
      const fmt = this._formatter();
      const arc = this._arc();
      const baseType = o.type === "area" ? "line" : o.type;
      const datasets = (o.datasets || []).map((spec, i) => this._styleDataset(spec, i));
      const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const legendShown = o.legend !== "none" && o.legend !== false && (arc || datasets.length >= 2 || (o.legend && o.legend !== "auto"));
      const legendPosition = o.legend && o.legend !== "auto" && o.legend !== "none" ? o.legend : "top";
      const valueAxis = o.horizontal ? "x" : "y";

      const axis = (id) => {
        const isValue = id === valueAxis;
        const label = id === "x" ? (o.horizontal ? o.yLabel : o.xLabel) : (o.horizontal ? o.xLabel : o.yLabel);
        const scale = {
          stacked: Boolean(o.stacked),
          // Recessive: gridlines on the value axis only.
          grid: { display: isValue, color: ink.grid, drawTicks: false },
          border: { display: !isValue, color: ink.grid },
          ticks: { color: ink.muted, padding: 6 },
          title: { display: Boolean(label) && !compact, text: label || "", color: ink.muted },
        };
        if (isValue) {
          scale.beginAtZero = Boolean(o.beginAtZero);
          if (o.yMin != null) scale.min = o.yMin;
          if (o.yMax != null) scale.max = o.yMax;
          scale.ticks.callback = (value) => fmt(value);
        }
        if ((o.type === "scatter" || o.type === "bubble") && !isValue) {
          scale.grid.display = true;
          scale.type = "linear";
        }
        return scale;
      };

      const compact = this._compact;
      let options = {
        responsive: true,
        onResize: (chart, size) => this._onResize(size),
        maintainAspectRatio: false, // fill the container, whatever its shape
        resizeDelay: Number(o.resizeDelay) || 0,
        animation: o.animation && !reduceMotion ? { duration: 300 } : false,
        indexAxis: o.horizontal ? "y" : "x",
        interaction: arc || o.type === "scatter" || o.type === "bubble"
          ? { mode: "nearest", intersect: true }
          : { mode: "index", intersect: false },
        onClick: (event, elements) => this._onClick(elements),
        color: ink.text,
        plugins: {
          title: {
            display: Boolean(o.title),
            text: o.title || "",
            color: ink.text,
            align: "start",
            font: { size: 14, weight: "600" },
            padding: { bottom: 8 },
          },
          legend: {
            display: Boolean(legendShown) && !(compact && (o.legend === "auto" || o.legend == null)),
            position: legendPosition,
            align: "start",
            labels: { color: ink.text, usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 14 },
          },
          tooltip: {
            backgroundColor: theme === "dark" ? "#1e293b" : "#0f172a",
            titleColor: "#f8fafc",
            bodyColor: "#e2e8f0",
            borderColor: theme === "dark" ? "#334155" : "transparent",
            borderWidth: theme === "dark" ? 1 : 0,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              label: (item) => {
                const raw = item.raw;
                let value = item.parsed && typeof item.parsed === "object"
                  ? (arc ? item.parsed : o.horizontal ? item.parsed.x : item.parsed.y)
                  : item.parsed;
                if (o.type === "scatter" || o.type === "bubble") value = `(${fmt(raw.x)}, ${fmt(raw.y)})`;
                else value = fmt(typeof value === "number" ? value : raw);
                const name = arc ? item.label : item.dataset.label;
                return ` ${name}: ${value}`;
              },
            },
          },
        },
      };
      if (!arc && o.type !== "radar") {
        options.scales = { x: axis("x"), y: axis("y") };
      } else if (o.type === "radar") {
        options.scales = {
          r: {
            beginAtZero: Boolean(o.beginAtZero),
            grid: { color: ink.grid },
            angleLines: { color: ink.grid },
            pointLabels: { color: ink.muted },
            ticks: { color: ink.muted, backdropColor: "transparent", callback: (v) => fmt(v) },
          },
        };
      } else if (o.type === "polarArea") {
        options.scales = { r: { grid: { color: ink.grid }, ticks: { color: ink.muted, backdropColor: "transparent" } } };
      }
      if (o.type === "doughnut") options.cutout = "62%";
      options = deepMerge(options, o.options || {});
      return {
        type: baseType,
        data: { labels: (o.labels || []).slice(), datasets },
        options,
      };
    }

    _create() {
      if (this._chart) this._chart.destroy();
      const ChartJS = this.ChartJS;
      if (!Chart._fontSet) {
        const family = getComputedStyle(document.documentElement).getPropertyValue("--wapyt-font-family").trim();
        if (family) ChartJS.defaults.font.family = family;
        Chart._fontSet = true;
      }
      this._lastTheme = this._theme();
      const box = this._wrap.getBoundingClientRect();
      this._compact = box.width > 0 && (box.width < COMPACT.width || box.height < COMPACT.height);
      this._chart = new ChartJS(this._canvas, this._config());
      this._describe();
    }

    // ── Accessibility ───────────────────────────────────────────────────────

    _describe() {
      const o = this.options;
      const n = (o.datasets || []).length;
      const kind = o.type === "polarArea" ? "polar area" : o.type;
      const label = o.ariaLabel || `${o.title ? `${o.title}: ` : ""}${kind} chart${this._arc() ? "" : `, ${n} series`}`;
      this._canvas.setAttribute("aria-label", label);
      this._renderTable();
    }

    _renderTable() {
      const o = this.options;
      const fmt = this._formatter();
      const table = document.createElement("table");
      if (o.title) {
        const caption = document.createElement("caption");
        caption.textContent = o.title;
        table.appendChild(caption);
      }
      const head = table.createTHead().insertRow();
      const body = table.createTBody();
      const th = (row, text, scope) => {
        const cell = document.createElement("th");
        cell.textContent = text == null ? "" : String(text);
        if (scope) cell.scope = scope;
        row.appendChild(cell);
      };
      const td = (row, text) => {
        const cell = row.insertCell();
        cell.textContent = text == null ? "" : String(text);
      };
      const datasets = o.datasets || [];
      if (o.type === "scatter" || o.type === "bubble") {
        th(head, "Series", "col"); th(head, "x", "col"); th(head, "y", "col");
        if (o.type === "bubble") th(head, "r", "col");
        datasets.forEach((ds) => (ds.data || []).forEach((point) => {
          const row = body.insertRow();
          th(row, ds.label, "row");
          td(row, fmt(point && point.x)); td(row, fmt(point && point.y));
          if (o.type === "bubble") td(row, fmt(point && point.r));
        }));
      } else {
        th(head, "", "col");
        datasets.forEach((ds, i) => th(head, ds.label != null ? ds.label : `Series ${i + 1}`, "col"));
        (o.labels || []).forEach((label, index) => {
          const row = body.insertRow();
          th(row, label, "row");
          datasets.forEach((ds) => td(row, fmt((ds.data || [])[index])));
        });
      }
      this._table.textContent = "";
      this._table.appendChild(table);
    }

    showTable(show = true) {
      this._tableShown = Boolean(show);
      this._table.dataset.mode = this._tableShown ? "shown" : "hidden";
      this._wrap.hidden = this._tableShown;
      this._syncToggle();
      if (!this._tableShown) this._chart.resize();
    }

    _syncToggle() {
      if (!this._toggle) return;
      this._toggle.textContent = this._tableShown ? "Chart" : "Table";
      this._toggle.setAttribute("aria-pressed", this._tableShown ? "true" : "false");
      this._toggle.title = this._tableShown ? "Show the chart" : "Show the data as a table";
    }

    // ── Events ───────────────────────────────────────────────────────────────

    _onClick(elements) {
      if (!elements || !elements.length) return;
      const { datasetIndex, index } = elements[0];
      const spec = (this.options.datasets || [])[datasetIndex] || {};
      const raw = (spec.data || [])[index];
      this._emit("click", {
        dataset_index: datasetIndex,
        dataset: spec.label != null ? String(spec.label) : null,
        index,
        label: (this.options.labels || [])[index] ?? null,
        value: raw === undefined ? null : raw,
      });
    }

    // Rebuilt rather than recoloured in place: Chart.js caches each
    // element's resolved colours, so points kept the old surface ring after
    // an in-place change. Series keep their slots and their shown / hidden
    // state (the legend may have toggled it).
    _themeChanged() {
      if (!this._chart) return;
      const theme = this._theme();
      if (theme === this._lastTheme) return;
      this._keepVisibility();
      this._create();
    }

    _keepVisibility() {
      if (!this._chart || this._arc()) return;
      (this.options.datasets || []).forEach((spec, i) => {
        if (i < this._chart.data.datasets.length) spec.hidden = !this._chart.isDatasetVisible(i);
      });
    }

    // Small containers (a shrunk dashboard tile) drop the automatic legend
    // and axis titles; the switch is deferred a frame because Chart.js is
    // mid-resize when it calls this.
    _onResize(size) {
      const compact = size.width < COMPACT.width || size.height < COMPACT.height;
      if (compact === Boolean(this._compact)) return;
      this._compact = compact;
      requestAnimationFrame(() => {
        if (!this._chart) return;
        this._keepVisibility();
        this._chart.options = this._config().options;
        this._chart.update("none");
      });
    }

    // ── Data ─────────────────────────────────────────────────────────────────

    setData(labels, datasets) {
      if (labels != null) this.options.labels = labels.slice();
      if (datasets != null) this.options.datasets = datasets.slice();
      const fresh = this._config();
      this._chart.data.labels = fresh.data.labels;
      this._chart.data.datasets = fresh.data.datasets;
      this._chart.options = fresh.options;
      this._chart.update();
      this._describe();
    }

    _datasetIndex(key) {
      const list = this.options.datasets || [];
      if (typeof key === "number") return key >= 0 && key < list.length ? key : -1;
      return list.findIndex((ds) => String(ds.label) === String(key));
    }

    updateDataset(key, data) {
      const index = this._datasetIndex(key);
      if (index < 0) throw new Error(`Chart has no dataset '${key}'`);
      this.options.datasets[index] = Object.assign({}, this.options.datasets[index], { data: (data || []).slice() });
      this._chart.data.datasets[index].data = (data || []).slice();
      this._chart.update();
      this._renderTable();
    }

    // Streaming: one new label and one value per dataset; drop the oldest
    // past maxPoints. Small updates skip the animation.
    append(label, values, maxPoints) {
      const o = this.options;
      const list = Array.isArray(values) ? values : [values];
      o.labels = (o.labels || []).concat([label]);
      (o.datasets || []).forEach((ds, i) => { ds.data = (ds.data || []).concat([list[i] === undefined ? null : list[i]]); });
      const max = Number(maxPoints) || 0;
      if (max > 0 && o.labels.length > max) {
        const drop = o.labels.length - max;
        o.labels = o.labels.slice(drop);
        o.datasets.forEach((ds) => { ds.data = ds.data.slice(drop); });
      }
      this._chart.data.labels = o.labels.slice();
      this._chart.data.datasets.forEach((ds, i) => { ds.data = (o.datasets[i].data || []).slice(); });
      this._chart.update("none");
      this._renderTable();
    }

    setTitle(title) {
      this.options.title = title || null;
      this._chart.options.plugins.title.display = Boolean(title);
      this._chart.options.plugins.title.text = title || "";
      this._chart.update("none");
      this._describe();
    }

    setType(type) {
      if (!TYPES.has(type)) throw new Error(`wapyt.Chart: unknown type '${type}'`);
      this._keepVisibility();
      this.options.type = type;
      this._create();
    }

    setOptions(raw) {
      this.options.options = deepMerge(this.options.options || {}, raw || {});
      this._chart.options = this._config().options;
      this._chart.update();
    }

    // For a dashboard's resize-stop hook; the ResizeObserver normally does it.
    resize() {
      this._chart.resize();
    }

    toImage() {
      return this._chart.toBase64Image("image/png", 1);
    }

    destroy() {
      charts.delete(this);
      if (this._chart) this._chart.destroy();
      this._chart = null;
      this._host.textContent = "";
      this._events = {};
    }

    on(event, handler) {
      if (!this._events[event]) this._events[event] = new Set();
      this._events[event].add(handler);
    }

    off(event, handler) {
      if (this._events[event]) this._events[event].delete(handler);
    }

    _emit(event, payload) {
      (this._events[event] || new Set()).forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] Chart listener failed", error);
        }
      });
    }
  }

  globalNS.Chart = Chart;
})();
