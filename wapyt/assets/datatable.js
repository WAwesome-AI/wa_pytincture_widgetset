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
          // Opt-in: drag a header's right edge / drag a header onto another.
          // Either change emits "columns" with the new state.
          resizableColumns: false,
          reorderableColumns: false,
          minColumnWidth: 48,
          // Leading columns that stay put while the table scrolls sideways.
          frozenColumns: 0,
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
      // Editing: the one editable cell in the tab order, the open editor, and
      // errors the app reported per cell (they survive re-renders).
      this._active = null;
      this._editing = null;
      this._cellErrors = new Map();

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
      if (this.options.resizableColumns) {
        this._host.dataset.resizable = "true";
      }

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
      this._tbody.addEventListener("keydown", (event) => this._onCellKey(event));
      this._tbody.addEventListener("focusin", (event) => {
        const td = event.target.closest && event.target.closest("td[data-editable]");
        if (td) this._setActive(td.parentElement.dataset.rowId, td.dataset.columnId);
      });
      this._scroller.appendChild(this._table);
      this._host.appendChild(this._scroller);
      // The frozen edge casts a shadow only once something is underneath it.
      this._scroller.addEventListener("scroll", () => {
        const scrolled = this._scroller.scrollLeft > 0;
        if (scrolled) this._host.dataset.scrolledX = "true";
        else delete this._host.dataset.scrolledX;
      }, { passive: true });

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
          this._syncSelection();
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
        if (this.options.reorderableColumns) {
          this._wireReorder(th, column);
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
        if (this.options.resizableColumns) {
          this._wireResize(th, column);
        }
        tr.appendChild(th);
      });

      this._thead.appendChild(tr);
      this._applyTableWidth();
      this._observeFrozen();
    }

    // ── Frozen columns ───────────────────────────────────────────────────────

    // How many leading cells per row are frozen: the multi-select checkbox
    // column always goes with them.
    _frozenCount() {
      const n = Math.max(0, Math.trunc(Number(this.options.frozenColumns) || 0));
      if (!n) return 0;
      const columns = (this.options.columns || []).length;
      return Math.min(n, columns) + (this.options.selection === "multi" ? 1 : 0);
    }

    // Sticky cells with `left` set to the widths of the header cells before
    // them. Header widths are the truth (table-layout: fixed), so body rows
    // just copy the offsets.
    _applyFrozen() {
      const headRow = this._thead.firstElementChild;
      if (!headRow) return;
      const count = this._frozenCount();
      const heads = Array.from(headRow.children);
      const offsets = [];
      let left = 0;
      heads.forEach((th, i) => {
        offsets.push(i < count ? left : null);
        if (i < count) left += th.getBoundingClientRect().width;
      });
      const mark = (cell, i) => {
        if (offsets[i] == null) {
          if (cell.dataset.frozen) {
            delete cell.dataset.frozen;
            cell.style.left = "";
          }
          return;
        }
        cell.dataset.frozen = i === count - 1 ? "last" : "true";
        cell.style.left = `${offsets[i]}px`;
      };
      heads.forEach(mark);
      Array.from(this._tbody.children).forEach((tr) => Array.from(tr.children).forEach(mark));
      if (count) this._host.dataset.frozen = String(count);
      else delete this._host.dataset.frozen;
    }

    // Column resizes (dragged, or the panel changing size) move the offsets.
    _observeFrozen() {
      if (this._frozenObserver) this._frozenObserver.disconnect();
      const count = this._frozenCount();
      if (!count || typeof ResizeObserver === "undefined") return;
      const headRow = this._thead.firstElementChild;
      if (!headRow) return;
      let frame = 0;
      this._frozenObserver = new ResizeObserver(() => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          this._applyFrozen();
        });
      });
      Array.from(headRow.children).slice(0, count).forEach((th) => this._frozenObserver.observe(th));
    }

    setFrozenColumns(count) {
      this.options.frozenColumns = Math.max(0, Math.trunc(Number(count) || 0));
      this._observeFrozen();
      this._applyFrozen();
    }

    // ── Column resize and reorder ────────────────────────────────────────────

    // With table-layout: fixed and width: 100%, the browser stretches columns
    // to fill the table, so a dragged edge would not stay where it was
    // dropped. Once every column has a pixel width, the table takes their sum
    // instead (and scrolls sideways if that is wider than the panel).
    _applyTableWidth() {
      const columns = this.options.columns || [];
      const fixed = columns.length && columns.every((c) => typeof c.width === "number");
      if (!fixed || !this.options.resizableColumns) {
        this._table.style.width = "";
        return;
      }
      const check = this.options.selection === "multi" ? 34 : 0;
      const total = columns.reduce((sum, c) => sum + c.width, check);
      this._table.style.width = `${total}px`;
    }

    // Give every column its current rendered width in pixels.
    _freezeWidths() {
      (this.options.columns || []).forEach((column) => {
        if (typeof column.width === "number") return;
        const th = this._thead.querySelector(`th[data-column-id="${CSS.escape(column.id)}"]`);
        if (th) column.width = Math.round(th.getBoundingClientRect().width);
      });
    }

    _wireResize(th, column) {
      const grip = document.createElement("span");
      grip.className = "wapyt-datatable-resizer";
      grip.setAttribute("aria-hidden", "true");
      grip.title = "Drag to resize";
      // The grip lives inside the header, whose click sorts: swallow it.
      grip.addEventListener("click", (event) => event.stopPropagation());
      grip.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._freezeWidths();
        this._applyTableWidth();
        th.draggable = false;
        const startX = event.clientX;
        const startWidth = column.width;
        const min = Number(this.options.minColumnWidth) || 48;
        grip.setPointerCapture(event.pointerId);
        this._host.dataset.resizing = "true";
        const move = (moveEvent) => {
          column.width = Math.max(min, Math.round(startWidth + moveEvent.clientX - startX));
          th.style.width = `${column.width}px`;
          this._applyTableWidth();
        };
        const up = () => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", up);
          grip.removeEventListener("pointercancel", up);
          delete this._host.dataset.resizing;
          th.draggable = Boolean(this.options.reorderableColumns);
          if (column.width !== startWidth) {
            this._emit("columns", { reason: "resize", column: column.id, columns: this.getColumnState() });
          }
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", up);
        grip.addEventListener("pointercancel", up);
      });
      th.appendChild(grip);
    }

    _wireReorder(th, column) {
      th.draggable = true;
      th.addEventListener("dragstart", (event) => {
        if (this._host.dataset.resizing) {
          event.preventDefault();
          return;
        }
        this._dragColumn = column.id;
        event.dataTransfer.effectAllowed = "move";
        // Firefox will not start a drag without data.
        event.dataTransfer.setData("text/plain", column.id);
        th.dataset.dragging = "true";
      });
      th.addEventListener("dragend", () => {
        delete th.dataset.dragging;
        this._dragColumn = null;
        this._thead.querySelectorAll("th[data-drop]").forEach((cell) => delete cell.dataset.drop);
      });
      th.addEventListener("dragover", (event) => {
        if (!this._dragColumn || this._dragColumn === column.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const box = th.getBoundingClientRect();
        th.dataset.drop = event.clientX < box.left + box.width / 2 ? "before" : "after";
      });
      th.addEventListener("dragleave", () => delete th.dataset.drop);
      th.addEventListener("drop", (event) => {
        event.preventDefault();
        const moving = this._dragColumn;
        const side = th.dataset.drop;
        delete th.dataset.drop;
        if (!moving || moving === column.id) return;
        this.moveColumn(moving, column.id, side === "after");
      });
    }

    // Move a column before (or after) another; emits "columns".
    moveColumn(columnId, targetId, after = false) {
      const columns = this.options.columns || [];
      const from = columns.findIndex((c) => c.id === columnId);
      if (from < 0 || columnId === targetId) return;
      const [moved] = columns.splice(from, 1);
      let to = columns.findIndex((c) => c.id === targetId);
      if (to < 0) {
        columns.splice(from, 0, moved);
        return;
      }
      if (after) to += 1;
      columns.splice(to, 0, moved);
      this._refresh();
      this._emit("columns", { reason: "reorder", column: columnId, columns: this.getColumnState() });
    }

    // [{id, width}] in display order; width is null until the column has
    // been given (or dragged to) a pixel width.
    getColumnState() {
      return (this.options.columns || []).map((c) => ({
        id: c.id,
        width: typeof c.width === "number" ? c.width : null,
      }));
    }

    // The right-click menu is a wapyt.ContextMenu (keyboard, focus, ARIA,
    // clean-up); TableAction stays the public API. Actions get internal ids,
    // since apps reuse ids such as "delete" across groups.
    _buildContextMenu() {
      const actions = this.options.contextActions || [];
      if (!actions.length) return;
      const ContextMenu = globalThis.wapyt && globalThis.wapyt.ContextMenu;
      if (!ContextMenu) {
        console.warn("[wapyt.DataTable] context actions need wapyt.ContextMenu (contextmenu.js)");
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
        label: "Row actions",
        menuClass: "wapyt-datatable-menu",
        itemClass: "wapyt-datatable-menu-item",
      });
      this._menu.on("select", ({ id, context }) => {
        const entry = this._menuActions.find((candidate) => candidate.key === id);
        if (!entry) return;
        this._emit("action", {
          action: entry.action.id,
          id: context,
          row: this.getRow(context),
          selected: this.getSelectedIds(),
        });
      });
    }

    _showMenu(rowId, x, y) {
      if (this._menu) this._menu.showAt(x, y, { context: rowId });
    }

    _hideMenu() {
      if (this._menu) this._menu.hide(false);
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
      // A click selects (and re-renders) the row; keep keyboard focus on the
      // same cell rather than dropping it to <body>.
      const hadFocus = this._tbody.contains(document.activeElement) && !this._editing;
      this._computeView();
      this._renderHead();
      this._renderBody();
      this._syncSelectAll();
      if (hadFocus && this._active) this._focusCell(this._active.id, this._active.column);
    }

    _renderBody() {
      // Re-rendering would destroy an open editor; keep what was typed.
      if (this._editing) this._closeEditor(true);
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
          // Same identifier the header cell carries, so a stylesheet can reach
          // a whole column -- hiding a secondary one in a narrow container,
          // say. Without it a body cell can only be addressed by position.
          td.dataset.columnId = column.id;
          if (column.align) {
            td.style.textAlign = column.align;
          }
          this._fillCell(td, row, column);
          tr.appendChild(td);
        });

        tr.addEventListener("click", (event) => this._onRowClick(event, id));
        tr.addEventListener("dblclick", (event) => {
          // An editable cell edits; anywhere else activates the row.
          const td = event.target.closest("td[data-editable]");
          if (td) {
            this.editCell(id, td.dataset.columnId);
            return;
          }
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
      this._syncTabStop();
      this._applyFrozen();
    }

    // Draw one body cell's content. Also used after an edit, which redraws
    // only that cell so the row does not jump under an active sort.
    _fillCell(td, row, column) {
      td.textContent = "";
      td.className = "";
      td.removeAttribute("title");
      const value = row[column.id];
      const editor = column.editable ? column.editor || "text" : null;

      if (editor) {
        const id = this._rowId(row);
        td.dataset.editable = editor;
        td.tabIndex = this._isActiveCell(id, column.id) ? 0 : -1;
        const error = this._cellErrors.get(this._cellKey(id, column.id));
        if (error) {
          td.dataset.error = "true";
          td.setAttribute("aria-invalid", "true");
          td.dataset.wapytTooltip = error;
          // An error shows whether or not the text is cut off.
          delete td.dataset.wapytTooltipOverflow;
        } else {
          delete td.dataset.error;
          td.removeAttribute("aria-invalid");
          delete td.dataset.wapytTooltip;
        }
      }

      if (editor === "checkbox") {
        // Shown as a checkbox; Space or a click toggles it and commits.
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "wapyt-datatable-checkbox";
        box.checked = Boolean(value);
        box.tabIndex = -1;
        box.setAttribute("aria-label", column.header || column.id);
        box.addEventListener("click", (event) => {
          event.stopPropagation();
          this._commit(this._rowId(row), column, box.checked);
        });
        td.appendChild(box);
        return;
      }

      if (column.type === "icon") {
        const icon = document.createElement("span");
        icon.className = iconClass(value);
        if (row[`${column.id}_title`]) {
          icon.title = String(row[`${column.id}_title`]);
        }
        td.appendChild(icon);
        return;
      }

      const shown = this._displayValue(column, value);
      const marker = column.iconBy ? row[column.iconBy] : null;
      if (marker) {
        const icon = document.createElement("span");
        icon.className = `${iconClass(marker)} wapyt-datatable-cell-icon`;
        if (row[`${column.iconBy}_title`]) {
          icon.title = String(row[`${column.iconBy}_title`]);
        }
        td.appendChild(icon);
        td.appendChild(document.createTextNode(shown));
      } else {
        td.textContent = shown;
      }
      if (column.ellipsis !== false) {
        td.className = "wapyt-datatable-ellipsis";
        // An error message is the tooltip while there is one.
        if (!td.dataset.error) td.title = shown;
      }
    }

    // ── Editing ──────────────────────────────────────────────────────────────

    _cellKey(id, columnId) {
      return `${id}\u0000${columnId}`;
    }

    _column(columnId) {
      return (this.options.columns || []).find((column) => column.id === columnId) || null;
    }

    _editableIds() {
      return (this.options.columns || []).filter((column) => column.editable).map((column) => column.id);
    }

    _cellEl(id, columnId) {
      const tr = Array.from(this._tbody.children).find((row) => row.dataset.rowId === String(id));
      return tr ? Array.from(tr.children).find((td) => td.dataset.columnId === columnId) || null : null;
    }

    _isActiveCell(id, columnId) {
      return Boolean(this._active && this._active.id === String(id) && this._active.column === columnId);
    }

    // One editable cell is in the tab order (roving tabindex); arrows move it.
    _setActive(id, columnId) {
      if (this._isActiveCell(id, columnId)) return;
      const previous = this._active && this._cellEl(this._active.id, this._active.column);
      if (previous) previous.tabIndex = -1;
      this._active = { id: String(id), column: columnId };
      const cell = this._cellEl(id, columnId);
      if (cell) cell.tabIndex = 0;
    }

    _syncTabStop() {
      const cells = this._tbody.querySelectorAll("td[data-editable]");
      if (!cells.length) return;
      const active = this._active && this._cellEl(this._active.id, this._active.column);
      if (active) {
        active.tabIndex = 0;
        return;
      }
      const first = cells[0];
      this._active = { id: first.parentElement.dataset.rowId, column: first.dataset.columnId };
      first.tabIndex = 0;
    }

    _focusCell(id, columnId) {
      const cell = this._cellEl(id, columnId);
      if (!cell) return false;
      this._setActive(id, columnId);
      cell.focus({ preventScroll: false });
      return true;
    }

    _move(id, columnId, dRow, dCol) {
      const ids = this._view.map((row) => this._rowId(row));
      const cols = this._editableIds();
      let r = ids.indexOf(String(id));
      let c = cols.indexOf(columnId);
      if (r < 0 || c < 0) return false;
      c += dCol;
      // Tab off the end of a row continues on the next one.
      if (c >= cols.length) { c = 0; r += 1; }
      if (c < 0) { c = cols.length - 1; r -= 1; }
      r += dRow;
      if (r < 0 || r >= ids.length) return false;
      return this._focusCell(ids[r], cols[c]);
    }

    _onCellKey(event) {
      if (this._editing) return; // the editor handles its own keys
      const td = event.target.closest && event.target.closest("td[data-editable]");
      if (!td || event.target !== td) return;
      const id = td.parentElement.dataset.rowId;
      const columnId = td.dataset.columnId;
      const editor = td.dataset.editable;
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[event.key]) {
        event.preventDefault();
        this._move(id, columnId, ...moves[event.key]);
      } else if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        if (editor === "checkbox") this._toggle(id, columnId);
        else this.editCell(id, columnId);
      } else if (event.key === " " && editor === "checkbox") {
        event.preventDefault();
        this._toggle(id, columnId);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey &&
                 (editor === "text" || editor === "number")) {
        // Typing over a cell starts an edit with that character, as in a sheet.
        event.preventDefault();
        this.editCell(id, columnId, event.key);
      }
    }

    _toggle(id, columnId) {
      const row = this.getRow(id);
      const column = this._column(columnId);
      if (row && column) this._commit(String(id), column, !row[columnId]);
    }

    editCell(id, columnId, initialText) {
      const row = this.getRow(id);
      const column = this._column(columnId);
      if (!row || !column || !column.editable) return false;
      if (this._editing) this._closeEditor(true);
      const td = this._cellEl(id, columnId);
      if (!td) return false;
      const kind = column.editor || "text";
      if (kind === "checkbox") {
        this._focusCell(id, columnId);
        return true;
      }
      this._setActive(id, columnId);
      const value = row[columnId];
      let input;
      if (kind === "select") {
        input = document.createElement("select");
        (column.options || []).forEach((option) => {
          const opt = document.createElement("option");
          const isObj = option && typeof option === "object";
          opt.value = String(isObj ? option.value ?? "" : option ?? "");
          opt.textContent = String(isObj ? option.label ?? option.value ?? "" : option ?? "");
          input.appendChild(opt);
        });
        input.value = value == null ? "" : String(value);
      } else {
        input = document.createElement("input");
        input.type = kind === "date" ? "date" : "text";
        if (kind === "number") input.inputMode = "decimal";
        input.value = initialText != null ? initialText : value == null ? "" : String(value);
      }
      input.className = "wapyt-datatable-editor";
      input.setAttribute("aria-label", `${column.header || column.id}`);
      td.dataset.editing = "true";
      td.textContent = "";
      td.removeAttribute("title");
      td.appendChild(input);
      this._editing = { id: String(id), column, input, td };

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (this._closeEditor(true, true)) this._focusCell(id, columnId);
        } else if (event.key === "Tab") {
          event.preventDefault();
          if (this._closeEditor(true, true)) {
            if (!this._move(id, columnId, 0, event.shiftKey ? -1 : 1)) this._focusCell(id, columnId);
          }
        } else if (event.key === "Escape") {
          // Stop here so an enclosing modal stays open.
          event.preventDefault();
          event.stopPropagation();
          this._closeEditor(false);
          this._focusCell(id, columnId);
        }
      });
      input.addEventListener("blur", () => {
        // Leaving with an invalid value drops it rather than trapping focus.
        if (this._editing && this._editing.input === input && !this._closeEditor(true, true)) {
          this._closeEditor(false);
        }
      });
      input.focus();
      if (initialText == null && typeof input.select === "function") input.select();
      return true;
    }

    // The typed value as the column's type, or {error}.
    _parse(column, raw) {
      const kind = column.editor || "text";
      const text = String(raw ?? "");
      if (!text.trim()) {
        if (column.required) return { error: `${column.header || column.id} is required` };
        return { value: kind === "number" || kind === "date" ? null : "" };
      }
      if (kind === "number") {
        const number = Number(text.trim().replace(/,/g, ""));
        if (!Number.isFinite(number)) return { error: "Must be a number" };
        return { value: number };
      }
      return { value: text };
    }

    // Close the open editor. With commit, a valid value is saved (returns
    // true); an invalid one keeps the editor open with the error when `stay`,
    // else returns false and leaves it to the caller.
    _closeEditor(commit, stay = false) {
      const editing = this._editing;
      if (!editing) return true;
      if (commit) {
        const parsed = this._parse(editing.column, editing.input.value);
        if (parsed.error) {
          if (stay) {
            editing.input.setAttribute("aria-invalid", "true");
            editing.input.dataset.wapytTooltip = parsed.error;
            if (globalThis.wapyt && globalThis.wapyt.tooltip) globalThis.wapyt.tooltip.show(editing.input);
            return false;
          }
          commit = false;
        }
        if (commit) {
          this._editing = null;
          delete editing.td.dataset.editing;
          this._commit(editing.id, editing.column, parsed.value, editing.td);
          return true;
        }
      }
      this._editing = null;
      delete editing.td.dataset.editing;
      const row = this.getRow(editing.id);
      if (row) this._fillCell(editing.td, row, editing.column);
      return true;
    }

    _commit(id, column, value, td) {
      const row = this.getRow(id);
      if (!row) return;
      const old = row[column.id];
      const cell = td || this._cellEl(id, column.id);
      const same = old === value || (old == null && value == null) ||
        (old != null && value != null && typeof old !== "boolean" && String(old) === String(value) && typeof old === typeof value);
      if (!same) {
        row[column.id] = value;
        this._cellErrors.delete(this._cellKey(id, column.id));
      }
      if (cell) this._fillCell(cell, row, column);
      if (!same) {
        this._emit("edit", { id, column: column.id, value, old_value: old === undefined ? null : old, row });
      }
    }

    cancelEdit() {
      if (!this._editing) return;
      const { id, column } = this._editing;
      this._closeEditor(false);
      this._focusCell(id, column.id);
    }

    // The app's answer to an edit: put a value back (or set one) without
    // firing "edit", and/or flag the cell with a message (null clears it).
    setCell(id, columnId, value) {
      const row = this.getRow(id);
      const column = this._column(columnId);
      if (!row || !column) return;
      row[columnId] = value;
      const td = this._cellEl(id, columnId);
      if (td && !(this._editing && this._editing.td === td)) this._fillCell(td, row, column);
    }

    setCellError(id, columnId, message) {
      const key = this._cellKey(id, columnId);
      if (message) this._cellErrors.set(key, String(message));
      else this._cellErrors.delete(key);
      const row = this.getRow(id);
      const column = this._column(columnId);
      const td = this._cellEl(id, columnId);
      if (row && column && td && !(this._editing && this._editing.td === td)) this._fillCell(td, row, column);
    }

    // A select column shows the option's label for its value.
    _displayValue(column, value) {
      if (value == null) return "";
      if (column.editor === "select" && Array.isArray(column.options)) {
        const match = column.options.find((option) =>
          option && typeof option === "object" ? String(option.value) === String(value) : String(option) === String(value));
        if (match) return String(typeof match === "object" ? match.label ?? match.value : match);
      }
      return String(value);
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
      // Clicks inside an open editor must not re-render it away.
      if (event.target.closest && event.target.closest(".wapyt-datatable-editor")) return;
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
          this._syncSelection();
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
        this._syncSelection();
        this._emitSelection();
        return;
      }

      this._selectOnly(id);
    }

    _selectOnly(id) {
      this._selected.clear();
      this._selected.add(id);
      this._lastAnchor = id;
      this._syncSelection();
      this._emitSelection();
    }

    // Selection changes repaint rows in place. Re-rendering re-sorted the view
    // on every click, so a row edited out of sort order jumped away between
    // the two clicks of a double-click, and keyboard focus was lost.
    _syncSelection() {
      Array.from(this._tbody.children).forEach((tr) => {
        const id = tr.dataset.rowId;
        if (id == null) return;
        const chosen = this._selected.has(id);
        if (chosen) tr.dataset.selected = "true";
        else delete tr.dataset.selected;
        const box = tr.querySelector(".wapyt-datatable-check input");
        if (box) box.checked = chosen;
      });
      this._syncSelectAll();
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
      this._syncSelection();
      this._emitSelection();
    }

    clearSelection() {
      this._selected.clear();
      this._lastAnchor = null;
      this._syncSelection();
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
      if (this._frozenObserver) this._frozenObserver.disconnect();
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
          console.error("[wapyt] DataTable listener failed", error);
        }
      });
    }
  }

  globalThis.wapyt.DataTable = DataTable;
})();
