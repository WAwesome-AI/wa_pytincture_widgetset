(function () {
  // Theme editor: pick a palette, then adjust any colour token for light and
  // dark, the corner radius and the font. Themes are applied as inline custom
  // properties on <html>, so every widget built on the --wapyt-* tokens
  // follows live. wapyt.theme holds the model (tokens, palettes, resolve,
  // apply, save / restore) so an app can apply a saved theme at startup
  // without mounting the editor.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  // ── Tokens ────────────────────────────────────────────────────────────────
  // light / dark: the custom properties holding each mode's value. The old
  // tokens (bg, surface...) are a plain name plus -dark; the newer ones are
  // -light / -dark behind a switching name (see the top of wapyt.css).
  const TOKENS = [
    { key: "bg", label: "Background", group: "Surfaces", light: "--wapyt-bg", dark: "--wapyt-bg-dark" },
    { key: "surface", label: "Surface", group: "Surfaces", light: "--wapyt-surface", dark: "--wapyt-surface-dark" },
    { key: "border", label: "Border", group: "Surfaces", light: "--wapyt-border", dark: "--wapyt-border-dark" },
    { key: "divider", label: "Divider", group: "Surfaces", light: "--wapyt-divider", dark: "--wapyt-divider-dark" },
    { key: "text", label: "Text", group: "Text", light: "--wapyt-text", dark: "--wapyt-text-dark", on: "bg", min: 4.5 },
    { key: "muted", label: "Muted text", group: "Text", light: "--wapyt-muted-light", dark: "--wapyt-muted-dark", on: "bg", min: 4.5 },
    { key: "accent", label: "Accent", group: "Accent", light: "--wapyt-accent-light", dark: "--wapyt-accent-dark", on: "bg", min: 3 },
    { key: "accent-strong", label: "Accent hover", group: "Accent", light: "--wapyt-accent-strong-light", dark: "--wapyt-accent-strong-dark" },
    { key: "accent-text", label: "Text on accent tint", group: "Accent", light: "--wapyt-accent-text-light", dark: "--wapyt-accent-text-dark", on: "tint", min: 4.5 },
    { key: "on-accent", label: "Text on accent", group: "Accent", light: "--wapyt-on-accent-light", dark: "--wapyt-on-accent-dark", on: "accent", min: 4.5 },
    { key: "focus", label: "Focus ring", group: "Accent", light: "--wapyt-focus-light", dark: "--wapyt-focus-dark", on: "bg", min: 3 },
    { key: "danger", label: "Danger", group: "Status", light: "--wapyt-danger-light", dark: "--wapyt-danger-dark", on: "bg", min: 3 },
    { key: "danger-strong", label: "Danger hover", group: "Status", light: "--wapyt-danger-strong-light", dark: "--wapyt-danger-strong-dark" },
    { key: "success", label: "Success", group: "Status", light: "--wapyt-success-light", dark: "--wapyt-success-dark", on: "bg", min: 3 },
    { key: "success-strong", label: "Success text", group: "Status", light: "--wapyt-success-strong-light", dark: "--wapyt-success-strong-dark" },
    { key: "warning", label: "Warning", group: "Status", light: "--wapyt-warning-light", dark: "--wapyt-warning-dark" },
  ];
  const TOKEN_KEYS = TOKENS.map((t) => t.key);
  const GROUPS = ["Surfaces", "Text", "Accent", "Status"];

  const FONTS = [
    { id: "system", label: "System", css: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
    { id: "humanist", label: "Humanist", css: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif' },
    { id: "rounded", label: "Rounded", css: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT", Calibri, source-sans-pro, sans-serif' },
    { id: "serif", label: "Serif", css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
    { id: "mono", label: "Monospace", css: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace' },
  ];
  const DEFAULT_RADIUS = 6;

  // Default must equal wapyt.css (tests/test_themeeditor_js.py checks).
  const DEFAULT = {
    light: {
      bg: "#ffffff", surface: "#f8fafc", border: "#e2e8f0", divider: "#cbd5e1",
      text: "#0f172a", muted: "#64748b",
      accent: "#2563eb", "accent-strong": "#1d4ed8", "accent-text": "#1e40af", "on-accent": "#ffffff", focus: "#3b82f6",
      danger: "#dc2626", "danger-strong": "#b91c1c", success: "#059669", "success-strong": "#15803d", warning: "#f59e0b",
    },
    dark: {
      bg: "#0f172a", surface: "#1e293b", border: "#1f2937", divider: "#475569",
      text: "#f8fafc", muted: "#94a3b8",
      accent: "#2563eb", "accent-strong": "#60a5fa", "accent-text": "#bfdbfe", "on-accent": "#ffffff", focus: "#3b82f6",
      danger: "#ef4444", "danger-strong": "#b91c1c", success: "#10b981", "success-strong": "#4ade80", warning: "#f59e0b",
    },
  };

  function accentSet(light, dark) {
    const [la, ls, lt, lf] = light;
    const [da, ds, dt, df] = dark;
    return {
      light: { accent: la, "accent-strong": ls, "accent-text": lt, focus: lf },
      dark: { accent: da, "accent-strong": ds, "accent-text": dt, focus: df },
    };
  }

  function merge(...parts) {
    const out = { light: {}, dark: {} };
    parts.forEach((p) => {
      Object.assign(out.light, p.light || {});
      Object.assign(out.dark, p.dark || {});
    });
    return out;
  }

  // Palettes are overrides on DEFAULT. Accent fills keep white text at 4.5:1
  // or better; High contrast's dark accent is yellow with black text.
  const PALETTES = [
    { id: "default", label: "Default", ...merge({}) },
    { id: "ocean", label: "Ocean", ...accentSet(["#0e7490", "#155e75", "#164e63", "#0891b2"], ["#0e7490", "#22d3ee", "#a5f3fc", "#06b6d4"]) },
    { id: "forest", label: "Forest", ...accentSet(["#15803d", "#166534", "#14532d", "#16a34a"], ["#15803d", "#4ade80", "#bbf7d0", "#22c55e"]) },
    { id: "sunset", label: "Sunset", ...accentSet(["#c2410c", "#9a3412", "#7c2d12", "#ea580c"], ["#c2410c", "#fb923c", "#fed7aa", "#f97316"]) },
    { id: "grape", label: "Grape", ...accentSet(["#7c3aed", "#6d28d9", "#5b21b6", "#8b5cf6"], ["#7c3aed", "#a78bfa", "#ddd6fe", "#8b5cf6"]) },
    { id: "rose", label: "Rose", ...accentSet(["#be123c", "#9f1239", "#881337", "#f43f5e"], ["#e11d48", "#fb7185", "#fecdd3", "#f43f5e"]) },
    {
      id: "graphite", label: "Graphite",
      ...merge(accentSet(["#3f3f46", "#27272a", "#18181b", "#71717a"], ["#71717a", "#d4d4d8", "#e4e4e7", "#a1a1aa"]), {
        light: { bg: "#ffffff", surface: "#f4f4f5", border: "#e4e4e7", divider: "#d4d4d8", text: "#18181b", muted: "#71717a" },
        dark: { bg: "#18181b", surface: "#27272a", border: "#3f3f46", divider: "#52525b", text: "#fafafa", muted: "#a1a1aa" },
      }),
    },
    {
      id: "paper", label: "Paper",
      ...merge(accentSet(["#b45309", "#92400e", "#78350f", "#d97706"], ["#b45309", "#fbbf24", "#fde68a", "#f59e0b"]), {
        light: { bg: "#fffdf8", surface: "#f8f5ee", border: "#e7e1d4", divider: "#d6cdb8", text: "#292524", muted: "#78716c" },
        dark: { bg: "#1c1917", surface: "#292524", border: "#44403c", divider: "#57534e", text: "#fafaf9", muted: "#a8a29e" },
      }),
    },
    {
      id: "contrast", label: "High contrast",
      ...merge({
        light: {
          bg: "#ffffff", surface: "#ffffff", border: "#000000", divider: "#000000", text: "#000000", muted: "#374151",
          accent: "#1d4ed8", "accent-strong": "#1e3a8a", "accent-text": "#1e3a8a", "on-accent": "#ffffff", focus: "#000000",
          danger: "#b91c1c", "danger-strong": "#7f1d1d", success: "#047857", "success-strong": "#065f46", warning: "#b45309",
        },
        dark: {
          bg: "#000000", surface: "#000000", border: "#ffffff", divider: "#ffffff", text: "#ffffff", muted: "#d1d5db",
          accent: "#facc15", "accent-strong": "#fde047", "accent-text": "#fef08a", "on-accent": "#000000", focus: "#facc15",
          danger: "#f87171", "danger-strong": "#fca5a5", success: "#4ade80", "success-strong": "#86efac", warning: "#fbbf24",
        },
      }),
    },
  ];

  // ── Colour maths ──────────────────────────────────────────────────────────
  function normalizeHex(value) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value == null ? "" : value).trim());
    if (!m) return null;
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    return `#${hex}`;
  }

  function rgb(hex) {
    const h = normalizeHex(hex) || "#000000";
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  function toHex(r, g, b) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
  }

  function luminance(hex) {
    const [r, g, b] = rgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  function mixHex(a, b, weightA) {
    const x = rgb(a);
    const y = rgb(b);
    return toHex(...x.map((v, i) => v * weightA + y[i] * (1 - weightA)));
  }

  function toHsl(hex) {
    const [r, g, b] = rgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function fromHsl(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }

  function withLightness(hex, l) {
    const [h, s] = toHsl(hex);
    return fromHsl(h, s, Math.max(0, Math.min(1, l)));
  }

  // The accent family derived from one colour: what the editor fills in when
  // the accent changes and the person has not set the others themselves.
  function deriveAccent(accent, mode) {
    const [, , l] = toHsl(accent);
    const onAccent = contrast(accent, "#ffffff") >= contrast(accent, "#000000") ? "#ffffff" : "#000000";
    if (mode === "dark") {
      return {
        "accent-strong": withLightness(accent, Math.max(l + 0.2, 0.68)),
        "accent-text": withLightness(accent, 0.88),
        focus: withLightness(accent, Math.max(l + 0.1, 0.6)),
        "on-accent": onAccent,
      };
    }
    return {
      "accent-strong": withLightness(accent, l - 0.08),
      "accent-text": withLightness(accent, Math.min(l - 0.15, 0.3)),
      focus: withLightness(accent, Math.min(l + 0.1, 0.6)),
      "on-accent": onAccent,
    };
  }

  // ── Theme model ───────────────────────────────────────────────────────────
  // A theme: {palette, light: {key: hex}, dark: {key: hex}, radius, font}.
  // light / dark hold only the person's overrides on top of the palette.
  const customPalettes = new Map();

  function paletteById(id) {
    return customPalettes.get(id) || PALETTES.find((p) => p.id === id) || PALETTES[0];
  }

  function registerPalette(spec) {
    if (!spec || !spec.id) throw new Error("A palette needs an id");
    const palette = { id: String(spec.id), label: String(spec.label || spec.id), ...merge(spec) };
    customPalettes.set(palette.id, palette);
    return palette;
  }

  function cleanOverrides(map) {
    const out = {};
    Object.entries(map || {}).forEach(([key, value]) => {
      const hex = normalizeHex(value);
      if (TOKEN_KEYS.includes(key) && hex) out[key] = hex;
    });
    return out;
  }

  function normalizeTheme(theme) {
    const t = theme || {};
    const radius = Number(t.radius);
    return {
      palette: paletteById(t.palette || "default").id,
      light: cleanOverrides(t.light),
      dark: cleanOverrides(t.dark),
      radius: Number.isFinite(radius) ? Math.max(0, Math.min(24, Math.round(radius))) : DEFAULT_RADIUS,
      font: t.font ? String(t.font) : "system",
    };
  }

  function resolve(theme) {
    const t = normalizeTheme(theme);
    const p = paletteById(t.palette);
    return {
      light: Object.assign({}, DEFAULT.light, p.light, t.light),
      dark: Object.assign({}, DEFAULT.dark, p.dark, t.dark),
      radius: t.radius,
      font: fontCss(t.font),
    };
  }

  function fontCss(font) {
    const known = FONTS.find((f) => f.id === font);
    return known ? known.css : String(font || FONTS[0].css);
  }

  let applied = null;

  function apply(theme) {
    const style = document.documentElement.style;
    TOKENS.forEach((t) => {
      style.removeProperty(t.light);
      style.removeProperty(t.dark);
    });
    style.removeProperty("--wapyt-radius");
    style.removeProperty("--wapyt-font-family");
    if (theme == null) {
      applied = null;
      document.documentElement.removeAttribute("data-wapyt-palette");
      return null;
    }
    const t = normalizeTheme(theme);
    const r = resolve(t);
    TOKENS.forEach((tok) => {
      style.setProperty(tok.light, r.light[tok.key]);
      style.setProperty(tok.dark, r.dark[tok.key]);
    });
    style.setProperty("--wapyt-radius", `${r.radius}px`);
    style.setProperty("--wapyt-font-family", r.font);
    document.documentElement.setAttribute("data-wapyt-palette", t.palette);
    applied = t;
    return t;
  }

  function storage() {
    try {
      return globalThis.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function save(key, theme) {
    const store = storage();
    if (!store || !key) return;
    try {
      if (theme == null) store.removeItem(key);
      else store.setItem(key, JSON.stringify(normalizeTheme(theme)));
    } catch (error) {
      /* storage full or blocked: the theme still applies for this page */
    }
  }

  function load(key) {
    const store = storage();
    if (!store || !key) return null;
    try {
      const raw = store.getItem(key);
      return raw ? normalizeTheme(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function restore(key) {
    const theme = load(key);
    if (theme) apply(theme);
    return theme;
  }

  function setPageMode(mode) {
    if (typeof globalNS.setTheme === "function") globalNS.setTheme(mode);
    else document.documentElement.setAttribute("data-wapyt-theme", mode);
  }

  function pageMode() {
    return document.documentElement.getAttribute("data-wapyt-theme") === "dark" ? "dark" : "light";
  }

  globalNS.theme = {
    TOKENS, FONTS, PALETTES, DEFAULT, DEFAULT_RADIUS,
    palettes: () => [...PALETTES, ...customPalettes.values()],
    registerPalette, normalizeHex, contrast, deriveAccent,
    normalize: normalizeTheme, resolve, apply, current: () => applied,
    save, load, restore,
  };

  // ── Editor ────────────────────────────────────────────────────────────────
  let editorSeq = 0;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_themeedhost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") return document.querySelector(target);
    if (target && target.nodeType === 1) return target;
    return null;
  }

  function iconClass(value) {
    const icons = globalNS.icons;
    if (icons && typeof icons.iconClass === "function") return icons.iconClass(value);
    return `mdi ${String(value || "")}`;
  }

  class ThemeEditor {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          palettes: null,       // ids (and custom palette specs) to offer; null = all
          value: null,          // a theme to start from
          mode: null,           // tab to start on: "light" / "dark"; null = the page's
          previewMode: true,    // switching the tab switches the page theme
          storageKey: null,     // remember the theme in localStorage
          apply: true,          // apply to the page as it is edited
          showShape: true,
          showFont: true,
          showExport: true,
          title: "Theme",
        },
        options || {}
      );
      this._events = {};
      this._id = `wapyt-themeed-${++editorSeq}`;
      this._host = resolveHost(target);
      if (!this._host) throw new Error("ThemeEditor: no host element");

      (this.options.palettes || []).forEach((p) => {
        if (p && typeof p === "object") registerPalette(p);
      });
      const stored = this.options.storageKey ? load(this.options.storageKey) : null;
      this._theme = normalizeTheme(this.options.value || stored || applied || {});
      // Tokens the person set themselves: the accent family is not re-derived over them.
      this._touched = { light: new Set(Object.keys(this._theme.light)), dark: new Set(Object.keys(this._theme.dark)) };
      this._mode = this.options.mode === "dark" || this.options.mode === "light" ? this.options.mode : pageMode();
      this._build();
      this._render();
      if (this.options.apply) apply(this._theme);
      if (this.options.previewMode && this.options.mode) setPageMode(this._mode);
      this._watchPage();
    }

    // Lists -----------------------------------------------------------------
    _paletteList() {
      const wanted = this.options.palettes;
      if (!wanted || !wanted.length) return globalNS.theme.palettes();
      return wanted.map((p) => paletteById(typeof p === "object" ? p.id : p));
    }

    // Build -----------------------------------------------------------------
    _build() {
      const root = el("section", "wapyt-themeed");
      root.setAttribute("aria-label", this.options.title || "Theme");
      this._root = root;

      if (this.options.title) root.appendChild(el("h2", "wapyt-themeed-title", this.options.title));

      // Palettes: a radio group of cards.
      const palHead = el("div", "wapyt-themeed-section-head", "Palette");
      palHead.id = `${this._id}-pal`;
      root.appendChild(palHead);
      const grid = el("div", "wapyt-themeed-palettes");
      grid.setAttribute("role", "radiogroup");
      grid.setAttribute("aria-labelledby", palHead.id);
      this._paletteEls = new Map();
      this._paletteList().forEach((p) => {
        const card = el("button", "wapyt-themeed-palette");
        card.type = "button";
        card.setAttribute("role", "radio");
        card.dataset.id = p.id;
        const sw = el("span", "wapyt-themeed-swatches");
        sw.setAttribute("aria-hidden", "true");
        ["bg", "surface", "accent", "text"].forEach((k) => sw.appendChild(el("span", `wapyt-themeed-sw wapyt-themeed-sw-${k}`)));
        card.appendChild(sw);
        card.appendChild(el("span", "wapyt-themeed-palette-label", p.label));
        card.addEventListener("click", () => this.setPalette(p.id, { source: "palette" }));
        card.addEventListener("keydown", (e) => this._paletteKey(e, p.id));
        grid.appendChild(card);
        this._paletteEls.set(p.id, card);
      });
      root.appendChild(grid);

      // Mode switch.
      const modeRow = el("div", "wapyt-themeed-mode");
      modeRow.setAttribute("role", "radiogroup");
      modeRow.setAttribute("aria-label", "Edit colours for");
      this._modeBtns = {};
      [["light", "Light", "mdi-white-balance-sunny"], ["dark", "Dark", "mdi-weather-night"]].forEach(([mode, label, icon]) => {
        const b = el("button", "wapyt-themeed-mode-btn");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.dataset.mode = mode;
        const i = el("i", iconClass(icon));
        i.setAttribute("aria-hidden", "true");
        b.append(i, el("span", null, label));
        b.addEventListener("click", () => this.setMode(mode));
        b.addEventListener("keydown", (e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            const next = mode === "light" ? "dark" : "light";
            this.setMode(next);
            this._modeBtns[next].focus();
          }
        });
        modeRow.appendChild(b);
        this._modeBtns[mode] = b;
      });
      root.appendChild(modeRow);

      // Token rows by group.
      this._rows = new Map();
      GROUPS.forEach((group) => {
        const box = el("fieldset", "wapyt-themeed-group");
        box.appendChild(el("legend", "wapyt-themeed-section-head", group));
        TOKENS.filter((t) => t.group === group).forEach((tok) => box.appendChild(this._buildRow(tok)));
        root.appendChild(box);
      });

      // Shape and type.
      if (this.options.showShape || this.options.showFont) {
        const box = el("fieldset", "wapyt-themeed-group");
        box.appendChild(el("legend", "wapyt-themeed-section-head", "Shape and type"));
        if (this.options.showShape) {
          const row = el("div", "wapyt-themeed-row");
          const id = `${this._id}-radius`;
          const label = el("label", "wapyt-themeed-label", "Corner radius");
          label.htmlFor = id;
          const range = el("input", "wapyt-themeed-range");
          range.type = "range";
          range.id = id;
          range.min = "0";
          range.max = "16";
          range.step = "1";
          const out = el("output", "wapyt-themeed-radius-out");
          out.htmlFor = id;
          range.addEventListener("input", () => this._setRadius(range.value, false));
          range.addEventListener("change", () => this._setRadius(range.value, true));
          const reset = this._resetButton("Reset corner radius", () => this._setRadius(DEFAULT_RADIUS, true));
          row.append(label, range, out, reset);
          box.appendChild(row);
          this._radius = { range, out, reset };
        }
        if (this.options.showFont) {
          const row = el("div", "wapyt-themeed-row");
          const id = `${this._id}-font`;
          const label = el("label", "wapyt-themeed-label", "Font");
          label.htmlFor = id;
          const select = el("select", "wapyt-themeed-select");
          select.id = id;
          FONTS.forEach((f) => {
            const o = el("option", null, f.label);
            o.value = f.id;
            o.style.fontFamily = f.css;
            select.appendChild(o);
          });
          this._customFont = el("option", null, "Custom");
          this._customFont.value = "__custom";
          this._customFont.hidden = true;
          select.appendChild(this._customFont);
          select.addEventListener("change", () => {
            if (select.value === "__custom") return;
            this._theme.font = select.value;
            this._commit("font", null);
          });
          row.append(label, select);
          box.appendChild(row);
          this._font = { select };
        }
        root.appendChild(box);
      }

      // Footer.
      const foot = el("div", "wapyt-themeed-footer");
      const mk = (text, icon, handler, cls) => {
        const b = el("button", `wapyt-themeed-btn${cls ? ` ${cls}` : ""}`);
        b.type = "button";
        const i = el("i", iconClass(icon));
        i.setAttribute("aria-hidden", "true");
        b.append(i, el("span", null, text));
        b.addEventListener("click", handler);
        foot.appendChild(b);
        return b;
      };
      mk("Reset all", "mdi-restore", () => this.reset({ source: "reset" }));
      if (this.options.showExport) {
        mk("Copy", "mdi-content-copy", () => this._copy());
        mk("Download", "mdi-download", () => this._download());
        this._fileInput = el("input");
        this._fileInput.type = "file";
        this._fileInput.accept = "application/json,.json";
        this._fileInput.hidden = true;
        this._fileInput.addEventListener("change", () => this._importFile());
        foot.appendChild(this._fileInput);
        mk("Import", "mdi-upload", () => this._fileInput.click());
      }
      this._status = el("div", "wapyt-themeed-status");
      this._status.setAttribute("role", "status");
      root.append(foot, this._status);

      this._host.innerHTML = "";
      this._host.appendChild(root);
    }

    _buildRow(tok) {
      const row = el("div", "wapyt-themeed-row");
      row.dataset.token = tok.key;
      const id = `${this._id}-${tok.key}`;
      const label = el("label", "wapyt-themeed-label", tok.label);
      label.htmlFor = `${id}-hex`;
      const picker = el("input", "wapyt-themeed-color");
      picker.type = "color";
      picker.setAttribute("aria-label", `${tok.label} colour picker`);
      const hex = el("input", "wapyt-themeed-hex");
      hex.id = `${id}-hex`;
      hex.type = "text";
      hex.spellcheck = false;
      hex.autocomplete = "off";
      hex.maxLength = 7;
      hex.setAttribute("aria-describedby", `${id}-ratio`);
      const ratio = el("span", "wapyt-themeed-ratio");
      ratio.id = `${id}-ratio`;
      const reset = this._resetButton(`Reset ${tok.label}`, () => this._resetToken(tok.key));

      let frame = 0;
      picker.addEventListener("input", () => {
        cancelAnimationFrame(frame);
        const value = picker.value;
        frame = requestAnimationFrame(() => this._setToken(tok.key, value, false));
      });
      picker.addEventListener("change", () => this._setToken(tok.key, picker.value, true));
      hex.addEventListener("change", () => this._hexEntered(tok.key, hex));
      hex.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._hexEntered(tok.key, hex);
        } else if (e.key === "Escape") {
          hex.value = this._value(tok.key);
          hex.removeAttribute("aria-invalid");
        }
      });

      const field = el("div", "wapyt-themeed-field");
      field.append(picker, hex);
      row.append(label, field, ratio, reset);
      this._rows.set(tok.key, { row, picker, hex, ratio, reset });
      return row;
    }

    _resetButton(label, handler) {
      const b = el("button", "wapyt-themeed-reset");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      const i = el("i", iconClass("mdi-restore"));
      i.setAttribute("aria-hidden", "true");
      b.appendChild(i);
      b.addEventListener("click", handler);
      return b;
    }

    _paletteKey(e, id) {
      const ids = [...this._paletteEls.keys()];
      const i = ids.indexOf(id);
      let next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = ids[(i + 1) % ids.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = ids[(i - 1 + ids.length) % ids.length];
      else if (e.key === "Home") next = ids[0];
      else if (e.key === "End") next = ids[ids.length - 1];
      if (next == null) return;
      e.preventDefault();
      this.setPalette(next, { source: "palette" });
      this._paletteEls.get(next).focus();
    }

    // State -----------------------------------------------------------------
    _palette() {
      return paletteById(this._theme.palette);
    }

    _paletteValue(key, mode = this._mode) {
      const p = this._palette();
      return (p[mode] && p[mode][key]) || DEFAULT[mode][key];
    }

    _value(key, mode = this._mode) {
      return this._theme[mode][key] || this._paletteValue(key, mode);
    }

    _setToken(key, value, commit) {
      const hex = normalizeHex(value);
      if (!hex) return false;
      const mode = this._mode;
      const overrides = this._theme[mode];
      if (hex === this._paletteValue(key)) delete overrides[key];
      else overrides[key] = hex;
      if (key === "accent") {
        // Fill in the family unless the person set those tokens themselves.
        const family = deriveAccent(hex, mode);
        const touched = this._touched;
        Object.entries(family).forEach(([k, v]) => {
          if (touched[mode].has(k)) return;
          if (hex === this._paletteValue("accent")) delete overrides[k];
          else overrides[k] = v;
        });
      } else {
        this._touched[mode].add(key);
      }
      if (commit) this._commit("token", key);
      else this._preview();
      return true;
    }

    _resetToken(key) {
      delete this._theme[this._mode][key];
      this._touched[this._mode].delete(key);
      if (key === "accent") {
        Object.keys(deriveAccent("#000000", this._mode)).forEach((k) => {
          if (!this._touched[this._mode].has(k)) delete this._theme[this._mode][k];
        });
      }
      this._commit("reset-token", key);
      const r = this._rows.get(key);
      if (r) r.hex.focus();
    }

    _hexEntered(key, input) {
      if (this._setToken(key, input.value, true)) {
        input.removeAttribute("aria-invalid");
        return;
      }
      input.setAttribute("aria-invalid", "true");
      this._say(`"${input.value}" is not a colour. Use a hex value like #2563eb.`);
    }

    _setRadius(value, commit) {
      this._theme.radius = Math.max(0, Math.min(24, Math.round(Number(value) || 0)));
      if (commit) this._commit("radius", null);
      else this._preview();
    }

    _preview() {
      if (this.options.apply) apply(this._theme);
      this._render();
    }

    _commit(source, key) {
      this._preview();
      if (this.options.storageKey) save(this.options.storageKey, this._theme);
      this._emit("change", { theme: this.getTheme(), source, key, mode: this._mode });
    }

    // Render ----------------------------------------------------------------
    _render() {
      const mode = this._mode;
      const resolved = resolve(this._theme);
      const values = resolved[mode];
      this._root.dataset.mode = mode;

      this._paletteEls.forEach((card, id) => {
        const on = id === this._theme.palette;
        card.setAttribute("aria-checked", on ? "true" : "false");
        card.tabIndex = on ? 0 : -1;
        const p = paletteById(id);
        const v = Object.assign({}, DEFAULT[mode], p[mode]);
        const sw = card.querySelectorAll(".wapyt-themeed-sw");
        ["bg", "surface", "accent", "text"].forEach((k, i) => {
          sw[i].style.background = v[k];
        });
      });
      Object.entries(this._modeBtns).forEach(([m, b]) => {
        b.setAttribute("aria-checked", m === mode ? "true" : "false");
        b.tabIndex = m === mode ? 0 : -1;
      });

      const tint = mixHex(values.accent, values.bg, mode === "dark" ? 0.18 : 0.12);
      TOKENS.forEach((tok) => {
        const r = this._rows.get(tok.key);
        const value = values[tok.key];
        r.picker.value = value;
        if (document.activeElement !== r.hex) {
          r.hex.value = value;
          r.hex.removeAttribute("aria-invalid");
        }
        const overridden = Object.prototype.hasOwnProperty.call(this._theme[mode], tok.key);
        r.row.toggleAttribute("data-changed", overridden);
        r.reset.hidden = !overridden;
        if (tok.on) {
          const against = tok.on === "tint" ? tint : values[tok.on];
          const ratio = contrast(value, against);
          const pass = ratio >= tok.min;
          const large = !pass && tok.min === 4.5 && ratio >= 3;
          r.ratio.textContent = `${ratio.toFixed(1)}:1`;
          r.ratio.dataset.level = pass ? "pass" : large ? "large" : "fail";
          const onWhat = tok.on === "tint" ? "the accent tint" : TOKENS.find((t) => t.key === tok.on).label.toLowerCase();
          r.ratio.title = pass
            ? `Contrast with ${onWhat}: passes (needs ${tok.min}:1)`
            : large
              ? `Contrast with ${onWhat}: large text only (needs ${tok.min}:1)`
              : `Contrast with ${onWhat}: too low (needs ${tok.min}:1)`;
          r.ratio.setAttribute("aria-label", r.ratio.title.replace(":", ` ${ratio.toFixed(1)} to 1:`));
          r.ratio.hidden = false;
        } else {
          r.ratio.hidden = true;
          r.ratio.textContent = "";
        }
      });

      if (this._radius) {
        this._radius.range.value = String(this._theme.radius);
        this._radius.out.textContent = `${this._theme.radius}px`;
        this._radius.reset.hidden = this._theme.radius === DEFAULT_RADIUS;
      }
      if (this._font) {
        const known = FONTS.some((f) => f.id === this._theme.font);
        this._customFont.hidden = known;
        this._font.select.value = known ? this._theme.font : "__custom";
      }
    }

    // Export / import -------------------------------------------------------
    _json() {
      return JSON.stringify(this.getTheme(), null, 2);
    }

    async _copy() {
      try {
        await navigator.clipboard.writeText(this._json());
        this._say("Theme copied as JSON.");
      } catch (error) {
        this._say("Copy is not available here; use Download.");
      }
    }

    _download() {
      const blob = new Blob([this._json()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `theme-${this._theme.palette}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this._say("Theme downloaded.");
    }

    async _importFile() {
      const file = this._fileInput.files && this._fileInput.files[0];
      this._fileInput.value = "";
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
        this.setTheme(data, { source: "import" });
        this._say(`Imported ${file.name}.`);
      } catch (error) {
        this._say(`${file.name} is not a theme file.`);
      }
    }

    _say(text) {
      this._status.textContent = "";
      this._status.textContent = text;
      clearTimeout(this._sayTimer);
      this._sayTimer = setTimeout(() => {
        this._status.textContent = "";
      }, 4000);
    }

    _watchPage() {
      if (typeof MutationObserver === "undefined") return;
      this._observer = new MutationObserver(() => {
        if (!this.options.previewMode) return;
        const mode = pageMode();
        if (mode !== this._mode) {
          this._mode = mode;
          this._render();
        }
      });
      this._observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-wapyt-theme"] });
    }

    // Public API ------------------------------------------------------------
    getTheme() {
      const t = this._theme;
      return {
        palette: t.palette,
        light: Object.assign({}, t.light),
        dark: Object.assign({}, t.dark),
        radius: t.radius,
        font: t.font,
      };
    }

    getResolved() {
      return resolve(this._theme);
    }

    setTheme(theme, opts = {}) {
      this._theme = normalizeTheme(theme);
      this._touched = { light: new Set(Object.keys(this._theme.light)), dark: new Set(Object.keys(this._theme.dark)) };
      if (opts.silent) {
        this._preview();
        if (this.options.storageKey) save(this.options.storageKey, this._theme);
      } else {
        this._commit(opts.source || "code", null);
      }
    }

    setPalette(id, opts = {}) {
      const palette = paletteById(id);
      // A new palette starts clean: overrides were adjustments to the old one.
      this._theme = Object.assign(this._theme, { palette: palette.id, light: {}, dark: {} });
      this._touched = { light: new Set(), dark: new Set() };
      if (opts.silent) this._preview();
      else this._commit(opts.source || "code", null);
    }

    reset(opts = {}) {
      this._theme = normalizeTheme({});
      this._touched = { light: new Set(), dark: new Set() };
      if (opts.silent) this._preview();
      else this._commit(opts.source || "code", null);
    }

    setMode(mode) {
      if (mode !== "light" && mode !== "dark") return;
      this._mode = mode;
      if (this.options.previewMode) setPageMode(mode);
      this._render();
      this._emit("mode", { mode });
    }

    getMode() {
      return this._mode;
    }

    on(event, handler) {
      (this._events[event] || (this._events[event] = new Set())).add(handler);
    }

    off(event, handler) {
      if (this._events[event]) this._events[event].delete(handler);
    }

    _emit(event, payload) {
      (this._events[event] || new Set()).forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] ThemeEditor listener failed", error);
        }
      });
    }

    destroy() {
      this._events = {};
      if (this._observer) this._observer.disconnect();
      clearTimeout(this._sayTimer);
      this._root.remove();
    }
  }

  globalNS.ThemeEditor = ThemeEditor;
})();
