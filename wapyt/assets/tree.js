(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_treehost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-tree"></div>`);
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

  // Labels and badges reach the DOM through textContent; icons only ever
  // receive a class name. Nothing here interpolates node data into innerHTML.
  class Tree {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          items: [],
          selected: null,
          expandAll: false,
          filterable: false,
          filterPlaceholder: "Filter",
          emptyText: "Nothing here",
          contextActions: [],
          indent: 14,
        },
        options || {}
      );

      this._events = {};
      this._items = [];
      this._index = new Map();
      this._expanded = new Set();
      this._selected = this.options.selected ? String(this.options.selected) : null;
      this._filter = "";

      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount Tree – target not found.");
      }
      this._render();
      this.setItems(this.options.items || []);
    }

    _render() {
      this._host.classList.add("wapyt-tree");
      this._host.innerHTML = "";

      if (this.options.filterable) {
        const bar = document.createElement("div");
        bar.className = "wapyt-tree-toolbar";
        const input = document.createElement("input");
        input.type = "search";
        input.className = "wapyt-tree-filter";
        input.placeholder = this.options.filterPlaceholder || "Filter";
        input.addEventListener("input", () => {
          this._filter = input.value.trim().toLowerCase();
          this._renderNodes();
          this._emit("filter", { value: this._filter });
        });
        bar.appendChild(input);
        this._filterInput = input;
        this._host.appendChild(bar);
      }

      this._scroller = document.createElement("div");
      this._scroller.className = "wapyt-tree-scroll";
      this._host.appendChild(this._scroller);

      this._status = document.createElement("div");
      this._status.className = "wapyt-tree-status";
      this._status.hidden = true;
      // Inside the scroller, not after it: as a sibling of the flex:1
      // scroller the empty state gets pushed to the bottom of the panel.
      this._scroller.appendChild(this._status);

      this._buildContextMenu();
    }

    _buildContextMenu() {
      const actions = this.options.contextActions || [];
      if (!actions.length) return;

      const menu = document.createElement("div");
      menu.className = "wapyt-tree-menu";
      menu.hidden = true;
      actions.forEach((action) => {
        if (action && action.separator) {
          const sep = document.createElement("div");
          sep.className = "wapyt-tree-menu-sep";
          menu.appendChild(sep);
          return;
        }
        const item = document.createElement("button");
        item.type = "button";
        item.className = "wapyt-tree-menu-item";
        if (action.danger) item.dataset.danger = "true";
        if (action.icon) {
          const icon = document.createElement("span");
          icon.className = iconClass(action.icon);
          item.appendChild(icon);
        }
        const label = document.createElement("span");
        label.textContent = action.label || action.id;
        item.appendChild(label);
        item.addEventListener("click", () => {
          const nodeId = menu.dataset.nodeId;
          this._hideMenu();
          this._emit("action", {
            action: action.id,
            id: nodeId,
            node: this.getNode(nodeId),
          });
        });
        // A folder-only or leaf-only action is filtered when the menu opens.
        item.dataset.scope = action.scope || "any";
        menu.appendChild(item);
      });

      document.body.appendChild(menu);
      this._menu = menu;
      this._dismissMenu = (event) => {
        if (this._menu && !this._menu.hidden && !this._menu.contains(event.target)) {
          this._hideMenu();
        }
      };
      document.addEventListener("pointerdown", this._dismissMenu, true);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this._hideMenu();
      });
      this._scroller.addEventListener("scroll", () => this._hideMenu());
    }

    _showMenu(nodeId, x, y) {
      if (!this._menu) return;
      const node = this.getNode(nodeId);
      const isBranch = Boolean(node && node.items && node.items.length);
      let visible = 0;
      this._menu.querySelectorAll(".wapyt-tree-menu-item").forEach((item) => {
        const scope = item.dataset.scope || "any";
        const show =
          scope === "any" ||
          (scope === "branch" && isBranch) ||
          (scope === "leaf" && !isBranch);
        item.hidden = !show;
        if (show) visible += 1;
      });
      if (!visible) return;

      this._menu.dataset.nodeId = nodeId;
      this._menu.hidden = false;
      const rect = this._menu.getBoundingClientRect();
      const left = Math.min(x, window.innerWidth - rect.width - 8);
      const top = Math.min(y, window.innerHeight - rect.height - 8);
      this._menu.style.left = `${Math.max(8, left)}px`;
      this._menu.style.top = `${Math.max(8, top)}px`;
    }

    _hideMenu() {
      if (this._menu) this._menu.hidden = true;
    }

    // ── Data ─────────────────────────────────────────────────────────────────

    _reindex(items, parentId) {
      (items || []).forEach((item) => {
        if (!item || item.id == null) return;
        const id = String(item.id);
        this._index.set(id, { node: item, parent: parentId });
        if (item.items && item.items.length) {
          // Expansion state is keyed by id and deliberately survives setItems,
          // so reloading the list does not collapse everything the user opened.
          if (this.options.expandAll && !this._expanded.has(id)) {
            this._expanded.add(id);
          }
          this._reindex(item.items, id);
        }
      });
    }

    setItems(items) {
      this._items = Array.isArray(items) ? items : [];
      this._index.clear();
      this._reindex(this._items, null);
      if (this._selected && !this._index.has(this._selected)) {
        this._selected = null;
      }
      this._renderNodes();
    }

    getNode(id) {
      const entry = this._index.get(String(id));
      return entry ? entry.node : null;
    }

    getParentId(id) {
      const entry = this._index.get(String(id));
      return entry ? entry.parent : null;
    }

    _matches(node) {
      if (!this._filter) return true;
      const label = String(node.label ?? node.id ?? "").toLowerCase();
      if (label.includes(this._filter)) return true;
      return (node.items || []).some((child) => this._matches(child));
    }

    _renderNodes() {
      // innerHTML drops the status node along with the rows, so re-attach it.
      this._scroller.innerHTML = "";
      this._scroller.appendChild(this._status);
      const visible = (this._items || []).filter((node) => this._matches(node));
      if (!visible.length) {
        this._status.textContent = this.options.emptyText;
        this._status.hidden = false;
        return;
      }
      this._status.hidden = true;
      const fragment = document.createDocumentFragment();
      visible.forEach((node) => this._renderNode(node, 0, fragment));
      this._scroller.appendChild(fragment);
    }

    _renderNode(node, depth, parentEl) {
      const id = String(node.id);
      const children = (node.items || []).filter((child) => this._matches(child));
      const isBranch = Boolean(node.items && node.items.length);
      // A filter match deep in the tree is useless if its folder stays shut.
      const expanded = this._filter ? true : this._expanded.has(id);

      const row = document.createElement("div");
      row.className = "wapyt-tree-row";
      row.dataset.nodeId = id;
      row.dataset.depth = String(depth);
      row.style.paddingLeft = `${6 + depth * this.options.indent}px`;
      if (this._selected === id) row.dataset.selected = "true";
      if (isBranch) row.dataset.branch = "true";

      const twisty = document.createElement("span");
      twisty.className = "wapyt-tree-twisty";
      if (isBranch) {
        twisty.textContent = expanded ? "▾" : "▸";
        twisty.addEventListener("click", (event) => {
          event.stopPropagation();
          this.toggle(id);
        });
      }
      row.appendChild(twisty);

      const icon = document.createElement("span");
      const iconName = isBranch
        ? expanded
          ? node.open_icon || node.icon || "mdi-folder-open"
          : node.icon || "mdi-folder"
        : node.icon || "mdi-file-outline";
      icon.className = `wapyt-tree-icon ${iconClass(iconName)}`;
      row.appendChild(icon);

      const label = document.createElement("span");
      label.className = "wapyt-tree-label";
      label.textContent = node.label != null ? node.label : id;
      label.title = node.tooltip || label.textContent;
      row.appendChild(label);

      if (node.badge != null) {
        const badge = document.createElement("span");
        badge.className = "wapyt-tree-badge";
        badge.textContent = String(node.badge);
        row.appendChild(badge);
      }

      row.addEventListener("click", () => {
        this.select(id);
        if (isBranch) this.toggle(id);
      });
      row.addEventListener("dblclick", (event) => {
        event.preventDefault();
        if (!isBranch) {
          this._emit("activate", { id, node });
        }
      });
      row.addEventListener("contextmenu", (event) => {
        if (!this._menu) return;
        event.preventDefault();
        this.select(id);
        this._showMenu(id, event.clientX, event.clientY);
      });

      parentEl.appendChild(row);

      if (isBranch && expanded) {
        children.forEach((child) => this._renderNode(child, depth + 1, parentEl));
      }
    }

    // ── State ────────────────────────────────────────────────────────────────

    select(id) {
      const next = id == null ? null : String(id);
      if (this._selected === next) {
        // Still notify: clicking the current row is how a toolbar re-reads it.
        this._emit("select", { id: next, node: next ? this.getNode(next) : null });
        return;
      }
      this._selected = next;
      this._renderNodes();
      this._emit("select", { id: next, node: next ? this.getNode(next) : null });
    }

    getSelected() {
      return this._selected;
    }

    expand(id) {
      this._expanded.add(String(id));
      this._renderNodes();
    }

    collapse(id) {
      this._expanded.delete(String(id));
      this._renderNodes();
    }

    toggle(id) {
      const key = String(id);
      if (this._expanded.has(key)) {
        this._expanded.delete(key);
      } else {
        this._expanded.add(key);
      }
      this._renderNodes();
      this._emit("toggle", { id: key, expanded: this._expanded.has(key) });
    }

    expandAll() {
      this._index.forEach((entry, id) => {
        if (entry.node.items && entry.node.items.length) {
          this._expanded.add(id);
        }
      });
      this._renderNodes();
    }

    collapseAll() {
      this._expanded.clear();
      this._renderNodes();
    }

    getExpanded() {
      return Array.from(this._expanded);
    }

    setExpanded(ids) {
      this._expanded = new Set((ids || []).map((id) => String(id)));
      this._renderNodes();
    }

    setFilter(value) {
      this._filter = String(value || "").trim().toLowerCase();
      if (this._filterInput) this._filterInput.value = value || "";
      this._renderNodes();
    }

    setEmptyText(text) {
      this.options.emptyText = text;
      this._renderNodes();
    }

    destroy() {
      if (this._dismissMenu) {
        document.removeEventListener("pointerdown", this._dismissMenu, true);
      }
      if (this._menu && this._menu.parentNode) {
        this._menu.parentNode.removeChild(this._menu);
      }
      this._host.innerHTML = "";
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
          console.error("[wapyt] Tree listener failed", error);
        }
      });
    }
  }

  globalThis.wapyt.Tree = Tree;
})();
