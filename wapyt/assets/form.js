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

      if (type === "textarea") {
        control = document.createElement("textarea");
        control.rows = Number(field.rows) || 4;
      } else if (type === "select") {
        control = document.createElement("select");
        this._fillSelect(control, field.options);
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
        : "wapyt-form-control";
      if (!GROUPS.has(type)) control.name = field.id;
      if (field.placeholder) control.placeholder = field.placeholder;
      if (field.autocomplete) control.autocomplete = field.autocomplete;
      if (field.disabled) control.disabled = true;
      if (field.readonly && "readOnly" in control) control.readOnly = true;

      const entry = { field, el: control, type, name: controlId };
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
      const discrete = type === "select" || BOOLEAN.has(type) || GROUPS.has(type);
      control.addEventListener(discrete ? "change" : "input", emitChange);

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
      } else if (value != null || type !== "range") {
        // An unset range keeps the browser's midpoint rather than snapping to min.
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
