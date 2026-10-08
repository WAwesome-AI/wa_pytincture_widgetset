/* CI autofix test: throwaway, do not merge */
(function () {
  // Pagination: first / previous / next / last, a page box or numbered
  // buttons, a page-size selector and a "1–50 of 1,234" summary. Monguana
  // built this by hand for query results, including the case where the server
  // gave up counting (total unknown). Every string goes in through textContent.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_pagerhost_${Math.random().toString(16).slice(2)}`;
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

  const fmt = (n) => Number(n).toLocaleString();

  class Pagination {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          total: null,
          page: 1,
          pageSize: 50,
          pageSizes: [],
          exact: true,
          hasMore: true,
          numbers: false,
          siblings: 1,
          showJump: true,
          showSummary: true,
          emptyText: "No items",
          label: "Pagination",
        },
        options || {}
      );
      this._events = {};
      this._busy = false;
      this._shown = null;
      this._total = this.options.total == null ? null : Math.max(0, Number(this.options.total));
      this._exact = this.options.exact !== false;
      this._hasMore = this.options.hasMore !== false;
      this._size = Math.max(1, Number(this.options.pageSize) || 50);
      this._page = Math.max(1, Number(this.options.page) || 1);
      this._host = resolveHost(target);
      if (!this._host) throw new Error("Unable to mount Pagination – target not found.");
      this._build();
      this._clamp();
      this._render();
    }

    // ── State ───────────────────────────────────────────────────────────────

    pageCount() {
      return this._total == null ? null : Math.max(1, Math.ceil(this._total / this._size));
    }

    _clamp() {
      const count = this.pageCount();
      const before = this._page;
      if (count != null) this._page = Math.min(this._page, count);
      this._page = Math.max(1, this._page);
      return this._page !== before;
    }

    getState() {
      return {
        page: this._page,
        page_size: this._size,
        offset: (this._page - 1) * this._size,
        total: this._total,
        page_count: this.pageCount(),
      };
    }

    _emit(event, payload) {
      (this._events[event] || new Set()).forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] Pagination listener failed", error);
        }
      });
    }

    _changed() {
      const { page, page_size, offset } = this.getState();
      this._emit("change", { page, page_size, offset });
    }

    // From the person: clamp, render, and emit only if the page moved.
    _goto(page) {
      const before = this._page;
      this._page = Number.isFinite(page) ? Math.trunc(page) : before;
      this._clamp();
      // The last load's row count belongs to the page being left.
      if (this._page !== before) this._shown = null;
      this._render();
      if (this._page !== before) this._changed();
    }

    // ── DOM ─────────────────────────────────────────────────────────────────

    _button(icon, label, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wapyt-pager-btn";
      button.setAttribute("aria-label", label);
      button.title = label;
      const glyph = document.createElement("span");
      glyph.className = iconClass(icon);
      glyph.setAttribute("aria-hidden", "true");
      button.appendChild(glyph);
      button.addEventListener("click", onClick);
      return button;
    }

    _build() {
      this._host.innerHTML = "";
      this._nav = document.createElement("nav");
      this._nav.className = "wapyt-pager";
      this._nav.setAttribute("aria-label", this.options.label || "Pagination");

      this._first = this._button("mdi-page-first", "First page", () => this._goto(1));
      this._prev = this._button("mdi-chevron-left", "Previous page", () => this._goto(this._page - 1));
      this._next = this._button("mdi-chevron-right", "Next page", () => this._goto(this._page + 1));
      this._last = this._button("mdi-page-last", "Last page", () => this._goto(this.pageCount() || this._page));

      this._numbers = document.createElement("span");
      this._numbers.className = "wapyt-pager-numbers";
      this._numbers.addEventListener("click", (event) => {
        const button = event.target.closest("[data-page]");
        if (button) this._goto(Number(button.dataset.page));
      });

      this._jump = document.createElement("span");
      this._jump.className = "wapyt-pager-jump";
      this._input = document.createElement("input");
      this._input.type = "text";
      this._input.inputMode = "numeric";
      this._input.className = "wapyt-pager-input";
      this._input.setAttribute("aria-label", "Page");
      this._input.autocomplete = "off";
      const commit = () => {
        const wanted = parseInt(this._input.value, 10);
        if (Number.isFinite(wanted)) this._goto(wanted);
        else this._render();
      };
      this._input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          this._render();
        }
      });
      this._input.addEventListener("change", commit);
      this._of = document.createElement("span");
      this._of.className = "wapyt-pager-of";
      this._jump.append(this._input, this._of);

      this._sizeSelect = document.createElement("select");
      this._sizeSelect.className = "wapyt-pager-size";
      this._sizeSelect.setAttribute("aria-label", "Items per page");
      this._sizeSelect.addEventListener("change", () => {
        this._size = Math.max(1, Number(this._sizeSelect.value) || this._size);
        this._page = 1;
        this._shown = null;
        this._render();
        this._changed();
      });

      this._summary = document.createElement("span");
      this._summary.className = "wapyt-pager-summary";
      this._summary.setAttribute("aria-live", "polite");

      this._nav.append(this._first, this._prev, this._numbers, this._jump, this._next, this._last,
        this._sizeSelect, this._summary);
      this._host.appendChild(this._nav);
    }

    // The page numbers to show: 1, the window around the current page, the
    // last, with null where a gap becomes an ellipsis. A gap of one page shows
    // that page instead, since "…" would take the same room.
    _window(count) {
      const siblings = Math.max(0, Number(this.options.siblings) || 0);
      const from = Math.max(2, this._page - siblings);
      const to = Math.min(count - 1, this._page + siblings);
      const pages = [1];
      if (from > 3) pages.push(null);
      else for (let n = 2; n < from; n += 1) pages.push(n);
      for (let n = from; n <= to; n += 1) pages.push(n);
      if (to < count - 2) pages.push(null);
      else for (let n = to + 1; n < count; n += 1) pages.push(n);
      if (count > 1) pages.push(count);
      return pages;
    }

    _render() {
      const count = this.pageCount();
      const known = count != null;
      const busy = this._busy;
      this._nav.dataset.busy = busy ? "true" : "false";

      this._first.disabled = busy || this._page <= 1;
      this._prev.disabled = busy || this._page <= 1;
      this._next.disabled = busy || (known ? this._page >= count : !this._hasMore);
      this._last.disabled = busy || !known || this._page >= count;
      this._last.hidden = !known;

      const numbers = Boolean(this.options.numbers) && known;
      this._numbers.hidden = !numbers;
      this._jump.hidden = numbers || this.options.showJump === false;
      if (numbers) {
        this._numbers.innerHTML = "";
        this._window(count).forEach((page) => {
          if (page == null) {
            const gap = document.createElement("span");
            gap.className = "wapyt-pager-gap";
            gap.textContent = "…";
            gap.setAttribute("aria-hidden", "true");
            this._numbers.appendChild(gap);
            return;
          }
          const button = document.createElement("button");
          button.type = "button";
          button.className = "wapyt-pager-btn wapyt-pager-num";
          button.dataset.page = String(page);
          button.textContent = fmt(page);
          button.setAttribute("aria-label", `Page ${page}`);
          if (page === this._page) button.setAttribute("aria-current", "page");
          button.disabled = busy;
          this._numbers.appendChild(button);
        });
      } else {
        this._input.value = String(this._page);
        this._input.disabled = busy;
        this._input.style.width = `${Math.max(2, String(count || this._page).length) + 2}ch`;
        this._of.textContent = known ? `of ${fmt(count)}` : "";
      }

      const sizes = Array.from(new Set([...(this.options.pageSizes || []), this._size].map(Number)))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      this._sizeSelect.hidden = !(this.options.pageSizes || []).length;
      this._sizeSelect.disabled = busy;
      if (this._sizeSelect.options.length !== sizes.length ||
          sizes.some((n, i) => Number(this._sizeSelect.options[i].value) !== n)) {
        this._sizeSelect.innerHTML = "";
        sizes.forEach((n) => {
          const opt = document.createElement("option");
          opt.value = String(n);
          opt.textContent = `${fmt(n)} / page`;
          this._sizeSelect.appendChild(opt);
        });
      }
      this._sizeSelect.value = String(this._size);

      this._summary.hidden = this.options.showSummary === false;
      this._summary.textContent = this._summaryText();
    }

    _summaryText() {
      const offset = (this._page - 1) * this._size;
      let shown = this._shown;
      if (shown == null) {
        shown = this._total == null ? this._size : Math.max(0, Math.min(this._size, this._total - offset));
      }
      if (!shown && !this._total) return this.options.emptyText || "";
      const first = offset + 1;
      const last = offset + shown;
      const range = `${fmt(first)}–${fmt(last)}`;
      if (this._total == null) return range;
      return `${range} of ${this._exact ? "" : "≈"}${fmt(this._total)}`;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    setTotal(total, opts = {}) {
      this._total = total == null ? null : Math.max(0, Number(total));
      this._exact = opts.exact !== false;
      this._hasMore = opts.hasMore !== false;
      this._shown = opts.shown == null ? null : Math.max(0, Number(opts.shown));
      // The list shrank under the current page (a delete, a narrower filter):
      // move to the new last page and tell the app to load it.
      const moved = this._clamp();
      if (moved) this._shown = null;
      this._render();
      if (moved) this._changed();
    }

    setPage(page) {
      this._page = Math.max(1, Math.trunc(Number(page)) || 1);
      this._shown = null;
      this._clamp();
      this._render();
    }

    setPageSize(size) {
      this._size = Math.max(1, Math.trunc(Number(size)) || this._size);
      this._page = 1;
      this._shown = null;
      this._render();
    }

    setBusy(busy) {
      this._busy = Boolean(busy);
      this._render();
    }

    on(event, handler) {
      if (!this._events[event]) this._events[event] = new Set();
      this._events[event].add(handler);
    }

    off(event, handler) {
      if (this._events[event]) this._events[event].delete(handler);
    }

    destroy() {
      this._events = {};
      this._nav.remove();
    }
  }

  globalNS.Pagination = Pagination;
})();
