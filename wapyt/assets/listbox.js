(function () {
  // Listbox: a list of rich items that can hold HTML and live widgets, with
  // selection, actions, a filter, and drag-and-drop within and between lists
  // that share a `group` (the base for Kanban columns).
  //
  // Each item is one <li>: a content part redrawn by updateItem, a body that
  // is never redrawn (itemBody(id) hands it out for mounting widgets), and an
  // actions row. Moves relocate the <li> itself, so mounted widgets survive a
  // drag into another list. Items hold buttons and widgets, so the list uses
  // role="list" / "listitem" (an ARIA option may not contain interactive
  // content); selection is announced with hidden text.
  //
  // Text fields are set with textContent. A template is escaped per value,
  // with the ResourceBoard opt-out: a key ending in "Html" is inserted raw.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});
  const DRAG_THRESHOLD = 5;
  const EDGE = 40; // px from a list edge that starts auto-scroll
  const groups = new Map(); // group name -> Set of Listbox

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_listbox_${Math.random().toString(16).slice(2)}`;
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function interpolate(template, item) {
    return String(template).replace(/\{([^}]+)\}/g, (_, token) => {
      const parts = token.trim().split(".");
      let value = item;
      for (const part of parts) {
        if (value == null) break;
        value = value[part];
      }
      if (value == null) return "";
      const raw = /Html$/.test(parts[parts.length - 1]);
      const text = Array.isArray(value) ? value.join(", ") : value;
      return raw ? String(text) : escapeHtml(text);
    });
  }

  // Presses on these never start a drag or select the item.
  const INTERACTIVE = "button, a[href], input, select, textarea, label, [contenteditable=''], [contenteditable='true'], [role='button'], .wapyt-listbox-nodrag";

  // Lists in a group, in document order (left to right, top to bottom), for
  // keyboard moves to the neighbouring list.
  function groupOrder(group) {
    return Array.from(groups.get(group) || []).filter((lb) => lb._list.isConnected).sort((a, b) =>
      a._list.compareDocumentPosition(b._list) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  class Listbox {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          items: [],
          idField: "id",
          template: null,
          selection: "single", // none | single | multi
          draggable: false,
          dragHandle: false,
          group: null,
          accept: true, // take drops from other lists in the group
          copy: false, // dragging out leaves the item here and copies it
          actions: [],
          filterable: false,
          filterPlaceholder: "Filter",
          emptyText: "No items",
          label: "List",
        },
        options || {}
      );
      this._events = {};
      this._items = new Map(); // id -> item data
      this._els = new Map(); // id -> <li>
      this._selected = new Set();
      this._anchor = null;
      this._focusId = null;
      this._lifted = null; // keyboard move in progress
      this._drag = null; // pointer drag in progress
      this._host = resolveHost(target);
      if (!this._host) throw new Error("Unable to mount Listbox – target not found.");
      this._build();
      this.setItems(this.options.items || []);
      if (this.options.group) {
        if (!groups.has(this.options.group)) groups.set(this.options.group, new Set());
        groups.get(this.options.group).add(this);
      }
    }

    // ── DOM ──────────────────────────────────────────────────────────────────

    _build() {
      this._host.innerHTML = "";
      this._host.classList.add("wapyt-listbox");
      if (this.options.draggable) this._host.dataset.draggable = "true";
      if (this.options.filterable) {
        this._filter = document.createElement("input");
        this._filter.type = "search";
        this._filter.className = "wapyt-listbox-filter";
        this._filter.placeholder = this.options.filterPlaceholder || "Filter";
        this._filter.setAttribute("aria-label", `Filter ${this.options.label || "list"}`);
        this._filter.addEventListener("input", () => this._applyFilter());
        this._host.appendChild(this._filter);
      }
      this._list = document.createElement("ul");
      this._list.className = "wapyt-listbox-list";
      this._list.setAttribute("role", "list");
      this._list.setAttribute("aria-label", String(this.options.label || "List"));
      this._list.addEventListener("keydown", (event) => this._onKey(event));
      this._list.addEventListener("pointerdown", (event) => this._onPointerDown(event));
      this._list.addEventListener("click", (event) => this._onClick(event));
      this._list.addEventListener("dblclick", (event) => {
        const li = this._liFrom(event.target);
        if (li && !event.target.closest(INTERACTIVE)) this._emit("activate", this._payload(li.dataset.id));
      });
      this._list.addEventListener("focusin", (event) => {
        const li = event.target.closest && event.target.closest(".wapyt-listbox-item");
        if (li && this._els.get(li.dataset.id) === li) this._setFocus(li.dataset.id, false);
      });
      this._host.appendChild(this._list);
      this._empty = document.createElement("div");
      this._empty.className = "wapyt-listbox-empty";
      this._host.appendChild(this._empty);
      this._live = document.createElement("div");
      this._live.className = "wapyt-listbox-live";
      this._live.setAttribute("aria-live", "assertive");
      this._host.appendChild(this._live);
    }

    _id(item) {
      return String(item[this.options.idField]);
    }

    _liFrom(node) {
      const li = node && node.closest ? node.closest(".wapyt-listbox-item") : null;
      return li && this._els.get(li.dataset.id) === li ? li : null;
    }

    _makeLi(item) {
      const id = this._id(item);
      const li = document.createElement("li");
      li.className = "wapyt-listbox-item";
      li.setAttribute("role", "listitem");
      li.dataset.id = id;
      li.tabIndex = -1;
      li._wapytOwner = this;
      if (this.options.draggable && this.options.dragHandle) {
        const handle = document.createElement("span");
        handle.className = "wapyt-listbox-handle mdi mdi-drag-vertical";
        handle.setAttribute("aria-hidden", "true");
        li.appendChild(handle);
      }
      const main = document.createElement("div");
      main.className = "wapyt-listbox-main";
      const content = document.createElement("div");
      content.className = "wapyt-listbox-content";
      main.appendChild(content);
      // Never redrawn: widgets mounted here survive updates and moves.
      const body = document.createElement("div");
      body.className = "wapyt-listbox-body";
      main.appendChild(body);
      li.appendChild(main);
      const actions = document.createElement("div");
      actions.className = "wapyt-listbox-actions";
      li.appendChild(actions);
      const state = document.createElement("span");
      state.className = "wapyt-listbox-live";
      li.appendChild(state);
      li._parts = { content, body, actions, state };
      this._fill(li, item);
      return li;
    }

    // Redraw the content and actions of one item from its data.
    _fill(li, item) {
      const { content, actions } = li._parts;
      content.textContent = "";
      if (this.options.template) {
        content.innerHTML = interpolate(this.options.template, item);
      } else {
        const head = document.createElement("div");
        head.className = "wapyt-listbox-head";
        if (item.icon) {
          const icon = document.createElement("i");
          icon.className = `wapyt-listbox-icon ${iconClass(item.icon)}`;
          icon.setAttribute("aria-hidden", "true");
          head.appendChild(icon);
        }
        const title = document.createElement("span");
        title.className = "wapyt-listbox-title";
        title.textContent = item.title == null ? this._id(item) : String(item.title);
        head.appendChild(title);
        if (item.badge !== undefined && item.badge !== null && item.badge !== "") {
          const badge = document.createElement("span");
          badge.className = "wapyt-listbox-badge";
          badge.textContent = String(item.badge);
          head.appendChild(badge);
        }
        content.appendChild(head);
        ["subtitle", "meta"].forEach((key) => {
          if (item[key] == null || item[key] === "") return;
          const line = document.createElement("div");
          line.className = `wapyt-listbox-${key}`;
          line.textContent = String(item[key]);
          content.appendChild(line);
        });
      }
      li.setAttribute("aria-label", String(item.title == null ? this._id(item) : item.title));
      if (item.disabled) li.setAttribute("aria-disabled", "true");
      else li.removeAttribute("aria-disabled");
      actions.textContent = "";
      (this.options.actions || []).forEach((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wapyt-listbox-action";
        button.dataset.action = String(action.id);
        button.tabIndex = -1;
        if (action.danger) button.dataset.danger = "true";
        const label = action.label || action.id;
        button.setAttribute("aria-label", String(label));
        button.title = String(label);
        if (action.icon) {
          const icon = document.createElement("i");
          icon.className = iconClass(action.icon);
          icon.setAttribute("aria-hidden", "true");
          button.appendChild(icon);
        } else {
          button.textContent = String(label);
        }
        actions.appendChild(button);
      });
      this._syncItemState(li);
    }

    _syncItemState(li) {
      const id = li.dataset.id;
      const selected = this._selected.has(id);
      if (selected) li.dataset.selected = "true";
      else delete li.dataset.selected;
      li._parts.state.textContent = selected ? ", selected" : "";
      const active = this._focusId === id;
      li.tabIndex = active ? 0 : -1;
      // Inner controls are in the tab order only for the focused item.
      li.querySelectorAll(".wapyt-listbox-action").forEach((b) => { b.tabIndex = active ? 0 : -1; });
    }

    _syncEmpty() {
      const visible = this._itemEls().some((li) => !li.hidden && li.dataset.dragging !== "true");
      this._empty.textContent = visible ? "" : String(this.options.emptyText || "");
      this._empty.hidden = visible;
    }

    // ── Items ────────────────────────────────────────────────────────────────

    setItems(items) {
      this._cancelLift();
      this._items.clear();
      this._els.clear();
      this._list.textContent = "";
      (items || []).forEach((item) => {
        const id = this._id(item);
        this._items.set(id, Object.assign({}, item));
        const li = this._makeLi(this._items.get(id));
        this._els.set(id, li);
        this._list.appendChild(li);
      });
      Array.from(this._selected).forEach((id) => { if (!this._items.has(id)) this._selected.delete(id); });
      if (!this._items.has(this._focusId)) this._focusId = null;
      this._ensureTabStop();
      this._applyFilter();
    }

    getItems() {
      return this._order().map((id) => this._items.get(id));
    }

    getItem(id) {
      return this._items.get(String(id)) || null;
    }

    // Item <li>s only: a drag placeholder can sit in the list too.
    _itemEls() {
      return Array.from(this._list.children).filter((el) => el.classList.contains("wapyt-listbox-item"));
    }

    _order() {
      return this._itemEls().map((li) => li.dataset.id);
    }

    addItem(item, index) {
      const id = this._id(item);
      if (this._items.has(id)) throw new Error(`Listbox: duplicate item id ${id}`);
      this._items.set(id, Object.assign({}, item));
      const li = this._makeLi(this._items.get(id));
      this._els.set(id, li);
      this._insertAt(li, index);
      this._ensureTabStop();
      this._applyFilter();
    }

    updateItem(id, fields) {
      const key = String(id);
      const item = this._items.get(key);
      const li = this._els.get(key);
      if (!item || !li) return;
      Object.assign(item, fields || {});
      this._fill(li, item);
      this._applyFilter();
    }

    removeItem(id) {
      const key = String(id);
      const li = this._els.get(key);
      if (!li) return;
      li.remove();
      this._els.delete(key);
      this._items.delete(key);
      this._selected.delete(key);
      if (this._focusId === key) this._focusId = null;
      this._ensureTabStop();
      this._syncEmpty();
    }

    // The persistent body element of an item, for mounting widgets.
    itemBody(id) {
      const li = this._els.get(String(id));
      return li ? li._parts.body : null;
    }

    _insertAt(li, index) {
      const kids = this._itemEls().filter((el) => el !== li);
      const at = index == null || index < 0 || index >= kids.length ? null : kids[index];
      this._list.insertBefore(li, at);
    }

    // Move an item to `index` in `target` (default: this list) without
    // firing "move": the app's way to put back a refused drop.
    move(id, index, target) {
      const key = String(id);
      const to = target || this;
      const li = this._els.get(key);
      if (!li) return false;
      const item = this._items.get(key);
      if (to !== this) {
        if (to._items.has(key)) return false;
        this._els.delete(key);
        this._items.delete(key);
        this._selected.delete(key);
        if (this._focusId === key) this._focusId = null;
        to._adopt(li, item);
      }
      // Insert first, so the source's empty state and tab stop see the
      // item already gone.
      to._insertAt(li, index);
      if (to !== this) {
        this._ensureTabStop();
        this._syncEmpty();
      }
      to._ensureTabStop();
      to._applyFilter();
      return true;
    }

    // Take ownership of an <li> (and its mounted widgets) from another list.
    _adopt(li, item) {
      const key = this._id(item);
      li._wapytOwner = this;
      this._items.set(key, item);
      this._els.set(key, li);
      // Actions and template belong to the receiving list.
      this._fill(li, item);
    }

    // ── Selection and focus ──────────────────────────────────────────────────

    _ensureTabStop() {
      if (!this._focusId || !this._els.has(this._focusId)) {
        const first = this._itemEls().find((li) => !li.hidden);
        this._focusId = first ? first.dataset.id : null;
      }
      this._els.forEach((li) => this._syncItemState(li));
    }

    _setFocus(id, move = true) {
      const key = String(id);
      const li = this._els.get(key);
      if (!li) return;
      const previous = this._focusId;
      this._focusId = key;
      if (previous && previous !== key && this._els.get(previous)) this._syncItemState(this._els.get(previous));
      this._syncItemState(li);
      if (move) li.focus();
    }

    _onClick(event) {
      if (this._suppressClick) {
        this._suppressClick = false;
        return;
      }
      const li = this._liFrom(event.target);
      if (!li) return;
      const actionBtn = event.target.closest(".wapyt-listbox-action");
      if (actionBtn && li.contains(actionBtn)) {
        this._emit("action", Object.assign({ action: actionBtn.dataset.action }, this._payload(li.dataset.id)));
        return;
      }
      if (event.target.closest(INTERACTIVE) || li.getAttribute("aria-disabled") === "true") return;
      if (li._parts.body.contains(event.target) && li._parts.body !== event.target) return;
      this._clickSelect(li.dataset.id, event);
    }

    _clickSelect(id, event) {
      const mode = this.options.selection;
      if (mode === "none") return;
      if (mode === "multi" && event && event.shiftKey && this._anchor) {
        const ids = this._visibleIds();
        const [a, b] = [ids.indexOf(this._anchor), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0 && b >= 0) ids.slice(a, b + 1).forEach((x) => this._selected.add(x));
      } else if (mode === "multi" && event && (event.ctrlKey || event.metaKey)) {
        if (this._selected.has(id)) this._selected.delete(id);
        else this._selected.add(id);
        this._anchor = id;
      } else {
        this._selected = new Set([id]);
        this._anchor = id;
      }
      this._els.forEach((li) => this._syncItemState(li));
      this._emitSelect();
    }

    _toggleSelect(id) {
      const mode = this.options.selection;
      if (mode === "none") return;
      if (mode === "single") this._selected = this._selected.has(id) ? new Set() : new Set([id]);
      else if (this._selected.has(id)) this._selected.delete(id);
      else this._selected.add(id);
      this._anchor = id;
      this._els.forEach((li) => this._syncItemState(li));
      this._emitSelect();
    }

    _emitSelect() {
      const ids = this.getSelectedIds();
      this._emit("select", { ids, id: ids.length === 1 ? ids[0] : null, items: ids.map((x) => this._items.get(x)) });
    }

    getSelectedIds() {
      return this._order().filter((id) => this._selected.has(id));
    }

    select(ids) {
      this._selected = new Set([].concat(ids || []).map(String).filter((id) => this._items.has(id)));
      this._els.forEach((li) => this._syncItemState(li));
      this._emitSelect();
    }

    clearSelection() {
      this.select([]);
    }

    _payload(id) {
      return { id: String(id), item: this._items.get(String(id)) || null };
    }

    _visibleIds() {
      return this._itemEls().filter((li) => !li.hidden).map((li) => li.dataset.id);
    }

    // ── Filter ───────────────────────────────────────────────────────────────

    setFilter(text) {
      if (this._filter) this._filter.value = String(text || "");
      this._filterText = String(text || "").trim().toLowerCase();
      this._applyFilter(true);
    }

    _applyFilter(fromApi) {
      if (this._filter && !fromApi) this._filterText = this._filter.value.trim().toLowerCase();
      const needle = this._filterText || "";
      this._els.forEach((li) => {
        li.hidden = Boolean(needle) && !li._parts.content.textContent.toLowerCase().includes(needle);
      });
      // Dragging into a filtered list would land between hidden items.
      if (needle) this._host.dataset.filtered = "true";
      else delete this._host.dataset.filtered;
      this._syncEmpty();
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────

    _onKey(event) {
      const li = this._liFrom(event.target);
      if (!li || event.target !== li) return; // keys inside an item's controls are theirs
      const id = li.dataset.id;
      if (this._lifted) {
        this._liftedKey(event);
        return;
      }
      const ids = this._visibleIds();
      const index = ids.indexOf(id);
      const go = (i) => {
        event.preventDefault();
        const next = ids[Math.max(0, Math.min(ids.length - 1, i))];
        if (next) {
          this._setFocus(next);
          if (event.shiftKey && this.options.selection === "multi") this._clickSelect(next, { shiftKey: true });
        }
      };
      switch (event.key) {
        case "ArrowDown": go(index + 1); break;
        case "ArrowUp": go(index - 1); break;
        case "Home": go(0); break;
        case "End": go(ids.length - 1); break;
        case "Enter":
          event.preventDefault();
          this._emit("activate", this._payload(id));
          break;
        case " ":
          event.preventDefault();
          if (this.options.draggable && !(event.ctrlKey || event.metaKey)) this._lift(id);
          else this._toggleSelect(id);
          break;
        default:
          break;
      }
    }

    _announce(text) {
      this._live.textContent = "";
      requestAnimationFrame(() => { this._live.textContent = text; });
    }

    _lift(id) {
      if (this._host.dataset.filtered || !this._els.has(id)) return;
      const li = this._els.get(id);
      if (li.getAttribute("aria-disabled") === "true") return;
      this._lifted = { id, li, from: this, fromIndex: this._order().indexOf(id) };
      li.dataset.lifted = "true";
      this._announce(`Picked up ${li.getAttribute("aria-label")}. Arrow keys move it, Space drops it, Escape cancels.`);
    }

    _liftedKey(event) {
      const lift = this._lifted;
      const owner = lift.li._wapytOwner;
      const order = owner._order();
      const index = order.indexOf(lift.id);
      event.preventDefault();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const to = index + (event.key === "ArrowDown" ? 1 : -1);
        if (to < 0 || to >= order.length) return;
        owner._insertAt(lift.li, to);
        lift.li.focus();
        owner._announce(`Position ${to + 1} of ${order.length}`);
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && owner.options.group) {
        const lists = groupOrder(owner.options.group);
        const next = lists[lists.indexOf(owner) + (event.key === "ArrowRight" ? 1 : -1)];
        if (!next || !next.options.accept || next._host.dataset.filtered) return;
        owner._handOver(lift, next, Math.min(index, next._order().length));
      } else if (event.key === " " || event.key === "Enter") {
        this._drop();
      } else if (event.key === "Escape") {
        event.stopPropagation();
        this._cancelLift(true);
      }
    }

    // Move a lifted item into another list while still lifted.
    _handOver(lift, next, index) {
      const item = this._items.get(lift.id);
      this._els.delete(lift.id);
      this._items.delete(lift.id);
      this._selected.delete(lift.id);
      if (this._focusId === lift.id) this._focusId = null;
      next._adopt(lift.li, item);
      next._insertAt(lift.li, index);
      this._ensureTabStop();
      this._syncEmpty();
      next._focusId = lift.id;
      next._ensureTabStop();
      next._syncEmpty();
      next._lifted = lift;
      this._lifted = null;
      lift.li.dataset.lifted = "true";
      lift.li.focus();
      next._announce(`Moved to ${next.options.label || "list"}, position ${index + 1}`);
    }

    _drop() {
      const lift = this._lifted;
      if (!lift) return;
      this._lifted = null;
      delete lift.li.dataset.lifted;
      const toIndex = this._order().indexOf(lift.id);
      this._announce(`Dropped at position ${toIndex + 1}`);
      if (lift.from === this && lift.fromIndex === toIndex) return;
      this._emitMove(lift.id, lift.from, this, lift.fromIndex, toIndex);
    }

    _cancelLift(announce) {
      const lift = this._lifted;
      if (!lift) return;
      this._lifted = null;
      delete lift.li.dataset.lifted;
      if (lift.li._wapytOwner !== lift.from || this !== lift.from) {
        this.move(lift.id, lift.fromIndex, lift.from);
      } else {
        this._insertAt(lift.li, lift.fromIndex);
      }
      lift.li.focus();
      if (announce) lift.from._announce("Move cancelled");
    }

    _emitMove(id, from, to, fromIndex, toIndex, copied = false) {
      to._emit("move", {
        id: String(id),
        item: to._items.get(String(id)) || null,
        from_list: from.options.listId || from.options.label || null,
        to_list: to.options.listId || to.options.label || null,
        from_index: fromIndex,
        to_index: toIndex,
        copy: copied,
      });
    }

    // ── Pointer drag ─────────────────────────────────────────────────────────

    _onPointerDown(event) {
      if (!this.options.draggable || event.button !== 0 || this._host.dataset.filtered) return;
      const li = this._liFrom(event.target);
      if (!li || li.getAttribute("aria-disabled") === "true") return;
      if (event.target.closest(INTERACTIVE)) return;
      if (li._parts.body.contains(event.target) && li._parts.body !== event.target) return;
      if (this.options.dragHandle && !event.target.closest(".wapyt-listbox-handle")) return;
      const start = { x: event.clientX, y: event.clientY };
      const id = li.dataset.id;
      const onMove = (e) => {
        if (!this._drag) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
          this._startDrag(li, id, e, start);
        }
        this._dragMove(e);
      };
      const onUp = (e) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (this._drag) this._endDrag(e, true);
      };
      const onCancel = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (this._drag) this._endDrag(null, false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    }

    _startDrag(li, id, event, start) {
      const rect = li.getBoundingClientRect();
      const ghost = li.cloneNode(true);
      ghost.classList.add("wapyt-listbox-ghost");
      ghost.removeAttribute("id");
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);
      const placeholder = document.createElement("li");
      placeholder.className = "wapyt-listbox-placeholder";
      placeholder.style.height = `${rect.height}px`;
      placeholder.setAttribute("aria-hidden", "true");
      // The item leaves the flow and the placeholder takes its exact place.
      // Keeping both (the item faded) doubled the space, so the item under
      // the pointer moved down a row and the drop kept snapping back to the
      // start. A copy source keeps its item visible and reorders nothing.
      if (this.options.copy) {
        li.dataset.dragging = "copy";
      } else {
        li.dataset.dragging = "true";
        this._list.insertBefore(placeholder, li);
      }
      this._drag = {
        id, li, ghost, placeholder,
        dx: start.x - rect.left, dy: start.y - rect.top,
        fromIndex: this._order().indexOf(id),
        target: null, index: null, scroll: 0,
      };
      this._onDragKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this._endDrag(null, false);
        }
      };
      document.addEventListener("keydown", this._onDragKey, true);
      document.documentElement.classList.add("wapyt-listbox-dragging");
      this._emit("drag_start", this._payload(id));
    }

    // Which list (in this group, accepting drops) is under the pointer.
    _dropTarget(x, y) {
      const el = document.elementFromPoint(x, y);
      const host = el && el.closest ? el.closest(".wapyt-listbox") : null;
      if (!host) return null;
      const candidates = this.options.group ? Array.from(groups.get(this.options.group) || []) : [this];
      const lb = candidates.find((c) => c._host === host);
      if (!lb || lb._host.dataset.filtered) return null;
      if (lb !== this && !lb.options.accept) return null;
      return lb;
    }

    _dragMove(event) {
      const drag = this._drag;
      if (!drag) return;
      drag.ghost.style.left = `${event.clientX - drag.dx}px`;
      drag.ghost.style.top = `${event.clientY - drag.dy}px`;
      let target = this._dropTarget(event.clientX, event.clientY);
      if (target === this && this.options.copy) target = null;
      if (!target) {
        drag.placeholder.remove();
        drag.target = null;
        this._stopScroll();
        return;
      }
      // Place the placeholder before the first item whose middle is below
      // the pointer, skipping the item being dragged.
      const kids = Array.from(target._list.children).filter((el) => el !== drag.li && el !== drag.placeholder && !el.hidden);
      let index = kids.length;
      for (let i = 0; i < kids.length; i += 1) {
        const r = kids[i].getBoundingClientRect();
        if (event.clientY < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      target._list.insertBefore(drag.placeholder, kids[index] || null);
      drag.target = target;
      drag.index = index;
      this._autoScroll(target, event.clientY);
    }

    _autoScroll(target, y) {
      const r = target._list.getBoundingClientRect();
      const speed = y < r.top + EDGE ? -(r.top + EDGE - y) / 3 : y > r.bottom - EDGE ? (y - (r.bottom - EDGE)) / 3 : 0;
      this._stopScroll();
      if (!speed) return;
      const step = () => {
        target._list.scrollTop += speed;
        this._scrollFrame = requestAnimationFrame(step);
      };
      this._scrollFrame = requestAnimationFrame(step);
    }

    _stopScroll() {
      if (this._scrollFrame) cancelAnimationFrame(this._scrollFrame);
      this._scrollFrame = 0;
    }

    _endDrag(event, commit) {
      const drag = this._drag;
      this._drag = null;
      this._stopScroll();
      document.removeEventListener("keydown", this._onDragKey, true);
      document.documentElement.classList.remove("wapyt-listbox-dragging");
      drag.ghost.remove();
      drag.placeholder.remove();
      delete drag.li.dataset.dragging;
      // The click that ends a drag must not select or activate.
      this._suppressClick = true;
      setTimeout(() => { this._suppressClick = false; }, 0);
      if (!commit || !drag.target) return;
      const target = drag.target;
      const index = drag.index;
      if (target === this) {
        const before = this._order();
        this._insertAt(drag.li, index);
        const toIndex = this._order().indexOf(drag.id);
        if (toIndex !== before.indexOf(drag.id)) this._emitMove(drag.id, this, this, drag.fromIndex, toIndex);
        return;
      }
      if (target._items.has(drag.id)) return; // the same id already there
      if (this.options.copy) {
        target.addItem(JSON.parse(JSON.stringify(this._items.get(drag.id))), index);
        this._emitMove(drag.id, this, target, drag.fromIndex, target._order().indexOf(drag.id), true);
        return;
      }
      this.move(drag.id, index, target);
      this._emitMove(drag.id, this, target, drag.fromIndex, target._order().indexOf(drag.id));
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
          console.error("[wapyt] Listbox listener failed", error);
        }
      });
    }

    destroy() {
      if (this._drag) this._endDrag(null, false);
      if (this.options.group && groups.has(this.options.group)) groups.get(this.options.group).delete(this);
      this._events = {};
      this._host.innerHTML = "";
    }
  }

  // Find the Listbox that owns a list id, for move(..., target) from Python.
  Listbox.byListId = (group, listId) =>
    Array.from(groups.get(group) || []).find((lb) => lb.options.listId === listId) || null;

  globalNS.Listbox = Listbox;
})();
