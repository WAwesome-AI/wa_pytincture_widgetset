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
        (field.options || []).forEach((option) => {
          const opt = document.createElement("option");
          if (option && typeof option === "object") {
            opt.value = String(option.value ?? "");
            opt.textContent = String(option.label ?? option.value ?? "");
          } else {
            opt.value = String(option ?? "");
            opt.textContent = String(option ?? "");
          }
          control.appendChild(opt);
        });
      } else if (type === "checkbox") {
        control = document.createElement("input");
        control.type = "checkbox";
      } else {
        control = document.createElement("input");
        control.type = TEXTUAL.has(type) ? type : "text";
        if (type === "number") {
          if (field.min != null) control.min = String(field.min);
          if (field.max != null) control.max = String(field.max);
          if (field.step != null) control.step = String(field.step);
        }
      }

      control.id = controlId;
      control.className = "wapyt-form-control";
      control.name = field.id;
      if (field.placeholder) control.placeholder = field.placeholder;
      if (field.autocomplete) control.autocomplete = field.autocomplete;
      if (field.disabled) control.disabled = true;
      if (field.readonly && "readOnly" in control) control.readOnly = true;

      if (type === "checkbox") {
        control.checked = Boolean(field.value);
      } else {
        control.value = field.value == null ? "" : String(field.value);
      }

      const label = document.createElement("label");
      label.className = "wapyt-form-label";
      label.htmlFor = controlId;
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

      if (type === "checkbox") {
        row.dataset.inline = "true";
        row.appendChild(control);
        row.appendChild(label);
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
        this.clearError(field.id);
        this._emit("change", { id: field.id, value: this._readControl(field.id) });
      };
      control.addEventListener(type === "select" || type === "checkbox" ? "change" : "input", emitChange);

      this._controls.set(field.id, { field, el: control, type });
      this._errorEls.set(field.id, error);
      this._rows.set(field.id, row);
      return row;
    }

    // ── Values ───────────────────────────────────────────────────────────────

    _readControl(id) {
      const entry = this._controls.get(id);
      if (!entry) return null;
      if (entry.type === "checkbox") {
        return entry.el.checked;
      }
      const raw = entry.el.value;
      if (entry.type === "number") {
        if (raw === "" || raw == null) return null;
        const parsed = Number(raw);
        return Number.isNaN(parsed) ? raw : parsed;
      }
      return raw;
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
        if (!entry) return;
        const value = values[id];
        if (entry.type === "checkbox") {
          entry.el.checked = Boolean(value);
        } else {
          entry.el.value = value == null ? "" : String(value);
        }
      });
    }

    setFieldOptions(id, options) {
      const entry = this._controls.get(id);
      if (!entry || entry.type !== "select") return;
      const previous = entry.el.value;
      entry.el.innerHTML = "";
      (options || []).forEach((option) => {
        const opt = document.createElement("option");
        if (option && typeof option === "object") {
          opt.value = String(option.value ?? "");
          opt.textContent = String(option.label ?? option.value ?? "");
        } else {
          opt.value = String(option ?? "");
          opt.textContent = String(option ?? "");
        }
        entry.el.appendChild(opt);
      });
      entry.el.value = previous;
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
          entry.el.focus();
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
        const empty =
          type === "checkbox" ? false : value == null || String(value).trim() === "";

        if (field.required && empty) {
          errors[id] = field.requiredMessage || `${field.label || id} is required`;
          return;
        }
        if (empty) return;
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
        if (entry) entry.el.focus();
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
