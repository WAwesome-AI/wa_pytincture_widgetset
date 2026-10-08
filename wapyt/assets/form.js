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
  // Kinds that can show an icon inside the field.
  const ICONABLE = new Set([...TEXTUAL, ...DATELIKE, "select"]);

  function optionPairs(options) {
    return (options || []).map((option) =>
      option && typeof option === "object"
        ? {
            value: String(option.value ?? ""),
            label: String(option.label ?? option.value ?? ""),
            disabled: Boolean(option.disabled),
            icon: option.icon || null,
          }
        : { value: String(option ?? ""), label: String(option ?? ""), disabled: false, icon: null }
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
        if (this.input.matches(":disabled") || event.target.closest(".wapyt-form-combo-chip-remove")) return;
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
      if (this.isOpen() || this.input.matches(":disabled") || this.input.readOnly) return;
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
        if (option.disabled) item.setAttribute("aria-disabled", "true");
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
      this._setActive(needle ? 0 : Math.max(current, 0), 1);
      this._place();
    }

    // Moves the active option to `index`, or on past disabled options in
    // direction `dir`; stays put when nothing enabled lies that way.
    _setActive(index, dir = 1) {
      const items = this.list.querySelectorAll("[data-index]");
      let next = items.length ? Math.max(0, Math.min(index, items.length - 1)) : -1;
      while (next >= 0 && next < items.length && this.visible[next].disabled) next += dir;
      if (next < 0 || next >= items.length) {
        if (this.active >= 0 && this.active < items.length && !this.visible[this.active].disabled) return;
        next = this.visible.findIndex((option) => !option.disabled);
        if (next < 0) next = -1;
      }
      items.forEach((item) => item.removeAttribute("data-active"));
      this.active = next;
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
        const dir = key === "ArrowDown" ? 1 : -1;
        this._setActive(this.active + dir, dir);
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
      if (!option || option.disabled) return;
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
        // Keep focus in the input: a focused × is removed with its chip,
        // which dropped focus to <body> (a spurious blur) before it came back.
        remove.addEventListener("mousedown", (event) => event.preventDefault());
        remove.addEventListener("click", () => {
          if (this.input.matches(":disabled") || this.input.readOnly) return;
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
  function humanSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = n / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }

  // `accept` like the native attribute: ".csv", "text/plain", "image/*".
  function acceptsFile(accept, file) {
    if (!accept) return true;
    const name = String(file.name || "").toLowerCase();
    const mime = String(file.type || "").toLowerCase();
    return accept.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).some((token) => {
      if (token.startsWith(".")) return name.endsWith(token);
      if (token.endsWith("/*")) return mime.startsWith(token.slice(0, -1));
      return mime === token;
    });
  }

  // type="file" (a drop zone, a Choose button and a list of picked files)
  // and type="avatar" (a round picture button). Files stay in the browser:
  // get_values reports {name, size, type}, getFiles() hands over the File
  // objects (for filetransfer.adopt / upload). Rules (accept, max_size,
  // max_files) are applied as files arrive; rejected ones are reported, not
  // added. Names reach the DOM as text.
  class FilePicker {
    constructor(field, controlId, onChange, report) {
      this.avatar = field.type === "avatar";
      this.multiple = !this.avatar && Boolean(field.multiple);
      this.accept = field.accept || (this.avatar ? "image/*" : "");
      this.maxSize = Number(field.maxSize) || 0;
      this.maxFiles = this.multiple ? Number(field.maxFiles) || 0 : 1;
      this.files = []; // {file, meta}
      this.url = null; // avatar: the current picture's URL, set by the app
      this.onChange = onChange;
      this.report = report;

      this.input = document.createElement("input");
      this.input.type = "file";
      this.input.hidden = true;
      this.input.tabIndex = -1;
      if (this.accept) this.input.accept = this.accept;
      this.input.multiple = this.multiple;
      this.input.addEventListener("change", () => {
        this._add(this.input.files);
        this.input.value = "";
      });

      this.root = document.createElement("div");
      this.root.className = this.avatar ? "wapyt-form-avatar" : "wapyt-form-file";
      this.root.appendChild(this.input);

      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.id = controlId;
      this.button.addEventListener("click", () => {
        if (!this.isDisabled()) this.input.click();
      });

      if (this.avatar) {
        this.button.className = "wapyt-form-avatar-button";
        this.img = document.createElement("img");
        this.img.alt = "";
        this.img.hidden = true;
        this.placeholder = document.createElement("i");
        this.placeholder.className = `wapyt-form-avatar-placeholder ${iconClass("mdi-account")}`;
        this.placeholder.setAttribute("aria-hidden", "true");
        this.button.appendChild(this.img);
        this.button.appendChild(this.placeholder);
        this.root.appendChild(this.button);
        this.removeBtn = document.createElement("button");
        this.removeBtn.type = "button";
        this.removeBtn.className = "wapyt-form-button wapyt-form-button-link wapyt-form-avatar-remove";
        this.removeBtn.textContent = "Remove";
        this.removeBtn.addEventListener("click", () => {
          if (this.isDisabled()) return;
          this.files = [];
          this.url = null;
          this._render();
          this.onChange();
          this.button.focus();
        });
        this.root.appendChild(this.removeBtn);
        this.dropTarget = this.button;
      } else {
        this.zone = document.createElement("div");
        this.zone.className = "wapyt-form-file-zone";
        const icon = document.createElement("i");
        icon.className = `wapyt-form-file-icon ${iconClass("mdi-tray-arrow-up")}`;
        icon.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "wapyt-form-file-text";
        text.textContent = field.placeholder || (this.multiple ? "Drop files here or" : "Drop a file here or");
        this.button.className = "wapyt-form-button wapyt-form-button-ghost wapyt-form-file-choose";
        this.button.textContent = this.multiple ? "Choose files" : "Choose a file";
        this.zone.appendChild(icon);
        this.zone.appendChild(text);
        this.zone.appendChild(this.button);
        this.root.appendChild(this.zone);
        this.list = document.createElement("ul");
        this.list.className = "wapyt-form-file-list";
        this.root.appendChild(this.list);
        this.dropTarget = this.zone;
      }

      this.dropTarget.addEventListener("dragover", (event) => {
        if (this.isDisabled()) return;
        event.preventDefault();
        this.dropTarget.dataset.drag = "true";
      });
      this.dropTarget.addEventListener("dragleave", () => delete this.dropTarget.dataset.drag);
      this.dropTarget.addEventListener("drop", (event) => {
        delete this.dropTarget.dataset.drag;
        if (this.isDisabled()) return;
        event.preventDefault();
        this._add(event.dataTransfer && event.dataTransfer.files);
      });
      this._render();
    }

    isDisabled() {
      return this.button.matches(":disabled");
    }

    _add(fileList) {
      if (this.isDisabled()) return;
      const problems = [];
      let ok = [];
      Array.from(fileList || []).forEach((file) => {
        if (!acceptsFile(this.accept, file)) problems.push(`${file.name}: not an accepted file type`);
        else if (this.maxSize && file.size > this.maxSize) problems.push(`${file.name}: larger than ${humanSize(this.maxSize)}`);
        else ok.push(file);
      });
      if (this.multiple) {
        const known = new Set(this.files.map(({ file }) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`));
        ok = ok.filter((file) => !known.has(`${file.name}\u0000${file.size}\u0000${file.lastModified}`));
        const room = this.maxFiles ? Math.max(0, this.maxFiles - this.files.length) : Infinity;
        if (ok.length > room) {
          problems.push(`At most ${this.maxFiles} files`);
          ok = ok.slice(0, room);
        }
      } else {
        ok = ok.slice(0, 1);
      }
      const entries = ok.map((file) => ({ file, meta: { name: file.name, size: file.size, type: file.type || "" } }));
      if (entries.length) {
        this.files = this.multiple ? this.files.concat(entries) : entries;
        if (this.avatar) {
          this.url = null;
          this._preview(entries[0].file);
        }
        this._render();
        this.onChange();
      }
      if (problems.length) this.report(problems.join("\n"));
    }

    // The CSP allows data: images but not blob:, so the preview is read as
    // a data URL rather than URL.createObjectURL.
    _preview(file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (this.files.length && this.files[0].file === file) {
          this.img.src = String(reader.result || "");
          this.img.hidden = false;
          this.placeholder.hidden = true;
        }
      };
      reader.readAsDataURL(file);
    }

    _render() {
      if (this.avatar) {
        const has = Boolean(this.url) || this.files.length > 0;
        if (this.url) {
          this.img.src = this.url;
          this.img.hidden = false;
        } else if (!this.files.length) {
          this.img.removeAttribute("src");
          this.img.hidden = true;
        }
        this.placeholder.hidden = !this.img.hidden;
        this.removeBtn.hidden = !has;
        this.root.dataset.empty = has ? "false" : "true";
        return;
      }
      this.list.textContent = "";
      this.files.forEach(({ file, meta }, index) => {
        const item = document.createElement("li");
        item.className = "wapyt-form-file-item";
        const name = document.createElement("span");
        name.className = "wapyt-form-file-name";
        name.textContent = meta.name;
        const size = document.createElement("span");
        size.className = "wapyt-form-file-size";
        size.textContent = humanSize(meta.size);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "wapyt-form-file-remove";
        remove.setAttribute("aria-label", `Remove ${meta.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          if (this.isDisabled()) return;
          this.files = this.files.filter((entry) => entry.file !== file);
          this._render();
          this.onChange();
          const next = this.list.querySelectorAll(".wapyt-form-file-remove")[Math.min(index, this.files.length - 1)];
          (next || this.button).focus();
        });
        item.appendChild(name);
        item.appendChild(size);
        item.appendChild(remove);
        this.list.appendChild(item);
      });
      this.list.hidden = !this.files.length;
    }

    getValue() {
      if (this.avatar) return this.files.length ? Object.assign({}, this.files[0].meta) : this.url;
      return this.files.map(({ meta }) => Object.assign({}, meta));
    }

    // Files cannot be put into a picker from code: an empty value clears it,
    // and an avatar also takes the URL of an existing picture.
    setValue(value) {
      if (this.avatar && typeof value === "string" && value) {
        this.files = [];
        this.url = value;
      } else if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
        this.files = [];
        this.url = null;
      }
      this._render();
    }

    getFiles() {
      return this.files.map(({ file }) => file);
    }
  }

  // type="toggle_group": segmented buttons in a borderless <fieldset> (so
  // disabling it, its fieldset or the form disables them natively). One
  // choice is a WAI-ARIA radio group (arrows move and select, one tab stop);
  // multiple=True makes toggle buttons (aria-pressed; arrows move, Space or
  // Enter toggles). Labels are text; icons are classes.
  class ToggleGroup {
    constructor(field, controlId, onChange) {
      this.multiple = Boolean(field.multiple);
      this.onChange = onChange;
      this.selected = [];
      this.options = [];
      this.root = document.createElement("fieldset");
      this.root.setAttribute("role", this.multiple ? "group" : "radiogroup");
      this.root.setAttribute("aria-labelledby", `${controlId}_label`);
      this.root.addEventListener("click", (event) => {
        const button = event.target.closest(".wapyt-form-segment");
        if (button && !button.disabled) this._activate(button.dataset.value);
      });
      this.root.addEventListener("keydown", (event) => this._onKey(event));
      this.setOptions(field.options);
    }

    _buttons() {
      return Array.from(this.root.querySelectorAll(".wapyt-form-segment"));
    }

    _activate(value) {
      let next;
      if (this.multiple) {
        next = this.selected.includes(value) ? this.selected.filter((v) => v !== value) : [...this.selected, value];
      } else {
        if (this.selected[0] === value) return;
        next = [value];
      }
      this.selected = next;
      this._sync();
      this.onChange();
    }

    _onKey(event) {
      const buttons = this._buttons().filter((b) => !b.disabled);
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let target = null;
      if (event.key in keys) target = buttons[(index + keys[event.key] + buttons.length) % buttons.length];
      else if (event.key === "Home") target = buttons[0];
      else if (event.key === "End") target = buttons[buttons.length - 1];
      if (!target) return;
      event.preventDefault();
      this._buttons().forEach((b) => { b.tabIndex = b === target ? 0 : -1; });
      target.focus();
      // A radio group selects as focus moves, like native radios.
      if (!this.multiple) this._activate(target.dataset.value);
    }

    setOptions(options) {
      const previous = this.selected;
      this.options = optionPairs(options);
      const known = new Set(this.options.map((o) => o.value));
      this.selected = previous.filter((v) => known.has(v));
      this.root.textContent = "";
      this.options.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wapyt-form-segment";
        button.dataset.value = option.value;
        button.disabled = option.disabled;
        if (!this.multiple) button.setAttribute("role", "radio");
        if (option.icon) {
          const icon = document.createElement("i");
          icon.className = `wapyt-form-segment-icon ${iconClass(option.icon)}`;
          icon.setAttribute("aria-hidden", "true");
          button.appendChild(icon);
        }
        const text = document.createElement("span");
        text.textContent = option.label;
        button.appendChild(text);
        this.root.appendChild(button);
      });
      this._sync();
    }

    _sync() {
      const buttons = this._buttons();
      buttons.forEach((button) => {
        const on = this.selected.includes(button.dataset.value);
        button.setAttribute(this.multiple ? "aria-pressed" : "aria-checked", on ? "true" : "false");
      });
      // One tab stop: the (first) selected option, else the first enabled.
      const enabled = buttons.filter((b) => !b.disabled);
      const stop = enabled.find((b) => this.selected.includes(b.dataset.value)) || enabled[0];
      buttons.forEach((b) => { b.tabIndex = b === stop ? 0 : -1; });
    }

    getValue() {
      return this.multiple ? this.selected.slice() : this.selected.length ? this.selected[0] : null;
    }

    setValue(value) {
      const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
      const known = new Set(this.options.map((o) => o.value));
      const kept = list.map(String).filter((v) => known.has(v));
      this.selected = this.multiple ? Array.from(new Set(kept)) : kept.slice(0, 1);
      this._sync();
    }

    focus() {
      const stop = this._buttons().find((b) => b.tabIndex === 0);
      if (stop) stop.focus();
    }
  }

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
        else thumb.removeAttribute("aria-readonly");
      });
      if (this.disabled && this.drag) this._endDrag();
    }

    focus() {
      if (!this.disabled) this.thumbs[0].focus();
    }
  }

  // Messages that blur validation shows (validate_field from on_blur) wait
  // while a pointer is held down: pressing a button blurs the field first,
  // and a new message line pushed the button down before the release, so
  // the click never happened. Updates queued here run after the release, by
  // which time the click has been dispatched (same task as pointerup).
  let pointerHeld = false;
  const afterRelease = [];
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", () => { pointerHeld = true; }, true);
    const release = () => {
      if (!pointerHeld) return;
      pointerHeld = false;
      setTimeout(() => afterRelease.splice(0).forEach((fn) => fn()), 0);
    };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
  }

  function whenPointerFree(fn) {
    if (pointerHeld) afterRelease.push(fn);
    else fn();
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

  // What get_properties reports for a field (camelCase, as in the config).
  const PROPERTY_KEYS = [
    "label", "placeholder", "help", "icon", "required", "readonly", "min", "max", "step",
    "minLength", "maxLength", "pattern", "matches", "options",
    "requiredMessage", "minLengthMessage", "maxLengthMessage", "patternMessage",
    "matchesMessage", "rangeMessage", "successMessage",
  ];

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
      this._fieldsets = new Map(); // id -> fieldset element

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
      this._formEl.addEventListener("focusin", (event) => this._onFocusIn(event));
      this._formEl.addEventListener("focusout", (event) => this._onFocusOut(event));
      this._formEl.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submit();
      });

      // Everything sits in one fieldset so disable() can disable every
      // native control at once. display: contents keeps the rows as items of
      // the form's grid.
      this._frame = document.createElement("fieldset");
      this._frame.className = "wapyt-form-frame";
      this._formEl.appendChild(this._frame);

      (this.options.fields || []).forEach((field) => {
        const item = this._createItem(field, null);
        if (item) this._frame.appendChild(item);
      });

      this._formError = document.createElement("div");
      this._formError.className = "wapyt-form-error wapyt-form-error-global";
      this._formError.hidden = true;
      this._frame.appendChild(this._formError);

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

      this._frame.appendChild(this._actions);
      this._host.appendChild(this._formEl);
      if (this.options.disabled) this._frame.disabled = true;
      if (this.options.hidden) this._formEl.hidden = true;
      this.setBusy(Boolean(this.options.busy));
      this._syncSliders();
      this._watchNarrow();
    }

    // ── Label position ───────────────────────────────────────────────────────

    _labelPosition(field, inherited) {
      const position = (field && field.labelPosition) || inherited || this.options.labelPosition;
      return position === "left" ? "left" : "top";
    }

    // ── Layout items: fields, buttons, fieldsets, spacers ────────────────────

    _createItem(spec, inherited) {
      if (!spec) return null;
      if (spec.type === "fieldset") return this._createFieldset(spec, inherited);
      if (spec.type === "spacer") return this._createSpacer(spec);
      if (spec.type === "button") return this._createButtonRow(spec, inherited);
      return this._createRow(spec, inherited);
    }

    // A titled, bordered group with its own grid. Hiding or disabling it acts
    // on everything inside (a disabled <fieldset> disables its native
    // controls; sliders are synced by hand). Its fields stay flat in
    // get_values. label_position / label_width set here apply to its fields.
    _createFieldset(spec, inherited) {
      const el = document.createElement("fieldset");
      el.className = "wapyt-form-fieldset";
      if (spec.id) el.dataset.fieldsetId = String(spec.id);
      if (spec.span) el.dataset.span = String(spec.span);
      const width = cssLength(spec.labelWidth);
      if (width) el.style.setProperty("--wapyt-form-label-width", width);
      if (spec.label) {
        const legend = document.createElement("legend");
        legend.className = "wapyt-form-legend";
        legend.textContent = String(spec.label);
        el.appendChild(legend);
      }
      const body = document.createElement("div");
      body.className = "wapyt-form-fieldset-body";
      if (Number(spec.columns) > 1) body.dataset.columns = String(spec.columns);
      const position = spec.labelPosition || inherited;
      (spec.fields || []).forEach((child) => {
        const item = this._createItem(child, position);
        if (item) body.appendChild(item);
      });
      el.appendChild(body);
      if (spec.hidden) el.hidden = true;
      if (spec.disabled) el.disabled = true;
      if (spec.id) {
        this._fieldsets.set(String(spec.id), el);
        this._rows.set(String(spec.id), el);
      }
      return el;
    }

    _createSpacer(spec) {
      const el = document.createElement("div");
      el.className = "wapyt-form-spacer";
      el.setAttribute("aria-hidden", "true");
      if (spec.span) el.dataset.span = String(spec.span);
      const height = cssLength(spec.height);
      if (height) el.style.height = height;
      if (spec.hidden) el.hidden = true;
      if (spec.id) this._rows.set(String(spec.id), el);
      return el;
    }

    // Whether a field is out of reach: disabled (itself or by a disabled
    // fieldset) or not shown (itself or an ancestor inside this form is
    // hidden). Such fields are not validated, like the browser's own forms
    // skip disabled controls; they still appear in get_values.
    _isInactive(entry) {
      if (entry.type === "hidden" || entry.type === "static") return true;
      if (entry.slider) {
        if (entry.slider.disabled) return true;
      } else if (entry.el.matches(":disabled")) {
        return true;
      }
      for (let node = this._rows.get(entry.field.id); node && node !== this._formEl; node = node.parentElement) {
        if (node.hidden) return true;
      }
      return false;
    }

    // A slider is not a native control, so a disabled fieldset cannot disable
    // it: its state is its own setting or any disabled fieldset around it.
    _syncSliders() {
      this._controls.forEach((entry) => {
        if (!entry.slider) return;
        const inherited = Boolean(entry.slider.root.closest("fieldset.wapyt-form-fieldset:disabled, fieldset.wapyt-form-frame:disabled"));
        entry.slider.setDisabled(Boolean(entry.selfDisabled) || inherited);
      });
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

    _createButtonRow(spec, inherited) {
      if (!spec.id) return null;
      const row = document.createElement("div");
      row.className = "wapyt-form-row";
      row.dataset.fieldId = String(spec.id);
      row.dataset.kind = "button";
      if (spec.span) row.dataset.span = String(spec.span);
      if (this._labelPosition(spec, inherited) === "left") row.dataset.labelPosition = "left";
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
      const busy = (this._busy || this._checking) && entry.spec.submit;
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
      if (this._busy || this._checking) return;
      const errors = this.validate();
      if (Object.keys(errors).length) {
        this._focusInvalid(errors);
        this._emit("invalid", { errors, id });
        return;
      }
      this._afterPending(() => this._emit("click", { id, values: this.getValues() }), { id });
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

    _createRow(field, inherited) {
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
      const left = this._labelPosition(field, inherited) === "left";
      if (left) row.dataset.labelPosition = "left";
      const fieldLabelWidth = cssLength(field.labelWidth);
      if (fieldLabelWidth) row.style.setProperty("--wapyt-form-label-width", fieldLabelWidth);
      row.dataset.kind =
        BOOLEAN.has(type) ? "boolean"
        : type === "avatar" ? "avatar"
        : type === "toggle_group" ? "toggles"
        : GROUPS.has(type) ? "group"
        : type === "range" ? "range"
        : "control";

      const controlId = `wapyt_f_${field.id}_${Math.random().toString(16).slice(2, 8)}`;
      let control;
      let combo = null;
      let slider = null;
      let picker = null;
      let toggles = null;

      if (type === "toggle_group") {
        toggles = new ToggleGroup(field, controlId, () => emitChange());
        control = toggles.root;
      } else if (type === "file" || type === "avatar") {
        picker = new FilePicker(field, controlId, () => emitChange(), (message) => this.setError(field.id, message));
        control = picker.button;
      } else if (type === "range" && field.range) {
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
        if (field.inline) control.dataset.inline = "true";
      } else if (type === "static") {
        // A read-only value: an <output>, which a <label for> names, so it
        // is announced with its label but is not a tab stop.
        control = document.createElement("output");
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
        picker ? control.className
        : toggles ? "wapyt-form-togglegroup"
        : slider ? "wapyt-form-slider"
        : type === "range" ? "wapyt-form-range-input"
        : GROUPS.has(type) ? "wapyt-form-group"
        : type === "toggle" ? "wapyt-form-control wapyt-form-toggle"
        : type === "combo" ? "wapyt-form-combo-input"
        : type === "static" ? "wapyt-form-static"
        : "wapyt-form-control";
      if (picker || toggles) {
        if (field.disabled) control.disabled = true;
      } else if (!slider && type !== "static") {
        if (!GROUPS.has(type)) control.name = field.id;
        if (field.placeholder) control.placeholder = field.placeholder;
        if (field.autocomplete) control.autocomplete = field.autocomplete;
        if (field.maxLength != null && "maxLength" in control) control.maxLength = Number(field.maxLength);
        if (field.disabled) control.disabled = true;
        if (field.readonly && "readOnly" in control) control.readOnly = true;
      }

      const entry = { field, el: control, type, name: controlId, combo, slider, picker, toggles, selfDisabled: Boolean(field.disabled) };
      if (GROUPS.has(type)) {
        this._fillGroup(entry, field.options);
      } else if (type === "range") {
        entry.output = document.createElement("output");
        entry.output.className = "wapyt-form-range-value";
        entry.output.htmlFor = controlId;
        entry.output.hidden = field.showValue === false;
        this._sizeOutput(entry);
      }
      this._writeControl(entry, field.value);

      // A group has no single control to point a <label for> at, so its
      // caption is a plain element the fieldset names through aria-labelledby.
      // A two-thumb slider is a group too: the label names it, and a click on
      // the label focuses the low thumb.
      const plainLabel = GROUPS.has(type) || slider || toggles;
      const label = document.createElement(plainLabel ? "div" : "label");
      label.className = "wapyt-form-label";
      label.id = `${controlId}_label`;
      if (!plainLabel) label.htmlFor = controlId;
      if (slider) label.addEventListener("click", () => slider.focus());
      // Hidden from sight, never from assistive technology.
      if (field.hiddenLabel) label.classList.add("wapyt-form-label-hidden");
      entry.labelEl = label;
      entry.row = row;
      this._renderLabel(entry);

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
      } else if (picker) {
        row.appendChild(label);
        row.appendChild(picker.root);
      } else if (combo) {
        row.appendChild(label);
        row.appendChild(combo.root);
        entry.iconHost = combo.root;
      } else if (type === "range") {
        const wrap = document.createElement("div");
        wrap.className = "wapyt-form-range";
        const scale = buildTicks(field);
        entry.scale = scale;
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
        if (ICONABLE.has(type)) entry.iconHost = null; // wrapped on demand
      }

      row.appendChild(error);
      entry.errorEl = error;
      this._renderHelp(entry);
      if (field.icon) this._renderIcon(entry);

      const emitChange = () => {
        this._syncOutput(entry);
        // A new value outdates any async check still running for this field.
        entry.checks = (entry.checks || 0) + 1;
        this._setPending(field.id, false);
        this.clearError(field.id);
        this._emit("change", { id: field.id, value: this._readControl(field.id) });
      };
      // Group inputs bubble their change events up to the fieldset.
      // A combo reports its own picks; its typing is only a filter.
      const discrete = type === "select" || BOOLEAN.has(type) || GROUPS.has(type);
      if (!combo && !slider && !picker && !toggles) control.addEventListener(discrete ? "change" : "input", emitChange);

      this._controls.set(field.id, entry);
      this._errorEls.set(field.id, error);
      this._rows.set(field.id, row);
      return row;
    }

    // ── Properties ───────────────────────────────────────────────────────────

    _renderLabel(entry) {
      const { field, labelEl } = entry;
      labelEl.textContent = field.label || field.id;
      if (field.required) {
        const mark = document.createElement("span");
        mark.className = "wapyt-form-required";
        mark.textContent = "*";
        mark.setAttribute("aria-hidden", "true");
        labelEl.appendChild(mark);
      }
      // aria-required belongs on inputs and radio groups, not on a plain
      // group (checkboxes, toggle buttons), a button (file, avatar) or a
      // static value.
      const target =
        entry.slider || entry.picker || entry.type === "static" || entry.type === "checkbox_group"
        || (entry.toggles && entry.toggles.multiple) ? null : entry.el;
      if (target) {
        if (field.required) target.setAttribute("aria-required", "true");
        else target.removeAttribute("aria-required");
      }
    }

    // The help line sits just above the error slot; it is created, changed
    // or removed as `help` changes.
    // An icon inside the field, on the left. A text-like input or select is
    // wrapped in a positioned box on first use; a combo hosts it in its own
    // box. Other kinds have nowhere sensible to put one.
    _renderIcon(entry) {
      const icon = entry.field.icon;
      if (entry.iconHost === undefined) {
        if (icon) throw new Error(`Field '${entry.field.id}' (${entry.type}) cannot show an icon`);
        return;
      }
      if (!entry.iconHost) {
        if (!icon) return;
        const wrap = document.createElement("div");
        wrap.className = "wapyt-form-input-wrap";
        entry.el.replaceWith(wrap);
        wrap.appendChild(entry.el);
        entry.iconHost = wrap;
      }
      let el = entry.iconHost.querySelector(":scope > .wapyt-form-input-icon");
      if (!icon) {
        if (el) el.remove();
        delete entry.iconHost.dataset.icon;
        return;
      }
      if (!el) {
        el = document.createElement("i");
        el.setAttribute("aria-hidden", "true");
        entry.iconHost.insertBefore(el, entry.iconHost.firstChild);
      }
      el.className = `wapyt-form-input-icon ${iconClass(icon)}`;
      entry.iconHost.dataset.icon = "true";
    }

    _renderHelp(entry) {
      const text = entry.field.help;
      if (!text) {
        if (entry.helpEl) entry.helpEl.remove();
        entry.helpEl = null;
        return;
      }
      if (!entry.helpEl) {
        entry.helpEl = document.createElement("div");
        entry.helpEl.className = "wapyt-form-help";
        entry.row.insertBefore(entry.helpEl, entry.errorEl);
      }
      entry.helpEl.textContent = String(text);
    }

    // Reserve the widest readout up front: as a flex sibling, a readout
    // that grew with its text ("0 – 500" to "150 – 500") would shrink the
    // track under the pointer mid-drag.
    _sizeOutput(entry) {
      if (!entry.output) return;
      const bounds = rangeBounds(entry.field);
      const decimals = stepDecimals(bounds.step);
      const widest = Math.max(...[bounds.min, bounds.max].map((n) => n.toFixed(decimals).length));
      entry.output.style.minWidth = `${entry.slider ? widest * 2 + 3 : widest}ch`;
    }

    // New min / max / step: native controls take the attributes; a two-thumb
    // slider gets new bounds and re-snaps its values; ticks are rebuilt.
    _applyBounds(entry) {
      const { field } = entry;
      if (entry.slider) {
        entry.slider.bounds = rangeBounds(field);
        entry.slider.setValue(entry.slider.getValue());
      } else if (BOUNDED.has(entry.type)) {
        ["min", "max", "step"].forEach((key) => {
          if (field[key] == null || field[key] === "") entry.el.removeAttribute(key);
          else entry.el[key] = String(field[key]);
        });
      }
      if (entry.scale) {
        const scale = buildTicks(field);
        if (scale) entry.scale.replaceWith(scale);
        else entry.scale.remove();
        entry.scale = scale;
      }
      this._sizeOutput(entry);
      this._syncOutput(entry);
    }

    setProperties(id, props) {
      const key = String(id);
      const button = this._button(key);
      if (button) return this._setButtonProperties(button, props || {});
      const entry = this._controls.get(key);
      if (!entry || entry.type === "hidden") throw new Error(`Form has no field '${id}'`);
      const { field, el } = entry;
      let bounds = false;
      Object.keys(props || {}).forEach((name) => {
        const value = props[name];
        switch (name) {
          case "label":
          case "required":
            field[name] = name === "required" ? Boolean(value) : value;
            if (name === "required" && entry.type === "static" && value) {
              throw new Error(`Field '${id}' is static and cannot be required`);
            }
            this._renderLabel(entry);
            break;
          case "help":
            field.help = value;
            this._renderHelp(entry);
            break;
          case "placeholder":
            field.placeholder = value;
            if (entry.type === "static") this._writeControl(entry, entry.value);
            else if ("placeholder" in el) el.placeholder = value == null ? "" : String(value);
            break;
          case "readonly":
            field.readonly = Boolean(value);
            if (entry.slider) {
              entry.slider.readOnly = field.readonly;
              entry.slider.setDisabled(entry.slider.disabled);
            } else if ("readOnly" in el) {
              el.readOnly = field.readonly;
            }
            break;
          case "min":
          case "max":
          case "step":
            field[name] = value;
            bounds = true;
            break;
          case "options":
            this.setFieldOptions(key, value || []);
            field.options = value || [];
            break;
          case "icon":
            field.icon = value;
            this._renderIcon(entry);
            break;
          case "minLength":
          case "maxLength":
          case "pattern":
          case "matches":
          case "requiredMessage":
          case "minLengthMessage":
          case "maxLengthMessage":
          case "patternMessage":
          case "matchesMessage":
          case "rangeMessage":
          case "successMessage":
            // Read by validate() each time; nothing to redraw.
            field[name] = value;
            if (name === "maxLength" && "maxLength" in el) {
              if (value == null) el.removeAttribute("maxlength");
              else el.maxLength = Number(value);
            }
            break;
          default:
            throw new Error(`Form field '${id}': cannot set '${name}'`);
        }
      });
      if (bounds) this._applyBounds(entry);
      return undefined;
    }

    _setButtonProperties(entry, props) {
      Object.keys(props).forEach((name) => {
        const value = props[name];
        if (name === "text") {
          entry.spec.text = value;
          entry.textEl.textContent = value == null ? "" : String(value);
        } else if (name === "tooltip") {
          entry.spec.tooltip = value;
          if (value) entry.el.title = String(value);
          else entry.el.removeAttribute("title");
        } else if (name === "variant") {
          const variant = BUTTON_VARIANTS[value] || "ghost";
          entry.el.classList.remove(...Object.values(BUTTON_VARIANTS).map((v) => `wapyt-form-button-${v}`));
          entry.el.classList.add(`wapyt-form-button-${variant}`);
          entry.spec.variant = value;
        } else if (name === "icon") {
          let icon = entry.el.querySelector(".wapyt-form-button-icon");
          if (!value) {
            if (icon) icon.remove();
          } else {
            if (!icon) {
              icon = document.createElement("i");
              icon.setAttribute("aria-hidden", "true");
              entry.el.insertBefore(icon, entry.el.firstChild);
            }
            icon.className = `wapyt-form-button-icon ${iconClass(value)}`;
          }
          entry.spec.icon = value;
        } else {
          throw new Error(`Form button '${entry.spec.id}': cannot set '${name}'`);
        }
      });
    }

    getProperties(id) {
      const key = String(id);
      const button = this._button(key);
      if (button) {
        const { text, tooltip, variant, icon } = button.spec;
        return { text: text ?? null, tooltip: tooltip ?? null, variant: variant || "default", icon: icon ?? null };
      }
      const entry = this._controls.get(key);
      if (!entry) throw new Error(`Form has no field '${id}'`);
      const out = {};
      PROPERTY_KEYS.forEach((name) => {
        out[name] = entry.field[name] === undefined ? null : entry.field[name];
      });
      out.required = Boolean(entry.field.required);
      out.readonly = Boolean(entry.field.readonly);
      return out;
    }

    // ── Values ───────────────────────────────────────────────────────────────

    _fillSelect(select, options) {
      select.innerHTML = "";
      optionPairs(options).forEach(({ value, label, disabled }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        opt.disabled = disabled;
        select.appendChild(opt);
      });
    }

    _fillGroup(entry, options) {
      const group = entry.el;
      group.innerHTML = "";
      optionPairs(options).forEach(({ value, label, disabled }) => {
        const wrap = document.createElement("label");
        wrap.className = "wapyt-form-option";
        const input = document.createElement("input");
        input.type = entry.type === "radio" ? "radio" : "checkbox";
        input.disabled = disabled;
        if (disabled) wrap.dataset.disabled = "true";
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
      if (type === "static") {
        return entry.value === undefined ? null : entry.value;
      }
      if (entry.picker) {
        return entry.picker.getValue();
      }
      if (entry.toggles) {
        return entry.toggles.getValue();
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
      } else if (entry.picker) {
        entry.picker.setValue(value);
      } else if (entry.toggles) {
        entry.toggles.setValue(value);
      } else if (type === "static") {
        // Kept as given (string, number...) for get_values; shown as text.
        entry.value = value === undefined ? null : value;
        const empty = value == null || value === "";
        el.textContent = empty ? (entry.field.placeholder || "") : String(value);
        if (empty) el.dataset.empty = "true";
        else delete el.dataset.empty;
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
      if (entry.toggles) {
        entry.toggles.focus();
        return;
      }
      if (!GROUPS.has(entry.type)) {
        entry.el.focus();
        return;
      }
      const inputs = this._groupInputs(entry).filter((input) => !input.matches(":disabled"));
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
      if (entry.picker) return null;
      if (entry.toggles) return entry.toggles.multiple ? [] : null;
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
      } else if (entry.toggles) {
        entry.toggles.setOptions(options);
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
      const row = this._rows.get(String(id));
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
      const fieldset = this._fieldsets.get(String(id));
      if (fieldset) {
        fieldset.disabled = Boolean(disabled);
        this._syncSliders();
        return;
      }
      const button = this._button(id);
      if (button) {
        button.disabled = Boolean(disabled);
        this._syncButton(button);
        return;
      }
      const entry = this._controls.get(id);
      if (!entry) return;
      if (entry.slider) {
        entry.selfDisabled = Boolean(disabled);
        this._syncSliders();
      } else {
        entry.el.disabled = Boolean(disabled);
      }
    }

    setBusy(busy) {
      this._busy = Boolean(busy);
      this._host.dataset.busy = this._busy ? "true" : "false";
      if (this._submitBtn) this._submitBtn.disabled = this._busy || Boolean(this._checking);
      if (this._cancelBtn) this._cancelBtn.disabled = this._busy;
      if (this._buttons) this._buttons.forEach((entry) => this._syncButton(entry));
    }

    focusFirst() {
      for (const [, entry] of this._controls) {
        if (!this._isInactive(entry)) {
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
        delete error.dataset.state;
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

    // Runs the checks in order: required, then (for a non-empty value) the
    // built-in bounds / length / pattern / matches checks, then the field's
    // validator. Hidden and disabled fields are skipped. Fields that pass and
    // carry a successMessage show it.
    // Synchronous: async validators are started (their fields show
    // "Checking…" and their results arrive later) but not waited for; their
    // checks are kept in this._pending for validateAsync / submit.
    validate() {
      const errors = {};
      const passed = [];
      const pending = [];
      let snapshot = null;
      const values = () => (snapshot = snapshot || this.getValues());
      this._controls.forEach((entry, id) => {
        const result = this._checkField(entry, values);
        if (result.message) errors[id] = result.message;
        else if (result.pending) pending.push({ id, entry, token: entry.checks, promise: result.pending });
        else if (result.passed) passed.push(id);
      });
      this.setErrors(errors);
      passed.forEach((id) => {
        const message = this._controls.get(id).field.successMessage;
        if (message) this._setSuccess(id, message);
      });
      pending.forEach((check) => this._showWhenDone(check));
      this._pending = pending;
      return errors;
    }

    // Every check, async ones included: resolves to the full errors map.
    validateAsync() {
      const errors = this.validate();
      return Promise.all(this._pending.map((check) => check.promise.then((message) => {
        if (message && check.entry.checks === check.token) errors[check.id] = message;
      }))).then(() => errors);
    }

    validateFieldAsync(id) {
      const message = this.validateField(id);
      const check = this._fieldPending;
      if (!check) return Promise.resolve(message);
      return check.promise.then((result) => (check.entry.checks === check.token ? result || null : null));
    }

    // A check in flight shows as a spinner after the label and aria-busy on
    // the control, never as a new line of text: a line appearing on blur
    // pushed the button being pressed down before mouseup, so the click was
    // lost. The message slot changes once, when the answer arrives.
    _setPending(id, pending = true) {
      const entry = this._controls.get(id);
      if (!entry) return;
      if (pending) {
        this._rows.get(id).dataset.checking = "true";
        entry.el.setAttribute("aria-busy", "true");
      } else {
        delete this._rows.get(id).dataset.checking;
        entry.el.removeAttribute("aria-busy");
      }
    }

    // Shows an async result when it arrives, unless the field changed (or was
    // checked again) in the meantime.
    _showWhenDone(check) {
      this._setPending(check.id);
      check.promise.then((message) => whenPointerFree(() => {
        if (check.entry.checks !== check.token) return;
        this._setPending(check.id, false);
        this.setError(check.id, message || "");
        if (!message && check.entry.field.successMessage) this._setSuccess(check.id, check.entry.field.successMessage);
      }));
    }

    // Submit (or a submit button) with async checks outstanding: wait for
    // them with the submit buttons disabled, then emit. An edit during the
    // wait abandons this submit rather than sending a value nobody checked.
    _afterPending(onValid, extra) {
      const pending = this._pending || [];
      if (!pending.length) {
        onValid();
        return;
      }
      this._setChecking(true);
      Promise.all(pending.map((check) => check.promise)).then((messages) => {
        this._setChecking(false);
        if (pending.some((check) => check.entry.checks !== check.token)) return;
        const errors = {};
        pending.forEach((check, index) => {
          if (messages[index]) errors[check.id] = messages[index];
        });
        if (Object.keys(errors).length) {
          this._focusInvalid(errors);
          this._emit("invalid", Object.assign({ errors }, extra || {}));
          return;
        }
        onValid();
      });
    }

    _setChecking(checking) {
      this._checking = Boolean(checking);
      if (this._checking) this._host.dataset.checking = "true";
      else delete this._host.dataset.checking;
      if (this._submitBtn) this._submitBtn.disabled = this._busy || this._checking;
      this._buttons.forEach((entry) => this._syncButton(entry));
    }

    // One field's checks: {message} when it fails, {passed: true} when it
    // has a value that passes, {} when it is empty or inactive.
    _checkField(entry, values) {
      const { field, type } = entry;
      if (this._isInactive(entry)) return {};
      const value = this._readControl(field.id);
      const empty = BOOLEAN.has(type)
        ? false
        : Array.isArray(value)
          ? value.length === 0
          : value == null || String(value).trim() === "";
      if (field.required && empty) {
        return { message: field.requiredMessage || `${field.label || field.id} is required` };
      }
      if (empty) return {};
      entry.checks = (entry.checks || 0) + 1;
      const builtin = this._builtinError(entry, value);
      if (builtin) return { message: builtin };
      const custom = this._validatorError(entry, value, values);
      if (custom && typeof custom.then === "function") return { pending: custom };
      return custom ? { message: custom } : { passed: true };
    }

    // Validate a single field and show the result under it, leaving the
    // other fields' messages alone (for on_blur). Returns the message, or
    // null when it passes, is empty, or is hidden / disabled.
    validateField(id) {
      const entry = this._controls.get(String(id));
      if (!entry) throw new Error(`Form has no field '${id}'`);
      let snapshot = null;
      const result = this._checkField(entry, () => (snapshot = snapshot || this.getValues()));
      const token = entry.checks;
      whenPointerFree(() => {
        if (entry.checks !== token) return; // edited since
        this.setError(entry.field.id, result.message || "");
        if (result.passed && entry.field.successMessage) this._setSuccess(entry.field.id, entry.field.successMessage);
      });
      this._fieldPending = null;
      if (result.pending) {
        this._fieldPending = { id: entry.field.id, entry, token, promise: result.pending };
        this._showWhenDone(this._fieldPending);
      }
      return result.message || null;
    }

    // ── Focus ────────────────────────────────────────────────────────────────

    // The field a node belongs to (a field row, not a button row), or null.
    _fieldIdOf(node) {
      const row = node && node.closest && node.closest(".wapyt-form-row");
      if (!row || !this._formEl.contains(row) || row.dataset.kind === "button") return null;
      const id = row.dataset.fieldId;
      return id && this._controls.has(id) ? id : null;
    }

    // focusin / focusout bubble, so one pair of listeners covers every
    // field. Moving between the parts of one field (radio options, the two
    // thumbs of a range, a combo's chips) is not a blur and a focus.
    _onFocusIn(event) {
      const id = this._fieldIdOf(event.target);
      if (!id || id === this._fieldIdOf(event.relatedTarget)) return;
      this._emit("focus", { id });
    }

    _onFocusOut(event) {
      const id = this._fieldIdOf(event.target);
      if (!id || id === this._fieldIdOf(event.relatedTarget)) return;
      this._emit("blur", { id, value: this._readControl(id) });
    }

    setFocus(id) {
      const key = String(id);
      const button = this._button(key);
      if (button) {
        if (button.el.disabled || button.el.closest("[hidden]")) return false;
        button.el.focus();
        return document.activeElement === button.el;
      }
      const entry = this._controls.get(key);
      if (!entry) throw new Error(`Form has no field '${id}'`);
      if (this._isInactive(entry)) return false;
      this._focusEntry(entry);
      return this._fieldIdOf(document.activeElement) === key;
    }

    getFocused() {
      const active = document.activeElement;
      if (!active || !this._formEl.contains(active)) return null;
      const button = active.closest && active.closest("[data-button-id]");
      if (button) return button.dataset.buttonId;
      return this._fieldIdOf(active);
    }

    _builtinError(entry, value) {
      const { field, type } = entry;
      // The control already carries min/max, so its own validity flags do
      // the comparison for numbers, dates and times alike.
      if (BOUNDED.has(type) && entry.el.validity) {
        const later = DATELIKE.has(type);
        if (entry.el.validity.rangeUnderflow) {
          return field.rangeMessage ||
            (later ? `Must be ${field.min} or later` : `Must be at least ${field.min}`);
        }
        if (entry.el.validity.rangeOverflow) {
          return field.rangeMessage ||
            (later ? `Must be ${field.max} or earlier` : `Must be at most ${field.max}`);
        }
      }
      if (Array.isArray(value)) return null;
      if (field.minLength && String(value).length < field.minLength) {
        return field.minLengthMessage || `Must be at least ${field.minLength} characters`;
      }
      // The maxlength attribute stops typing, but set_values can still put a
      // longer value in.
      if (field.maxLength != null && String(value).length > Number(field.maxLength)) {
        return field.maxLengthMessage || `Must be at most ${field.maxLength} characters`;
      }
      if (field.pattern) {
        let re;
        try {
          re = new RegExp(field.pattern);
        } catch (error) {
          re = null;
        }
        if (re && !re.test(String(value))) return field.patternMessage || "Invalid value";
      }
      if (field.matches && this._controls.has(field.matches)) {
        if (String(value) !== String(this._readControl(field.matches))) {
          return field.matchesMessage || "Values do not match";
        }
      }
      return null;
    }

    // A validator (usually a Python function handed over by the wrapper)
    // gets (value, values) and returns nothing / "" / true when the value is
    // fine, a message when it is not, or false for the generic message. One
    // that throws counts as invalid rather than breaking the submit.
    // Returns null, a message, or (for an async validator: a Python
    // coroutine arrives as a thenable proxy) a Promise of null or a message.
    _validatorError(entry, value, values) {
      if (typeof entry.validator !== "function") return null;
      const normalise = (result) => {
        if (result == null || result === "" || result === true) return null;
        if (result === false) return "Invalid value";
        return String(result);
      };
      const failed = (error) => {
        console.error(`[wapyt] Form validator for '${entry.field.id}' failed`, error);
        return "Invalid value";
      };
      let result;
      try {
        result = entry.validator(value, values());
      } catch (error) {
        return failed(error);
      }
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).then(normalise, failed).finally(() => {
          if (typeof result.destroy === "function") {
            try {
              result.destroy();
            } catch (error) {
              /* already released */
            }
          }
        });
      }
      return normalise(result);
    }

    setValidator(id, fn) {
      const entry = this._controls.get(String(id));
      if (!entry) throw new Error(`Form has no field '${id}'`);
      entry.validator = typeof fn === "function" ? fn : null;
    }

    _setSuccess(id, message) {
      const el = this._errorEls.get(id);
      if (!el) return;
      el.textContent = String(message);
      el.hidden = false;
      el.dataset.state = "success";
    }

    // The File objects a file or avatar field holds (for filetransfer).
    getFiles(id) {
      const entry = this._controls.get(String(id));
      if (!entry || !entry.picker) throw new Error(`Form field '${id}' is not a file or avatar field`);
      return entry.picker.getFiles();
    }

    // ── Whole form ───────────────────────────────────────────────────────────

    disable() {
      this._frame.disabled = true;
      this._syncSliders();
    }

    enable() {
      this._frame.disabled = false;
      this._syncSliders();
    }

    isDisabled() {
      return this._frame.disabled;
    }

    hide() {
      this._formEl.hidden = true;
    }

    show() {
      this._formEl.hidden = false;
    }

    isVisible() {
      return !this._formEl.hidden;
    }

    submit() {
      if (this._busy || this._checking || this._frame.disabled) return;
      const errors = this.validate();
      if (Object.keys(errors).length) {
        this._focusInvalid(errors);
        this._emit("invalid", { errors });
        return;
      }
      this._afterPending(() => this._emit("submit", this.getValues()));
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
