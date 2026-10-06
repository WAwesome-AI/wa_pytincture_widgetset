(function () {
  // ProgressBar: a determinate or indeterminate bar with a label and a value
  // text, in active / done / error / paused states. IguanaXterm's transfer
  // queue and Monguana's meters each drew their own; updates here only touch
  // the fill width and two text nodes, so several per second are cheap.
  // Label and value text are set with textContent.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});
  const STATES = ["active", "done", "error", "paused"];

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_progresshost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") return document.querySelector(target);
    if (target && target.nodeType === 1) return target;
    return null;
  }

  class ProgressBar {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          value: 0,
          max: 100,
          label: "",
          showValue: true,
          valueText: null,
          state: "active",
          indeterminate: false,
          compact: false,
          labelWidth: null, // e.g. "140px": line bars up in a stacked list
          valueWidth: null,
        },
        options || {}
      );
      this._host = resolveHost(target);
      if (!this._host) throw new Error("Unable to mount ProgressBar – target not found.");

      const root = document.createElement("div");
      root.className = "wapyt-progress";
      root.setAttribute("role", "progressbar");
      root.setAttribute("aria-valuemin", "0");

      const head = document.createElement("div");
      head.className = "wapyt-progress-head";
      this._labelEl = document.createElement("span");
      this._labelEl.className = "wapyt-progress-label";
      this._valueEl = document.createElement("span");
      this._valueEl.className = "wapyt-progress-value";
      head.appendChild(this._labelEl);
      head.appendChild(this._valueEl);

      const track = document.createElement("div");
      track.className = "wapyt-progress-track";
      this._fillEl = document.createElement("div");
      this._fillEl.className = "wapyt-progress-fill";
      track.appendChild(this._fillEl);

      root.appendChild(head);
      root.appendChild(track);
      this._root = root;
      this._host.appendChild(root);

      this.setLabel(this.options.label);
      this.setState(this.options.state);
      if (this.options.compact) root.dataset.compact = "true";
      const cssSize = (v) => (typeof v === "number" ? `${v}px` : String(v));
      if (this.options.labelWidth != null) {
        this._labelEl.style.flex = `0 0 ${cssSize(this.options.labelWidth)}`;
        this._labelEl.style.maxWidth = "none";
      }
      if (this.options.valueWidth != null) {
        this._valueEl.style.flex = `0 0 ${cssSize(this.options.valueWidth)}`;
        this._valueEl.style.textAlign = "right";
      }
      this._indeterminate = Boolean(this.options.indeterminate);
      this.setValue(this.options.value, this.options.max, this.options.valueText);
    }

    _render() {
      const root = this._root;
      if (this._indeterminate) {
        root.dataset.indeterminate = "true";
        root.removeAttribute("aria-valuenow");
        root.removeAttribute("aria-valuemax");
        this._fillEl.style.width = "";
      } else {
        delete root.dataset.indeterminate;
        const max = this._max > 0 ? this._max : 100;
        const value = Math.max(0, Math.min(this._value, max));
        root.setAttribute("aria-valuemax", String(max));
        root.setAttribute("aria-valuenow", String(value));
        this._fillEl.style.width = `${(value / max) * 100}%`;
      }
      const pct = this._max > 0 ? Math.round((Math.max(0, Math.min(this._value, this._max)) / this._max) * 100) : 0;
      const text = this._text != null && this._text !== ""
        ? String(this._text)
        : (this._indeterminate || !this.options.showValue ? "" : `${pct}%`);
      this._valueEl.textContent = text;
      this._valueEl.hidden = !text;
      if (text) root.setAttribute("aria-valuetext", text);
      else root.removeAttribute("aria-valuetext");
    }

    // max and text are optional: text replaces the "42%" readout, e.g.
    // "42%  1.2 MB"; pass "" to fall back to the percentage.
    setValue(value, max, text) {
      this._value = Number(value) || 0;
      if (max !== undefined && max !== null) this._max = Number(max) || 0;
      else if (this._max === undefined) this._max = Number(this.options.max) || 100;
      if (text !== undefined) this._text = text;
      this._render();
    }

    setLabel(label) {
      const value = label == null ? "" : String(label);
      this._labelEl.textContent = value;
      this._labelEl.hidden = !value;
      if (value) this._root.setAttribute("aria-label", value);
      else this._root.removeAttribute("aria-label");
    }

    setState(state) {
      this._root.dataset.state = STATES.includes(state) ? state : "active";
    }

    setIndeterminate(indeterminate = true) {
      this._indeterminate = Boolean(indeterminate);
      this._render();
    }

    getValue() {
      return { value: this._value, max: this._max, state: this._root.dataset.state };
    }

    destroy() {
      this._root.remove();
    }
  }

  globalNS.ProgressBar = ProgressBar;
})();
