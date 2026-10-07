(function () {
  // Kanban: a row of columns, each a header and a wapyt.Listbox, all sharing
  // one private drag group. Cards are Listbox items, so templates, widgets in
  // card bodies, actions and keyboard moves come from Listbox; this file adds
  // the board: headers with counts and WIP limits, add-card buttons,
  // collapsing, reordering columns, a board-wide filter and selection.
  // Header text goes in through textContent.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});
  let boardCount = 0;
  const DRAG_THRESHOLD = 5;

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_kanban_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") return document.querySelector(target);
    if (target && target.nodeType === 1) return target;
    return null;
  }

  function iconButton(icon, label, cls) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wapyt-kanban-btn ${cls}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    const glyph = document.createElement("i");
    glyph.className = `mdi ${icon}`;
    glyph.setAttribute("aria-hidden", "true");
    button.appendChild(glyph);
    return button;
  }

  class Kanban {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          columns: [],
          idField: "id",
          template: null,
          actions: [],
          addCard: true,
          addCardLabel: "Add card",
          wipStrict: false, // a column at its limit takes no more cards
          filterable: false,
          filterPlaceholder: "Filter cards",
          columnWidth: 280,
          reorderableColumns: true,
          emptyText: "No cards",
          label: "Board",
        },
        options || {}
      );
      this._events = {};
      this._columns = []; // {spec, el, header, title, count, list, collapsed, limit}
      this._group = `wapyt-kanban-${++boardCount}`;
      this._host = resolveHost(target);
      if (!this._host) throw new Error("Unable to mount Kanban – target not found.");
      this._render();
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    _render() {
      this._host.innerHTML = "";
      this._host.classList.add("wapyt-kanban");
      this._host.setAttribute("role", "region");
      this._host.setAttribute("aria-label", String(this.options.label || "Board"));
      if (this.options.filterable) {
        this._filter = document.createElement("input");
        this._filter.type = "search";
        this._filter.className = "wapyt-kanban-filter";
        this._filter.placeholder = this.options.filterPlaceholder || "Filter cards";
        this._filter.setAttribute("aria-label", this.options.filterPlaceholder || "Filter cards");
        this._filter.addEventListener("input", () => this.setFilter(this._filter.value, true));
        this._host.appendChild(this._filter);
      }
      this._board = document.createElement("div");
      this._board.className = "wapyt-kanban-board";
      this._host.appendChild(this._board);
      (this.options.columns || []).forEach((spec) => this._addColumnEl(spec));
      this._refreshAll();
    }

    _addColumnEl(spec, index) {
      const col = { spec, collapsed: Boolean(spec.collapsed), limit: spec.wipLimit == null ? null : Number(spec.wipLimit) };
      const el = document.createElement("section");
      el.className = "wapyt-kanban-column";
      el.dataset.columnId = String(spec.id);
      el.style.setProperty("--wapyt-kanban-width", `${Number(spec.width || this.options.columnWidth) || 280}px`);
      if (spec.color) el.style.setProperty("--wapyt-kanban-accent", String(spec.color));

      const header = document.createElement("header");
      header.className = "wapyt-kanban-header";
      if (this.options.reorderableColumns) {
        header.tabIndex = 0;
        header.setAttribute("aria-roledescription", "movable column header");
        header.setAttribute("aria-description", "Alt+Left / Alt+Right move the column");
        header.addEventListener("pointerdown", (event) => this._onHeaderPointer(event, col));
        header.addEventListener("keydown", (event) => this._onHeaderKey(event, col));
      }
      const toggle = iconButton("mdi-chevron-left", "Collapse column", "wapyt-kanban-toggle");
      toggle.addEventListener("click", () => this.setCollapsed(spec.id, !col.collapsed));
      const title = document.createElement("h3");
      title.className = "wapyt-kanban-title";
      title.textContent = spec.title == null ? String(spec.id) : String(spec.title);
      const count = document.createElement("span");
      count.className = "wapyt-kanban-count";
      header.append(toggle, title, count);
      if (this.options.addCard) {
        const add = iconButton("mdi-plus", `${this.options.addCardLabel} to ${title.textContent}`, "wapyt-kanban-add");
        add.addEventListener("click", () => this._emit("add_card", { column: String(spec.id) }));
        header.appendChild(add);
      }
      el.appendChild(header);

      const body = document.createElement("div");
      body.className = "wapyt-kanban-cards";
      el.appendChild(body);

      col.el = el;
      col.header = header;
      col.title = title;
      col.count = count;
      col.toggle = toggle;
      col.list = new globalNS.Listbox(body, {
        items: spec.items || [],
        idField: this.options.idField,
        template: this.options.template,
        actions: this.options.actions || [],
        selection: "single",
        draggable: true,
        group: this._group,
        listId: String(spec.id),
        label: title.textContent,
        emptyText: this.options.emptyText,
      });
      this._wireList(col);
      const before = index == null ? null : this._columns[index] ? this._columns[index].el : null;
      this._board.insertBefore(el, before);
      if (index == null || index >= this._columns.length) this._columns.push(col);
      else this._columns.splice(index, 0, col);
      return col;
    }

    _wireList(col) {
      const list = col.list;
      list.on("move", (e) => {
        this._refreshAll();
        this._emit("move", {
          id: e.id, card: e.item, from_column: e.from_list, to_column: e.to_list,
          from_index: e.from_index, to_index: e.to_index,
        });
      });
      // One selection across the board: picking a card clears the others.
      list.on("select", (e) => {
        if (this._quiet) return;
        if (e.ids.length) {
          this._quiet = true;
          this._columns.forEach((other) => { if (other !== col) other.list.clearSelection(); });
          this._quiet = false;
        }
        this._emit("select", { id: e.id, card: e.id ? list.getItem(e.id) : null, column: e.id ? String(col.spec.id) : null });
      });
      list.on("activate", (e) => this._emit("activate", { id: e.id, card: e.item, column: String(col.spec.id) }));
      list.on("action", (e) => this._emit("action", { action: e.action, id: e.id, card: e.item, column: String(col.spec.id) }));
    }

    // Counts, WIP state and whether each column takes drops.
    _refresh(col) {
      const n = col.list.getItems().length;
      col.count.textContent = col.limit == null ? String(n) : `${n} / ${col.limit}`;
      col.count.setAttribute("aria-label", col.limit == null ? `${n} cards` : `${n} of ${col.limit} cards`);
      const over = col.limit != null && n > col.limit;
      const full = col.limit != null && n >= col.limit;
      if (over) col.el.dataset.over = "true";
      else delete col.el.dataset.over;
      if (full) col.el.dataset.full = "true";
      else delete col.el.dataset.full;
      if (col.collapsed) col.el.dataset.collapsed = "true";
      else delete col.el.dataset.collapsed;
      col.toggle.setAttribute("aria-expanded", col.collapsed ? "false" : "true");
      col.toggle.setAttribute("aria-label", col.collapsed ? "Expand column" : "Collapse column");
      col.toggle.title = col.toggle.getAttribute("aria-label");
      // Strict WIP: a full column takes no drops (its own cards still reorder).
      col.list.options.accept = !col.collapsed && !(this.options.wipStrict && full);
    }

    _refreshAll() {
      this._columns.forEach((col) => this._refresh(col));
    }

    _col(columnId) {
      return this._columns.find((col) => String(col.spec.id) === String(columnId)) || null;
    }

    _colOfCard(cardId) {
      return this._columns.find((col) => col.list.getItem(cardId)) || null;
    }

    // ── Column reordering ────────────────────────────────────────────────────

    _onHeaderKey(event, col) {
      if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      const from = this._columns.indexOf(col);
      const to = from + (event.key === "ArrowRight" ? 1 : -1);
      if (to < 0 || to >= this._columns.length) return;
      this._moveColumn(col, to, true);
      col.header.focus();
    }

    _onHeaderPointer(event, col) {
      if (event.button !== 0 || event.target.closest("button")) return;
      const start = event.clientX;
      let dragging = false;
      let index = this._columns.indexOf(col);
      const onMove = (e) => {
        if (!dragging && Math.abs(e.clientX - start) < DRAG_THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          col.el.dataset.moving = "true";
          document.documentElement.classList.add("wapyt-kanban-moving");
        }
        // Drop before the first other column whose centre is right of the pointer.
        const others = this._columns.filter((c) => c !== col);
        let at = others.length;
        for (let i = 0; i < others.length; i += 1) {
          const r = others[i].el.getBoundingClientRect();
          if (e.clientX < r.left + r.width / 2) {
            at = i;
            break;
          }
        }
        if (at !== index) {
          index = at;
          this._board.insertBefore(col.el, others[at] ? others[at].el : null);
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!dragging) return;
        delete col.el.dataset.moving;
        document.documentElement.classList.remove("wapyt-kanban-moving");
        this._moveColumn(col, index, true);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    _moveColumn(col, to, emit) {
      const from = this._columns.indexOf(col);
      this._columns.splice(from, 1);
      this._columns.splice(to, 0, col);
      const next = this._columns[to + 1];
      this._board.insertBefore(col.el, next ? next.el : null);
      if (emit && from !== to) {
        this._emit("column_move", { id: String(col.spec.id), from_index: from, to_index: to, columns: this.getColumnIds() });
      }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    getColumnIds() {
      return this._columns.map((col) => String(col.spec.id));
    }

    moveColumn(columnId, index) {
      const col = this._col(columnId);
      if (!col) return;
      this._moveColumn(col, Math.max(0, Math.min(this._columns.length - 1, Number(index) || 0)), false);
    }

    getBoard() {
      const out = {};
      this._columns.forEach((col) => { out[String(col.spec.id)] = col.list.getItems(); });
      return out;
    }

    getCards(columnId) {
      const col = this._col(columnId);
      return col ? col.list.getItems() : [];
    }

    getCard(cardId) {
      const col = this._colOfCard(cardId);
      return col ? col.list.getItem(cardId) : null;
    }

    columnOf(cardId) {
      const col = this._colOfCard(cardId);
      return col ? String(col.spec.id) : null;
    }

    addCard(columnId, card, index) {
      const col = this._col(columnId);
      if (!col) throw new Error(`Kanban: no column ${columnId}`);
      if (this._colOfCard(String(card[this.options.idField]))) throw new Error(`Kanban: duplicate card id ${card[this.options.idField]}`);
      col.list.addItem(card, index);
      this._refresh(col);
    }

    updateCard(cardId, fields) {
      const col = this._colOfCard(cardId);
      if (col) col.list.updateItem(cardId, fields);
    }

    removeCard(cardId) {
      const col = this._colOfCard(cardId);
      if (!col) return;
      col.list.removeItem(cardId);
      this._refresh(col);
    }

    cardBody(cardId) {
      const col = this._colOfCard(cardId);
      return col ? col.list.itemBody(cardId) : null;
    }

    // Silent: how the app puts back a refused move.
    moveCard(cardId, columnId, index) {
      const from = this._colOfCard(cardId);
      const to = this._col(columnId);
      if (!from || !to) return false;
      const ok = from.list.move(cardId, index, to.list);
      this._refreshAll();
      return ok;
    }

    setWipLimit(columnId, limit) {
      const col = this._col(columnId);
      if (!col) return;
      col.limit = limit == null ? null : Number(limit);
      this._refresh(col);
    }

    setCollapsed(columnId, collapsed) {
      const col = this._col(columnId);
      if (!col || col.collapsed === Boolean(collapsed)) return;
      col.collapsed = Boolean(collapsed);
      this._refresh(col);
      this._emit("column_toggle", { id: String(col.spec.id), collapsed: col.collapsed });
    }

    isCollapsed(columnId) {
      const col = this._col(columnId);
      return Boolean(col && col.collapsed);
    }

    setFilter(text, fromInput) {
      if (this._filter && !fromInput) this._filter.value = String(text || "");
      this._columns.forEach((col) => col.list.setFilter(text || ""));
    }

    select(cardId) {
      const col = this._colOfCard(cardId);
      if (col) col.list.select([String(cardId)]);
    }

    getSelected() {
      for (const col of this._columns) {
        const ids = col.list.getSelectedIds();
        if (ids.length) return ids[0];
      }
      return null;
    }

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
          console.error("[wapyt] Kanban listener failed", error);
        }
      });
    }

    destroy() {
      this._columns.forEach((col) => col.list.destroy());
      this._columns = [];
      this._events = {};
      this._host.innerHTML = "";
    }
  }

  globalNS.Kanban = Kanban;
})();
