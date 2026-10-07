(function () {
  // MenuBar: a horizontal application menu (File, Edit, View...) in a layout
  // cell. Each top-level entry with `items` opens a wapyt.ContextMenu as its
  // dropdown; one without `items` is a plain command on the bar. Follows the
  // WAI-ARIA menubar pattern: one tab stop, Left / Right between titles,
  // Down / Enter / Space to open, and once a menu is open, hovering another
  // title or pressing Left / Right inside a dropdown moves to the neighbour.
  // Labels reach the DOM through textContent.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_menubar_${Math.random().toString(16).slice(2)}`;
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

  class MenuBar {
    constructor(target, options = {}) {
      this.options = Object.assign({ items: [], label: "Menu" }, options || {});
      this._events = {};
      this._entries = []; // {item, button, menu}
      this._openIndex = -1;
      this._focusIndex = 0;
      // Hidden / disabled state of top-level titles (state for ids inside a
      // dropdown lives in that dropdown's ContextMenu).
      this._hiddenTop = new Set();
      this._disabledTop = new Map();
      this._host = resolveHost(target);
      if (!this._host) throw new Error("Unable to mount MenuBar – target not found.");
      this._render();
    }

    _render() {
      this.close(false);
      this._entries.forEach((entry) => entry.menu && entry.menu.destroy());
      this._entries = [];
      this._host.innerHTML = "";
      this._bar = document.createElement("div");
      this._bar.className = "wapyt-menubar";
      this._bar.setAttribute("role", "menubar");
      this._bar.setAttribute("aria-label", String(this.options.label || "Menu"));
      this._bar.addEventListener("keydown", (event) => this._onKey(event));

      (this.options.items || []).forEach((item) => {
        if (!item || item.separator) return;
        const index = this._entries.length;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wapyt-menubar-item";
        button.setAttribute("role", "menuitem");
        button.dataset.id = String(item.id);
        button.tabIndex = -1;
        if (item.icon) {
          const icon = document.createElement("i");
          icon.className = `wapyt-menubar-icon ${iconClass(item.icon)}`;
          icon.setAttribute("aria-hidden", "true");
          button.appendChild(icon);
        }
        const label = document.createElement("span");
        label.textContent = item.label == null ? String(item.id) : String(item.label);
        button.appendChild(label);

        let menu = null;
        const hasMenu = Array.isArray(item.items) && item.items.length > 0;
        if (hasMenu) {
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
          menu = new globalNS.ContextMenu({
            items: item.items,
            label: item.label || String(item.id),
            menuClass: "wapyt-menubar-menu",
            owner: this._bar,
            onEdge: (dir) => this._step(dir, true),
          });
          menu.on("select", (payload) => this._emit("select", Object.assign({}, payload, { menu: String(item.id) })));
          menu.on("hide", () => {
            if (this._openIndex === index) {
              this._openIndex = -1;
              delete this._bar.dataset.open;
            }
            button.setAttribute("aria-expanded", "false");
          });
        }

        button.addEventListener("click", () => {
          if (this.isDisabled(item.id)) return;
          if (!hasMenu) {
            this.close(false);
            this._emit("select", { id: String(item.id), menu: null, context: null, target: null });
            return;
          }
          if (this._openIndex === index) this.close(true);
          else this._open(index, true);
        });
        // Once one menu is open, pointing at another title switches to it.
        button.addEventListener("pointerenter", () => {
          if (this._openIndex >= 0 && this._openIndex !== index) {
            if (hasMenu && !this.isDisabled(item.id)) this._open(index, false);
            else this.close(false);
            button.focus();
          }
        });
        button.addEventListener("focus", () => this._setFocusIndex(index));
        this._entries.push({ item, button, menu });
        this._bar.appendChild(button);
      });

      this._host.appendChild(this._bar);
      this._applyState();
      this._setFocusIndex(Math.min(this._focusIndex, Math.max(0, this._entries.length - 1)));
    }

    // ── Opening ──────────────────────────────────────────────────────────────

    _visibleIndexes() {
      return this._entries.map((entry, i) => i).filter((i) => !this._entries[i].button.hidden);
    }

    _setFocusIndex(index) {
      this._focusIndex = index;
      this._entries.forEach((entry, i) => { entry.button.tabIndex = i === index ? 0 : -1; });
    }

    // Move one visible title left (-1) or right (+1) of the open (or focused)
    // one, wrapping, and open it; a plain command or a disabled title just
    // takes focus.
    _step(dir, focusMenu) {
      const visible = this._visibleIndexes();
      if (!visible.length) return;
      const from = this._openIndex >= 0 ? this._openIndex : this._focusIndex;
      const pos = visible.indexOf(from);
      const next = visible[(pos + dir + visible.length) % visible.length];
      const entry = this._entries[next];
      if (entry.menu && !this.isDisabled(entry.item.id)) {
        this._open(next, focusMenu);
      } else {
        this.close(false);
        entry.button.focus();
      }
    }

    _open(index, focusMenu) {
      const entry = this._entries[index];
      if (!entry || !entry.menu) return;
      if (this._openIndex >= 0 && this._openIndex !== index) {
        const current = this._entries[this._openIndex];
        if (current && current.menu) current.menu.hide(false);
      }
      entry.button.focus();
      const rect = entry.button.getBoundingClientRect();
      entry.menu.showAt(rect.left, rect.bottom + 2, { context: String(entry.item.id) });
      if (!entry.menu.isOpen()) return; // every item hidden
      this._openIndex = index;
      this._bar.dataset.open = "true";
      entry.button.setAttribute("aria-expanded", "true");
      if (!focusMenu) entry.button.focus();
      this._emit("open", { id: String(entry.item.id) });
    }

    open(id) {
      const index = this._entries.findIndex((entry) => String(entry.item.id) === String(id));
      if (index >= 0) this._open(index, true);
    }

    close(restoreFocus = true) {
      if (this._openIndex < 0) return;
      const entry = this._entries[this._openIndex];
      this._openIndex = -1;
      delete this._bar.dataset.open;
      if (entry && entry.menu) entry.menu.hide(restoreFocus);
    }

    isOpen() {
      return this._openIndex >= 0;
    }

    // ── Keyboard on the bar itself ───────────────────────────────────────────

    _onKey(event) {
      const button = event.target.closest && event.target.closest(".wapyt-menubar-item");
      if (!button) return;
      const index = this._entries.findIndex((entry) => entry.button === button);
      const visible = this._visibleIndexes();
      const pos = visible.indexOf(index);
      const focusAt = (p) => {
        event.preventDefault();
        const target = this._entries[visible[(p + visible.length) % visible.length]];
        if (target) target.button.focus();
      };
      switch (event.key) {
        case "ArrowRight": focusAt(pos + 1); break;
        case "ArrowLeft": focusAt(pos - 1); break;
        case "Home": focusAt(0); break;
        case "End": focusAt(visible.length - 1); break;
        case "ArrowDown":
        case "Enter":
        case " ": {
          const entry = this._entries[index];
          if (!entry.menu) return; // Enter / Space click a plain command as usual
          event.preventDefault();
          if (!this.isDisabled(entry.item.id)) this._open(index, true);
          break;
        }
        default:
          break;
      }
    }

    // ── Item state, delegated to the menu that holds the id ─────────────────

    _menuFor(id) {
      const entry = this._entries.find((e) => e.menu && e.menu.hasItem(id));
      return entry ? entry.menu : null;
    }

    _topEntry(id) {
      return this._entries.find((e) => String(e.item.id) === String(id)) || null;
    }

    _applyState() {
      this._entries.forEach((entry) => {
        const id = String(entry.item.id);
        entry.button.hidden = this._hiddenTop.has(id);
        const disabled = this.isDisabled(id);
        if (disabled) entry.button.setAttribute("aria-disabled", "true");
        else entry.button.removeAttribute("aria-disabled");
      });
    }

    setDisabled(ids, disabled = true) {
      [].concat(ids || []).map(String).forEach((id) => {
        if (this._topEntry(id)) this._disabledTop.set(id, Boolean(disabled));
        const menu = this._menuFor(id);
        if (menu) menu.setDisabled(id, disabled);
      });
      if (this._openIndex >= 0 && this.isDisabled(this._entries[this._openIndex].item.id)) this.close(false);
      this._applyState();
    }

    setHidden(ids, hidden = true) {
      [].concat(ids || []).map(String).forEach((id) => {
        if (this._topEntry(id)) {
          if (hidden) this._hiddenTop.add(id);
          else this._hiddenTop.delete(id);
        }
        const menu = this._menuFor(id);
        if (menu) menu.setHidden(id, hidden);
      });
      this._applyState();
    }

    isDisabled(id) {
      const key = String(id);
      const top = this._topEntry(key);
      if (top) {
        if (this._disabledTop.has(key)) return this._disabledTop.get(key);
        return Boolean(top.item.disabled);
      }
      const menu = this._menuFor(key);
      return menu ? menu.isDisabled(key) : false;
    }

    isHidden(id) {
      const key = String(id);
      if (this._topEntry(key)) return this._hiddenTop.has(key);
      const menu = this._menuFor(key);
      return menu ? menu.isHidden(key) : false;
    }

    setChecked(id, checked = true) {
      const menu = this._menuFor(id);
      if (menu) menu.setChecked(id, checked);
    }

    isChecked(id) {
      const menu = this._menuFor(id);
      return menu ? menu.isChecked(id) : false;
    }

    setItems(items) {
      this.options.items = items || [];
      this._render();
    }

    // ── Events ───────────────────────────────────────────────────────────────

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
          console.error("[wapyt] MenuBar listener failed", error);
        }
      });
    }

    destroy() {
      this.close(false);
      this._entries.forEach((entry) => entry.menu && entry.menu.destroy());
      this._entries = [];
      this._events = {};
      this._host.innerHTML = "";
    }
  }

  globalNS.MenuBar = MenuBar;
})();
