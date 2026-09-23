(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_tablehost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-datatable"></div>`);
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

  function compare(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    if (typeof a === "boolean" || typeof b === "boolean") {
      return Number(a) - Number(b);
    }
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  // Cell values reach the DOM through textContent, and icon cells only ever
  // receive a class name. Nothing here interpolates row data into innerHTML, so
  // a remote filename cannot inject markup.
  class DataTable {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          columns: [],
          rows: [],
          idField: "id",
          selection: "single", // "none" | "single" | "multi"
          sortable: true,
          sortBy: null,
          sortDir: "asc",
          filterable: false,
          filterPlaceholder: "Filter",
          emptyText: "Nothing here",
          loadingText: "Loading…",
          dropUpload: false,
          contextActions: [],
          groupDirsFirst: null,
        },
        options || {}
      );

      this._events = {};
      this._rows = [];
      this._view = [];
      this._selected = new Set();
      this._lastAnchor = null;
      this._filter = "";
      this._sortBy = this.options.sortBy;
      this._sortDir = this.options.sortDir === "desc" ? "desc" : "asc";
      this._busy = false;

      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount DataTable – target not found.");
      }
      this._render();
      this.setRows(this.options.rows || []);
    }

    // ── Chrome ───────────────────────────────────────────────────────────────

    _render() {
      this._host.classList.add("wapyt-datatable");
      this._host.innerHTML = "";

      if (this.options.filterable) {
        const bar = document.createElement("div");
        bar.className = "wapyt-datatable-toolbar";
        const input = document.createElement("input");
        input.type = "search";
        input.className = "wapyt-datatable-filter";
        input.placeholder = this.options.filterPlaceholder || "Filter";
        input.addEventListener("input", () => {
          this._filter = input.value.trim().toLowerCase();
          this._refresh();
          this._emit("filter", { value: this._filter });
        });
        bar.appendChild(input);
        this._filterInput = input;
        this._host.appendChild(bar);
      }

      this._scroller = document.createElement("div");
      this._scroller.className = "wapyt-datatable-scroll";

      this._table = document.createElement("table");
      this._table.className = "wapyt-datatable-table";
      this._thead = document.createElement("thead");
      this._tbody = document.createElement("tbody");
      this._table.appendChild(this._thead);
      this._table.appendChild(this._tbody);
      this._scroller.appendChild(this._table);
      this._host.appendChild(this._scroller);

      this._status = document.createElement("div");
      this._status.className = "wapyt-datatable-status";
      this._status.hidden = true;
      // Inside the scroller, not after it: as a sibling of the flex:1
      // scroller the empty state gets pushed to the bottom of the panel.
      this._scroller.appendChild(this._status);

      this._renderHead();
      this._buildContextMenu();

      if (this.options.dropUpload) {
        this._wireDropTarget();
      }
    }

    _renderHead() {
      this._thead.innerHTML = "";
      const tr = document.createElement("tr");

      if (this.options.selection === "multi") {
        const th = document.createElement("th");
        th.className = "wapyt-datatable-check";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.setAttribute("aria-label", "Select all");
        box.addEventListener("change", () => {
          if (box.checked) {
            this._view.forEach((row) => this._selected.add(this._rowId(row)));
          } else {
            this._selected.clear();
          }
          this._refresh();
          this._emitSelection();
        });
        this._selectAll = box;
        th.appendChild(box);
        tr.appendChild(th);
      }

      (this.options.columns || []).forEach((column) => {
        const th = document.createElement("th");
        th.dataset.columnId = column.id;
        if (column.width) {
          th.style.width = typeof column.width === "number" ? `${column.width}px` : column.width;
        }
        if (column.align) {
          th.style.textAlign = column.align;
        }

        const sortable = this.options.sortable && column.sortable !== false;
        const labelEl = document.createElement("span");
        labelEl.className = "wapyt-datatable-th-label";
        labelEl.textContent = column.header != null ? column.header : column.id;
        th.appendChild(labelEl);

        if (sortable) {
          th.classList.add("wapyt-datatable-sortable");
          const caret = document.createElement("span");
          caret.className = "wapyt-datatable-caret";
          th.appendChild(caret);
          th.addEventListener("click", () => this.sort(column.id));
          if (this._sortBy === column.id) {
            th.dataset.sort = this._sortDir;
            caret.textContent = this._sortDir === "asc" ? "▲" : "▼";
          }
        }
        tr.appendChild(th);
      });

      this._thead.appendChild(tr);
    }

    _buildContextMenu() {
      const actions = this.options.contextActions || [];
      if (!actions.length) return;

      const menu = document.createElement("div");
      menu.className = "wapyt-datatable-menu";
      menu.hidden = true;
      actions.forEach((action) => {
        if (action && action.separator) {
          const sep = document.createElement("div");
          sep.className = "wapyt-datatable-menu-sep";
          menu.appendChild(sep);
          return;
        }
        const item = document.createElement("button");
        item.type = "button";
        item.className = "wapyt-datatable-menu-item";
        item.dataset.actionId = action.id;
        if (action.danger) {
          item.dataset.danger = "true";
        }
        if (action.icon) {
          const icon = document.createElement("span");
          icon.className = iconClass(action.icon);
          item.appendChild(icon);
        }
        const label = document.createElement("span");
        label.textContent = action.label || action.id;
        item.appendChild(label);
        item.addEventListener("click", () => {
          const rowId = menu.dataset.rowId;
          this._hideMenu();
          this._emit("action", {
            action: action.id,
            id: rowId,
            row: this.getRow(rowId),
            selected: this.getSelectedIds(),
          });
        });
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
      window.addEventListener("blur", () => this._hideMenu());
      this._scroller.addEventListener("scroll", () => this._hideMenu());
    }

    _showMenu(rowId, x, y) {
      if (!this._menu) return;
      this._menu.dataset.rowId = rowId;
      this._menu.hidden = false;
      // Measure first, then clamp inside the viewport.
      const rect = this._menu.getBoundingClientRect();
      const left = Math.min(x, window.innerWidth - rect.width - 8);
      const top = Math.min(y, window.innerHeight - rect.height - 8);
      this._menu.style.left = `${Math.max(8, left)}px`;
      this._menu.style.top = `${Math.max(8, top)}px`;
    }

    _hideMenu() {
      if (this._menu) {
        this._menu.hidden = true;
      }
    }

    _wireDropTarget() {
      const stop = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      ["dragenter", "dragover"].forEach((name) =>
        this._host.addEventListener(name, (event) => {
          stop(event);
          this._host.dataset.dropping = "true";
        })
      );
      ["dragleave", "drop"].forEach((name) =>
        this._host.addEventListener(name, (event) => {
          stop(event);
          if (name === "dragleave" && this._host.contains(event.relatedTarget)) {
            return;
          }
          delete this._host.dataset.dropping;
        })
      );
      this._host.addEventListener("drop", (event) => {
        const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
        if (!files.length) return;
        // FileList entries cannot cross the Pyodide FFI usefully, so the event
        // carries metadata and the app reads the bytes back off `getDroppedFiles`.
        this._droppedFiles = files;
        this._emit("drop", {
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        });
      });
    }

    getDroppedFiles() {
      return this._droppedFiles || [];
    }

    // ── Data ─────────────────────────────────────────────────────────────────

    _rowId(row) {
      return String(row[this.options.idField]);
    }

    setRows(rows) {
      this._rows = Array.isArray(rows) ? rows.slice() : [];
      const present = new Set(this._rows.map((row) => this._rowId(row)));
      // Drop selections for rows that no longer exist, so a stale id cannot
      // ride along into the next bulk action.
      Array.from(this._selected).forEach((id) => {
        if (!present.has(id)) this._selected.delete(id);
      });
      this._refresh();
    }

    getRows() {
      return this._rows.slice();
    }

    getRow(id) {
      return this._rows.find((row) => this._rowId(row) === String(id)) || null;
    }

    _computeView() {
      let view = this._rows.slice();

      if (this._filter) {
        const needle = this._filter;
        const columns = this.options.columns || [];
        view = view.filter((row) =>
          columns.some((column) => {
            const value = row[column.id];
            return value != null && String(value).toLowerCase().includes(needle);
          })
        );
      }

      if (this._sortBy) {
        const column =
          (this.options.columns || []).find((item) => item.id === this._sortBy) || {};
        const key = column.sortBy || column.id || this._sortBy;
        const dir = this._sortDir === "desc" ? -1 : 1;
        const groupField = this.options.groupDirsFirst;
        view.sort((a, b) => {
          // A file browser stays readable only if directories keep their block
          // whatever the active sort is.
          if (groupField) {
            const ga = a[groupField] ? 0 : 1;
            const gb = b[groupField] ? 0 : 1;
            if (ga !== gb) return ga - gb;
          }
          return compare(a[key], b[key]) * dir;
        });
      }

      this._view = view;
      return view;
    }

    _refresh() {
      this._computeView();
      this._renderHead();
      this._renderBody();
      this._syncSelectAll();
    }

    _renderBody() {
      this._tbody.innerHTML = "";

      if (this._busy) {
        this._setStatus(this.options.loadingText);
        return;
      }
      if (!this._view.length) {
        this._setStatus(this.options.emptyText);
        return;
      }
      this._setStatus(null);

      const columns = this.options.columns || [];
      const fragment = document.createDocumentFragment();

      this._view.forEach((row) => {
        const id = this._rowId(row);
        const tr = document.createElement("tr");
        tr.dataset.rowId = id;
        if (this._selected.has(id)) {
          tr.dataset.selected = "true";
        }
        if (row._class) {
          tr.classList.add(String(row._class));
        }

        if (this.options.selection === "multi") {
          const td = document.createElement("td");
          td.className = "wapyt-datatable-check";
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = this._selected.has(id);
          box.setAttribute("aria-label", "Select row");
          box.addEventListener("click", (event) => event.stopPropagation());
          box.addEventListener("change", () => {
            if (box.checked) {
              this._selected.add(id);
            } else {
              this._selected.delete(id);
            }
            tr.dataset.selected = box.checked ? "true" : "false";
            this._syncSelectAll();
            this._emitSelection();
          });
          td.appendChild(box);
          tr.appendChild(td);
        }

        columns.forEach((column) => {
          const td = document.createElement("td");
          if (column.align) {
            td.style.textAlign = column.align;
          }
          const value = row[column.id];

          if (column.type === "icon") {
            const icon = document.createElement("span");
            icon.className = iconClass(value);
            if (row[`${column.id}_title`]) {
              icon.title = String(row[`${column.id}_title`]);
            }
            td.appendChild(icon);
          } else {
            td.textContent = value == null ? "" : String(value);
            if (column.ellipsis !== false) {
              td.className = "wapyt-datatable-ellipsis";
              td.title = value == null ? "" : String(value);
            }
          }
          tr.appendChild(td);
        });

        tr.addEventListener("click", (event) => this._onRowClick(event, id));
        tr.addEventListener("dblclick", () => {
          this._emit("activate", { id, row: this.getRow(id) });
        });
        tr.addEventListener("contextmenu", (event) => {
          if (!this._menu) return;
          event.preventDefault();
          if (!this._selected.has(id)) {
            this._selectOnly(id);
          }
          this._showMenu(id, event.clientX, event.clientY);
        });

        fragment.appendChild(tr);
      });

      this._tbody.appendChild(fragment);
    }

    _setStatus(text) {
      if (!text) {
        this._status.hidden = true;
        this._status.textContent = "";
        return;
      }
      this._status.textContent = text;
      this._status.hidden = false;
    }

    // ── Selection ────────────────────────────────────────────────────────────

    _onRowClick(event, id) {
      const mode = this.options.selection;
      if (mode === "none") return;

      if (mode === "multi" && event.shiftKey && this._lastAnchor) {
        const ids = this._view.map((row) => this._rowId(row));
        const from = ids.indexOf(this._lastAnchor);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i += 1) {
            this._selected.add(ids[i]);
          }
          this._refresh();
          this._emitSelection();
          return;
        }
      }

      if (mode === "multi" && (event.ctrlKey || event.metaKey)) {
        if (this._selected.has(id)) {
          this._selected.delete(id);
        } else {
          this._selected.add(id);
        }
        this._lastAnchor = id;
        this._refresh();
        this._emitSelection();
        return;
      }

      this._selectOnly(id);
    }

    _selectOnly(id) {
      this._selected.clear();
      this._selected.add(id);
      this._lastAnchor = id;
      this._refresh();
      this._emitSelection();
    }

    _syncSelectAll() {
      if (!this._selectAll) return;
      const total = this._view.length;
      const chosen = this._view.filter((row) => this._selected.has(this._rowId(row))).length;
      this._selectAll.checked = total > 0 && chosen === total;
      this._selectAll.indeterminate = chosen > 0 && chosen < total;
    }

    _emitSelection() {
      const ids = this.getSelectedIds();
      this._emit("select", {
        ids,
        id: ids.length === 1 ? ids[0] : null,
        rows: ids.map((id) => this.getRow(id)).filter(Boolean),
      });
    }

    getSelectedIds() {
      return Array.from(this._selected);
    }

    getSelectedRows() {
      return this.getSelectedIds().map((id) => this.getRow(id)).filter(Boolean);
    }

    select(ids) {
      this._selected.clear();
      (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
        if (id != null) this._selected.add(String(id));
      });
      this._refresh();
      this._emitSelection();
    }

    clearSelection() {
      this._selected.clear();
      this._lastAnchor = null;
      this._refresh();
      this._emitSelection();
    }

    // ── Sorting / filtering / state ──────────────────────────────────────────

    sort(columnId, direction) {
      if (direction) {
        this._sortDir = direction === "desc" ? "desc" : "asc";
      } else if (this._sortBy === columnId) {
        this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
      } else {
        this._sortDir = "asc";
      }
      this._sortBy = columnId;
      this._refresh();
      this._emit("sort", { column: this._sortBy, direction: this._sortDir });
    }

    setFilter(value) {
      this._filter = String(value || "").trim().toLowerCase();
      if (this._filterInput) {
        this._filterInput.value = value || "";
      }
      this._refresh();
    }

    setBusy(busy) {
      this._busy = Boolean(busy);
      this._host.dataset.busy = this._busy ? "true" : "false";
      this._renderBody();
    }

    setColumns(columns) {
      this.options.columns = columns || [];
      this._refresh();
    }

    setEmptyText(text) {
      this.options.emptyText = text;
      if (!this._busy && !this._view.length) {
        this._setStatus(text);
      }
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
          console.error("[wapyt] DataTable listener failed", error);
        }
      });
    }
  }

  globalThis.wapyt.DataTable = DataTable;
})();
