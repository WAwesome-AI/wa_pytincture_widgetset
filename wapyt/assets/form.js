(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_formhost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-form"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") {
      return document.querySelector(target);
    }
    if (target && target.nodeType === 1) {
      return target;
    }
    return null;
  }

  const TEXTUAL = new Set(["text", "password", "email", "number", "url", "search", "tel"]);
  // Native pickers: the browser draws them and they read back as ISO strings.
  const DATELIKE = new Set(["date", "time", "datetime-local"]);
  // Types that take min / max / step and are bounds-checked in validate().
  const BOUNDED = new Set(["number", "range", ...DATELIKE]);
  // A single checkbox and a switch both read back as a bool.
  const BOOLEAN = new Set(["checkbox", "toggle"]);
  // One control per option, wrapped in a fieldset.
  const GROUPS = new Set(["radio", "checkbox_group"]);

  function optionPairs(options) {
    return (options || []).map((option) =>
      option && typeof option === "object"
        ? { value: String(option.value ?? ""), label: String(option.label ?? option.value ?? "") }
        : { value: String(option ?? ""), label: String(option ?? "") }
    );
  }

  // Searchable select. The input is a WAI-ARIA combobox; its listbox is
  // appended to <body> only while open and positioned `fixed`, like
  // ContextMenu, so a modal's or a cell's overflow cannot clip it.
  class Combo {
    constructor(field, controlId, onChange) {
      this.multiple = Boolean(field.multiple);
      this.allowCustom = Boolean(field.allowCustom);
      this.onChange = onChange;
      this.options = optionPairs(field.options);
      this.selected = [];
      this.visible = [];
      this.active = -1;
      this.listId = `${controlId}_list`;

      this.root = document.createElement("div");
      this.root.className = "wapyt-form-combo";
      if (this.multiple) this.root.dataset.multiple = "true";

      this.chips = document.createElement("span");
      this.chips.className = "wapyt-form-combo-chips";
      this.root.appendChild(this.chips);

      this.input = document.createElement("input");
      this.input.type = "text";
      this.input.className = "wapyt-form-combo-input";
      this.input.setAttribute("role", "combobox");
      this.input.setAttribute("aria-autocomplete", "list");
      this.input.setAttribute("aria-expanded", "false");
      this.input.setAttribute("aria-controls", this.listId);
      this.input.autocomplete = "off";
      this.input.spellcheck = false;
      this.root.appendChild(this.input);

      this.list = document.createElement("ul");
      this.list.className = "wapyt-form-combo-list";
      this.list.id = this.listId;
      this.list.setAttribute("role", "listbox");
      if (this.multiple) this.list.setAttribute("aria-multiselectable", "true");
      // Keep focus in the input while an option is clicked.
      this.list.addEventListener("mousedown", (event) => event.preventDefault());
      this.list.addEventListener("click", (event) => {
        const item = event.target.closest("[data-index]");
        if (item) this._pick(this.visible[Number(item.dataset.index)]);
      });

      this.root.addEventListener("mousedown", (event) => {
        if (this.input.disabled || event.target.closest(".wapyt-form-combo-chip-remove")) return;
        if (event.target !== this.input) event.preventDefault();
        this.input.focus();
        if (this.isOpen()) {
          this.close();
          return;
        }
        this.open();
        // Select the current choice's text so typing starts a fresh search.
        if (!this.multiple) {
          event.preventDefault();
          this.input.select();
        }
      });
      this.input.addEventListener("input", () => {
        this.open();
        this._filter(this.input.value);
      });
      this.input.addEventListener("keydown", (event) => this._onKey(event));
      this.input.addEventListener("blur", () => {
        this.close();
        this._commitText();
      });

      this._onViewport = (event) => {
        if (event && event.target && this.list.contains(event.target)) return;
        this._place();
      };
    }

    isOpen() {
      return this.list.isConnected;
    }

    open() {
      if (this.isOpen() || this.input.disabled || this.input.readOnly) return;
      document.body.appendChild(this.list);
      this.input.setAttribute("aria-expanded", "true");
      this.root.dataset.open = "true";
      // Single mode opens on the full list, with the current choice active.
      this._filter(this.multiple ? this.input.value : "");
      window.addEventListener("scroll", this._onViewport, true);
      window.addEventListener("resize", this._onViewport);
    }

    close() {
      if (!this.isOpen()) return;
      this.list.remove();
      this.input.setAttribute("aria-expanded", "false");
      this.input.removeAttribute("aria-activedescendant");
      delete this.root.dataset.open;
      window.removeEventListener("scroll", this._onViewport, true);
      window.removeEventListener("resize", this._onViewport);
    }

    _place() {
      const box = this.root.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      const height = Math.min(this.list.scrollHeight, 240);
      this.list.style.left = `${Math.round(box.left)}px`;
      this.list.style.width = `${Math.round(box.width)}px`;
      // Flip above when there is no room below and more room above.
      if (below < height + 8 && box.top > below) {
        this.list.style.top = "";
        this.list.style.bottom = `${Math.round(window.innerHeight - box.top + 4)}px`;
      } else {
        this.list.style.bottom = "";
        this.list.style.top = `${Math.round(box.bottom + 4)}px`;
      }
    }

    _filter(text) {
      const needle = String(text || "").trim().toLowerCase();
      this.visible = needle
        ? this.options.filter((option) => option.label.toLowerCase().includes(needle))
        : this.options.slice();
      this.list.innerHTML = "";
      this.visible.forEach((option, index) => {
        const item = document.createElement("li");
        item.className = "wapyt-form-combo-option";
        item.id = `${this.listId}_${index}`;
        item.dataset.index = String(index);
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", this.selected.includes(option.value) ? "true" : "false");
        item.textContent = option.label;
        this.list.appendChild(item);
      });
      if (!this.visible.length) {
        const empty = document.createElement("li");
        empty.className = "wapyt-form-combo-empty";
        empty.textContent = this.allowCustom && needle ? `Press Enter to use “${text.trim()}”` : "No matches";
        this.list.appendChild(empty);
      }
      const current = this.multiple ? -1 : this.visible.findIndex((o) => o.value === this.selected[0]);
      this._setActive(needle ? 0 : Math.max(current, 0));
      this._place();
    }

    _setActive(index) {
      const items = this.list.querySelectorAll("[data-index]");
      items.forEach((item) => item.removeAttribute("data-active"));
      this.active = items.length ? Math.max(0, Math.min(index, items.length - 1)) : -1;
      if (this.active < 0) {
        this.input.removeAttribute("aria-activedescendant");
        return;
      }
      const item = items[this.active];
      item.dataset.active = "true";
      this.input.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    }

    _onKey(event) {
      const key = event.key;
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        if (!this.isOpen()) return this.open();
        this._setActive(this.active + (key === "ArrowDown" ? 1 : -1));
      } else if (key === "Enter") {
        if (!this.isOpen()) return;
        // Enter inside an open list picks; it must not submit the form.
        event.preventDefault();
        if (this.active >= 0) {
          this._pick(this.visible[this.active]);
        } else if (this.allowCustom && this.input.value.trim()) {
          const text = this.input.value.trim();
          this._pick({ value: text, label: text });
        }
      } else if (key === "Escape") {
        if (!this.isOpen()) return;
        // Stop here so an enclosing modal does not close as well.
        event.preventDefault();
        event.stopPropagation();
        this.close();
        this._syncText();
      } else if (key === "Tab") {
        this.close();
      } else if (key === "Backspace" && this.multiple && !this.input.value && this.selected.length) {
        this._set(this.selected.slice(0, -1));
      }
    }

    _pick(option) {
      if (!option) return;
      if (this.multiple) {
        const has = this.selected.includes(option.value);
        this._set(has ? this.selected.filter((v) => v !== option.value) : [...this.selected, option.value]);
        this.input.value = "";
        this._filter("");
      } else {
        this._set([option.value]);
        this.close();
      }
    }

    // On blur, typed text that matches nothing is dropped unless custom
    // values are allowed; clearing the box clears a single selection.
    _commitText() {
      const text = this.input.value.trim();
      if (this.multiple) {
        if (text && this.allowCustom) this._set([...this.selected, text]);
        this.input.value = "";
        return;
      }
      if (!text) {
        if (this.selected.length) this._set([]);
        return;
      }
      const match = this.options.find((o) => o.label.toLowerCase() === text.toLowerCase());
      if (match) this._set([match.value]);
      else if (this.allowCustom) this._set([text]);
      else this._syncText();
    }

    _labelFor(value) {
      const option = this.options.find((o) => o.value === value);
      return option ? option.label : value;
    }

    _set(values, silent) {
      const next = Array.from(new Set(values.map(String)));
      const changed = next.join("\u0000") !== this.selected.join("\u0000");
      this.selected = next;
      this._syncText();
      if (changed && !silent) this.onChange();
    }

    _syncText() {
      if (!this.multiple) {
        this.input.value = this.selected.length ? this._labelFor(this.selected[0]) : "";
        return;
      }
      this.chips.innerHTML = "";
      this.selected.forEach((value) => {
        const chip = document.createElement("span");
        chip.className = "wapyt-form-combo-chip";
        const text = document.createElement("span");
        text.textContent = this._labelFor(value);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "wapyt-form-combo-chip-remove";
        remove.tabIndex = -1;
        remove.setAttribute("aria-label", `Remove ${this._labelFor(value)}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          if (this.input.disabled || this.input.readOnly) return;
          this._set(this.selected.filter((v) => v !== value));
          this.input.focus();
        });
        chip.appendChild(text);
        chip.appendChild(remove);
        this.chips.appendChild(chip);
      });
      if (this.isOpen()) this._filter(this.input.value);
    }

    getValue() {
      if (this.multiple) return this.selected.slice();
      return this.selected.length ? this.selected[0] : null;
    }

    setValue(value) {
      const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
      // Values that are not options survive only when custom values are allowed.
      const known = new Set(this.options.map((o) => o.value));
      const kept = list.map(String).filter((v) => this.allowCustom || known.has(v));
      this._set(this.multiple ? kept : kept.slice(0, 1), true);
    }

    setOptions(options) {
      const previous = this.getValue();
      this.options = optionPairs(options);
      this.setValue(previous);
      if (this.isOpen()) this._filter(this.input.value);
    }
  }

  // Range geometry shared by the native slider and RangeSlider: a value's
  // position along the track, snapping to the step, and the decimals the step
  // implies (so 0.1 steps do not read back as 0.30000000000000004).
  function rangeBounds(field) {
    const min = field.min != null && field.min !== "" ? Number(field.min) : 0;
    const max = field.max != null && field.max !== "" ? Number(field.max) : 100;
    const step = Number(field.step) > 0 ? Number(field.step) : 1;
    return { min, max: Math.max(min, max), step };
  }

  function stepDecimals(step) {
    const text = String(step);
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : text.length - dot - 1;
  }

  function snapValue(value, bounds) {
    const { min, max, step } = bounds;
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    const snapped = min + Math.round((n - min) / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    return Number(clamped.toFixed(stepDecimals(step)));
  }

  function rangeFraction(value, bounds) {
    const span = bounds.max - bounds.min;
    return span > 0 ? (value - bounds.min) / span : 0;
  }

  // Tick marks under a slider: a minor tick every `ticks` units, a major one
  // (with its value as a label, unless tickLabels is false) every
  // `majorTicks`. Positions use the same inset as the thumbs (half a thumb at
  // each end), so a tick sits under the thumb centre at that value. Capped at
  // 201 marks so a tiny interval cannot flood the DOM.
  function buildTicks(field) {
    const bounds = rangeBounds(field);
    const minor = Number(field.ticks) > 0 ? Number(field.ticks) : 0;
    const major = Number(field.majorTicks) > 0 ? Number(field.majorTicks) : 0;
    if (!minor && !major) return null;
    const span = bounds.max - bounds.min;
    const unit = minor && major ? Math.min(minor, major) : minor || major;
    if (span <= 0 || span / unit > 200) return null;
    const decimals = Math.max(stepDecimals(unit), stepDecimals(bounds.step));
    const near = (value, interval) => {
      if (!interval) return false;
      const ratio = (value - bounds.min) / interval;
      return Math.abs(ratio - Math.round(ratio)) < 1e-6;
    };
    const scale = document.createElement("div");
    scale.className = "wapyt-form-ticks";
    scale.setAttribute("aria-hidden", "true");
    const count = Math.round(span / unit);
    for (let i = 0; i <= count; i += 1) {
      const value = Number((bounds.min + i * unit).toFixed(decimals));
      if (value > bounds.max + 1e-9) break;
      const isMajor = near(value, major);
      if (!isMajor && !near(value, minor)) continue;
      const tick = document.createElement("span");
      tick.className = "wapyt-form-tick";
      if (isMajor) tick.dataset.major = "true";
      tick.style.setProperty("--wapyt-tick-at", String(rangeFraction(value, bounds)));
      if (isMajor && field.tickLabels !== false) {
        const label = document.createElement("span");
        label.className = "wapyt-form-tick-label";
        label.textContent = String(value);
        tick.appendChild(label);
      }
      scale.appendChild(tick);
    }
    if (major && field.tickLabels !== false) scale.dataset.labels = "true";
    return scale;
  }

  // Two-thumb slider for FieldConfig(type="range", range=True), reading back
  // [low, high]. One native input cannot have two thumbs, so this follows the
  // WAI-ARIA multi-thumb slider pattern: each thumb is a focusable
  // role="slider" whose aria-valuemin / max are the limits the other thumb
  // sets, and the thumbs never cross.
  class RangeSlider {
    constructor(field, controlId, onChange) {
      this.field = field;
      this.bounds = rangeBounds(field);
      this.onChange = onChange;
      this.values = [this.bounds.min, this.bounds.max];
      this.disabled = false;
      this.readOnly = Boolean(field.readonly);
      this.drag = null;

      this.root = document.createElement("div");
      this.root.className = "wapyt-form-slider";
      this.root.id = controlId;
      this.root.setAttribute("role", "group");
      this.root.setAttribute("aria-labelledby", `${controlId}_label`);

      this.track = document.createElement("div");
      this.track.className = "wapyt-form-slider-track";
      this.fill = document.createElement("div");
      this.fill.className = "wapyt-form-slider-fill";
      this.track.appendChild(this.fill);
      this.root.appendChild(this.track);

      const name = field.label || field.id;
      this.thumbs = ["minimum", "maximum"].map((which, index) => {
        const thumb = document.createElement("div");
        thumb.className = "wapyt-form-slider-thumb";
        thumb.dataset.thumb = index ? "high" : "low";
        thumb.tabIndex = 0;
        thumb.setAttribute("role", "slider");
        thumb.setAttribute("aria-orientation", "horizontal");
        thumb.setAttribute("aria-label", `${name} ${which}`);
        thumb.addEventListener("keydown", (event) => this._onKey(event, index));
        this.root.appendChild(thumb);
        return thumb;
      });

      this.root.addEventListener("pointerdown", (event) => this._onDown(event));
      this.root.addEventListener("pointermove", (event) => this._onMove(event));
      this.root.addEventListener("pointerup", (event) => this._onUp(event));
      this.root.addEventListener("pointercancel", (event) => this._onUp(event));
      this.root.addEventListener("lostpointercapture", () => this._endDrag());
      this.setDisabled(Boolean(field.disabled));
      this._paint();
    }

    _valueAt(clientX) {
      const box = this.track.getBoundingClientRect();
      const fraction = box.width > 0 ? (clientX - box.left) / box.width : 0;
      const { min, max } = this.bounds;
      return snapValue(min + Math.min(1, Math.max(0, fraction)) * (max - min), this.bounds);
    }

    _interactive() {
      return !this.disabled && !this.readOnly;
    }

    _onDown(event) {
      if (event.button !== 0 || !this._interactive()) return;
      event.preventDefault();
      const value = this._valueAt(event.clientX);
      const [low, high] = this.values;
      let index;
      const onThumb = event.target.closest(".wapyt-form-slider-thumb");
      if (low === high && (onThumb || value === low)) {
        // Stacked thumbs: wait for the first movement to say which one.
        index = null;
      } else if (onThumb) {
        index = this.thumbs.indexOf(onThumb);
      } else {
        index = Math.abs(value - low) <= Math.abs(value - high) ? 0 : 1;
        if (value < low) index = 0;
        else if (value > high) index = 1;
      }
      this.drag = { pointerId: event.pointerId, index, startX: event.clientX };
      this.root.setPointerCapture(event.pointerId);
      this.root.dataset.dragging = "true";
      if (index != null) {
        this.thumbs[index].focus();
        this._setThumb(index, value);
      } else {
        (onThumb || this.thumbs[0]).focus();
      }
    }

    _onMove(event) {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.index == null) {
        if (event.clientX === drag.startX) return;
        drag.index = event.clientX < drag.startX ? 0 : 1;
        this.thumbs[drag.index].focus();
      }
      this._setThumb(drag.index, this._valueAt(event.clientX));
    }

    _onUp(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      if (this.root.hasPointerCapture(event.pointerId)) {
        this.root.releasePointerCapture(event.pointerId);
      }
      this._endDrag();
    }

    _endDrag() {
      this.drag = null;
      delete this.root.dataset.dragging;
    }

    _onKey(event, index) {
      if (!this._interactive()) return;
      const { min, max, step } = this.bounds;
      const page = Math.max(step, snapValue(min + (max - min) / 10, this.bounds) - min);
      const current = this.values[index];
      let next;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = current - step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = current + step;
          break;
        case "PageDown":
          next = current - page;
          break;
        case "PageUp":
          next = current + page;
          break;
        case "Home":
          next = index ? this.values[0] : min;
          break;
        case "End":
          next = index ? max : this.values[1];
          break;
        default:
          return;
      }
      event.preventDefault();
      this._setThumb(index, next);
    }

    // Move one thumb, stopping at the other; fires change only on a real move.
    _setThumb(index, value) {
      let next = snapValue(value, this.bounds);
      if (index === 0) next = Math.min(next, this.values[1]);
      else next = Math.max(next, this.values[0]);
      if (next === this.values[index]) return;
      this.values[index] = next;
      this._paint();
      this.onChange();
    }

    _paint() {
      const [low, high] = this.values;
      const { min, max } = this.bounds;
      const from = rangeFraction(low, this.bounds);
      const to = rangeFraction(high, this.bounds);
      this.root.style.setProperty("--wapyt-slider-from", String(from));
      this.root.style.setProperty("--wapyt-slider-to", String(to));
      const limits = [[min, high], [low, max]];
      this.thumbs.forEach((thumb, index) => {
        const value = this.values[index];
        thumb.style.setProperty("--wapyt-slider-at", String(index ? to : from));
        thumb.setAttribute("aria-valuemin", String(limits[index][0]));
        thumb.setAttribute("aria-valuemax", String(limits[index][1]));
        thumb.setAttribute("aria-valuenow", String(value));
      });
      // Equal values: keep the high thumb grabbable once both sit at min.
      this.thumbs[1].dataset.top = low === high && low === min ? "true" : "false";
    }

    text() {
      return `${this.values[0]} – ${this.values[1]}`;
    }

    getValue() {
      return this.values.slice();
    }

    // Takes [low, high] (either may be null for its bound); a scalar or junk
    // falls back to the whole range. Values are snapped and put in order.
    setValue(value) {
      const pair = Array.isArray(value) ? value : [];
      const pick = (item, fallback) => (item == null || item === "" ? fallback : snapValue(item, this.bounds));
      const low = pick(pair[0], this.bounds.min);
      const high = pick(pair[1], this.bounds.max);
      this.values = low <= high ? [low, high] : [high, low];
      this._paint();
    }

    setDisabled(disabled) {
      this.disabled = Boolean(disabled);
      if (this.disabled) this.root.dataset.disabled = "true";
      else delete this.root.dataset.disabled;
      this.thumbs.forEach((thumb) => {
        thumb.tabIndex = this.disabled ? -1 : 0;
        if (this.disabled) thumb.setAttribute("aria-disabled", "true");
        else thumb.removeAttribute("aria-disabled");
        if (this.readOnly) thumb.setAttribute("aria-readonly", "true");
      });
      if (this.disabled && this.drag) this._endDrag();
    }

    focus() {
      if (!this.disabled) this.thumbs[0].focus();
    }
  }

  // A label width as CSS: numbers are pixels, strings pass through.
  function cssLength(value) {
    if (value == null || value === "") return null;
    return typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value)) ? `${value}px` : String(value);
  }

  function iconClass(value) {
    const icons = globalNS.icons;
    if (icons && typeof icons.iconClass === "function") return icons.iconClass(value);
    return `mdi ${String(value || "")}`;
  }

  const BUTTON_VARIANTS = { primary: "primary", danger: "danger", link: "link", default: "ghost" };

  // Every label, option and error string here reaches the DOM through
  // textContent, and every control is built with createElement. Nothing in this
  // widget interpolates a value into innerHTML, so field definitions coming
  // from application data cannot inject markup.
  class Form {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          fields: [],
          submitText: "Save",
          cancelText: null,
          columns: 1,
          busy: false,
          autocomplete: "off",
          buttons: [],
          labelPosition: "top",
          labelWidth: null,
        },
        options || {}
      );

      this._events = {};
      this._controls = new Map();
      this._errorEls = new Map();
      this._rows = new Map();
      this._buttons = new Map(); // id -> {spec, el, textEl, row, disabled, loading}

      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount Form – target not found.");
      }
      this._render();
    }

    _render() {
      this._host.classList.add("wapyt-form");
      this._host.innerHTML = "";

      this._formEl = document.createElement("form");
      this._formEl.className = "wapyt-form-body";
      this._formEl.setAttribute("novalidate", "novalidate");
      this._formEl.autocomplete = this.options.autocomplete || "off";
      if (Number(this.options.columns) > 1) {
        this._formEl.dataset.columns = String(this.options.columns);
      }
      const labelWidth = cssLength(this.options.labelWidth);
      if (labelWidth) this._formEl.style.setProperty("--wapyt-form-label-width", labelWidth);
      this._formEl.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submit();
      });

      (this.options.fields || []).forEach((field) => {
        const row = field && field.type === "button" ? this._createButtonRow(field) : this._createRow(field);
        if (row) {
          this._formEl.appendChild(row);
        }
      });

      this._formError = document.createElement("div");
      this._formError.className = "wapyt-form-error wapyt-form-error-global";
      this._formError.hidden = true;
      this._formEl.appendChild(this._formError);

      this._actions = document.createElement("div");
      this._actions.className = "wapyt-form-actions";
      (this.options.buttons || []).forEach((spec) => {
        if (spec && spec.id) this._actions.appendChild(this._createButton(spec, null));
      });

      if (this.options.cancelText) {
        this._cancelBtn = document.createElement("button");
        this._cancelBtn.type = "button";
        this._cancelBtn.className = "wapyt-form-button wapyt-form-button-ghost";
        this._cancelBtn.textContent = this.options.cancelText;
        this._cancelBtn.addEventListener("click", () => this._emit("cancel", {}));
        this._actions.appendChild(this._cancelBtn);
      }

      if (this.options.submitText) {
        this._submitBtn = document.createElement("button");
        this._submitBtn.type = "submit";
        this._submitBtn.className = "wapyt-form-button wapyt-form-button-primary";
        this._submitBtn.textContent = this.options.submitText;
        this._actions.appendChild(this._submitBtn);
      }

      this._formEl.appendChild(this._actions);
      this._host.appendChild(this._formEl);
      this.setBusy(Boolean(this.options.busy));
      this._watchNarrow();
    }

    // ── Label position ───────────────────────────────────────────────────────

    _labelPosition(field) {
      const position = (field && field.labelPosition) || this.options.labelPosition;
      return position === "left" ? "left" : "top";
    }

    // Left labels fall back to top labels when a row leaves its control less
    // than 160px. A ResizeObserver rather than a container query: inline-size
    // containment would collapse a form inside a shrink-to-fit Popup.
    _watchNarrow() {
      if (this._narrowObserver) this._narrowObserver.disconnect();
      const rows = Array.from(this._rows.values()).filter((row) => row.dataset.labelPosition === "left");
      if (!rows.length || typeof ResizeObserver !== "function") return;
      const check = () => {
        rows.forEach((row) => {
          if (row.hidden) return;
          if (row.dataset.narrow !== "true") {
            const track = parseFloat(getComputedStyle(row).gridTemplateColumns);
            if (Number.isFinite(track)) row._wapytLabelTrack = track;
          }
          const label = row._wapytLabelTrack || 0;
          const narrow = row.clientWidth - label - 12 < 160;
          if (narrow) row.dataset.narrow = "true";
          else delete row.dataset.narrow;
        });
      };
      this._narrowObserver = new ResizeObserver(check);
      this._narrowObserver.observe(this._formEl);
      check();
    }

    // ── Buttons ──────────────────────────────────────────────────────────────

    _createButtonRow(spec) {
      if (!spec.id) return null;
      const row = document.createElement("div");
      row.className = "wapyt-form-row";
      row.dataset.fieldId = String(spec.id);
      row.dataset.kind = "button";
      if (spec.span) row.dataset.span = String(spec.span);
      if (this._labelPosition(spec) === "left") row.dataset.labelPosition = "left";
      row.appendChild(this._createButton(spec, row));
      if (spec.hidden) row.hidden = true;
      this._rows.set(String(spec.id), row);
      return row;
    }

    _createButton(spec, row) {
      const id = String(spec.id);
      const button = document.createElement("button");
      button.type = "button";
      const variant = BUTTON_VARIANTS[spec.variant] || "ghost";
      button.className = `wapyt-form-button wapyt-form-button-${variant}`;
      button.dataset.buttonId = id;
      if (spec.full) button.dataset.full = "true";
      if (spec.tooltip) button.title = String(spec.tooltip);
      if (spec.icon) {
        const icon = document.createElement("i");
        icon.className = `wapyt-form-button-icon ${iconClass(spec.icon)}`;
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
      }
      const textEl = document.createElement("span");
      textEl.className = "wapyt-form-button-text";
      textEl.textContent = spec.text == null ? id : String(spec.text);
      button.appendChild(textEl);
      const spinner = document.createElement("span");
      spinner.className = "wapyt-form-button-spinner";
      spinner.setAttribute("aria-hidden", "true");
      button.appendChild(spinner);
      if (!row && spec.hidden) button.hidden = true;

      const entry = { spec, el: button, textEl, row, disabled: Boolean(spec.disabled), loading: false };
      this._buttons.set(id, entry);
      this._syncButton(entry);
      button.addEventListener("click", () => this._onButton(entry));
      return button;
    }

    // A button is unusable while disabled, loading, or (for submit buttons)
    // while the form is busy.
    _syncButton(entry) {
      const busy = this._busy && entry.spec.submit;
      entry.el.disabled = entry.disabled || entry.loading || Boolean(busy);
      if (entry.loading) {
        entry.el.dataset.loading = "true";
        entry.el.setAttribute("aria-busy", "true");
      } else {
        delete entry.el.dataset.loading;
        entry.el.removeAttribute("aria-busy");
      }
    }

    _onButton(entry) {
      const id = String(entry.spec.id);
      if (!entry.spec.submit) {
        this._emit("click", { id });
        return;
      }
      if (this._busy) return;
      const errors = this.validate();
      if (Object.keys(errors).length) {
        this._focusInvalid(errors);
        this._emit("invalid", { errors, id });
        return;
      }
      this._emit("click", { id, values: this.getValues() });
    }

    _button(id) {
      return this._buttons.get(String(id)) || null;
    }

    setButtonText(id, text) {
      const entry = this._button(id);
      if (entry) entry.textEl.textContent = text == null ? "" : String(text);
    }

    setButtonLoading(id, loading = true) {
      const entry = this._button(id);
      if (!entry) return;
      entry.loading = Boolean(loading);
      this._syncButton(entry);
    }

    _createRow(field) {
      if (!field || !field.id) return null;
      const type = field.type || "text";

      if (type === "hidden") {
        const input = document.createElement("input");
        input.type = "hidden";
        input.value = field.value ?? "";
        this._controls.set(field.id, { field, el: input, type });
        return input;
      }

      const row = document.createElement("div");
      row.className = "wapyt-form-row";
      row.dataset.fieldId = field.id;
      if (field.span) {
        row.dataset.span = String(field.span);
      }
      const left = this._labelPosition(field) === "left";
      if (left) row.dataset.labelPosition = "left";
      const fieldLabelWidth = cssLength(field.labelWidth);
      if (fieldLabelWidth) row.style.setProperty("--wapyt-form-label-width", fieldLabelWidth);
      row.dataset.kind =
        BOOLEAN.has(type) ? "boolean"
        : GROUPS.has(type) ? "group"
        : type === "range" ? "range"
        : "control";

      const controlId = `wapyt_f_${field.id}_${Math.random().toString(16).slice(2, 8)}`;
      let control;
      let combo = null;
      let slider = null;

      if (type === "range" && field.range) {
        slider = new RangeSlider(field, controlId, () => emitChange());
        control = slider.root;
      } else if (type === "textarea") {
        control = document.createElement("textarea");
        control.rows = Number(field.rows) || 4;
      } else if (type === "select") {
        control = document.createElement("select");
        this._fillSelect(control, field.options);
      } else if (type === "combo") {
        combo = new Combo(field, controlId, () => emitChange());
        control = combo.input;
      } else if (GROUPS.has(type)) {
        control = document.createElement("fieldset");
        control.setAttribute("role", type === "radio" ? "radiogroup" : "group");
        control.setAttribute("aria-labelledby", `${controlId}_label`);
        if (field.required && type === "radio") control.setAttribute("aria-required", "true");
        if (field.inline) control.dataset.inline = "true";
      } else if (BOOLEAN.has(type)) {
        control = document.createElement("input");
        control.type = "checkbox";
        if (type === "toggle") control.setAttribute("role", "switch");
      } else {
        control = document.createElement("input");
        control.type = TEXTUAL.has(type) || DATELIKE.has(type) || type === "color" || type === "range"
          ? type
          : "text";
      }
      if (BOUNDED.has(type) && !slider) {
        if (field.min != null) control.min = String(field.min);
        if (field.max != null) control.max = String(field.max);
        if (field.step != null) control.step = String(field.step);
      }

      control.id = controlId;
      control.className =
        slider ? "wapyt-form-slider"
        : type === "range" ? "wapyt-form-range-input"
        : GROUPS.has(type) ? "wapyt-form-group"
        : type === "toggle" ? "wapyt-form-control wapyt-form-toggle"
        : type === "combo" ? "wapyt-form-combo-input"
        : "wapyt-form-control";
      if (!slider) {
        if (!GROUPS.has(type)) control.name = field.id;
        if (field.placeholder) control.placeholder = field.placeholder;
        if (field.autocomplete) control.autocomplete = field.autocomplete;
        if (field.disabled) control.disabled = true;
        if (field.readonly && "readOnly" in control) control.readOnly = true;
      }

      const entry = { field, el: control, type, name: controlId, combo, slider };
      if (GROUPS.has(type)) {
        this._fillGroup(entry, field.options);
      } else if (type === "range") {
        entry.output = document.createElement("output");
        entry.output.className = "wapyt-form-range-value";
        entry.output.htmlFor = controlId;
        entry.output.hidden = field.showValue === false;
        // Reserve the widest readout up front: as a flex sibling, a readout
        // that grew with its text ("0 – 500" to "150 – 500") would shrink the
        // track under the pointer mid-drag.
        const bounds = rangeBounds(field);
        const decimals = stepDecimals(bounds.step);
        const widest = Math.max(...[bounds.min, bounds.max].map((n) => n.toFixed(decimals).length));
        entry.output.style.minWidth = `${slider ? widest * 2 + 3 : widest}ch`;
      }
      this._writeControl(entry, field.value);

      // A group has no single control to point a <label for> at, so its
      // caption is a plain element the fieldset names through aria-labelledby.
      // A two-thumb slider is a group too: the label names it, and a click on
      // the label focuses the low thumb.
      const plainLabel = GROUPS.has(type) || slider;
      const label = document.createElement(plainLabel ? "div" : "label");
      label.className = "wapyt-form-label";
      label.id = `${controlId}_label`;
      if (!plainLabel) label.htmlFor = controlId;
      if (slider) label.addEventListener("click", () => slider.focus());
      label.textContent = field.label || field.id;
      // Hidden from sight, never from assistive technology.
      if (field.hiddenLabel) label.classList.add("wapyt-form-label-hidden");
      if (field.required) {
        const mark = document.createElement("span");
        mark.className = "wapyt-form-required";
        mark.textContent = "*";
        mark.setAttribute("aria-hidden", "true");
        label.appendChild(mark);
      }

      const error = document.createElement("div");
      error.className = "wapyt-form-error";
      error.hidden = true;

      if (BOOLEAN.has(type) && !left) {
        row.dataset.inline = "true";
        row.appendChild(control);
        row.appendChild(label);
      } else if (BOOLEAN.has(type)) {
        // Left labels: the caption in the label column, the box under the
        // other controls.
        row.appendChild(label);
        row.appendChild(control);
      } else if (combo) {
        row.appendChild(label);
        row.appendChild(combo.root);
      } else if (type === "range") {
        const wrap = document.createElement("div");
        wrap.className = "wapyt-form-range";
        const scale = buildTicks(field);
        if (scale) {
          // The slider and its scale stack in one column beside the readout.
          const column = document.createElement("div");
          column.className = "wapyt-form-range-track";
          column.appendChild(control);
          column.appendChild(scale);
          wrap.appendChild(column);
          wrap.dataset.ticks = "true";
        } else {
          wrap.appendChild(control);
        }
        wrap.appendChild(entry.output);
        row.appendChild(label);
        row.appendChild(wrap);
      } else {
        row.appendChild(label);
        row.appendChild(control);
      }

      if (field.help) {
        const help = document.createElement("div");
        help.className = "wapyt-form-help";
        help.textContent = field.help;
        row.appendChild(help);
      }
      row.appendChild(error);

      const emitChange = () => {
        this._syncOutput(entry);
        this.clearError(field.id);
        this._emit("change", { id: field.id, value: this._readControl(field.id) });
      };
      // Group inputs bubble their change events up to the fieldset.
      // A combo reports its own picks; its typing is only a filter.
      const discrete = type === "select" || BOOLEAN.has(type) || GROUPS.has(type);
      if (!combo && !slider) control.addEventListener(discrete ? "change" : "input", emitChange);

      this._controls.set(field.id, entry);
      this._errorEls.set(field.id, error);
      this._rows.set(field.id, row);
      return row;
    }

    // ── Values ───────────────────────────────────────────────────────────────

    _fillSelect(select, options) {
      select.innerHTML = "";
      optionPairs(options).forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
      });
    }

    _fillGroup(entry, options) {
      const group = entry.el;
      group.innerHTML = "";
      optionPairs(options).forEach(({ value, label }) => {
        const wrap = document.createElement("label");
        wrap.className = "wapyt-form-option";
        const input = document.createElement("input");
        input.type = entry.type === "radio" ? "radio" : "checkbox";
        // The per-instance id keeps two forms' radio sets from sharing a name.
        input.name = entry.name;
        input.value = value;
        const text = document.createElement("span");
        text.textContent = label;
        wrap.appendChild(input);
        wrap.appendChild(text);
        group.appendChild(wrap);
      });
    }

    _groupInputs(entry) {
      return Array.from(entry.el.querySelectorAll("input"));
    }

    _readControl(id) {
      const entry = this._controls.get(id);
      if (!entry) return null;
      const { type, el } = entry;
      if (BOOLEAN.has(type)) {
        return el.checked;
      }
      if (entry.combo) {
        return entry.combo.getValue();
      }
      if (entry.slider) {
        return entry.slider.getValue();
      }
      if (type === "radio") {
        const picked = this._groupInputs(entry).find((input) => input.checked);
        return picked ? picked.value : null;
      }
      if (type === "checkbox_group") {
        return this._groupInputs(entry).filter((input) => input.checked).map((input) => input.value);
      }
      const raw = el.value;
      if (type === "number" || type === "range") {
        if (raw === "" || raw == null) return null;
        const parsed = Number(raw);
        return Number.isNaN(parsed) ? raw : parsed;
      }
      if (DATELIKE.has(type)) {
        return raw === "" ? null : raw;
      }
      return raw;
    }

    _writeControl(entry, value) {
      const { type, el } = entry;
      if (BOOLEAN.has(type)) {
        el.checked = Boolean(value);
      } else if (entry.combo) {
        entry.combo.setValue(value);
      } else if (entry.slider) {
        entry.slider.setValue(value);
      } else if (type === "radio") {
        this._groupInputs(entry).forEach((input) => {
          input.checked = value != null && input.value === String(value);
        });
      } else if (type === "checkbox_group") {
        const list = Array.isArray(value) ? value : value == null ? [] : [value];
        const wanted = new Set(list.map(String));
        this._groupInputs(entry).forEach((input) => {
          input.checked = wanted.has(input.value);
        });
      } else if (type === "range" && value == null) {
        // An unset range sits at the midpoint of its own min and max. Left to
        // the browser it took the midpoint of 0-100 before min/max were set,
        // so min=0, max=20 started at 20, not 10.
        el.value = String(this._rangeMidpoint(entry.field));
      } else {
        el.value = value == null ? "" : String(value);
      }
      this._syncOutput(entry);
    }

    _syncOutput(entry) {
      if (!entry.output) return;
      entry.output.textContent = entry.slider ? entry.slider.text() : entry.el.value;
    }

    _focusEntry(entry) {
      if (entry.slider) {
        entry.slider.focus();
        return;
      }
      if (!GROUPS.has(entry.type)) {
        entry.el.focus();
        return;
      }
      const inputs = this._groupInputs(entry).filter((input) => !input.disabled);
      const target = inputs.find((input) => input.checked) || inputs[0];
      if (target) target.focus();
    }

    getValues() {
      const out = {};
      this._controls.forEach((entry, id) => {
        out[id] = this._readControl(id);
      });
      return out;
    }

    // Empty every field, or (reset) put back the values the form was built
    // with. Both are silent, like setValues: no "change" events.
    clear(opts = {}) {
      const { values = true, errors = true } = opts || {};
      if (values) this._controls.forEach((entry) => this._writeControl(entry, this._emptyValue(entry)));
      if (errors) this.clearErrors();
    }

    reset() {
      this._controls.forEach((entry) => {
        const initial = entry.field.value;
        this._writeControl(entry, initial === undefined || initial === null ? this._defaultValue(entry) : initial);
      });
      this.clearErrors();
    }

    // What "empty" means per control. Native range and colour inputs cannot
    // be blank, so they go to their minimum and to black; a select ends up
    // with nothing chosen (it reads back as "").
    _emptyValue(entry) {
      const { type, field } = entry;
      if (BOOLEAN.has(type)) return false;
      if (type === "checkbox_group") return [];
      if (entry.slider) return [null, null];
      if (type === "range") return field.min != null ? field.min : 0;
      if (type === "color") return "#000000";
      return null;
    }

    _rangeMidpoint(field) {
      const min = field.min != null ? Number(field.min) : 0;
      const max = field.max != null ? Number(field.max) : 100;
      return min + (max - min) / 2;
    }

    // A field configured without a value goes back to how a fresh form shows
    // it: a range at its midpoint, a select with nothing chosen, the rest empty.
    _defaultValue(entry) {
      if (entry.slider) return [null, null];
      if (entry.type === "range") return this._rangeMidpoint(entry.field);
      return this._emptyValue(entry);
    }

    setValues(values) {
      if (!values) return;
      Object.keys(values).forEach((id) => {
        const entry = this._controls.get(id);
        if (entry) this._writeControl(entry, values[id]);
      });
    }

    setFieldOptions(id, options) {
      const entry = this._controls.get(id);
      if (!entry) return;
      if (entry.type === "select") {
        const previous = entry.el.value;
        this._fillSelect(entry.el, options);
        entry.el.value = previous;
      } else if (entry.combo) {
        entry.combo.setOptions(options);
      } else if (GROUPS.has(entry.type)) {
        // Whatever is still offered stays selected.
        const previous = this._readControl(id);
        this._fillGroup(entry, options);
        this._writeControl(entry, previous);
      }
    }

    // ── Visibility / state ───────────────────────────────────────────────────

    // Buttons in the action row have no row of their own: they hide alone.
    _setHidden(id, hidden) {
      const row = this._rows.get(id);
      if (row) {
        row.hidden = hidden;
        return;
      }
      const button = this._button(id);
      if (button) button.el.hidden = hidden;
    }

    showField(id) {
      this._setHidden(id, false);
    }

    hideField(id) {
      this._setHidden(id, true);
    }

    setFieldDisabled(id, disabled) {
      const button = this._button(id);
      if (button) {
        button.disabled = Boolean(disabled);
        this._syncButton(button);
        return;
      }
      const entry = this._controls.get(id);
      if (!entry) return;
      if (entry.slider) entry.slider.setDisabled(disabled);
      else entry.el.disabled = Boolean(disabled);
    }

    setBusy(busy) {
      this._busy = Boolean(busy);
      this._host.dataset.busy = this._busy ? "true" : "false";
      if (this._submitBtn) this._submitBtn.disabled = this._busy;
      if (this._cancelBtn) this._cancelBtn.disabled = this._busy;
      if (this._buttons) this._buttons.forEach((entry) => this._syncButton(entry));
    }

    focusFirst() {
      for (const [, entry] of this._controls) {
        const disabled = entry.slider ? entry.slider.disabled : entry.el.disabled;
        if (!disabled && entry.type !== "hidden") {
          this._focusEntry(entry);
          return;
        }
      }
    }

    // ── Errors ───────────────────────────────────────────────────────────────

    setError(id, message) {
      if (id == null) {
        this._formError.textContent = message || "";
        this._formError.hidden = !message;
        return;
      }
      const error = this._errorEls.get(id);
      const entry = this._controls.get(id);
      if (error) {
        error.textContent = message || "";
        error.hidden = !message;
      }
      if (entry) {
        entry.el.setAttribute("aria-invalid", message ? "true" : "false");
      }
    }

    setErrors(map) {
      this.clearErrors();
      Object.keys(map || {}).forEach((id) => this.setError(id, map[id]));
    }

    clearError(id) {
      this.setError(id, "");
    }

    clearErrors() {
      this._controls.forEach((_entry, id) => this.clearError(id));
      this.setError(null, "");
    }

    validate() {
      const errors = {};
      this._controls.forEach((entry, id) => {
        const { field, type } = entry;
        const value = this._readControl(id);
        const empty = BOOLEAN.has(type)
          ? false
          : Array.isArray(value)
            ? value.length === 0
            : value == null || String(value).trim() === "";

        if (field.required && empty) {
          errors[id] = field.requiredMessage || `${field.label || id} is required`;
          return;
        }
        if (empty) return;
        // The control already carries min/max, so its own validity flags do
        // the comparison for numbers, dates and times alike.
        if (BOUNDED.has(type) && entry.el.validity) {
          const later = DATELIKE.has(type);
          if (entry.el.validity.rangeUnderflow) {
            errors[id] = field.rangeMessage ||
              (later ? `Must be ${field.min} or later` : `Must be at least ${field.min}`);
            return;
          }
          if (entry.el.validity.rangeOverflow) {
            errors[id] = field.rangeMessage ||
              (later ? `Must be ${field.max} or earlier` : `Must be at most ${field.max}`);
            return;
          }
        }
        if (Array.isArray(value)) return;
        if (field.minLength && String(value).length < field.minLength) {
          errors[id] =
            field.minLengthMessage ||
            `Must be at least ${field.minLength} characters`;
          return;
        }
        if (field.pattern) {
          let re;
          try {
            re = new RegExp(field.pattern);
          } catch (error) {
            re = null;
          }
          if (re && !re.test(String(value))) {
            errors[id] = field.patternMessage || "Invalid value";
            return;
          }
        }
        if (field.matches && this._controls.has(field.matches)) {
          if (String(value) !== String(this._readControl(field.matches))) {
            errors[id] = field.matchesMessage || "Values do not match";
          }
        }
      });
      this.setErrors(errors);
      return errors;
    }

    submit() {
      if (this._busy) return;
      const errors = this.validate();
      if (Object.keys(errors).length) {
        this._focusInvalid(errors);
        this._emit("invalid", { errors });
        return;
      }
      this._emit("submit", this.getValues());
    }

    _focusInvalid(errors) {
      const entry = this._controls.get(Object.keys(errors)[0]);
      if (entry) this._focusEntry(entry);
    }

    // ── Events ───────────────────────────────────────────────────────────────

    on(event, handler) {
      if (!this._events[event]) {
        this._events[event] = new Set();
      }
      this._events[event].add(handler);
    }

    off(event, handler) {
      if (this._events[event]) {
        this._events[event].delete(handler);
      }
    }

    _emit(event, payload) {
      const listeners = this._events[event];
      if (!listeners) return;
      listeners.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] Form listener failed", error);
        }
      });
    }
  }

  globalThis.wapyt.Form = Form;
})();
