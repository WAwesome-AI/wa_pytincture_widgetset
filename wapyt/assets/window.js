(function () {
  // Window: a movable, resizable dialog, non-modal by default (dhxpyt's
  // `window`). ModalWindow stays the fixed, centred dialog it was; this is
  // the free-floating one. Mounted on <body>; the title reaches the DOM as
  // text.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  // Every open window, back to front. The last one is on top: it answers
  // Escape, and its z-index is the highest.
  const stack = [];
  const BASE_Z = 9000; // under ModalWindow (9999), popups and menus
  const MODAL_Z = 9600;
  const KEEP_VISIBLE = 48; // px of a window that must stay on screen
  const EDGES = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
    + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function toPx(value, fallback) {
    if (value == null || value === "") return fallback;
    if (typeof value === "number") return value;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function restack() {
    stack.forEach((win, index) => {
      const z = (win.options.modal ? MODAL_Z : BASE_Z) + index * 2;
      win.root.style.zIndex = String(z + 1);
      if (win.backdrop) win.backdrop.style.zIndex = String(z);
      win.root.dataset.active = index === stack.length - 1 ? "true" : "false";
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !stack.length) return;
    const top = stack[stack.length - 1];
    // A non-modal window only closes on Escape when focus is inside it.
    if (!top.options.closable) return;
    if (!top.options.modal && !top.root.contains(document.activeElement)) return;
    if (event.defaultPrevented) return; // a menu or combo inside took it
    top._dismiss("escape");
  });

  window.addEventListener("resize", () => stack.forEach((win) => win._clamp(true)));

  class Window {
    constructor(options = {}) {
      this.options = Object.assign(
        {
          title: "",
          width: 480,
          height: 320,
          left: null,
          top: null,
          minWidth: 200,
          minHeight: 120,
          maxWidth: null,
          maxHeight: null,
          movable: true,
          resizable: true,
          modal: false,
          closable: true,
          maximizable: true,
          maximized: false,
          footer: false,
          disposeOnClose: false,
        },
        options || {}
      );
      this._events = {};
      this._visible = false;
      this._closed = false;
      this._maximized = false;
      this._rect = { left: 0, top: 0, width: 0, height: 0 };
      this._placed = false;
      this._build();
    }

    _build() {
      const o = this.options;
      const titleId = `wapyt_win_${Math.random().toString(16).slice(2)}`;
      this.root = document.createElement("div");
      this.root.className = "wapyt-window";
      this.root.hidden = true;
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-labelledby", titleId);
      if (o.modal) this.root.setAttribute("aria-modal", "true");
      this.root.tabIndex = -1;
      this.root.addEventListener("pointerdown", () => this.bringToFront(), true);
      this.root.addEventListener("keydown", (event) => this._trapTab(event));

      this.header = document.createElement("div");
      this.header.className = "wapyt-window-header";
      // The title bar is focusable: arrows move the window, Shift+arrows
      // resize it, Enter maximises.
      if (o.movable || o.resizable) {
        this.header.tabIndex = 0;
        this.header.setAttribute("aria-label", "Window title bar: arrow keys move, Shift and arrow keys resize");
      }
      this.titleEl = document.createElement("span");
      this.titleEl.className = "wapyt-window-title";
      this.titleEl.id = titleId;
      this.titleEl.textContent = o.title || "";
      this.header.appendChild(this.titleEl);

      const buttons = document.createElement("div");
      buttons.className = "wapyt-window-buttons";
      if (o.maximizable) {
        this.maxBtn = document.createElement("button");
        this.maxBtn.type = "button";
        this.maxBtn.className = "wapyt-window-button";
        this.maxBtn.addEventListener("click", () => (this._maximized ? this.restore() : this.maximize()));
        buttons.appendChild(this.maxBtn);
      }
      if (o.closable) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "wapyt-window-button";
        close.setAttribute("aria-label", "Close");
        close.title = "Close";
        const icon = document.createElement("i");
        icon.className = "mdi mdi-close";
        icon.setAttribute("aria-hidden", "true");
        close.appendChild(icon);
        close.addEventListener("click", () => this._dismiss("button"));
        buttons.appendChild(close);
      }
      this.header.appendChild(buttons);
      this.root.appendChild(this.header);

      this.bodyEl = document.createElement("div");
      this.bodyEl.className = "wapyt-window-body";
      this.root.appendChild(this.bodyEl);

      // Always defined (null without a footer): Pyodide raises AttributeError
      // reading a property that was never set.
      this.footerEl = null;
      if (o.footer) {
        this.footerEl = document.createElement("div");
        this.footerEl.className = "wapyt-window-footer";
        this.root.appendChild(this.footerEl);
      }

      if (o.resizable) {
        EDGES.forEach((edge) => {
          const grip = document.createElement("div");
          grip.className = "wapyt-window-grip";
          grip.dataset.edge = edge;
          grip.addEventListener("pointerdown", (event) => this._startDrag(event, edge));
          this.root.appendChild(grip);
        });
      }
      if (o.movable) {
        this.header.addEventListener("pointerdown", (event) => {
          if (event.target.closest(".wapyt-window-button")) return;
          this._startDrag(event, "move");
        });
      }
      if (o.maximizable) {
        this.header.addEventListener("dblclick", (event) => {
          if (event.target.closest(".wapyt-window-button")) return;
          if (this._maximized) this.restore();
          else this.maximize();
        });
      }
      this.header.addEventListener("keydown", (event) => this._onHeaderKey(event));

      if (o.modal) {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "wapyt-window-backdrop";
        this.backdrop.hidden = true;
        document.body.appendChild(this.backdrop);
      }
      document.body.appendChild(this.root);
      this._syncMaxButton();
    }

    // ── Geometry ─────────────────────────────────────────────────────────────

    _limits() {
      const o = this.options;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        minW: Math.min(toPx(o.minWidth, 200), vw),
        minH: Math.min(toPx(o.minHeight, 120), vh),
        maxW: Math.min(toPx(o.maxWidth, Infinity), vw),
        maxH: Math.min(toPx(o.maxHeight, Infinity), vh),
      };
    }

    _apply() {
      const r = this._rect;
      Object.assign(this.root.style, {
        left: `${Math.round(r.left)}px`,
        top: `${Math.round(r.top)}px`,
        width: `${Math.round(r.width)}px`,
        height: `${Math.round(r.height)}px`,
      });
    }

    _place() {
      const o = this.options;
      const lim = this._limits();
      const width = Math.max(lim.minW, Math.min(toPx(o.width, 480), lim.maxW));
      const height = Math.max(lim.minH, Math.min(toPx(o.height, 320), lim.maxH));
      const left = o.left == null ? (window.innerWidth - width) / 2 : toPx(o.left, 0);
      const top = o.top == null ? Math.max(0, (window.innerHeight - height) / 2) : toPx(o.top, 0);
      this._rect = { left, top, width, height };
      this._placed = true;
      this._clamp(false);
    }

    // Size within the limits; the title bar stays reachable: never above
    // the viewport, and at least KEEP_VISIBLE px of the window on screen.
    _clamp(apply) {
      if (!this._placed) return;
      const r = this._rect;
      const lim = this._limits();
      r.width = Math.max(lim.minW, Math.min(r.width, lim.maxW));
      r.height = Math.max(lim.minH, Math.min(r.height, lim.maxH));
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      r.left = Math.min(Math.max(r.left, KEEP_VISIBLE - r.width), vw - KEEP_VISIBLE);
      r.top = Math.min(Math.max(r.top, 0), vh - KEEP_VISIBLE);
      if (apply && !this._maximized) this._apply();
    }

    setPosition(left, top) {
      if (!this._placed) this._place();
      this._rect.left = toPx(left, this._rect.left);
      this._rect.top = toPx(top, this._rect.top);
      this._clamp(false);
      if (!this._maximized) this._apply();
    }

    getPosition() {
      if (!this._placed) this._place();
      return { left: Math.round(this._rect.left), top: Math.round(this._rect.top) };
    }

    setSize(width, height) {
      if (!this._placed) this._place();
      if (width != null) this._rect.width = toPx(width, this._rect.width);
      if (height != null) this._rect.height = toPx(height, this._rect.height);
      this._clamp(false);
      if (!this._maximized) this._apply();
    }

    getSize() {
      if (!this._placed) this._place();
      return { width: Math.round(this._rect.width), height: Math.round(this._rect.height) };
    }

    center() {
      if (!this._placed) this._place();
      this._rect.left = (window.innerWidth - this._rect.width) / 2;
      this._rect.top = Math.max(0, (window.innerHeight - this._rect.height) / 2);
      this._clamp(false);
      if (!this._maximized) this._apply();
    }

    // ── Maximise ─────────────────────────────────────────────────────────────

    maximize() {
      if (this._maximized) return;
      this._maximized = true;
      this.root.dataset.maximized = "true";
      Object.assign(this.root.style, { left: "0px", top: "0px", width: "100vw", height: "100vh" });
      this._syncMaxButton();
      this._emit("resize", Object.assign(this.getSize(), { maximized: true }));
    }

    restore() {
      if (!this._maximized) return;
      this._maximized = false;
      delete this.root.dataset.maximized;
      this._clamp(false);
      this._apply();
      this._syncMaxButton();
      this._emit("resize", Object.assign(this.getSize(), { maximized: false }));
    }

    isMaximized() {
      return this._maximized;
    }

    _syncMaxButton() {
      if (!this.maxBtn) return;
      const label = this._maximized ? "Restore" : "Maximize";
      this.maxBtn.setAttribute("aria-label", label);
      this.maxBtn.title = label;
      this.maxBtn.textContent = "";
      const icon = document.createElement("i");
      icon.className = `mdi ${this._maximized ? "mdi-window-restore" : "mdi-window-maximize"}`;
      icon.setAttribute("aria-hidden", "true");
      this.maxBtn.appendChild(icon);
    }

    // ── Pointer move and resize ─────────────────────────────────────────────

    _startDrag(event, mode) {
      if (event.button !== 0 || this._maximized) return;
      event.preventDefault();
      const start = Object.assign({}, this._rect);
      const x0 = event.clientX;
      const y0 = event.clientY;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      // An iframe or terminal in the body would swallow the pointer mid-drag.
      document.documentElement.dataset.wapytWindowDrag = mode === "move" ? "move" : "resize";
      let frame = 0;
      let last = null;
      const onMove = (e) => {
        last = e;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          this._dragTo(mode, start, last.clientX - x0, last.clientY - y0);
        });
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        if (frame) cancelAnimationFrame(frame);
        if (last) this._dragTo(mode, start, last.clientX - x0, last.clientY - y0);
        delete document.documentElement.dataset.wapytWindowDrag;
        const r = this._rect;
        if (mode === "move") {
          if (r.left !== start.left || r.top !== start.top) this._emit("move", this.getPosition());
        } else if (r.width !== start.width || r.height !== start.height || r.left !== start.left || r.top !== start.top) {
          this._emit("resize", Object.assign(this.getSize(), this.getPosition(), { maximized: false }));
        }
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    }

    _dragTo(mode, start, dx, dy) {
      const r = this._rect;
      if (mode === "move") {
        r.left = start.left + dx;
        r.top = start.top + dy;
        this._clamp(false);
        this._apply();
        return;
      }
      const lim = this._limits();
      const clampW = (w) => Math.max(lim.minW, Math.min(w, lim.maxW));
      const clampH = (h) => Math.max(lim.minH, Math.min(h, lim.maxH));
      let { left, top, width, height } = start;
      if (mode.includes("e")) width = clampW(start.width + dx);
      if (mode.includes("s")) height = clampH(start.height + dy);
      if (mode.includes("w")) {
        width = clampW(start.width - dx);
        left = start.left + (start.width - width);
      }
      if (mode.includes("n")) {
        // Never drag the title bar above the viewport.
        const maxGrow = start.top;
        height = clampH(Math.min(start.height - dy, start.height + maxGrow));
        top = start.top + (start.height - height);
      }
      Object.assign(r, { left, top, width, height });
      this._apply();
    }

    // ── Keyboard ─────────────────────────────────────────────────────────────

    _onHeaderKey(event) {
      if (event.target !== this.header) return;
      if (event.key === "Enter" && this.options.maximizable) {
        event.preventDefault();
        if (this._maximized) this.restore();
        else this.maximize();
        return;
      }
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!(event.key in steps) || this._maximized) return;
      event.preventDefault();
      const [dx, dy] = steps[event.key].map((v) => v * (event.ctrlKey ? 1 : 10));
      if (event.shiftKey) {
        if (!this.options.resizable) return;
        this.setSize(this._rect.width + dx, this._rect.height + dy);
        this._emit("resize", Object.assign(this.getSize(), this.getPosition(), { maximized: false }));
      } else {
        if (!this.options.movable) return;
        this.setPosition(this._rect.left + dx, this._rect.top + dy);
        this._emit("move", this.getPosition());
      }
    }

    // A modal window keeps Tab inside itself.
    _trapTab(event) {
      if (event.key !== "Tab" || !this.options.modal) return;
      const items = Array.from(this.root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === this.header);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // ── Showing ──────────────────────────────────────────────────────────────

    _applyTheme() {
      const theme = document.documentElement.getAttribute("data-wapyt-theme") || "light";
      this.root.setAttribute("data-wapyt-theme", theme);
      if (this.backdrop) this.backdrop.setAttribute("data-wapyt-theme", theme);
    }

    show() {
      if (this._closed) return;
      this._applyTheme();
      if (!this._placed) {
        this._place();
        this._apply();
        if (this.options.maximized) this.maximize();
      } else {
        this._clamp(true);
      }
      this.root.hidden = false;
      if (this.backdrop) this.backdrop.hidden = false;
      const wasVisible = this._visible;
      this._visible = true;
      this.bringToFront();
      if (!wasVisible) {
        this._returnFocus = document.activeElement;
        // Focus moves in, to the first control or the window itself.
        const first = this.bodyEl.querySelector(FOCUSABLE) || (this.footerEl && this.footerEl.querySelector(FOCUSABLE));
        (first || this.root).focus({ preventScroll: true });
        this._emit("show", {});
      }
    }

    bringToFront() {
      if (!this._visible) return;
      const index = stack.indexOf(this);
      if (index === stack.length - 1 && index >= 0) return;
      if (index >= 0) stack.splice(index, 1);
      // A non-modal window can't rise above an open modal one.
      let at = stack.length;
      if (!this.options.modal) {
        while (at > 0 && stack[at - 1].options.modal) at -= 1;
      }
      stack.splice(at, 0, this);
      restack();
      if (at === stack.length - 1) this._emit("focus", {});
    }

    hide(reason = "code") {
      this.root.hidden = true;
      if (this.backdrop) this.backdrop.hidden = true;
      const index = stack.indexOf(this);
      if (index >= 0) stack.splice(index, 1);
      restack();
      if (this._visible) {
        this._visible = false;
        const back = this._returnFocus;
        this._returnFocus = null;
        if (back && back.isConnected && this.root.contains(document.activeElement)) back.focus();
        this._emit("hide", { reason });
      }
    }

    close(reason = "code") {
      if (this._closed) return;
      this.hide(reason);
      this._closed = true;
      this.root.remove();
      if (this.backdrop) this.backdrop.remove();
      this._emit("close", { reason });
      this._events = {};
    }

    _dismiss(reason) {
      if (this.options.disposeOnClose) this.close(reason);
      else this.hide(reason);
    }

    isVisible() {
      return this._visible;
    }

    setTitle(title) {
      this.titleEl.textContent = title == null ? "" : String(title);
    }

    setContent(component) {
      this.bodyEl.textContent = "";
      if (!component) return;
      if (typeof component === "string") {
        this.bodyEl.textContent = component;
      } else if (component instanceof HTMLElement) {
        this.bodyEl.appendChild(component);
      } else if (component.getRootElement) {
        const root = component.getRootElement();
        if (root) this.bodyEl.appendChild(root);
      } else if (component.element) {
        this.bodyEl.appendChild(component.element);
      }
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
          console.error("[wapyt] Window listener failed", error);
        }
      });
    }
  }

  globalNS.Window = Window;
})();
