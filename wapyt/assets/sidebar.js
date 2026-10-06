(function () {
  // Sidebar: a navigation rail of items, groups (nested items that expand),
  // headings, separators and a spacer that pushes what follows to the bottom.
  // Collapsed to icons, a group opens its children in a flyout (wapyt.Popup).
  // Labels, headings and badges are set as text; styles live in wapyt.css.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_sidebar_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-sidebar"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") {
      return document.querySelector(target) || document.getElementById(target);
    }
    if (target && target.nodeType === 1) {
      return target;
    }
    return null;
  }

  function kindOf(item) {
    if (!item || typeof item !== "object") return null;
    if (item.type === "separator" || item.separator) return "separator";
    if (item.type === "spacer" || item.spacer) return "spacer";
    if (item.type === "heading") return "heading";
    return Array.isArray(item.items) ? "group" : "item";
  }

  class Sidebar {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          title: "Navigation",
          collapseButton: true,
          collapsed: false,
          items: [],
          active: null,
          expanded: null, // group ids open at mount; null = each group's own `expanded`
        },
        options || {}
      );
      this._events = {};
      this._buttons = new Map(); // id -> button, for items and groups
      this._items = new Map(); // id -> item spec
      this._parents = new Map(); // id -> parent group id
      this._expanded = new Set();
      this._flyout = null;
      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount Sidebar – target not found.");
      }
      this._host.classList.add("wapyt-sidebar");
      this._render();
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    _render() {
      this._closeFlyout();
      this._host.innerHTML = "";
      this._host.dataset.collapsed = this.options.collapsed ? "true" : "false";
      this._buttons.clear();
      this._items.clear();
      this._parents.clear();

      const header = document.createElement("div");
      header.className = "wapyt-sidebar-header";
      if (this.options.title) {
        const title = document.createElement("span");
        title.className = "wapyt-sidebar-title";
        title.textContent = this.options.title;
        header.appendChild(title);
      }
      if (this.options.collapseButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wapyt-sidebar-toggle";
        btn.setAttribute("aria-label", "Toggle sidebar");
        btn.setAttribute("aria-expanded", this.options.collapsed ? "false" : "true");
        const chevron = document.createElement("span");
        chevron.setAttribute("aria-hidden", "true");
        chevron.textContent = "‹";
        btn.appendChild(chevron);
        btn.addEventListener("click", () => this.toggle());
        header.appendChild(btn);
        this._toggleBtn = btn;
      }
      this._host.appendChild(header);

      this._list = document.createElement("nav");
      this._list.className = "wapyt-sidebar-list";
      this._list.setAttribute("aria-label", this.options.title || "Navigation");
      this._list.addEventListener("keydown", (event) => this._onKey(event));

      const initial = Array.isArray(this.options.expanded) ? new Set(this.options.expanded.map(String)) : null;
      this._expanded = new Set();
      this._build(this._list, this.options.items || [], 0, null, initial);
      this._host.appendChild(this._list);
      if (this.options.active) {
        this.setActive(this.options.active);
      }
    }

    _build(container, items, depth, parentId, initial) {
      items.forEach((item) => {
        const kind = kindOf(item);
        if (!kind) return;
        if (kind === "separator") {
          const hr = document.createElement("div");
          hr.className = "wapyt-sidebar-separator";
          hr.setAttribute("role", "separator");
          container.appendChild(hr);
          return;
        }
        if (kind === "spacer") {
          const spacer = document.createElement("div");
          spacer.className = "wapyt-sidebar-spacer";
          spacer.setAttribute("aria-hidden", "true");
          container.appendChild(spacer);
          return;
        }
        if (kind === "heading") {
          const heading = document.createElement("div");
          heading.className = "wapyt-sidebar-heading";
          heading.textContent = item.label || "";
          container.appendChild(heading);
          return;
        }

        const id = String(item.id);
        this._items.set(id, item);
        if (parentId != null) this._parents.set(id, parentId);
        const button = this._button(item, depth, kind);
        container.appendChild(button);

        if (kind === "group") {
          const open = initial ? initial.has(id) : Boolean(item.expanded);
          if (open) this._expanded.add(id);
          const children = document.createElement("div");
          children.className = "wapyt-sidebar-group";
          children.id = `wapyt-sidebar-group-${Math.random().toString(16).slice(2)}`;
          children.setAttribute("role", "group");
          children.hidden = !open;
          button.setAttribute("aria-expanded", open ? "true" : "false");
          button.setAttribute("aria-controls", children.id);
          container.appendChild(children);
          this._build(children, item.items, depth + 1, id, initial);
        }
      });
    }

    _button(item, depth, kind) {
      const id = String(item.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wapyt-sidebar-item";
      button.dataset.itemId = id;
      button.dataset.kind = kind;
      button.style.setProperty("--wapyt-sidebar-depth", String(depth));
      button.title = item.tooltip || item.label || "";
      if (item.disabled) button.disabled = true;

      const icon = this._renderIcon(item.icon);
      if (icon) button.appendChild(icon);
      else if (depth === 0) {
        // Keep top-level labels aligned, and give the collapsed rail something
        // to show: the label's first letter.
        const initialEl = document.createElement("span");
        initialEl.className = "wapyt-sidebar-icon wapyt-sidebar-initial";
        initialEl.setAttribute("aria-hidden", "true");
        initialEl.textContent = String(item.label || id).trim().charAt(0).toUpperCase();
        button.appendChild(initialEl);
      }

      const label = document.createElement("span");
      label.className = "wapyt-sidebar-label";
      label.textContent = item.label == null ? id : String(item.label);
      button.appendChild(label);

      const badge = document.createElement("span");
      badge.className = "wapyt-sidebar-badge";
      this._setBadgeEl(badge, item.badge);
      button.appendChild(badge);

      if (kind === "group") {
        const chevron = document.createElement("span");
        chevron.className = "wapyt-sidebar-chevron";
        chevron.setAttribute("aria-hidden", "true");
        button.appendChild(chevron);
      }

      button.addEventListener("click", () => {
        if (kind === "group") {
          if (this.isCollapsed()) this._openFlyout(id, button);
          else this._setExpanded(id, !this._expanded.has(id), true);
          return;
        }
        this._closeFlyout();
        this.setActive(id);
        this._emit("select", { id, data: item.data || {} });
      });
      this._buttons.set(id, button);
      return button;
    }

    _setBadgeEl(el, badge) {
      const has = badge !== null && badge !== undefined && badge !== "";
      el.textContent = has ? String(badge) : "";
      el.hidden = !has;
    }

    _renderIcon(iconValue) {
      if (!iconValue) {
        return null;
      }
      const span = document.createElement("span");
      span.className = "wapyt-sidebar-icon";
      const value = String(iconValue).trim();
      if (!value) {
        return null;
      }
      if (value.startsWith("<")) {
        // App-authored markup (an inline SVG). Never pass data through here.
        span.innerHTML = value;
      } else {
        // "mdi mdi-x" passes through; a Material Symbols name maps onto MDI.
        span.className = `wapyt-sidebar-icon ${globalNS.icons.iconClass(value)}`;
        span.setAttribute("aria-hidden", "true");
      }
      return span;
    }

    // ── Groups ───────────────────────────────────────────────────────────────

    _setExpanded(id, open, emit) {
      const button = this._buttons.get(String(id));
      if (!button || button.dataset.kind !== "group") return;
      const children = document.getElementById(button.getAttribute("aria-controls"));
      if (open) this._expanded.add(String(id));
      else this._expanded.delete(String(id));
      button.setAttribute("aria-expanded", open ? "true" : "false");
      if (children) children.hidden = !open;
      if (emit) this._emit("toggle", { id: String(id), expanded: open, expanded_ids: this.getExpanded() });
    }

    expandGroup(id) {
      this._setExpanded(id, true, false);
    }

    collapseGroup(id) {
      this._setExpanded(id, false, false);
    }

    getExpanded() {
      return Array.from(this._expanded);
    }

    setExpanded(ids) {
      const wanted = new Set((ids || []).map(String));
      this._buttons.forEach((button, id) => {
        if (button.dataset.kind === "group") this._setExpanded(id, wanted.has(id), false);
      });
    }

    // Collapsed to icons, a group's children open in a flyout beside it.
    _openFlyout(id, button) {
      const group = this._items.get(id);
      if (!group || !globalNS.Popup) return;
      if (this._flyout && this._flyoutId === id) {
        this._closeFlyout();
        return;
      }
      this._closeFlyout();
      const popup = new globalNS.Popup({ placement: "right-start", label: group.label || id, css: "wapyt-sidebar-flyout" });
      const heading = document.createElement("div");
      heading.className = "wapyt-sidebar-heading";
      heading.textContent = group.label || id;
      popup.body.appendChild(heading);
      const list = document.createElement("div");
      list.className = "wapyt-sidebar-list";
      popup.body.appendChild(list);
      this._flyoutItems(list, group.items || [], 0);
      popup.on("hide", () => {
        if (this._flyout === popup) {
          this._flyout = null;
          this._flyoutId = null;
        }
      });
      this._flyout = popup;
      this._flyoutId = id;
      popup.show(button);
    }

    _flyoutItems(container, items, depth) {
      items.forEach((item) => {
        const kind = kindOf(item);
        if (kind === "separator") {
          const hr = document.createElement("div");
          hr.className = "wapyt-sidebar-separator";
          container.appendChild(hr);
        } else if (kind === "heading") {
          const heading = document.createElement("div");
          heading.className = "wapyt-sidebar-heading";
          heading.textContent = item.label || "";
          container.appendChild(heading);
        } else if (kind === "item" || kind === "group") {
          const id = String(item.id);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "wapyt-sidebar-item";
          button.dataset.itemId = id;
          button.style.setProperty("--wapyt-sidebar-depth", String(depth));
          button.dataset.active = this.options.active === id ? "true" : "false";
          if (item.disabled || kind === "group") button.disabled = kind !== "group" && Boolean(item.disabled);
          const icon = this._renderIcon(item.icon);
          if (icon) button.appendChild(icon);
          const label = document.createElement("span");
          label.className = "wapyt-sidebar-label";
          label.textContent = item.label == null ? id : String(item.label);
          button.appendChild(label);
          if (kind === "group") {
            // Nested groups are listed open inside the flyout.
            button.disabled = true;
            container.appendChild(button);
            this._flyoutItems(container, item.items || [], depth + 1);
            return;
          }
          button.addEventListener("click", () => {
            this._closeFlyout();
            this.setActive(id);
            this._emit("select", { id, data: item.data || {} });
          });
          container.appendChild(button);
        }
      });
    }

    _closeFlyout() {
      if (this._flyout) {
        const popup = this._flyout;
        this._flyout = null;
        this._flyoutId = null;
        popup.destroy();
      }
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────

    _visibleButtons() {
      return Array.from(this._list.querySelectorAll(".wapyt-sidebar-item")).filter(
        (button) => !button.disabled && button.offsetParent !== null
      );
    }

    _onKey(event) {
      const button = event.target.closest && event.target.closest(".wapyt-sidebar-item");
      if (!button) return;
      const buttons = this._visibleButtons();
      const index = buttons.indexOf(button);
      const id = button.dataset.itemId;
      const group = button.dataset.kind === "group";
      let target = null;
      switch (event.key) {
        case "ArrowDown": target = buttons[index + 1]; break;
        case "ArrowUp": target = buttons[index - 1]; break;
        case "Home": target = buttons[0]; break;
        case "End": target = buttons[buttons.length - 1]; break;
        case "ArrowRight":
          if (group && !this.isCollapsed()) {
            if (!this._expanded.has(id)) this._setExpanded(id, true, true);
            else target = buttons[index + 1];
          }
          break;
        case "ArrowLeft":
          if (group && this._expanded.has(id) && !this.isCollapsed()) this._setExpanded(id, false, true);
          else if (this._parents.has(id)) target = this._buttons.get(this._parents.get(id));
          break;
        default:
          return;
      }
      event.preventDefault();
      if (target) target.focus();
    }

    // ── Public API ───────────────────────────────────────────────────────────

    isCollapsed() {
      return this._host.dataset.collapsed === "true";
    }

    _setCollapsed(collapsed) {
      this._closeFlyout();
      this._host.dataset.collapsed = collapsed ? "true" : "false";
      this.options.collapsed = collapsed;
      if (this._toggleBtn) this._toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      this._emit(collapsed ? "collapse" : "expand");
    }

    collapse() {
      this._setCollapsed(true);
    }

    expand() {
      this._setCollapsed(false);
    }

    toggle() {
      this._setCollapsed(!this.isCollapsed());
    }

    setActive(id) {
      if (id == null) return;
      const key = String(id);
      this._buttons.forEach((button, itemId) => {
        button.dataset.active = itemId === key ? "true" : "false";
        if (itemId === key) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
        delete button.dataset.hasActive;
      });
      // Open the groups above the active item and mark them, so the rail shows
      // which group holds it when collapsed.
      let parent = this._parents.get(key);
      while (parent != null) {
        const parentBtn = this._buttons.get(parent);
        if (parentBtn) parentBtn.dataset.hasActive = "true";
        this._setExpanded(parent, true, false);
        parent = this._parents.get(parent);
      }
      this.options.active = key;
    }

    getActive() {
      return this.options.active || null;
    }

    setBadge(id, badge) {
      const button = this._buttons.get(String(id));
      const item = this._items.get(String(id));
      if (item) item.badge = badge;
      if (button) this._setBadgeEl(button.querySelector(".wapyt-sidebar-badge"), badge);
    }

    // Replace the items, keeping which groups are open and the active item.
    setItems(items) {
      this.options.items = Array.isArray(items) ? items : [];
      this.options.expanded = this.getExpanded();
      this._render();
    }

    on(event, handler) {
      if (!this._events[event]) {
        this._events[event] = new Set();
      }
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
          console.error("[wapyt] Sidebar handler failed", error);
        }
      });
    }

    destroy() {
      this._closeFlyout();
      this._events = {};
      this._host.innerHTML = "";
    }
  }

  globalNS.Sidebar = Sidebar;
})();
