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
        },
        options || {}
      );

      this._events = {};
      this._controls = new Map();
      this._errorEls = new Map();
      this._rows = new Map();

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
      this._formEl.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submit();
      });

      (this.options.fields || []).forEach((field) => {
        const row = this._createRow(field);
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

      const controlId = `wapyt_f_${field.id}_${Math.random().toString(16).slice(2, 8)}`;
      let control;
      let combo = null;

      if (type === "textarea") {
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
      if (BOUNDED.has(type)) {
        if (field.min != null) control.min = String(field.min);
        if (field.max != null) control.max = String(field.max);
        if (field.step != null) control.step = String(field.step);
      }

      control.id = controlId;
      control.className =
        type === "range" ? "wapyt-form-range-input"
        : GROUPS.has(type) ? "wapyt-form-group"
        : type === "toggle" ? "wapyt-form-control wapyt-form-toggle"
        : type === "combo" ? "wapyt-form-combo-input"
        : "wapyt-form-control";
      if (!GROUPS.has(type)) control.name = field.id;
      if (field.placeholder) control.placeholder = field.placeholder;
      if (field.autocomplete) control.autocomplete = field.autocomplete;
      if (field.disabled) control.disabled = true;
      if (field.readonly && "readOnly" in control) control.readOnly = true;

      const entry = { field, el: control, type, name: controlId, combo };
      if (GROUPS.has(type)) {
        this._fillGroup(entry, field.options);
      } else if (type === "range") {
        entry.output = document.createElement("output");
        entry.output.className = "wapyt-form-range-value";
        entry.output.htmlFor = controlId;
        entry.output.hidden = field.showValue === false;
      }
      this._writeControl(entry, field.value);

      // A group has no single control to point a <label for> at, so its
      // caption is a plain element the fieldset names through aria-labelledby.
      const label = document.createElement(GROUPS.has(type) ? "div" : "label");
      label.className = "wapyt-form-label";
      label.id = `${controlId}_label`;
      if (!GROUPS.has(type)) label.htmlFor = controlId;
      label.textContent = field.label || field.id;
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

      if (BOOLEAN.has(type)) {
        row.dataset.inline = "true";
        row.appendChild(control);
        row.appendChild(label);
      } else if (combo) {
        row.appendChild(label);
        row.appendChild(combo.root);
      } else if (type === "range") {
        const wrap = document.createElement("div");
        wrap.className = "wapyt-form-range";
        wrap.appendChild(control);
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
        if (entry.output) entry.output.textContent = control.value;
        this.clearError(field.id);
        this._emit("change", { id: field.id, value: this._readControl(field.id) });
      };
      // Group inputs bubble their change events up to the fieldset.
      // A combo reports its own picks; its typing is only a filter.
      const discrete = type === "select" || BOOLEAN.has(type) || GROUPS.has(type);
      if (!combo) control.addEventListener(discrete ? "change" : "input", emitChange);

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
      if (entry.output) entry.output.textContent = el.value;
    }

    _focusEntry(entry) {
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

    showField(id) {
      const row = this._rows.get(id);
      if (row) row.hidden = false;
    }

    hideField(id) {
      const row = this._rows.get(id);
      if (row) row.hidden = true;
    }

    setFieldDisabled(id, disabled) {
      const entry = this._controls.get(id);
      if (entry) entry.el.disabled = Boolean(disabled);
    }

    setBusy(busy) {
      this._busy = Boolean(busy);
      this._host.dataset.busy = this._busy ? "true" : "false";
      if (this._submitBtn) this._submitBtn.disabled = this._busy;
      if (this._cancelBtn) this._cancelBtn.disabled = this._busy;
    }

    focusFirst() {
      for (const [, entry] of this._controls) {
        if (!entry.el.disabled && entry.type !== "hidden") {
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
        const firstId = Object.keys(errors)[0];
        const entry = this._controls.get(firstId);
        if (entry) this._focusEntry(entry);
        this._emit("invalid", { errors });
        return;
      }
      this._emit("submit", this.getValues());
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
