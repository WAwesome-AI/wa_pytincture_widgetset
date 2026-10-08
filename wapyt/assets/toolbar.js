(function () {
  // Toolbar: a row of buttons, separators, spacers and text, with toggle
  // buttons, one-of-several groups, dropdown and split buttons, and an
  // icon-only mode when it runs out of room. Monguana and IguanaXterm each
  // built this by hand from HTML.
  //
  // A button with `items` opens a wapyt.ContextMenu under it (the WAI-ARIA
  // menu button pattern); with `split` the button stays a command and a
  // separate arrow part opens the menu.
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
      this._items = new Map(); // id -> {spec, el, labelEl, badgeEl, iconEl, menu, arrow}
      this._menus = []; // {id, menu, opener}
      this._openMenu = null;
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
      this._destroyMenus();
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

      const entry = { spec, el: button, labelEl, badgeEl, iconEl, menu: null, arrow: null };
      this._items.set(String(spec.id), entry);
      if (!Array.isArray(spec.items)) return button;

      // Dropdown: the button itself opens the menu. Split: the button stays a
      // command and an arrow button beside it opens the menu; both sit in a
      // wrapper so they hide and lay out as one item.
      let opener = button;
      let node = button;
      if (spec.split) {
        const wrap = document.createElement("span");
        wrap.className = "wapyt-toolbar-split";
        if (spec.hidden) wrap.hidden = true;
        button.hidden = false;
        opener = document.createElement("button");
        opener.type = "button";
        opener.className = "wapyt-toolbar-btn wapyt-toolbar-arrow";
        opener.dataset.id = String(spec.id);
        opener.dataset.part = "arrow";
        opener.dataset.variant = button.dataset.variant;
        opener.setAttribute("aria-label", `${spec.label || tooltip || spec.id} options`);
        if (spec.disabled) opener.disabled = true;
        wrap.appendChild(button);
        wrap.appendChild(opener);
        entry.arrow = opener;
        node = wrap;
        entry.wrap = wrap;
      } else {
        button.dataset.dropdown = "true";
      }
      const chevron = document.createElement("i");
      chevron.className = `wapyt-toolbar-chevron ${iconClass("mdi-menu-down")}`;
      chevron.setAttribute("aria-hidden", "true");
      opener.appendChild(chevron);
      opener.setAttribute("aria-haspopup", "menu");
      opener.setAttribute("aria-expanded", "false");
      entry.opener = opener;
      entry.menu = this._createMenu(entry);
      return node;
    }

    // ── Dropdown menus ─────────────────────────────────────────────────────

    _createMenu(entry) {
      const { spec } = entry;
      const id = String(spec.id);
      const menu = new globalNS.ContextMenu({
        items: spec.items || [],
        label: spec.label || spec.tooltip || id,
        menuClass: "wapyt-toolbar-menu",
        owner: entry.opener,
        // Left / Right at the top of the menu close it and move along the
        // toolbar, as in a menu bar.
        onEdge: (dir) => this._stepFromMenu(entry, dir),
      });
      menu.on("select", (payload) => {
        const out = { id: payload.id, menu: id };
        if (payload.checked !== undefined) out.checked = payload.checked;
        this._emit("select", out);
      });
      menu.on("hide", () => {
        entry.opener.setAttribute("aria-expanded", "false");
        delete entry.opener.dataset.open;
        if (this._openMenu === entry) this._openMenu = null;
      });
      this._menus.push({ id, menu, entry });
      return menu;
    }

    _destroyMenus() {
      this._menus.forEach(({ menu }) => menu.destroy());
      this._menus = [];
      this._openMenu = null;
    }

    _openDropdown(entry, last = false) {
      if (!entry.menu || entry.opener.disabled) return;
      if (this._openMenu && this._openMenu !== entry) this._openMenu.menu.hide(false);
      // Focus first, so the menu hands focus back to the opener on close.
      entry.opener.focus();
      this._syncTabStops(entry.opener);
      const anchor = (entry.wrap || entry.el).getBoundingClientRect();
      entry.menu.showAt(anchor.left, anchor.bottom + 2, { context: String(entry.spec.id) });
      if (!entry.menu.isOpen()) return; // every item hidden
      this._openMenu = entry;
      entry.opener.setAttribute("aria-expanded", "true");
      entry.opener.dataset.open = "true";
      if (last) {
        const items = document.querySelectorAll(".wapyt-toolbar-menu .wapyt-cmenu-item");
        const enabled = Array.from(items).filter((el) => el.getAttribute("aria-disabled") !== "true");
        if (enabled.length) enabled[enabled.length - 1].focus();
      }
      this._emit("open", { id: String(entry.spec.id) });
    }

    _stepFromMenu(entry, dir) {
      entry.menu.hide(false);
      const buttons = this._buttons();
      const index = buttons.indexOf(entry.opener);
      if (index < 0 || !buttons.length) return;
      const next = buttons[(index + dir + buttons.length) % buttons.length];
      this._syncTabStops(next);
      next.focus();
      // Moving onto another dropdown opens it, like a menu bar.
      const target = this._entryForOpener(next);
      if (target) this._openDropdown(target);
    }

    _entryForOpener(el) {
      const entry = this._items.get(el.dataset.id);
      return entry && entry.opener === el ? entry : null;
    }

    openMenu(id) {
      const entry = this._entry(id);
      if (entry.menu) this._openDropdown(entry);
    }

    closeMenu() {
      if (this._openMenu) this._openMenu.menu.hide(true);
    }

    isMenuOpen(id) {
      if (id === undefined || id === null) return Boolean(this._openMenu);
      return Boolean(this._openMenu && String(this._openMenu.spec.id) === String(id));
    }

    setMenuItems(id, items) {
      const entry = this._entry(id);
      if (!entry.menu) throw new Error(`Toolbar item '${id}' has no menu`);
      entry.spec.items = items || [];
      entry.menu.setItems(entry.spec.items);
    }

    // The dropdown that holds a menu item id, or null.
    _menuFor(id) {
      const key = String(id);
      const found = this._menus.find(({ menu }) => menu.hasItem(key));
      return found ? found.menu : null;
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
      if (entry.opener === button) {
        // A dropdown or split arrow: toggle the menu, no click event.
        if (this._openMenu === entry) entry.menu.hide(true);
        else this._openDropdown(entry);
        return;
      }
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
        (b) => !b.hidden && !b.disabled && !(b.parentElement && b.parentElement.hidden)
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
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const opener = event.target.closest && event.target.closest(".wapyt-toolbar-btn");
        const entry = opener && this._entryForOpener(opener);
        if (entry) {
          event.preventDefault();
          this._openDropdown(entry, event.key === "ArrowUp");
        }
        return;
      }
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
      if (!this._items.has(String(id))) {
        const menu = this._menuFor(id);
        if (!menu) this._entry(id); // throws: no such item
        menu.setDisabled(String(id), disabled);
        return;
      }
      const entry = this._entry(id);
      entry.el.disabled = Boolean(disabled);
      if (entry.arrow) entry.arrow.disabled = Boolean(disabled);
      if (disabled && this._openMenu === entry) entry.menu.hide(false);
      this._syncTabStops(document.activeElement);
    }

    isDisabled(id) {
      if (!this._items.has(String(id))) {
        const menu = this._menuFor(id);
        if (!menu) this._entry(id);
        return menu.isDisabled(String(id));
      }
      return Boolean(this._entry(id).el.disabled);
    }

    isHidden(id) {
      if (!this._items.has(String(id))) {
        const menu = this._menuFor(id);
        if (!menu) this._entry(id);
        return menu.isHidden(String(id));
      }
      const entry = this._entry(id);
      return Boolean((entry.wrap || entry.el).hidden);
    }

    setChecked(id, checked = true) {
      const menu = this._menuFor(id);
      if (!menu) throw new Error(`Toolbar has no menu item '${id}'`);
      menu.setChecked(String(id), checked);
    }

    isChecked(id) {
      const menu = this._menuFor(id);
      if (!menu) throw new Error(`Toolbar has no menu item '${id}'`);
      return menu.isChecked(String(id));
    }

    setHidden(id, hidden = true) {
      if (!this._items.has(String(id))) {
        const menu = this._menuFor(id);
        if (!menu) this._entry(id);
        menu.setHidden(String(id), hidden);
        return;
      }
      const entry = this._entry(id);
      (entry.wrap || entry.el).hidden = Boolean(hidden);
      if (hidden && this._openMenu === entry) entry.menu.hide(false);
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
      this.setHidden(id, (entry.wrap || entry.el).hidden);
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
      this._destroyMenus();
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
