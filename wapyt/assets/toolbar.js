(function () {
  // Toolbar: a row of buttons, separators, spacers and text, with toggle
  // buttons, one-of-several groups, and an icon-only mode when it runs out of
  // room. Monguana and IguanaXterm each built this by hand from HTML.
  //
  // Labels, tooltips, badges and text reach the DOM through textContent and
  // setAttribute; icons only ever receive a class name.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_toolbarhost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-toolbar"></div>`);
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

  function iconClass(value) {
    const icons = globalThis.wapyt && globalThis.wapyt.icons;
    if (icons && typeof icons.iconClass === "function") {
      return icons.iconClass(value);
    }
    return `mdi ${String(value || "")}`;
  }

  class Toolbar {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          items: [],
          label: "Toolbar",
          compact: "auto", // auto | always | never
        },
        options || {}
      );
      this._events = {};
      this._items = new Map(); // id -> {spec, el, labelEl, badgeEl, iconEl}
      this._naturalWidth = 0;

      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount Toolbar – target not found.");
      }
      this._host.classList.add("wapyt-toolbar");
      this._host.setAttribute("role", "toolbar");
      this._host.setAttribute("aria-label", String(this.options.label || "Toolbar"));
      this._onClick = this._onClick.bind(this);
      this._onKeydown = this._onKeydown.bind(this);
      this._host.addEventListener("click", this._onClick);
      this._host.addEventListener("keydown", this._onKeydown);
      this.setItems(this.options.items || []);

      if (this.options.compact === "always") {
        this._host.dataset.compact = "true";
      } else if (this.options.compact === "auto" && typeof ResizeObserver === "function") {
        this._observer = new ResizeObserver(() => this._fit());
        this._observer.observe(this._host);
      }
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    setItems(items) {
      this._host.textContent = "";
      this._items.clear();
      (items || []).forEach((spec) => this._host.appendChild(this._renderItem(spec || {})));
      this._naturalWidth = 0;
      this._syncTabStops();
      this._fit();
    }

    _renderItem(spec) {
      const type = spec.type || "button";
      if (type === "separator") {
        const sep = document.createElement("span");
        sep.className = "wapyt-toolbar-sep";
        sep.setAttribute("role", "separator");
        sep.setAttribute("aria-orientation", "vertical");
        return sep;
      }
      if (type === "spacer") {
        const spacer = document.createElement("span");
        spacer.className = "wapyt-toolbar-spacer";
        return spacer;
      }
      if (type === "text") {
        const text = document.createElement("span");
        text.className = "wapyt-toolbar-text";
        text.textContent = spec.text == null ? "" : String(spec.text);
        if (spec.hidden) text.hidden = true;
        if (spec.id) this._items.set(String(spec.id), { spec, el: text, labelEl: text });
        return text;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "wapyt-toolbar-btn";
      button.dataset.id = String(spec.id || "");
      button.dataset.variant = spec.variant || "default";
      if (spec.group) button.dataset.group = String(spec.group);
      const tooltip = spec.tooltip || spec.label || spec.id || "";
      if (tooltip) button.title = String(tooltip);
      if (spec.disabled) button.disabled = true;
      if (spec.hidden) button.hidden = true;
      if (spec.toggle || spec.group) {
        button.setAttribute("aria-pressed", spec.active ? "true" : "false");
      }

      let iconEl = null;
      if (spec.icon) {
        iconEl = document.createElement("i");
        iconEl.className = `wapyt-toolbar-icon ${iconClass(spec.icon)}`;
        iconEl.setAttribute("aria-hidden", "true");
        button.appendChild(iconEl);
      }
      const labelEl = document.createElement("span");
      labelEl.className = "wapyt-toolbar-label";
      labelEl.textContent = spec.label == null ? "" : String(spec.label);
      if (spec.showLabel === false || !spec.label) labelEl.hidden = true;
      button.appendChild(labelEl);
      // Icon-only buttons still need an accessible name.
      if (labelEl.hidden || !spec.label) button.setAttribute("aria-label", String(tooltip));
      if (spec.keepLabel) button.dataset.keepLabel = "true";

      const badgeEl = document.createElement("span");
      badgeEl.className = "wapyt-toolbar-badge";
      this._setBadgeText(badgeEl, spec.badge);
      button.appendChild(badgeEl);

      this._items.set(String(spec.id), { spec, el: button, labelEl, badgeEl, iconEl });
      return button;
    }

    _setBadgeText(badgeEl, badge) {
      const empty = badge === null || badge === undefined || badge === "";
      badgeEl.textContent = empty ? "" : String(badge);
      badgeEl.hidden = empty;
    }

    // Collapse to icons when the labelled toolbar no longer fits its container,
    // and expand again once there is room for the labelled width it needs.
    _fit() {
      if (this.options.compact !== "auto") return;
      const host = this._host;
      const compact = host.dataset.compact === "true";
      if (!compact) {
        if (host.scrollWidth > host.clientWidth + 1) {
          this._naturalWidth = host.scrollWidth;
          host.dataset.compact = "true";
        }
      } else if (this._naturalWidth && host.clientWidth >= this._naturalWidth) {
        delete host.dataset.compact;
      }
    }

    // ── Events ─────────────────────────────────────────────────────────────

    on(event, handler) {
      if (!this._events[event]) this._events[event] = new Set();
      this._events[event].add(handler);
    }

    off(event, handler) {
      if (this._events[event]) this._events[event].delete(handler);
    }

    _emit(event, payload) {
      const listeners = this._events[event];
      if (!listeners) return;
      listeners.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[wapyt.Toolbar] ${event} handler failed`, error);
        }
      });
    }

    _onClick(event) {
      const button = event.target.closest(".wapyt-toolbar-btn");
      if (!button || !this._host.contains(button) || button.disabled) return;
      const id = button.dataset.id;
      const entry = this._items.get(id);
      if (!entry) return;
      const { spec } = entry;
      if (spec.group) {
        this.setActive(id, true);
      } else if (spec.toggle) {
        this.setActive(id, button.getAttribute("aria-pressed") !== "true");
      }
      const pressed = button.getAttribute("aria-pressed");
      this._emit("click", {
        id,
        group: spec.group || null,
        active: pressed === null ? null : pressed === "true",
      });
    }

    // WAI-ARIA toolbar pattern: one tab stop, arrow keys move between buttons.
    _buttons() {
      return Array.from(this._host.querySelectorAll(".wapyt-toolbar-btn")).filter(
        (b) => !b.hidden && !b.disabled
      );
    }

    _syncTabStops(focused) {
      const buttons = this._buttons();
      const current = focused && buttons.includes(focused) ? focused : buttons[0];
      this._host.querySelectorAll(".wapyt-toolbar-btn").forEach((b) => {
        b.tabIndex = b === current ? 0 : -1;
      });
    }

    _onKeydown(event) {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      const buttons = this._buttons();
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      this._syncTabStops(buttons[next]);
      buttons[next].focus();
    }

    // ── State ──────────────────────────────────────────────────────────────

    _entry(id) {
      const entry = this._items.get(String(id));
      if (!entry) throw new Error(`Toolbar has no item '${id}'`);
      return entry;
    }

    setActive(id, active = true) {
      const { spec, el } = this._entry(id);
      if (spec.group) {
        // One of several: pressing one releases the rest of its group.
        if (!active) return;
        this._host
          .querySelectorAll(`.wapyt-toolbar-btn[data-group="${CSS.escape(spec.group)}"]`)
          .forEach((b) => b.setAttribute("aria-pressed", b === el ? "true" : "false"));
      } else if (el.hasAttribute("aria-pressed")) {
        el.setAttribute("aria-pressed", active ? "true" : "false");
      }
    }

    isActive(id) {
      return this._entry(id).el.getAttribute("aria-pressed") === "true";
    }

    getActive(group) {
      const pressed = this._host.querySelector(
        `.wapyt-toolbar-btn[data-group="${CSS.escape(String(group))}"][aria-pressed="true"]`
      );
      return pressed ? pressed.dataset.id : null;
    }

    setDisabled(id, disabled = true) {
      this._entry(id).el.disabled = Boolean(disabled);
      this._syncTabStops(document.activeElement);
    }

    setHidden(id, hidden = true) {
      this._entry(id).el.hidden = Boolean(hidden);
      this._naturalWidth = 0;
      this._syncTabStops(document.activeElement);
      if (this._host.dataset.compact === "true" && this.options.compact === "auto") {
        // Re-measure from the labelled layout: an item may have changed width.
        delete this._host.dataset.compact;
      }
      this._fit();
    }

    setText(id, text) {
      const entry = this._entry(id);
      const value = text == null ? "" : String(text);
      entry.labelEl.textContent = value;
      if (entry.el.tagName === "BUTTON") {
        entry.spec.label = value;
        entry.labelEl.hidden = !value || entry.spec.showLabel === false;
        if (!entry.spec.tooltip) entry.el.title = value || entry.spec.id;
      }
      this.setHidden(id, entry.el.hidden);
    }

    setTooltip(id, tooltip) {
      const { el, spec } = this._entry(id);
      spec.tooltip = tooltip;
      el.title = String(tooltip || spec.label || spec.id || "");
    }

    setIcon(id, icon) {
      const entry = this._entry(id);
      if (!entry.iconEl) {
        entry.iconEl = document.createElement("i");
        entry.iconEl.setAttribute("aria-hidden", "true");
        entry.el.insertBefore(entry.iconEl, entry.el.firstChild);
      }
      entry.iconEl.className = `wapyt-toolbar-icon ${iconClass(icon)}`;
    }

    setBadge(id, badge) {
      const entry = this._entry(id);
      if (entry.badgeEl) this._setBadgeText(entry.badgeEl, badge);
    }

    destroy() {
      if (this._observer) this._observer.disconnect();
      this._host.removeEventListener("click", this._onClick);
      this._host.removeEventListener("keydown", this._onKeydown);
      this._host.textContent = "";
      this._items.clear();
      this._events = {};
    }
  }

  globalNS.Toolbar = Toolbar;
})();
