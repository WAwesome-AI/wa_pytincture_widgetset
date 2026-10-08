(function () {
  // Scheduler: appointments on day / week / work-week / month / agenda views,
  // created, moved and resized by pointer, touch or keyboard, with the app
  // (BFF) as the source of truth: changes apply at once and fire an event;
  // the app persists them and calls revert(id) if the server refuses.
  //
  // Times are naive local times (no time zone), like the Form pickers: they
  // travel as ISO strings ("2026-10-08T09:30", or "2026-10-08" for all-day
  // items, whose end date is exclusive). Positions come from the clock fields
  // (hours and minutes), never from millisecond differences, so a DST day
  // still lays out 00:00 to 24:00. Titles and descriptions are set as text.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  const DAY = 24 * 60; // minutes
  const DRAG_THRESHOLD = 5;
  // The dataviz palette (as in Chart): named slots for item colours.
  const COLORS = {
    blue: ["#2a78d6", "#3987e5"], orange: ["#eb6834", "#d95926"], aqua: ["#1baf7a", "#199e70"],
    yellow: ["#eda100", "#c98500"], magenta: ["#e87ba4", "#d55181"], green: ["#008300", "#008300"],
    violet: ["#4a3aa7", "#9085e9"], red: ["#e34948", "#e66767"],
  };
  const VIEWS = ["day", "week", "work_week", "month", "agenda"];
  const VIEW_LABELS = { day: "Day", week: "Week", work_week: "Work week", month: "Month", agenda: "Agenda" };

  // Item colours have light and dark steps: re-render on a theme switch.
  const schedulers = new Set();
  if (typeof MutationObserver === "function" && typeof document !== "undefined") {
    new MutationObserver(() => schedulers.forEach((s) => s._render())).observe(
      document.documentElement, { attributes: true, attributeFilter: ["data-wapyt-theme"] });
  }

  // ── Naive dates ──────────────────────────────────────────────────────────

  function parse(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value || ""));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  const pad = (n) => String(n).padStart(2, "0");

  function isoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function isoDateTime(d) {
    const sec = d.getSeconds() ? `:${pad(d.getSeconds())}` : "";
    return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}${sec}`;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Calendar arithmetic on the date fields: adding a day across a DST change
  // still lands on the next midnight.
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
  }

  function addMinutes(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() + n, d.getSeconds());
  }

  function minutesOfDay(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // Whole days between two midnights, by the calendar (DST-safe).
  function dayDiff(a, b) {
    const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
  }

  // Minutes from a to b counted on the clock: whole days by the calendar plus
  // the difference in time of day, so a 9:00-17:00 item is 480 minutes even
  // on a DST day.
  function clockMinutes(a, b) {
    return dayDiff(a, b) * DAY + minutesOfDay(b) - minutesOfDay(a);
  }

  function startOfWeek(d, weekStart) {
    const day = startOfDay(d);
    const offset = (day.getDay() - weekStart + 7) % 7;
    return addDays(day, -offset);
  }

  class Scheduler {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          view: "week",
          views: VIEWS.slice(),
          date: null,
          weekStart: 1,
          dayStart: 0,
          dayEnd: 24,
          scrollTo: 8,
          slotMinutes: 30,
          slotHeight: 22,
          timeFormat: null, // "12" | "24" | null (the locale decides)
          locale: undefined,
          nowIndicator: true,
          minItemMinutes: null,
          readOnly: false,
          miniCalendar: true,
          agendaDays: 14,
          height: null,
          title: "Schedule",
        },
        options || {}
      );
      const o = this.options;
      if (!VIEWS.includes(o.view)) throw new Error(`wapyt.Scheduler: unknown view '${o.view}'`);
      this._date = startOfDay(parse(o.date) || new Date());
      this._view = o.view;
      this._items = new Map();
      this._errors = new Map();
      this._previous = new Map(); // id -> item before its last change, for revert()
      this._events = {};
      this._cursor = null; // keyboard cursor: {date, minutes} in time views, {date} in month
      this._pending = null; // keyboard move / resize being staged
      this._drag = null;
      this._host = this._resolveHost(target);
      if (!this._host) throw new Error("Unable to mount Scheduler – target not found.");
      this._build();
      (o.items || []).forEach((item) => this._put(item));
      this._render();
      this._nowTimer = setInterval(() => this._paintNow(), 60000);
      schedulers.add(this);
    }

    _resolveHost(target) {
      if (target && typeof target.attachHTML === "function") {
        const mountId = `wapyt_schedhost_${Math.random().toString(16).slice(2)}`;
        target.attachHTML(`<div id="${mountId}"></div>`);
        return document.getElementById(mountId);
      }
      if (typeof target === "string") return document.querySelector(target);
      if (target && target.nodeType === 1) return target;
      return null;
    }

    // ── Formatting ───────────────────────────────────────────────────────────

    _fmt(opts) {
      const o = Object.assign({}, opts);
      if (o.hour && this.options.timeFormat) o.hour12 = this.options.timeFormat === "12";
      return new Intl.DateTimeFormat(this.options.locale, o);
    }

    _time(d) {
      return this._fmt({ hour: "numeric", minute: "2-digit" }).format(d);
    }

    _timeRange(item) {
      if (item.allDay) return "All day";
      return `${this._time(item.start)} – ${this._time(item.end)}`;
    }

    _longDate(d) {
      return this._fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
    }

    // ── Items ────────────────────────────────────────────────────────────────

    _put(spec) {
      if (!spec || spec.id == null) throw new Error("Scheduler items need an id");
      const allDay = Boolean(spec.allDay);
      let start = parse(spec.start);
      let end = parse(spec.end);
      if (!start) throw new Error(`Scheduler item '${spec.id}' has no valid start`);
      if (allDay) {
        start = startOfDay(start);
        end = end ? startOfDay(end) : addDays(start, 1);
        if (end <= start) end = addDays(start, 1);
      } else if (!end || end <= start) {
        end = addMinutes(start, this.options.slotMinutes);
      }
      const item = {
        id: String(spec.id),
        title: spec.title == null ? "" : String(spec.title),
        start,
        end,
        allDay,
        color: spec.color || null,
        editable: spec.editable !== false,
        description: spec.description == null ? null : String(spec.description),
        seriesId: spec.seriesId == null ? null : String(spec.seriesId),
        data: spec.data || null,
      };
      this._items.set(item.id, item);
      return item;
    }

    _public(item) {
      return {
        id: item.id,
        title: item.title,
        start: item.allDay ? isoDate(item.start) : isoDateTime(item.start),
        end: item.allDay ? isoDate(item.end) : isoDateTime(item.end),
        all_day: item.allDay,
        color: item.color,
        editable: item.editable,
        description: item.description,
        series_id: item.seriesId,
        data: item.data,
      };
    }

    _when(item) {
      return {
        start: item.allDay ? isoDate(item.start) : isoDateTime(item.start),
        end: item.allDay ? isoDate(item.end) : isoDateTime(item.end),
        all_day: item.allDay,
      };
    }

    setItems(items) {
      this._items.clear();
      this._errors.clear();
      this._previous.clear();
      (items || []).forEach((spec) => this._put(spec));
      this._render();
    }

    addItem(spec) {
      this._put(spec);
      this._render();
    }

    updateItem(id, changes) {
      const item = this._items.get(String(id));
      if (!item) throw new Error(`Scheduler has no item '${id}'`);
      const spec = Object.assign(this._specOf(item), changes || {});
      this._put(spec);
      this._render();
    }

    _specOf(item) {
      return {
        id: item.id, title: item.title, start: item.start, end: item.end, allDay: item.allDay,
        color: item.color, editable: item.editable, description: item.description,
        seriesId: item.seriesId, data: item.data,
      };
    }

    removeItem(id) {
      this._items.delete(String(id));
      this._errors.delete(String(id));
      this._render();
    }

    getItems() {
      return Array.from(this._items.values()).sort((a, b) => a.start - b.start).map((i) => this._public(i));
    }

    getItem(id) {
      const item = this._items.get(String(id));
      return item ? this._public(item) : null;
    }

    // Put an item back where it was before its last move or resize (the app
    // calls this when the server refuses the change).
    revert(id) {
      const key = String(id);
      const before = this._previous.get(key);
      if (!before) return false;
      this._put(before);
      this._previous.delete(key);
      this._render();
      return true;
    }

    setItemError(id, message) {
      const key = String(id);
      if (message) this._errors.set(key, String(message));
      else this._errors.delete(key);
      this._render();
    }

    _colorOf(item) {
      const theme = this._theme() === "dark" ? 1 : 0;
      if (!item.color) return COLORS.blue[theme];
      if (COLORS[item.color]) return COLORS[item.color][theme];
      return item.color;
    }

    _theme() {
      const scoped = this._host.closest("[data-wapyt-theme]");
      return (scoped && scoped.getAttribute("data-wapyt-theme")) || "light";
    }

    // ── Navigation ───────────────────────────────────────────────────────────

    getRange() {
      const o = this.options;
      let start;
      let end;
      if (this._view === "day") {
        start = this._date;
        end = addDays(start, 1);
      } else if (this._view === "week") {
        start = startOfWeek(this._date, o.weekStart);
        end = addDays(start, 7);
      } else if (this._view === "work_week") {
        start = startOfWeek(this._date, 1); // Monday to Friday, whatever weekStart
        end = addDays(start, 5);
      } else if (this._view === "month") {
        const first = new Date(this._date.getFullYear(), this._date.getMonth(), 1);
        start = startOfWeek(first, o.weekStart);
        end = addDays(start, 42);
      } else {
        start = this._date;
        end = addDays(start, Number(o.agendaDays) || 14);
      }
      return { start: isoDate(start), end: isoDate(end), view: this._view };
    }

    _days() {
      const range = this.getRange();
      const start = parse(range.start);
      const n = dayDiff(start, parse(range.end));
      return Array.from({ length: n }, (_, i) => addDays(start, i));
    }

    setView(view) {
      if (!VIEWS.includes(view)) throw new Error(`wapyt.Scheduler: unknown view '${view}'`);
      if (view === this._view) return;
      this._view = view;
      this._scrolled = false;
      this._cursor = null;
      this._render();
      this._emitRange();
    }

    setDate(date) {
      const d = parse(date);
      if (!d) throw new Error(`wapyt.Scheduler: bad date '${date}'`);
      const before = this._view ? this.getRange() : null;
      this._date = startOfDay(d);
      this._miniMonth = null;
      this._render();
      const after = this.getRange();
      if (!before || after.start !== before.start || after.end !== before.end) this._emitRange();
    }

    getDate() {
      return isoDate(this._date);
    }

    getView() {
      return this._view;
    }

    _step(dir) {
      const v = this._view;
      if (v === "day") return addDays(this._date, dir);
      if (v === "week" || v === "work_week") return addDays(this._date, 7 * dir);
      if (v === "month") return new Date(this._date.getFullYear(), this._date.getMonth() + dir, 1);
      return addDays(this._date, (Number(this.options.agendaDays) || 14) * dir);
    }

    next() { this.setDate(this._step(1)); }
    prev() { this.setDate(this._step(-1)); }
    today() { this.setDate(new Date()); }

    _emitRange() {
      this._emit("range", this.getRange());
    }

    // ── Shell ────────────────────────────────────────────────────────────────

    _build() {
      const o = this.options;
      this._host.textContent = "";
      this.root = document.createElement("div");
      this.root.className = "wapyt-sched";
      if (o.height != null) this.root.style.height = typeof o.height === "number" ? `${o.height}px` : String(o.height);

      const bar = document.createElement("div");
      bar.className = "wapyt-sched-bar";
      const button = (label, cls, onClick, aria) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `wapyt-sched-btn ${cls || ""}`;
        b.textContent = label;
        if (aria) b.setAttribute("aria-label", aria);
        b.addEventListener("click", onClick);
        return b;
      };
      const nav = document.createElement("div");
      nav.className = "wapyt-sched-nav";
      nav.appendChild(button("Today", "", () => this.today()));
      const prev = button("", "wapyt-sched-icon", () => this.prev(), "Previous");
      prev.innerHTML = '<i class="mdi mdi-chevron-left" aria-hidden="true"></i>';
      const next = button("", "wapyt-sched-icon", () => this.next(), "Next");
      next.innerHTML = '<i class="mdi mdi-chevron-right" aria-hidden="true"></i>';
      nav.appendChild(prev);
      nav.appendChild(next);
      bar.appendChild(nav);
      this._titleEl = document.createElement("h2");
      this._titleEl.className = "wapyt-sched-title";
      this._titleEl.setAttribute("aria-live", "polite");
      bar.appendChild(this._titleEl);
      this._viewsEl = document.createElement("div");
      this._viewsEl.className = "wapyt-sched-views";
      this._viewsEl.setAttribute("role", "group");
      this._viewsEl.setAttribute("aria-label", "View");
      (o.views || VIEWS).filter((v) => VIEWS.includes(v)).forEach((view) => {
        const b = button(VIEW_LABELS[view], "wapyt-sched-view", () => this.setView(view));
        b.dataset.view = view;
        this._viewsEl.appendChild(b);
      });
      bar.appendChild(this._viewsEl);
      this.root.appendChild(bar);

      const main = document.createElement("div");
      main.className = "wapyt-sched-main";
      if (o.miniCalendar) {
        this._mini = document.createElement("div");
        this._mini.className = "wapyt-sched-mini";
        main.appendChild(this._mini);
      }
      this._viewEl = document.createElement("div");
      this._viewEl.className = "wapyt-sched-view-area";
      main.appendChild(this._viewEl);
      this.root.appendChild(main);

      this._live = document.createElement("div");
      this._live.className = "wapyt-sched-live";
      this._live.setAttribute("aria-live", "polite");
      this.root.appendChild(this._live);
      this._host.appendChild(this.root);
      if (o.readOnly) this.root.dataset.readOnly = "true";
    }

    _rangeTitle() {
      const range = this.getRange();
      const start = parse(range.start);
      const lastDay = addDays(parse(range.end), -1);
      if (this._view === "day") return this._longDate(start);
      if (this._view === "month") return this._fmt({ month: "long", year: "numeric" }).format(this._date);
      const sameMonth = start.getMonth() === lastDay.getMonth() && start.getFullYear() === lastDay.getFullYear();
      const left = this._fmt(sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" }).format(start);
      const right = this._fmt({ day: "numeric", month: "short", year: "numeric" }).format(lastDay);
      return `${left} – ${right}`;
    }

    _render() {
      if (this._drag) return; // never rebuild under a drag
      const hadFocus = this.root.contains(document.activeElement);
      const focusKey = hadFocus ? document.activeElement.dataset.focusKey : null;
      // Keep the person's scroll position, but only once the first scroll
      // (to scrollTo) has happened: an early re-render before the layout
      // gave the grid a height would otherwise "keep" 0 and stay at midnight.
      const scrollTop = this._scrollEl && this._scrolled ? this._scrollEl.scrollTop : null;
      this.root.dataset.view = this._view;
      this.root.setAttribute("data-wapyt-theme", this._theme());
      this._titleEl.textContent = this._rangeTitle();
      this._viewsEl.querySelectorAll(".wapyt-sched-view").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.view === this._view ? "true" : "false");
      });
      this._viewEl.textContent = "";
      this._scrollEl = null;
      if (this._view === "month") this._renderMonth();
      else if (this._view === "agenda") this._renderAgenda();
      else this._renderTimeGrid(scrollTop);
      if (this._mini) this._renderMini();
      if (focusKey) {
        const el = this.root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
        if (el) el.focus({ preventScroll: true });
      }
    }

    // ── Mini month ───────────────────────────────────────────────────────────

    _renderMini() {
      const o = this.options;
      const shown = this._miniMonth || new Date(this._date.getFullYear(), this._date.getMonth(), 1);
      this._miniMonth = shown;
      const range = this.getRange();
      const rStart = parse(range.start);
      const rEnd = parse(range.end);
      this._mini.textContent = "";
      const head = document.createElement("div");
      head.className = "wapyt-sched-mini-head";
      const label = document.createElement("span");
      label.textContent = this._fmt({ month: "long", year: "numeric" }).format(shown);
      const step = (dir, icon, aria) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wapyt-sched-mini-nav";
        b.setAttribute("aria-label", aria);
        b.innerHTML = `<i class="mdi ${icon}" aria-hidden="true"></i>`;
        b.addEventListener("click", () => {
          this._miniMonth = new Date(shown.getFullYear(), shown.getMonth() + dir, 1);
          this._renderMini();
        });
        return b;
      };
      head.appendChild(step(-1, "mdi-chevron-left", "Previous month"));
      head.appendChild(label);
      head.appendChild(step(1, "mdi-chevron-right", "Next month"));
      this._mini.appendChild(head);
      const grid = document.createElement("div");
      grid.className = "wapyt-sched-mini-grid";
      const first = startOfWeek(shown, o.weekStart);
      const dayName = this._fmt({ weekday: "narrow" });
      for (let i = 0; i < 7; i += 1) {
        const h = document.createElement("span");
        h.className = "wapyt-sched-mini-dow";
        h.setAttribute("aria-hidden", "true");
        h.textContent = dayName.format(addDays(first, i));
        grid.appendChild(h);
      }
      const today = new Date();
      for (let i = 0; i < 42; i += 1) {
        const d = addDays(first, i);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wapyt-sched-mini-day";
        b.textContent = String(d.getDate());
        b.setAttribute("aria-label", this._longDate(d));
        if (d.getMonth() !== shown.getMonth()) b.dataset.outside = "true";
        if (sameDay(d, today)) b.dataset.today = "true";
        if (d >= rStart && d < rEnd) b.dataset.inRange = "true";
        if (sameDay(d, this._date)) b.setAttribute("aria-current", "date");
        b.addEventListener("click", () => {
          this._miniMonth = null;
          this.setDate(d);
        });
        grid.appendChild(b);
      }
      this._mini.appendChild(grid);
    }

    // ── Time grid (day, week, work week) ────────────────────────────────────

    _visibleMinutes() {
      const o = this.options;
      return { from: Math.max(0, o.dayStart) * 60, to: Math.min(24, o.dayEnd) * 60 };
    }

    _pxPerMinute() {
      return this.options.slotHeight / this.options.slotMinutes;
    }

    // Timed items split into one segment per day they touch.
    _segmentsFor(day) {
      const out = [];
      const dayStart = startOfDay(day);
      const dayEnd = addDays(dayStart, 1);
      this._items.forEach((item) => {
        if (item.allDay) return;
        if (item.end <= dayStart || item.start >= dayEnd) return;
        const s = item.start < dayStart ? 0 : minutesOfDay(item.start);
        const e = item.end >= dayEnd ? DAY : (sameDay(item.end, day) ? minutesOfDay(item.end) : DAY);
        out.push({ item, s, e, continuesBefore: item.start < dayStart, continuesAfter: item.end > dayEnd });
      });
      // Column packing: overlapping segments sit side by side.
      out.sort((a, b) => a.s - b.s || b.e - a.e);
      let cluster = [];
      let clusterEnd = -1;
      const flush = () => {
        const cols = [];
        cluster.forEach((seg) => {
          let col = cols.findIndex((end) => end <= seg.s);
          if (col < 0) {
            col = cols.length;
            cols.push(seg.e);
          } else {
            cols[col] = seg.e;
          }
          seg.col = col;
        });
        cluster.forEach((seg) => { seg.cols = cols.length; });
        cluster = [];
      };
      out.forEach((seg) => {
        if (seg.s >= clusterEnd && cluster.length) flush();
        cluster.push(seg);
        clusterEnd = Math.max(clusterEnd, seg.e);
      });
      if (cluster.length) flush();
      return out;
    }

    _renderTimeGrid(scrollTop) {
      const o = this.options;
      const days = this._days();
      const vis = this._visibleMinutes();
      const ppm = this._pxPerMinute();
      const today = new Date();
      const wrap = document.createElement("div");
      wrap.className = "wapyt-sched-time";
      wrap.style.setProperty("--wapyt-sched-days", String(days.length));

      // Header: weekday and date per column.
      const head = document.createElement("div");
      head.className = "wapyt-sched-head";
      head.appendChild(Object.assign(document.createElement("div"), { className: "wapyt-sched-gutter" }));
      const dayLabel = this._fmt({ weekday: "short" });
      days.forEach((d) => {
        const h = document.createElement("div");
        h.className = "wapyt-sched-dayhead";
        if (sameDay(d, today)) h.dataset.today = "true";
        const name = document.createElement("span");
        name.className = "wapyt-sched-dayname";
        name.textContent = dayLabel.format(d);
        const num = document.createElement("button");
        num.type = "button";
        num.className = "wapyt-sched-daynum";
        num.textContent = String(d.getDate());
        num.setAttribute("aria-label", `${this._longDate(d)}, show the day`);
        num.addEventListener("click", () => { this._date = startOfDay(d); this.setView("day"); });
        h.appendChild(name);
        h.appendChild(num);
        head.appendChild(h);
      });
      wrap.appendChild(head);

      // All-day row: chips per day (multi-day items repeat per day).
      const allday = document.createElement("div");
      allday.className = "wapyt-sched-allday";
      const allLabel = document.createElement("div");
      allLabel.className = "wapyt-sched-gutter wapyt-sched-allday-label";
      allLabel.textContent = "All day";
      allday.appendChild(allLabel);
      days.forEach((d) => {
        const cell = document.createElement("div");
        cell.className = "wapyt-sched-allday-cell";
        cell.dataset.date = isoDate(d);
        this._dayItems(d, true).forEach((item) => cell.appendChild(this._chip(item, d)));
        cell.addEventListener("dblclick", (event) => {
          if (event.target.closest(".wapyt-sched-item")) return;
          this._create(d, null, null, true);
        });
        allday.appendChild(cell);
      });
      allday.addEventListener("pointerdown", (event) => this._chipPointerDown(event));
      wrap.appendChild(allday);

      // Scroll body: hour gutter and day columns.
      const scroll = document.createElement("div");
      scroll.className = "wapyt-sched-scroll";
      this._scrollEl = scroll;
      const body = document.createElement("div");
      body.className = "wapyt-sched-body";
      body.setAttribute("role", "grid");
      body.setAttribute("aria-label", `${this._rangeTitle()}, time slots`);
      body.style.height = `${(vis.to - vis.from) * ppm}px`;
      const gutter = document.createElement("div");
      gutter.className = "wapyt-sched-gutter wapyt-sched-hours";
      gutter.setAttribute("aria-hidden", "true");
      const hourFmt = this._fmt({ hour: "numeric" });
      for (let m = vis.from; m < vis.to; m += 60) {
        const label = document.createElement("span");
        label.className = "wapyt-sched-hour";
        label.style.top = `${(m - vis.from) * ppm}px`;
        if (m > vis.from) label.textContent = hourFmt.format(new Date(2000, 0, 1, m / 60));
        gutter.appendChild(label);
      }
      body.appendChild(gutter);

      // The keyboard cursor, if it is in this range; else the first day at scrollTo.
      const cursor = this._cursor && this._cursor.minutes != null && days.some((d) => sameDay(d, this._cursor.date))
        ? this._cursor : null;
      days.forEach((d, dayIndex) => {
        const col = document.createElement("div");
        col.className = "wapyt-sched-col";
        col.setAttribute("role", "row");
        col.dataset.date = isoDate(d);
        if (sameDay(d, today)) col.dataset.today = "true";
        // Slots: the keyboard cursor and the targets for create / drop.
        for (let m = vis.from; m < vis.to; m += o.slotMinutes) {
          const slot = document.createElement("div");
          slot.className = "wapyt-sched-slot";
          slot.setAttribute("role", "gridcell");
          slot.dataset.minutes = String(m);
          if (m % 60 === 0) slot.dataset.hour = "true";
          const at = addMinutes(startOfDay(d), m);
          slot.setAttribute("aria-label", `${this._fmt({ weekday: "long", day: "numeric", month: "long" }).format(d)}, ${this._time(at)}`);
          slot.dataset.focusKey = `slot:${isoDate(d)}:${m}`;
          const isCursor = cursor ? sameDay(cursor.date, d) && cursor.minutes === m
            : dayIndex === 0 && m === Math.max(vis.from, Math.min(vis.to - o.slotMinutes, o.scrollTo * 60));
          slot.tabIndex = isCursor ? 0 : -1;
          col.appendChild(slot);
        }
        this._segmentsFor(d).forEach((seg) => {
          if (seg.e <= vis.from || seg.s >= vis.to) return;
          col.appendChild(this._block(seg, d, vis, ppm));
        });
        if (o.nowIndicator && sameDay(d, today)) {
          const now = document.createElement("div");
          now.className = "wapyt-sched-now";
          now.setAttribute("aria-hidden", "true");
          col.appendChild(now);
        }
        body.appendChild(col);
      });
      body.addEventListener("pointerdown", (event) => this._gridPointerDown(event));
      body.addEventListener("dblclick", (event) => this._gridDblClick(event));
      body.addEventListener("keydown", (event) => this._gridKey(event));
      scroll.appendChild(body);
      wrap.appendChild(scroll);
      this._viewEl.appendChild(wrap);
      this._paintNow();
      // Keep the scroll position across re-renders; the first time, start at
      // scrollTo, applied once the box can scroll: a layout cell is often
      // sized after the scheduler is built, and scrolling a box that cannot
      // scroll yet leaves it at midnight.
      if (scrollTop != null) scroll.scrollTop = scrollTop;
      const target = Math.max(0, (o.scrollTo * 60 - vis.from) * ppm);
      const settle = () => {
        if (!scroll.isConnected) return false;
        // The header and all-day rows have no scrollbar: pad them by its
        // width so their columns line up with the day columns below.
        wrap.style.setProperty("--wapyt-sched-scrollbar", `${scroll.offsetWidth - scroll.clientWidth}px`);
        if (scrollTop != null || this._scrolled) return true;
        if (scroll.scrollHeight <= scroll.clientHeight) return false;
        scroll.scrollTop = target;
        this._scrolled = true;
        return true;
      };
      if (typeof ResizeObserver === "function") {
        const ro = new ResizeObserver(() => { if (settle() || !scroll.isConnected) ro.disconnect(); });
        ro.observe(scroll);
      } else {
        requestAnimationFrame(settle);
      }
    }

    _paintNow() {
      if (!this.root.isConnected) {
        clearInterval(this._nowTimer);
        return;
      }
      const line = this.root.querySelector(".wapyt-sched-now");
      if (!line) return;
      const vis = this._visibleMinutes();
      const m = minutesOfDay(new Date());
      line.hidden = m < vis.from || m > vis.to;
      line.style.top = `${(m - vis.from) * this._pxPerMinute()}px`;
    }

    _block(seg, day, vis, ppm) {
      const { item } = seg;
      const el = document.createElement("div");
      el.className = "wapyt-sched-item wapyt-sched-block";
      this._decorate(el, item, day);
      const top = (Math.max(seg.s, vis.from) - vis.from) * ppm;
      // At least 18px, so a 15-minute item's title is readable.
      const height = Math.max((Math.min(seg.e, vis.to) - Math.max(seg.s, vis.from)) * ppm, 18);
      el.style.top = `${top}px`;
      el.style.height = `${height - 2}px`;
      el.style.left = `calc(${(seg.col / seg.cols) * 100}% + 1px)`;
      el.style.width = `calc(${100 / seg.cols}% - 3px)`;
      if (seg.continuesBefore) el.dataset.continuesBefore = "true";
      if (seg.continuesAfter) el.dataset.continuesAfter = "true";
      const time = document.createElement("span");
      time.className = "wapyt-sched-item-time";
      time.textContent = this._timeRange(item);
      const title = document.createElement("span");
      title.className = "wapyt-sched-item-title";
      title.textContent = item.title;
      el.appendChild(title);
      el.appendChild(time);
      if (height < 36) el.dataset.short = "true";
      if (this._editable(item) && !seg.continuesAfter) {
        const grip = document.createElement("div");
        grip.className = "wapyt-sched-grip";
        grip.setAttribute("aria-hidden", "true");
        el.appendChild(grip);
      }
      return el;
    }

    // Everything an item element shares across views.
    _decorate(el, item, day) {
      el.dataset.id = item.id;
      el.dataset.focusKey = `item:${item.id}:${day ? isoDate(day) : ""}`;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      const error = this._errors.get(item.id);
      const label = `${item.title}, ${item.allDay ? "all day" : this._timeRange(item)}, ${this._longDate(item.start)}`
        + (error ? `. Error: ${error}` : "");
      el.setAttribute("aria-label", label);
      el.style.setProperty("--wapyt-sched-color", this._colorOf(item));
      if (!this._editable(item)) el.dataset.locked = "true";
      if (error) {
        el.dataset.error = "true";
        el.dataset.wapytTooltip = error;
      }
      if (this._pending && this._pending.id === item.id) el.dataset.pending = "true";
      el.addEventListener("keydown", (event) => this._itemKey(event, item.id));
      el.addEventListener("click", () => {
        if (this._suppressClick) return;
        this._emit("open", { id: item.id, item: this._public(item) });
      });
    }

    _editable(item) {
      return !this.options.readOnly && item.editable;
    }

    _chip(item, day) {
      const el = document.createElement("div");
      el.className = "wapyt-sched-item wapyt-sched-chip";
      this._decorate(el, item, day);
      if (!item.allDay) {
        const time = document.createElement("span");
        time.className = "wapyt-sched-item-time";
        time.textContent = this._time(item.start);
        el.appendChild(time);
      }
      const title = document.createElement("span");
      title.className = "wapyt-sched-item-title";
      title.textContent = item.title;
      el.appendChild(title);
      if (item.allDay || !sameDay(item.start, addMinutes(item.end, -1))) el.dataset.allDay = "true";
      return el;
    }

    // Items touching `day`, all-day ones first; allDayOnly for the all-day row.
    _dayItems(day, allDayOnly) {
      const start = startOfDay(day);
      const end = addDays(start, 1);
      return Array.from(this._items.values())
        .filter((item) => (allDayOnly ? item.allDay : true) && item.start < end && item.end > start)
        .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || a.title.localeCompare(b.title));
    }

    // ── Month ────────────────────────────────────────────────────────────────

    _renderMonth() {
      const days = this._days();
      const today = new Date();
      const wrap = document.createElement("div");
      wrap.className = "wapyt-sched-month";
      const dow = document.createElement("div");
      dow.className = "wapyt-sched-month-dow";
      const name = this._fmt({ weekday: "short" });
      days.slice(0, 7).forEach((d) => {
        const h = document.createElement("div");
        h.textContent = name.format(d);
        dow.appendChild(h);
      });
      wrap.appendChild(dow);
      const grid = document.createElement("div");
      grid.className = "wapyt-sched-month-grid";
      grid.setAttribute("role", "grid");
      grid.setAttribute("aria-label", `${this._rangeTitle()}, days`);
      const inGrid = (d) => d && days.some((x) => sameDay(x, d));
      const cursor = inGrid(this._cursor && this._cursor.date) ? this._cursor.date : inGrid(this._date) ? this._date : days[0];
      days.forEach((d) => {
        const cell = document.createElement("div");
        cell.className = "wapyt-sched-month-cell";
        cell.setAttribute("role", "gridcell");
        cell.dataset.date = isoDate(d);
        cell.dataset.focusKey = `day:${isoDate(d)}`;
        cell.tabIndex = sameDay(d, cursor) ? 0 : -1;
        cell.setAttribute("aria-label", this._longDate(d));
        if (d.getMonth() !== this._date.getMonth()) cell.dataset.outside = "true";
        if (sameDay(d, today)) cell.dataset.today = "true";
        const num = document.createElement("button");
        num.type = "button";
        num.className = "wapyt-sched-month-num";
        num.tabIndex = -1;
        num.textContent = String(d.getDate());
        num.setAttribute("aria-label", `${this._longDate(d)}, show the day`);
        num.addEventListener("click", () => { this._date = startOfDay(d); this.setView("day"); });
        cell.appendChild(num);
        const list = document.createElement("div");
        list.className = "wapyt-sched-month-items";
        this._dayItems(d, false).forEach((item) => list.appendChild(this._chip(item, d)));
        cell.appendChild(list);
        grid.appendChild(cell);
      });
      grid.addEventListener("dblclick", (event) => {
        const cell = event.target.closest(".wapyt-sched-month-cell");
        if (!cell || event.target.closest(".wapyt-sched-item, .wapyt-sched-more, .wapyt-sched-month-num")) return;
        this._create(parse(cell.dataset.date), null, null, true);
      });
      grid.addEventListener("keydown", (event) => this._monthKey(event));
      grid.addEventListener("pointerdown", (event) => this._chipPointerDown(event));
      wrap.appendChild(grid);
      this._viewEl.appendChild(wrap);
      // Fold what does not fit into "+N more" once the cells have a size.
      requestAnimationFrame(() => this._foldMonth(grid));
    }

    _foldMonth(grid) {
      if (!grid.isConnected) return;
      grid.querySelectorAll(".wapyt-sched-month-cell").forEach((cell) => {
        const list = cell.querySelector(".wapyt-sched-month-items");
        const chips = Array.from(list.querySelectorAll(".wapyt-sched-chip"));
        if (!chips.length) return;
        const room = list.clientHeight;
        const each = chips[0].offsetHeight + 2;
        let fit = Math.max(0, Math.floor(room / each));
        if (fit >= chips.length) return;
        fit = Math.max(0, fit - 1); // make room for the "+N more" line
        chips.slice(fit).forEach((chip) => { chip.hidden = true; });
        const more = document.createElement("button");
        more.type = "button";
        more.className = "wapyt-sched-more";
        const hidden = chips.length - fit;
        more.textContent = `+${hidden} more`;
        more.setAttribute("aria-label", `${hidden} more on ${this._longDate(parse(cell.dataset.date))}`);
        more.addEventListener("click", (event) => {
          event.stopPropagation();
          this._showDayPopup(parse(cell.dataset.date), more);
        });
        list.appendChild(more);
      });
    }

    _showDayPopup(day, anchor) {
      const Popup = globalNS.Popup;
      if (!Popup) {
        this._date = startOfDay(day);
        this.setView("day");
        return;
      }
      if (this._popup) this._popup.destroy();
      this._popup = new Popup({ placement: "bottom-start", label: this._longDate(day), css: "wapyt-sched-popup", width: 240 });
      const head = document.createElement("div");
      head.className = "wapyt-sched-popup-head";
      head.textContent = this._longDate(day);
      this._popup.body.appendChild(head);
      this._dayItems(day, false).forEach((item) => this._popup.body.appendChild(this._chip(item, day)));
      this._popup.show(anchor);
    }

    // ── Agenda ───────────────────────────────────────────────────────────────

    _renderAgenda() {
      const days = this._days();
      const wrap = document.createElement("div");
      wrap.className = "wapyt-sched-agenda";
      let any = false;
      days.forEach((d) => {
        const items = this._dayItems(d, false);
        if (!items.length) return;
        any = true;
        const group = document.createElement("section");
        group.className = "wapyt-sched-agenda-day";
        const head = document.createElement("h3");
        head.className = "wapyt-sched-agenda-head";
        head.textContent = this._fmt({ weekday: "long", day: "numeric", month: "long" }).format(d);
        if (sameDay(d, new Date())) head.dataset.today = "true";
        group.appendChild(head);
        items.forEach((item) => {
          const row = document.createElement("div");
          row.className = "wapyt-sched-item wapyt-sched-agenda-item";
          this._decorate(row, item, d);
          const time = document.createElement("span");
          time.className = "wapyt-sched-item-time";
          time.textContent = item.allDay ? "All day" : this._timeRange(item);
          const title = document.createElement("span");
          title.className = "wapyt-sched-item-title";
          title.textContent = item.title;
          row.appendChild(time);
          row.appendChild(title);
          if (item.description) {
            const desc = document.createElement("span");
            desc.className = "wapyt-sched-item-desc";
            desc.textContent = item.description;
            row.appendChild(desc);
          }
          group.appendChild(row);
        });
        wrap.appendChild(group);
      });
      if (!any) {
        const empty = document.createElement("div");
        empty.className = "wapyt-sched-empty";
        empty.textContent = "Nothing scheduled";
        wrap.appendChild(empty);
      }
      this._viewEl.appendChild(wrap);
    }

    // ── Creating ─────────────────────────────────────────────────────────────

    _create(day, fromMinutes, toMinutes, allDay) {
      if (this.options.readOnly) return;
      if (allDay) {
        const start = startOfDay(day);
        this._emit("create", { start: isoDate(start), end: isoDate(addDays(start, 1)), all_day: true });
        return;
      }
      const start = addMinutes(startOfDay(day), fromMinutes);
      const end = addMinutes(startOfDay(day), toMinutes);
      this._emit("create", { start: isoDateTime(start), end: isoDateTime(end), all_day: false });
    }

    _gridDblClick(event) {
      const slot = event.target.closest(".wapyt-sched-slot");
      if (!slot || event.target.closest(".wapyt-sched-item")) return;
      const col = slot.closest(".wapyt-sched-col");
      const m = Number(slot.dataset.minutes);
      this._create(parse(col.dataset.date), m, m + this.options.slotMinutes, false);
    }

    // ── Pointer: create (empty slots), move and resize (items) ─────────────

    _slotAt(clientX, clientY) {
      const cols = Array.from(this._viewEl.querySelectorAll(".wapyt-sched-col"));
      const col = cols.find((c) => {
        const r = c.getBoundingClientRect();
        return clientX >= r.left && clientX < r.right;
      }) || (clientX < (cols[0] && cols[0].getBoundingClientRect().left) ? cols[0] : cols[cols.length - 1]);
      if (!col) return null;
      const vis = this._visibleMinutes();
      const r = col.getBoundingClientRect();
      const raw = vis.from + (clientY - r.top) / this._pxPerMinute();
      return { col, date: parse(col.dataset.date), minutes: Math.max(vis.from, Math.min(vis.to, raw)) };
    }

    _snap(minutes) {
      const s = this.options.slotMinutes;
      return Math.round(minutes / s) * s;
    }

    _gridPointerDown(event) {
      if (event.button !== 0) return;
      const itemEl = event.target.closest(".wapyt-sched-block");
      const o = this.options;
      if (itemEl) {
        const item = this._items.get(itemEl.dataset.id);
        if (!item || !this._editable(item)) return;
        const mode = event.target.closest(".wapyt-sched-grip") ? "resize" : "move";
        const at = this._slotAt(event.clientX, event.clientY);
        this._startDrag(event, { mode, item, el: itemEl, grabMinutes: at ? at.minutes : 0, grabDate: at ? at.date : item.start });
        return;
      }
      if (o.readOnly || !event.target.closest(".wapyt-sched-slot")) return;
      const at = this._slotAt(event.clientX, event.clientY);
      if (!at) return;
      this._startDrag(event, { mode: "create", date: at.date, anchor: Math.floor(at.minutes / o.slotMinutes) * o.slotMinutes });
    }

    _chipPointerDown(event) {
      if (event.button !== 0) return;
      const chip = event.target.closest(".wapyt-sched-chip");
      if (!chip) return;
      const item = this._items.get(chip.dataset.id);
      if (!item || !this._editable(item)) return;
      this._startDrag(event, { mode: "move-day", item, el: chip, grabDate: parse(chip.closest("[data-date]").dataset.date) });
    }

    _startDrag(event, drag) {
      Object.assign(drag, { x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false });
      this._drag = drag;
      const move = (e) => this._dragMove(e);
      const up = (e) => this._dragEnd(e, false);
      const key = (e) => {
        if (e.key === "Escape" && this._drag) {
          e.preventDefault();
          e.stopPropagation();
          this._dragEnd(e, true);
        }
      };
      drag.cleanup = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        document.removeEventListener("keydown", key, true);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
      document.addEventListener("keydown", key, true);
    }

    _dragMove(event) {
      const drag = this._drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
        drag.active = true;
        this.root.dataset.dragging = drag.mode;
        if (drag.el) drag.el.dataset.dragging = "true";
        drag.ghost = document.createElement("div");
        drag.ghost.className = "wapyt-sched-ghost";
        drag.label = document.createElement("span");
        drag.label.className = "wapyt-sched-ghost-label";
        drag.ghost.appendChild(drag.label);
        if (drag.item) drag.ghost.style.setProperty("--wapyt-sched-color", this._colorOf(drag.item));
      }
      event.preventDefault();
      this._autoScroll(event.clientY);
      if (drag.mode === "move-day") this._dragDay(event);
      else this._dragTime(event);
    }

    _autoScroll(clientY) {
      const el = this._scrollEl;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + 24) el.scrollTop -= 10;
      else if (clientY > r.bottom - 24) el.scrollTop += 10;
    }

    _dragTime(event) {
      const drag = this._drag;
      const o = this.options;
      const vis = this._visibleMinutes();
      const at = this._slotAt(event.clientX, event.clientY);
      if (!at) return;
      let day = at.date;
      let from;
      let to;
      if (drag.mode === "create") {
        const here = this._snap(at.minutes);
        from = Math.min(drag.anchor, here);
        to = Math.max(drag.anchor + o.slotMinutes, here);
        if (here <= drag.anchor) to = drag.anchor + o.slotMinutes;
        day = drag.date;
      } else if (drag.mode === "move") {
        const item = drag.item;
        const duration = clockMinutes(item.start, item.end);
        const offset = drag.grabMinutes - (sameDay(item.start, drag.grabDate) ? minutesOfDay(item.start) : 0);
        from = this._snap(at.minutes - offset);
        from = Math.max(vis.from, Math.min(from, DAY - o.slotMinutes));
        to = from + duration;
      } else {
        // resize: the end follows the pointer, on the item's last day
        const item = drag.item;
        day = startOfDay(item.start);
        const startMin = minutesOfDay(item.start);
        const min = Number(o.minItemMinutes) || o.slotMinutes;
        const endDay = sameDay(at.date, day) ? at.minutes : (at.date > day ? DAY : startMin + min);
        from = startMin;
        to = Math.max(startMin + min, this._snap(endDay));
        to = Math.min(to, DAY);
      }
      drag.result = { day: startOfDay(day), from, to };
      const col = this._viewEl.querySelector(`.wapyt-sched-col[data-date="${isoDate(day)}"]`);
      if (col && drag.ghost.parentElement !== col) col.appendChild(drag.ghost);
      const ppm = this._pxPerMinute();
      const top = (Math.max(from, vis.from) - vis.from) * ppm;
      drag.ghost.style.top = `${top}px`;
      drag.ghost.style.height = `${Math.max((Math.min(to, vis.to) - Math.max(from, vis.from)) * ppm - 2, 12)}px`;
      const s = addMinutes(drag.result.day, from);
      const e = addMinutes(drag.result.day, to);
      drag.label.textContent = `${this._time(s)} – ${this._time(e)}`;
    }

    _dragDay(event) {
      const drag = this._drag;
      const cells = Array.from(this._viewEl.querySelectorAll("[data-date].wapyt-sched-month-cell, [data-date].wapyt-sched-allday-cell"));
      const cell = cells.find((c) => {
        const r = c.getBoundingClientRect();
        return event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom;
      });
      this._viewEl.querySelectorAll("[data-drop]").forEach((c) => delete c.dataset.drop);
      if (!cell) {
        drag.result = null;
        drag.ghost.remove();
        return;
      }
      cell.dataset.drop = "true";
      drag.result = { date: parse(cell.dataset.date) };
      if (drag.ghost.parentElement !== document.body) document.body.appendChild(drag.ghost);
      drag.ghost.dataset.floating = "true";
      drag.ghost.style.left = `${event.clientX + 10}px`;
      drag.ghost.style.top = `${event.clientY + 6}px`;
      drag.label.textContent = `${drag.item.title} → ${this._fmt({ weekday: "short", day: "numeric", month: "short" }).format(drag.result.date)}`;
    }

    _dragEnd(event, cancelled) {
      const drag = this._drag;
      if (!drag) return;
      drag.cleanup();
      this._drag = null;
      if (!drag.active) return; // a plain click: the item's click handler opens it
      delete this.root.dataset.dragging;
      if (drag.el) delete drag.el.dataset.dragging;
      if (drag.ghost) drag.ghost.remove();
      this._viewEl.querySelectorAll("[data-drop]").forEach((c) => delete c.dataset.drop);
      this._suppressClick = true;
      setTimeout(() => { this._suppressClick = false; }, 0);
      const r = drag.result;
      if (cancelled || !r) {
        this._render();
        return;
      }
      if (drag.mode === "create") {
        this._render();
        this._create(r.day, r.from, r.to, false);
      } else if (drag.mode === "move") {
        this._commit(drag.item, addMinutes(r.day, r.from), addMinutes(r.day, r.to), "move");
      } else if (drag.mode === "resize") {
        this._commit(drag.item, drag.item.start, addMinutes(r.day, r.to), "resize");
      } else {
        const shift = dayDiff(drag.grabDate, r.date);
        this._commit(drag.item, addDays(drag.item.start, shift), addDays(drag.item.end, shift), "move");
      }
    }

    // Apply a change at once, remember the old place for revert(), and tell
    // the app. Nothing fires when nothing changed.
    _commit(item, start, end, kind) {
      if (start.getTime() === item.start.getTime() && end.getTime() === item.end.getTime()) {
        this._render();
        return;
      }
      const before = this._specOf(item);
      const old = this._when(item);
      this._previous.set(item.id, before);
      this._errors.delete(item.id);
      item.start = start;
      item.end = end;
      this._render();
      const when = this._when(item);
      this._live.textContent = `${item.title} ${kind === "resize" ? "now ends" : "moved to"} ${item.allDay
        ? this._longDate(item.start) : `${this._longDate(item.start)}, ${this._timeRange(item)}`}`;
      this._emit(kind, { id: item.id, start: when.start, end: when.end, all_day: item.allDay, old, item: this._public(item) });
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────

    _gridKey(event) {
      const slot = event.target.closest(".wapyt-sched-slot");
      if (!slot) return;
      const o = this.options;
      const vis = this._visibleMinutes();
      const col = slot.closest(".wapyt-sched-col");
      const days = this._days();
      let date = parse(col.dataset.date);
      let m = Number(slot.dataset.minutes);
      const index = days.findIndex((d) => sameDay(d, date));
      switch (event.key) {
        case "ArrowUp": m -= o.slotMinutes; break;
        case "ArrowDown": m += o.slotMinutes; break;
        case "ArrowLeft":
          if (index > 0) date = days[index - 1];
          else { event.preventDefault(); this._cursor = { date: addDays(date, -1), minutes: m }; this.prev(); this._focusCursor(); return; }
          break;
        case "ArrowRight":
          if (index < days.length - 1) date = days[index + 1];
          else { event.preventDefault(); this._cursor = { date: addDays(date, 1), minutes: m }; this.next(); this._focusCursor(); return; }
          break;
        case "Home": m = vis.from; break;
        case "End": m = vis.to - o.slotMinutes; break;
        case "PageUp": event.preventDefault(); this.prev(); return;
        case "PageDown": event.preventDefault(); this.next(); return;
        case "Enter":
        case " ":
          event.preventDefault();
          this._create(date, m, m + o.slotMinutes, false);
          return;
        default: return;
      }
      event.preventDefault();
      m = Math.max(vis.from, Math.min(vis.to - o.slotMinutes, m));
      this._moveSlotFocus(date, m);
    }

    _moveSlotFocus(date, minutes) {
      this._cursor = { date, minutes };
      const target = this._viewEl.querySelector(`.wapyt-sched-col[data-date="${isoDate(date)}"] .wapyt-sched-slot[data-minutes="${minutes}"]`);
      if (!target) return;
      this._viewEl.querySelectorAll('.wapyt-sched-slot[tabindex="0"]').forEach((s) => { s.tabIndex = -1; });
      target.tabIndex = 0;
      target.focus();
    }

    _focusCursor() {
      if (!this._cursor) return;
      if (this._view === "month") {
        const cell = this._viewEl.querySelector(`.wapyt-sched-month-cell[data-date="${isoDate(this._cursor.date)}"]`);
        if (cell) cell.focus();
      } else if (this._cursor.minutes != null) {
        this._moveSlotFocus(this._cursor.date, this._cursor.minutes);
      }
    }

    _monthKey(event) {
      const cell = event.target.closest(".wapyt-sched-month-cell");
      if (!cell || event.target !== cell) return;
      let date = parse(cell.dataset.date);
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (event.key in steps) {
        event.preventDefault();
        date = addDays(date, steps[event.key]);
        this._cursor = { date };
        const target = this._viewEl.querySelector(`.wapyt-sched-month-cell[data-date="${isoDate(date)}"]`);
        if (target) {
          this._viewEl.querySelectorAll('.wapyt-sched-month-cell[tabindex="0"]').forEach((c) => { c.tabIndex = -1; });
          target.tabIndex = 0;
          target.focus();
        } else {
          this.setDate(date);
          this._focusCursor();
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this._create(date, null, null, true);
      } else if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        if (event.key === "PageUp") this.prev();
        else this.next();
      }
    }

    // On an item: Enter opens, Delete asks to delete; arrows (Shift for the
    // end) stage a move that Enter commits and Escape drops.
    _itemKey(event, id) {
      const item = this._items.get(id);
      if (!item) return;
      const o = this.options;
      const pending = this._pending && this._pending.id === id ? this._pending : null;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        if (pending) {
          this._pending = null;
          this._commit(item, pending.start, pending.end, pending.kind);
          return;
        }
        this._emit("open", { id, item: this._public(item) });
        return;
      }
      if (event.key === "Escape" && pending) {
        event.preventDefault();
        event.stopPropagation();
        this._pending = null;
        this._render();
        this._live.textContent = "Move cancelled";
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !pending) {
        if (!this._editable(item)) return;
        event.preventDefault();
        this._emit("delete", { id, item: this._public(item) });
        return;
      }
      const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!arrows.includes(event.key) || !this._editable(item)) return;
      event.preventDefault();
      event.stopPropagation();
      const base = pending || { id, start: item.start, end: item.end, kind: "move" };
      let { start, end } = base;
      const dayStep = (n) => { start = addDays(start, n); end = addDays(end, n); };
      const timed = !item.allDay && this._view !== "month" && this._view !== "agenda";
      let kind = base.kind;
      if (event.key === "ArrowLeft") dayStep(-1);
      else if (event.key === "ArrowRight") dayStep(1);
      else if (!timed) dayStep(event.key === "ArrowUp" ? -7 : 7);
      else if (event.shiftKey) {
        kind = "resize";
        const min = Number(o.minItemMinutes) || o.slotMinutes;
        const next = addMinutes(end, event.key === "ArrowUp" ? -o.slotMinutes : o.slotMinutes);
        if (clockMinutes(start, next) >= min) end = next;
      } else {
        const d = event.key === "ArrowUp" ? -o.slotMinutes : o.slotMinutes;
        start = addMinutes(start, d);
        end = addMinutes(end, d);
      }
      this._pending = { id, start, end, kind };
      // Show the staged place: draw the item there, marked pending.
      const real = { start: item.start, end: item.end };
      item.start = start;
      item.end = end;
      const range = this.getRange();
      if (start < parse(range.start) || start >= parse(range.end)) this._date = startOfDay(start);
      this._render();
      item.start = real.start;
      item.end = real.end;
      const el = this.root.querySelector(`.wapyt-sched-item[data-id="${CSS.escape(id)}"]`);
      if (el) el.focus();
      this._live.textContent = `${item.title}: ${item.allDay ? this._longDate(start) : `${this._longDate(start)} ${this._time(start)} – ${this._time(end)}`}. Enter to confirm, Escape to cancel.`;
    }

    // ── Printing ─────────────────────────────────────────────────────────────

    // Prints this scheduler alone: the rest of the page is hidden for the
    // print, the time grid is drawn without its scroll box.
    print() {
      const html = document.documentElement;
      html.dataset.wapytPrint = "true";
      this.root.dataset.printing = "true";
      const done = () => {
        delete html.dataset.wapytPrint;
        delete this.root.dataset.printing;
        window.removeEventListener("afterprint", done);
      };
      window.addEventListener("afterprint", done);
      window.print();
    }

    // ── Downloads ────────────────────────────────────────────────────────────

    download(filename, text, mime) {
      const blob = new Blob([text], { type: mime || "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ── Lifecycle and events ─────────────────────────────────────────────────

    refresh() {
      this._render();
    }

    destroy() {
      schedulers.delete(this);
      clearInterval(this._nowTimer);
      if (this._drag) this._drag.cleanup();
      if (this._popup) this._popup.destroy();
      this._host.textContent = "";
      this._events = {};
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
          console.error("[wapyt] Scheduler listener failed", error);
        }
      });
    }
  }

  globalNS.Scheduler = Scheduler;
})();
