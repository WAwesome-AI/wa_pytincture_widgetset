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

  const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag
  const OPEN_DELAY = 650; // ms hovering a closed branch before it opens

  function hasChildren(node) {
    return Boolean(node && node.items && node.items.length);
  }

  // Labels and badges reach the DOM through textContent; icons only ever
  // receive a class name. Nothing here interpolates node data into innerHTML.
  //
  // WAI-ARIA tree: the scroller is role="tree", rows are treeitems with one
  // roving tab stop (this._focusId). Every change re-renders the rows, so the
  // focused row is re-focused after a render when focus was in the tree.
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
          checkboxes: false,
          checkCascade: true,
          draggable: false,
          dropIntoLeaves: false,
          label: "Tree",
        },
        options || {}
      );

      this._events = {};
      this._items = [];
      this._index = new Map();
      this._expanded = new Set();
      this._checked = new Set();
      this._selected = this.options.selected ? String(this.options.selected) : null;
      this._focusId = this._selected;
      this._filter = "";
      this._drag = null;

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
        input.setAttribute("aria-label", this.options.filterPlaceholder || "Filter");
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
      this._scroller.setAttribute("role", "tree");
      this._scroller.setAttribute("aria-label", String(this.options.label || "Tree"));
      if (this.options.checkboxes) this._scroller.setAttribute("aria-multiselectable", "true");
      this._scroller.addEventListener("keydown", (event) => this._onKey(event));
      this._scroller.addEventListener("pointerdown", (event) => this._onPointerDown(event));
      this._host.appendChild(this._scroller);

      this._status = document.createElement("div");
      this._status.className = "wapyt-tree-status";
      this._status.hidden = true;
      // Inside the scroller, not after it: as a sibling of the flex:1
      // scroller the empty state gets pushed to the bottom of the panel.
      this._scroller.appendChild(this._status);

      // Keyboard moves are announced here.
      this._live = document.createElement("div");
      this._live.className = "wapyt-tree-live";
      this._live.setAttribute("aria-live", "polite");
      this._host.appendChild(this._live);

      this._buildContextMenu();
    }

    // The right-click menu is a wapyt.ContextMenu (keyboard, focus, ARIA,
    // clean-up). TreeAction stays the public API: each action gets an
    // internal id, so two actions sharing an id cannot hide each other, and
    // scope / kinds / requires decide per node which ones are hidden.
    _buildContextMenu() {
      const actions = this.options.contextActions || [];
      if (!actions.length) return;
      const ContextMenu = globalThis.wapyt && globalThis.wapyt.ContextMenu;
      if (!ContextMenu) {
        console.warn("[wapyt.Tree] context actions need wapyt.ContextMenu (contextmenu.js)");
        return;
      }
      this._menuActions = actions.map((action, index) => ({ key: `a${index}`, action: action || {} }));
      const items = this._menuActions.map(({ key, action }) =>
        action.separator
          ? { separator: true }
          : {
              id: key,
              label: action.label || action.id,
              icon: action.icon,
              danger: Boolean(action.danger),
              data: { actionId: String(action.id) },
            }
      );
      this._menu = new ContextMenu({
        items,
        label: "Tree actions",
        menuClass: "wapyt-tree-menu",
        itemClass: "wapyt-tree-menu-item",
      });
      this._menu.on("select", ({ id, context }) => {
        const entry = this._menuActions.find((candidate) => candidate.key === id);
        if (!entry) return;
        this._emit("action", { action: entry.action.id, id: context, node: this.getNode(context) });
      });
    }

    _actionApplies(action, node) {
      const isBranch = hasChildren(node);
      const kind = node && node.data && node.data.kind != null ? String(node.data.kind) : null;
      const flags = node && node.data && Array.isArray(node.data.flags)
        ? node.data.flags.map(String) : [];
      const scope = action.scope || "any";
      const kinds = Array.isArray(action.kinds) && action.kinds.length ? action.kinds.map(String) : null;
      const requires = Array.isArray(action.requires) ? action.requires.map(String) : [];
      return (
        (scope === "any" || (scope === "branch" && isBranch) || (scope === "leaf" && !isBranch)) &&
        (!kinds || (kind !== null && kinds.includes(kind))) &&
        requires.every((flag) => flags.includes(flag))
      );
    }

    _showMenu(nodeId, x, y) {
      if (!this._menu) return;
      const node = this.getNode(nodeId);
      const hide = [];
      let visible = 0;
      this._menuActions.forEach(({ key, action }) => {
        if (action.separator) return;
        if (this._actionApplies(action, node)) visible += 1;
        else hide.push(key);
      });
      if (!visible) return;
      // ContextMenu drops separators left leading, trailing or doubled.
      this._menu.showAt(x, y, { context: nodeId, hide });
    }

    _hideMenu() {
      if (this._menu) this._menu.hide(false);
    }

    // ── Data ─────────────────────────────────────────────────────────────────

    _reindex(items, parentId) {
      (items || []).forEach((item) => {
        if (!item || item.id == null) return;
        const id = String(item.id);
        this._index.set(id, { node: item, parent: parentId });
        if (hasChildren(item)) {
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
      if (this._focusId && !this._index.has(this._focusId)) this._focusId = null;
      // Checks survive a reload for ids that still exist; items marked
      // `checked` add theirs.
      const kept = new Set();
      this._checked.forEach((id) => { if (this._index.has(id)) kept.add(id); });
      this._checked = kept;
      this._index.forEach(({ node }, id) => {
        if (node.checked) this._setCheckedRaw(id, true);
      });
      this._renderNodes();
    }

    getItems() {
      return this._items;
    }

    getNode(id) {
      const entry = this._index.get(String(id));
      return entry ? entry.node : null;
    }

    getParentId(id) {
      const entry = this._index.get(String(id));
      return entry ? entry.parent : null;
    }

    _siblings(parentId) {
      if (parentId == null) return this._items;
      const parent = this.getNode(parentId);
      if (!parent) return null;
      if (!parent.items) parent.items = [];
      return parent.items;
    }

    _isAncestor(ancestorId, id) {
      for (let cur = this.getParentId(id); cur != null; cur = this.getParentId(cur)) {
        if (cur === ancestorId) return true;
      }
      return false;
    }

    _matches(node) {
      if (!this._filter) return true;
      const label = String(node.label ?? node.id ?? "").toLowerCase();
      if (label.includes(this._filter)) return true;
      return (node.items || []).some((child) => this._matches(child));
    }

    // ── Checkboxes ───────────────────────────────────────────────────────────
    //
    // With cascade (the default) only leaves hold a state: a branch is
    // checked when all its leaves are, mixed when some are, and checking it
    // checks every leaf under it. Without cascade every node is independent.

    _hasBox(node) {
      return this.options.checkboxes && node && node.checkbox !== false;
    }

    _leafIds(id, out = []) {
      const node = this.getNode(id);
      if (!node) return out;
      if (!hasChildren(node)) {
        if (this._hasBox(node)) out.push(String(node.id));
        return out;
      }
      node.items.forEach((child) => this._leafIds(String(child.id), out));
      return out;
    }

    _setCheckedRaw(id, checked) {
      const node = this.getNode(id);
      if (!node) return;
      const ids = this.options.checkCascade && hasChildren(node) ? this._leafIds(id) : [String(id)];
      ids.forEach((leaf) => (checked ? this._checked.add(leaf) : this._checked.delete(leaf)));
    }

    // "true" / "false" / "mixed"
    _checkState(id) {
      const node = this.getNode(id);
      if (!node) return "false";
      if (!this.options.checkCascade || !hasChildren(node)) return this._checked.has(String(id)) ? "true" : "false";
      const leaves = this._leafIds(id);
      if (!leaves.length) return "false";
      const on = leaves.filter((leaf) => this._checked.has(leaf)).length;
      return on === 0 ? "false" : on === leaves.length ? "true" : "mixed";
    }

    _toggleCheck(id) {
      const node = this.getNode(id);
      if (!this._hasBox(node)) return;
      const checked = this._checkState(id) !== "true";
      this._setCheckedRaw(id, checked);
      this._renderNodes();
      this._emit("check", { id: String(id), checked, checked_ids: this.getChecked() });
    }

    check(id, checked = true) {
      if (!this.getNode(id)) throw new Error(`Tree has no node '${id}'`);
      this._setCheckedRaw(String(id), Boolean(checked));
      this._renderNodes();
    }

    setChecked(ids) {
      this._checked = new Set();
      (ids || []).forEach((id) => this._setCheckedRaw(String(id), true));
      this._renderNodes();
    }

    // Every node whose state is checked (fully checked branches included),
    // in tree order; leavesOnly keeps just the leaves.
    getChecked(leavesOnly = false) {
      const out = [];
      const walk = (items) => (items || []).forEach((node) => {
        const id = String(node.id);
        if (this._hasBox(node) && (!leavesOnly || !hasChildren(node)) && this._checkState(id) === "true") out.push(id);
        walk(node.items);
      });
      walk(this._items);
      return out;
    }

    isChecked(id) {
      return this._checkState(String(id)) === "true";
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    _renderNodes() {
      const hadFocus = this._scroller.contains(document.activeElement) &&
        document.activeElement !== this._scroller;
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
      visible.forEach((node, index) => this._renderNode(node, 0, fragment, index + 1, visible.length));
      this._scroller.appendChild(fragment);

      // One tab stop: the focused row if still shown, else the selected one,
      // else the first.
      const rows = this._rows();
      let stop = rows.find((row) => row.dataset.nodeId === this._focusId)
        || rows.find((row) => row.dataset.nodeId === this._selected) || rows[0];
      if (stop) {
        stop.tabIndex = 0;
        this._focusId = stop.dataset.nodeId;
        if (hadFocus) stop.focus({ preventScroll: false });
      }
    }

    _rows() {
      return Array.from(this._scroller.querySelectorAll(".wapyt-tree-row"));
    }

    _rowFor(id) {
      return this._rows().find((row) => row.dataset.nodeId === String(id)) || null;
    }

    _renderNode(node, depth, parentEl, position, setSize) {
      const id = String(node.id);
      const children = (node.items || []).filter((child) => this._matches(child));
      const isBranch = hasChildren(node);
      // A filter match deep in the tree is useless if its folder stays shut.
      const expanded = this._filter ? true : this._expanded.has(id);

      const row = document.createElement("div");
      row.className = "wapyt-tree-row";
      row.dataset.nodeId = id;
      row.dataset.depth = String(depth);
      row.style.paddingLeft = `${6 + depth * this.options.indent}px`;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      row.setAttribute("aria-posinset", String(position));
      row.setAttribute("aria-setsize", String(setSize));
      row.setAttribute("aria-selected", this._selected === id ? "true" : "false");
      row.tabIndex = -1;
      if (this._selected === id) row.dataset.selected = "true";
      if (isBranch) {
        row.dataset.branch = "true";
        row.setAttribute("aria-expanded", expanded ? "true" : "false");
      }

      const twisty = document.createElement("span");
      twisty.className = "wapyt-tree-twisty";
      twisty.setAttribute("aria-hidden", "true");
      if (isBranch) {
        twisty.textContent = expanded ? "▾" : "▸";
        twisty.addEventListener("click", (event) => {
          event.stopPropagation();
          this._focusId = id;
          this.toggle(id);
        });
      }
      row.appendChild(twisty);

      if (this._hasBox(node)) {
        const state = this._checkState(id);
        row.setAttribute("aria-checked", state);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "wapyt-tree-check";
        box.tabIndex = -1;
        box.setAttribute("aria-hidden", "true");
        box.checked = state === "true";
        box.indeterminate = state === "mixed";
        // The row is the control (aria-checked); the box only takes clicks.
        box.addEventListener("click", (event) => {
          event.stopPropagation();
          event.preventDefault();
          this._focusId = id;
          this._toggleCheck(id);
        });
        row.appendChild(box);
      } else if (this.options.checkboxes) {
        // Keeps icons in a column when one node has no checkbox.
        const gap = document.createElement("span");
        gap.className = "wapyt-tree-check-gap";
        row.appendChild(gap);
      }

      const icon = document.createElement("span");
      const iconName = isBranch
        ? expanded
          ? node.open_icon || node.icon || "mdi-folder-open"
          : node.icon || "mdi-folder"
        : node.icon || "mdi-file-outline";
      icon.className = `wapyt-tree-icon ${iconClass(iconName)}`;
      icon.setAttribute("aria-hidden", "true");
      row.appendChild(icon);

      const label = document.createElement("span");
      label.className = "wapyt-tree-label";
      label.textContent = node.label != null ? node.label : id;
      label.title = node.tooltip || label.textContent;
      // The label as its own tooltip only helps when it is cut off
      // (tooltip.js checks; an explicit node.tooltip always shows).
      if (!node.tooltip) label.dataset.wapytTooltipOverflow = "true";
      row.appendChild(label);

      if (node.badge != null) {
        const badge = document.createElement("span");
        badge.className = "wapyt-tree-badge";
        badge.textContent = String(node.badge);
        row.appendChild(badge);
      }

      row.addEventListener("click", () => {
        if (this._suppressClick) {
          this._suppressClick = false;
          return;
        }
        this._focusId = id;
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
        this._focusId = id;
        this.select(id);
        this._showMenu(id, event.clientX, event.clientY);
      });

      parentEl.appendChild(row);

      // Rows stay a flat list (the apps' selectors and styles rely on it);
      // aria-level / posinset / setsize give the tree its structure.
      if (isBranch && expanded) {
        children.forEach((child, index) => this._renderNode(child, depth + 1, parentEl, index + 1, children.length));
      }
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────

    _focusRow(row) {
      if (!row) return;
      this._rows().forEach((r) => { r.tabIndex = r === row ? 0 : -1; });
      this._focusId = row.dataset.nodeId;
      row.focus();
    }

    _onKey(event) {
      const row = event.target.closest && event.target.closest(".wapyt-tree-row");
      if (!row || this._drag) return;
      const id = row.dataset.nodeId;
      const node = this.getNode(id);
      const rows = this._rows();
      const index = rows.indexOf(row);
      const isBranch = hasChildren(node);
      const open = isBranch && row.getAttribute("aria-expanded") === "true";

      if (event.altKey && this.options.draggable && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        this._keyboardMove(id, event.key);
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          this._focusRow(rows[Math.min(index + 1, rows.length - 1)]);
          break;
        case "ArrowUp":
          event.preventDefault();
          this._focusRow(rows[Math.max(index - 1, 0)]);
          break;
        case "Home":
          event.preventDefault();
          this._focusRow(rows[0]);
          break;
        case "End":
          event.preventDefault();
          this._focusRow(rows[rows.length - 1]);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (isBranch && !open) this.toggle(id);
          else if (open) this._focusRow(rows[index + 1]);
          break;
        case "ArrowLeft": {
          event.preventDefault();
          if (open) {
            this.toggle(id);
          } else {
            const parent = this.getParentId(id);
            if (parent != null) this._focusRow(this._rowFor(parent));
          }
          break;
        }
        case "Enter":
          event.preventDefault();
          this.select(id);
          if (isBranch) this.toggle(id);
          else this._emit("activate", { id, node });
          break;
        case " ":
          event.preventDefault();
          if (this._hasBox(node)) this._toggleCheck(id);
          else this.select(id);
          break;
        case "ContextMenu":
        case "F10":
          if (event.key === "F10" && !event.shiftKey) return;
          if (!this._menu) return;
          event.preventDefault();
          this.select(id);
          {
            const box = (this._rowFor(id) || row).getBoundingClientRect();
            this._showMenu(id, box.left + 24, box.bottom);
          }
          break;
        default:
          break;
      }
    }

    // ── Moving ───────────────────────────────────────────────────────────────

    _canDrag(node) {
      return this.options.draggable && node && node.draggable !== false;
    }

    // Whether `id` may go into parentId (null = the root).
    _canDropInto(id, parentId) {
      if (parentId == null) return true;
      const key = String(parentId);
      if (key === String(id) || this._isAncestor(String(id), key)) return false;
      const parent = this.getNode(key);
      if (!parent || parent.droppable === false) return false;
      return hasChildren(parent) || Boolean(this.options.dropIntoLeaves);
    }

    // Moves without an event; returns the move's details, or null if refused.
    // `force` (moves from code, such as putting a refused drop back) skips
    // the drop rules people are held to, but never allows a cycle.
    _applyMove(id, toParent, toIndex, force = false) {
      const key = String(id);
      const entry = this._index.get(key);
      if (!entry) throw new Error(`Tree has no node '${id}'`);
      const target = toParent == null ? null : String(toParent);
      if (target != null) {
        if (!this._index.has(target) || target === key || this._isAncestor(key, target)) return null;
        if (!force && !this._canDropInto(key, target)) return null;
      }
      const fromParent = entry.parent;
      const fromList = this._siblings(fromParent);
      const fromIndex = fromList.indexOf(entry.node);
      fromList.splice(fromIndex, 1);
      const toList = this._siblings(target);
      let index = Math.max(0, Math.min(Number(toIndex), toList.length));
      if (!Number.isFinite(index)) index = toList.length;
      toList.splice(index, 0, entry.node);
      if (target != null) this._expanded.add(target);
      // A branch emptied by the move becomes a leaf again (no twisty).
      this._index.clear();
      this._reindex(this._items, null);
      return { id: key, node: entry.node, from_parent: fromParent, from_index: fromIndex, to_parent: target, to_index: index };
    }

    move(id, toParent, toIndex) {
      const result = this._applyMove(id, toParent, toIndex, true);
      if (!result) throw new Error(`Tree cannot move '${id}' into '${toParent}'`);
      this._renderNodes();
    }

    _emitMove(result) {
      if (result.from_parent === result.to_parent && result.from_index === result.to_index) return;
      this._emit("move", result);
    }

    _keyboardMove(id, key) {
      if (this._filter) return;
      const node = this.getNode(id);
      if (!this._canDrag(node)) return;
      const parent = this.getParentId(id);
      const siblings = this._siblings(parent);
      const index = siblings.indexOf(node);
      let result = null;
      let where = "";
      if (key === "ArrowUp" && index > 0) {
        result = this._applyMove(id, parent, index - 1);
      } else if (key === "ArrowDown" && index < siblings.length - 1) {
        result = this._applyMove(id, parent, index + 1);
      } else if (key === "ArrowRight" && index > 0) {
        // Indent: the last child of the sibling above.
        const above = siblings[index - 1];
        if (this._canDropInto(id, String(above.id))) {
          result = this._applyMove(id, String(above.id), (above.items || []).length);
          where = ` into ${above.label ?? above.id}`;
        }
      } else if (key === "ArrowLeft" && parent != null) {
        // Outdent: right after the parent, at the parent's level.
        const grand = this.getParentId(parent);
        const parentIndex = this._siblings(grand).indexOf(this.getNode(parent));
        result = this._applyMove(id, grand, parentIndex + 1);
        where = ` out of ${this.getNode(parent).label ?? parent}`;
      }
      if (!result) return;
      this._focusId = String(id);
      this._renderNodes();
      const list = this._siblings(result.to_parent);
      this._live.textContent = `${node.label ?? id} moved${where}, ${result.to_index + 1} of ${list.length}`;
      this._emitMove(result);
    }

    // ── Pointer drag ─────────────────────────────────────────────────────────

    _onPointerDown(event) {
      if (event.button !== 0 || this._filter) return;
      const row = event.target.closest(".wapyt-tree-row");
      if (!row || event.target.closest(".wapyt-tree-check, .wapyt-tree-twisty")) return;
      const node = this.getNode(row.dataset.nodeId);
      if (!this._canDrag(node)) return;
      this._drag = { id: row.dataset.nodeId, row, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
      this._onPointerMove = (e) => this._dragMove(e);
      this._onPointerUp = (e) => this._dragEnd(e, false);
      this._onDragKey = (e) => {
        if (e.key === "Escape" && this._drag && this._drag.active) {
          e.preventDefault();
          e.stopPropagation();
          this._dragEnd(e, true);
        }
      };
      document.addEventListener("pointermove", this._onPointerMove);
      document.addEventListener("pointerup", this._onPointerUp);
      document.addEventListener("pointercancel", this._onPointerUp);
      document.addEventListener("keydown", this._onDragKey, true);
    }

    _dragStart() {
      const drag = this._drag;
      drag.active = true;
      this._host.dataset.dragging = "true";
      drag.row.dataset.dragging = "true";
      this._hideMenu();
      const ghost = document.createElement("div");
      ghost.className = "wapyt-tree-ghost";
      const node = this.getNode(drag.id);
      ghost.textContent = node.label != null ? String(node.label) : drag.id;
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      const line = document.createElement("div");
      line.className = "wapyt-tree-drop-line";
      line.hidden = true;
      this._scroller.appendChild(line);
      drag.line = line;
    }

    // Where a drop at clientY would land: before / after a row, or inside a
    // branch (its middle half). Rows in the dragged node's subtree are out.
    _dropTarget(clientX, clientY) {
      const drag = this._drag;
      const rows = this._rows().filter((row) => {
        const id = row.dataset.nodeId;
        return id !== drag.id && !this._isAncestor(drag.id, id);
      });
      let best = null;
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        if (clientY < box.top || clientY > box.bottom) continue;
        const id = row.dataset.nodeId;
        const fraction = (clientY - box.top) / box.height;
        const canInside = this._canDropInto(drag.id, id);
        let mode;
        if (canInside && fraction > 0.25 && fraction < 0.75) mode = "inside";
        else mode = fraction < 0.5 ? "before" : "after";
        best = { row, id, mode };
        break;
      }
      if (!best) return null;
      const parent = best.mode === "inside" ? best.id : this.getParentId(best.id);
      if (best.mode !== "inside" && !this._canDropInto(drag.id, parent)) return null;
      return best;
    }

    _dragMove(event) {
      const drag = this._drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
        this._dragStart();
      }
      event.preventDefault();
      drag.ghost.style.left = `${event.clientX + 12}px`;
      drag.ghost.style.top = `${event.clientY + 8}px`;
      this._autoScroll(event.clientY);
      const target = this._dropTarget(event.clientX, event.clientY);
      this._rows().forEach((row) => delete row.dataset.dropInside);
      drag.target = target;
      if (!target) {
        drag.line.hidden = true;
        this._clearOpenTimer();
        return;
      }
      if (target.mode === "inside") {
        drag.line.hidden = true;
        target.row.dataset.dropInside = "true";
        // Hovering a closed branch opens it, so a drop can go deeper.
        if (hasChildren(this.getNode(target.id)) && !this._expanded.has(target.id)) {
          if (drag.openFor !== target.id) {
            this._clearOpenTimer();
            drag.openFor = target.id;
            drag.openTimer = setTimeout(() => {
              if (this._drag && this._drag.openFor === target.id) {
                this._expanded.add(target.id);
                this._renderDuringDrag();
              }
            }, OPEN_DELAY);
          }
        } else {
          this._clearOpenTimer();
        }
      } else {
        this._clearOpenTimer();
        const box = target.row.getBoundingClientRect();
        const host = this._scroller.getBoundingClientRect();
        const openBranch = target.mode === "after" && hasChildren(this.getNode(target.id)) && this._expanded.has(target.id);
        const depth = Number(target.row.dataset.depth || 0) + (openBranch ? 1 : 0);
        drag.line.hidden = false;
        drag.line.style.top = `${(target.mode === "before" ? box.top : box.bottom) - host.top + this._scroller.scrollTop - 1}px`;
        drag.line.style.left = `${6 + depth * this.options.indent + 18}px`;
      }
    }

    _renderDuringDrag() {
      const drag = this._drag;
      this._renderNodes();
      drag.row = this._rowFor(drag.id) || drag.row;
      drag.row.dataset.dragging = "true";
      this._scroller.appendChild(drag.line);
    }

    _clearOpenTimer() {
      const drag = this._drag;
      if (drag && drag.openTimer) clearTimeout(drag.openTimer);
      if (drag) {
        drag.openTimer = null;
        drag.openFor = null;
      }
    }

    _autoScroll(clientY) {
      const box = this._scroller.getBoundingClientRect();
      const edge = 28;
      if (clientY < box.top + edge) this._scroller.scrollTop -= 12;
      else if (clientY > box.bottom - edge) this._scroller.scrollTop += 12;
    }

    _dragEnd(event, cancelled) {
      const drag = this._drag;
      if (!drag) return;
      document.removeEventListener("pointermove", this._onPointerMove);
      document.removeEventListener("pointerup", this._onPointerUp);
      document.removeEventListener("pointercancel", this._onPointerUp);
      document.removeEventListener("keydown", this._onDragKey, true);
      this._drag = null;
      if (!drag.active) return;
      if (drag.openTimer) clearTimeout(drag.openTimer);
      drag.ghost.remove();
      drag.line.remove();
      delete this._host.dataset.dragging;
      // The click that ends a drag must not select or toggle.
      this._suppressClick = true;
      setTimeout(() => { this._suppressClick = false; }, 0);
      const target = drag.target;
      if (cancelled || !target) {
        this._renderNodes();
        return;
      }
      let parent;
      let index;
      const targetNode = this.getNode(target.id);
      if (target.mode === "inside") {
        parent = target.id;
        index = (targetNode.items || []).length;
      } else if (target.mode === "after" && hasChildren(targetNode) && this._expanded.has(target.id)) {
        // Just below an open branch reads as "first child", so it is.
        parent = target.id;
        index = 0;
      } else {
        parent = this.getParentId(target.id);
        const siblings = this._siblings(parent);
        index = siblings.indexOf(this.getNode(target.id)) + (target.mode === "after" ? 1 : 0);
        // Removing the node first shifts later siblings up by one.
        const own = siblings.indexOf(this.getNode(drag.id));
        if (own >= 0 && own < index) index -= 1;
      }
      const result = this._applyMove(drag.id, parent, index);
      this._focusId = drag.id;
      this._renderNodes();
      if (result) this._emitMove(result);
    }

    // ── State ────────────────────────────────────────────────────────────────

    select(id) {
      const next = id == null ? null : String(id);
      if (next) this._focusId = next;
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
        if (hasChildren(entry.node)) {
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

    focus(id) {
      const row = id == null ? this._rows().find((r) => r.tabIndex === 0) : this._rowFor(id);
      if (row) this._focusRow(row);
    }

    destroy() {
      if (this._drag) this._dragEnd({}, true);
      if (this._menu) {
        this._menu.destroy();
        this._menu = null;
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
