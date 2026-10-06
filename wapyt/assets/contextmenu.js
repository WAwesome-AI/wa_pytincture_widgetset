(function () {
  // ContextMenu: a standalone right-click menu with icons, shortcut hints,
  // danger and disabled items, separators and submenus.
  //
  // Tree, DataTable and Terminal each grew their own menu with the same
  // separator and danger handling, Escape only, no focus management and a
  // document keydown listener that is never removed. This one follows the
  // WAI-ARIA menu pattern and cleans up after itself. Labels and shortcut
  // hints reach the DOM through textContent; icons only receive a class name.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function iconClass(value) {
    const icons = globalThis.wapyt && globalThis.wapyt.icons;
    if (icons && typeof icons.iconClass === "function") {
      return icons.iconClass(value);
    }
    return `mdi ${String(value || "")}`;
  }

  function resolveElement(target) {
    if (typeof target === "string") return document.querySelector(target);
    if (target && target.nodeType === 1) return target;
    return null;
  }

  let openMenu = null; // only one context menu is open on a page at a time

  class ContextMenu {
    constructor(options = {}) {
      // menuClass / itemClass add class names alongside the wapyt-cmenu ones,
      // so a widget can keep its own selectors (tests, app CSS) when it moves
      // onto this menu.
      this.options = Object.assign(
        { items: [], label: "Context menu", menuClass: "", itemClass: "" },
        options || {}
      );
      this._events = {};
      this._items = this.options.items || [];
      this._attachments = []; // {el, listener, keyListener}
      this._panels = []; // open panels: [root, submenu, ...]
      this._context = null;
      this._target = null;
      this._returnFocus = null;
      this._onDocPointer = this._onDocPointer.bind(this);
      this._onDocKey = this._onDocKey.bind(this);
      this._onViewportChange = () => this.hide();
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
          console.error(`[wapyt.ContextMenu] ${event} handler failed`, error);
        }
      });
    }

    // ── Items ──────────────────────────────────────────────────────────────

    setItems(items) {
      this._items = items || [];
      if (this.isOpen()) this.hide();
    }

    // ── Opening ────────────────────────────────────────────────────────────

    // Open on right-click, Shift+F10 or the Menu key over an element. The
    // nearest ancestor with data-context names what was clicked ("target").
    attach(target, context) {
      const el = resolveElement(target);
      if (!el) throw new Error("ContextMenu.attach: target not found");
      const open = (event, x, y) => {
        const holder = event.target && event.target.closest
          ? event.target.closest("[data-context]")
          : null;
        const targetValue = holder && el.contains(holder) ? holder.getAttribute("data-context") : null;
        this.showAt(x, y, { context, target: targetValue });
      };
      const listener = (event) => {
        event.preventDefault();
        open(event, event.clientX, event.clientY);
      };
      const keyListener = (event) => {
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const anchor = event.target.getBoundingClientRect
            ? event.target.getBoundingClientRect()
            : el.getBoundingClientRect();
          open(event, anchor.left + 8, anchor.top + Math.min(anchor.height, 24));
        }
      };
      el.addEventListener("contextmenu", listener);
      el.addEventListener("keydown", keyListener);
      this._attachments.push({ el, listener, keyListener });
    }

    detach(target) {
      const el = resolveElement(target);
      this._attachments = this._attachments.filter((entry) => {
        if (el && entry.el !== el) return true;
        entry.el.removeEventListener("contextmenu", entry.listener);
        entry.el.removeEventListener("keydown", entry.keyListener);
        return false;
      });
    }

    // options: {context, target, hide: [ids], disable: [ids]}
    showAt(x, y, options = {}) {
      if (openMenu && openMenu !== this) openMenu.hide();
      this.hide(false);
      this._context = options.context === undefined ? null : options.context;
      this._target = options.target === undefined ? null : options.target;
      this._hidden = new Set((options.hide || []).map(String));
      this._disabled = new Set((options.disable || []).map(String));
      this._returnFocus = document.activeElement;

      const panel = this._renderPanel(this._items, null);
      if (!panel) return; // nothing visible to show
      this._place(panel, x, y);
      openMenu = this;
      document.addEventListener("pointerdown", this._onDocPointer, true);
      document.addEventListener("keydown", this._onDocKey, true);
      window.addEventListener("resize", this._onViewportChange);
      window.addEventListener("scroll", this._onViewportChange, true);
      window.addEventListener("blur", this._onViewportChange);
      this._focusFirst(panel);
      this._emit("show", { context: this._context, target: this._target });
    }

    isOpen() {
      return this._panels.length > 0;
    }

    hide(restoreFocus = true) {
      if (!this._panels.length) return;
      this._panels.forEach((panel) => panel.remove());
      this._panels = [];
      document.removeEventListener("pointerdown", this._onDocPointer, true);
      document.removeEventListener("keydown", this._onDocKey, true);
      window.removeEventListener("resize", this._onViewportChange);
      window.removeEventListener("scroll", this._onViewportChange, true);
      window.removeEventListener("blur", this._onViewportChange);
      if (openMenu === this) openMenu = null;
      const focusTarget = this._returnFocus;
      this._returnFocus = null;
      if (restoreFocus && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === "function") {
        focusTarget.focus();
      }
      this._emit("hide", { context: this._context, target: this._target });
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _visible(items) {
      // Drop hidden items, then separators that would lead, trail or double up.
      const shown = items.filter((item) => item && !(item.id && this._hidden.has(String(item.id))));
      const out = [];
      shown.forEach((item) => {
        if (item.separator) {
          if (out.length && !out[out.length - 1].separator) out.push(item);
        } else {
          out.push(item);
        }
      });
      while (out.length && out[out.length - 1].separator) out.pop();
      return out;
    }

    _renderPanel(items, parentItemEl) {
      const visible = this._visible(items);
      if (!visible.some((item) => !item.separator)) return null;
      const panel = document.createElement("div");
      panel.className = "wapyt-cmenu";
      if (this.options.menuClass) panel.classList.add(...String(this.options.menuClass).split(/\s+/).filter(Boolean));
      panel.setAttribute("role", "menu");
      panel.setAttribute("aria-label", String(this.options.label || "Context menu"));
      panel.tabIndex = -1;

      visible.forEach((item) => {
        if (item.separator) {
          const sep = document.createElement("div");
          sep.className = "wapyt-cmenu-sep";
          sep.setAttribute("role", "separator");
          panel.appendChild(sep);
          return;
        }
        const el = document.createElement("button");
        el.type = "button";
        el.className = "wapyt-cmenu-item";
        if (this.options.itemClass) el.classList.add(...String(this.options.itemClass).split(/\s+/).filter(Boolean));
        // Extra data-* attributes, e.g. data-action for a widget's own tests.
        if (item.data && typeof item.data === "object") {
          Object.keys(item.data).forEach((key) => {
            if (/^[a-z][A-Za-z0-9]*$/.test(key)) el.dataset[key] = String(item.data[key]);
          });
        }
        el.setAttribute("role", "menuitem");
        el.tabIndex = -1;
        el.dataset.id = String(item.id);
        if (item.danger) el.dataset.danger = "true";
        const disabled = item.disabled || this._disabled.has(String(item.id));
        if (disabled) el.setAttribute("aria-disabled", "true");

        const icon = document.createElement("i");
        icon.className = item.icon ? `wapyt-cmenu-icon ${iconClass(item.icon)}` : "wapyt-cmenu-icon";
        icon.setAttribute("aria-hidden", "true");
        el.appendChild(icon);

        const label = document.createElement("span");
        label.className = "wapyt-cmenu-label";
        label.textContent = item.label == null ? String(item.id) : String(item.label);
        el.appendChild(label);

        const hasSub = Array.isArray(item.items) && item.items.length > 0;
        if (hasSub) {
          el.setAttribute("aria-haspopup", "menu");
          el.setAttribute("aria-expanded", "false");
          const chevron = document.createElement("i");
          chevron.className = "wapyt-cmenu-chevron mdi mdi-chevron-right";
          chevron.setAttribute("aria-hidden", "true");
          el.appendChild(chevron);
        } else if (item.shortcut) {
          const shortcut = document.createElement("span");
          shortcut.className = "wapyt-cmenu-shortcut";
          shortcut.textContent = String(item.shortcut);
          el.appendChild(shortcut);
        }

        el.addEventListener("click", (event) => {
          event.stopPropagation();
          if (el.getAttribute("aria-disabled") === "true") return;
          if (hasSub) {
            this._openSub(el, item, true);
            return;
          }
          this._choose(item);
        });
        el.addEventListener("pointerenter", () => {
          this._closeSubsFrom(panel);
          if (hasSub && el.getAttribute("aria-disabled") !== "true") this._openSub(el, item, false);
          el.focus();
        });
        el._wapytItem = item;
        panel.appendChild(el);
      });

      document.body.appendChild(panel);
      this._panels.push(panel);
      panel._parentItemEl = parentItemEl;
      return panel;
    }

    _place(panel, x, y) {
      panel.style.left = "0px";
      panel.style.top = "0px";
      const rect = panel.getBoundingClientRect();
      const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    _openSub(itemEl, item, focus) {
      const parentPanel = itemEl.closest(".wapyt-cmenu");
      this._closeSubsFrom(parentPanel);
      const sub = this._renderPanel(item.items, itemEl);
      if (!sub) return;
      itemEl.setAttribute("aria-expanded", "true");
      const anchor = itemEl.getBoundingClientRect();
      const width = sub.getBoundingClientRect().width;
      // Open to the right, or to the left when there is no room.
      const right = anchor.right + 2;
      const x = right + width + 8 > window.innerWidth ? anchor.left - width - 2 : right;
      this._place(sub, x, anchor.top - 4);
      if (focus) this._focusFirst(sub);
    }

    _closeSubsFrom(panel) {
      const index = this._panels.indexOf(panel);
      if (index < 0) return;
      this._panels.splice(index + 1).forEach((sub) => {
        if (sub._parentItemEl) sub._parentItemEl.setAttribute("aria-expanded", "false");
        sub.remove();
      });
    }

    _choose(item) {
      const payload = { id: String(item.id), context: this._context, target: this._target };
      this.hide();
      this._emit("select", payload);
    }

    // ── Keyboard and dismissal ─────────────────────────────────────────────

    _enabledItems(panel) {
      return Array.from(panel.querySelectorAll(".wapyt-cmenu-item"));
    }

    _focusFirst(panel) {
      const items = this._enabledItems(panel);
      const first = items.find((el) => el.getAttribute("aria-disabled") !== "true") || items[0];
      (first || panel).focus();
    }

    _onDocPointer(event) {
      if (!this._panels.some((panel) => panel.contains(event.target))) this.hide(false);
    }

    _onDocKey(event) {
      const panel = this._panels[this._panels.length - 1];
      if (!panel) return;
      const items = this._enabledItems(panel);
      const index = items.indexOf(document.activeElement);
      const move = (to) => {
        event.preventDefault();
        event.stopPropagation();
        const next = items[(to + items.length) % items.length];
        if (next) next.focus();
      };
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          if (this._panels.length > 1) {
            const parentItem = panel._parentItemEl;
            this._closeSubsFrom(this._panels[this._panels.length - 2]);
            if (parentItem) parentItem.focus();
          } else {
            this.hide();
          }
          break;
        case "ArrowDown":
          move(index + 1);
          break;
        case "ArrowUp":
          move(index < 0 ? -1 : index - 1);
          break;
        case "Home":
          move(0);
          break;
        case "End":
          move(-1);
          break;
        case "ArrowRight": {
          const current = document.activeElement;
          if (current && current._wapytItem && current.getAttribute("aria-haspopup") &&
              current.getAttribute("aria-disabled") !== "true") {
            event.preventDefault();
            this._openSub(current, current._wapytItem, true);
          }
          break;
        }
        case "ArrowLeft":
          if (this._panels.length > 1) {
            event.preventDefault();
            const parentItem = panel._parentItemEl;
            this._closeSubsFrom(this._panels[this._panels.length - 2]);
            if (parentItem) parentItem.focus();
          }
          break;
        case "Enter":
        case " ":
          if (document.activeElement && panel.contains(document.activeElement)) {
            event.preventDefault();
            event.stopPropagation();
            document.activeElement.click();
          }
          break;
        case "Tab":
          event.preventDefault();
          this.hide();
          break;
        default:
          break;
      }
    }

    destroy() {
      this.hide(false);
      this.detach();
      this._events = {};
    }
  }

  globalNS.ContextMenu = ContextMenu;
})();
