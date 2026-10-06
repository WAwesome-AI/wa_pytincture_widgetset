(function () {
  // Popup: an anchored popover for pickers, help and small forms. Appended to
  // <body> while open and positioned `fixed`, like ContextMenu, so a cell's or
  // a modal's overflow cannot clip it. It flips to the side with room, follows
  // its anchor on scroll and resize, closes on Escape or a press outside, and
  // gives focus back to the anchor when it closes.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});
  const GAP = 6;
  const MARGIN = 8;
  const SIDES = ["bottom", "top", "right", "left"];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let openCount = 0;

  function resolveAnchor(anchor) {
    if (!anchor) return null;
    if (typeof anchor === "string") return document.querySelector(anchor);
    if (anchor.nodeType === 1) return anchor;
    if (typeof anchor.x === "number" && typeof anchor.y === "number") return { point: anchor };
    return null;
  }

  class Popup {
    constructor(options = {}) {
      this.options = Object.assign(
        {
          placement: "bottom", // bottom | top | right | left; "-start" / "-end" align an edge
          offset: GAP,
          width: null,
          maxWidth: null,
          maxHeight: null,
          label: "",
          closeOnOutside: true,
          closeOnEscape: true,
          focus: true,
          css: null,
        },
        options || {}
      );
      this._events = {};
      this._anchor = null;

      this.element = document.createElement("div");
      this.element.className = "wapyt-popup";
      this.element.id = `wapyt-popup-${++openCount}`;
      this.element.setAttribute("role", "dialog");
      this.element.tabIndex = -1;
      if (this.options.label) this.element.setAttribute("aria-label", String(this.options.label));
      if (this.options.css) String(this.options.css).split(/\s+/).filter(Boolean).forEach((c) => this.element.classList.add(c));
      const size = (v) => (typeof v === "number" ? `${v}px` : v);
      if (this.options.width != null) this.element.style.width = size(this.options.width);
      if (this.options.maxWidth != null) this.element.style.maxWidth = size(this.options.maxWidth);
      if (this.options.maxHeight != null) this.element.style.maxHeight = size(this.options.maxHeight);

      this.body = document.createElement("div");
      this.body.className = "wapyt-popup-body";
      this.element.appendChild(this.body);

      this._onOutside = (event) => {
        if (!this.isVisible() || !this.options.closeOnOutside) return;
        const target = event.target;
        if (this.element.contains(target)) return;
        if (this._anchor && this._anchor.nodeType === 1 && this._anchor.contains(target)) return;
        // A combo list or menu opened from inside the popup lives in <body>.
        if (target.closest && target.closest(".wapyt-form-combo-list, .wapyt-cmenu")) return;
        this.hide({ restoreFocus: false });
      };
      this._onKey = (event) => {
        if (event.key === "Escape" && this.options.closeOnEscape && this.isVisible()) {
          event.stopPropagation();
          this.hide();
        }
      };
      this._onViewport = () => {
        if (!this.isVisible()) return;
        if (this._anchor && this._anchor.nodeType === 1 && !this._anchor.isConnected) {
          this.hide({ restoreFocus: false });
          return;
        }
        this._place();
      };
      this.element.addEventListener("keydown", this._onKey);
    }

    isVisible() {
      return this.element.isConnected;
    }

    getContainer() {
      return this.body;
    }

    setText(text) {
      this.body.textContent = text == null ? "" : String(text);
      if (this.isVisible()) this._place();
    }

    // Raw HTML: only for markup the app itself built and escaped.
    attachHTML(html) {
      this.body.innerHTML = html || "";
      if (this.isVisible()) this._place();
    }

    show(anchor) {
      const resolved = resolveAnchor(anchor);
      if (!resolved) throw new Error("Popup.show needs an element, a selector or {x, y}.");
      if (this.isVisible() && resolved === this._anchor) return;
      if (this.isVisible()) this._unbindAnchor();
      this._returnFocus = document.activeElement;
      this._anchor = resolved;
      if (resolved.nodeType === 1) {
        resolved.setAttribute("aria-expanded", "true");
        resolved.setAttribute("aria-controls", this.element.id);
        if (!resolved.hasAttribute("aria-haspopup")) resolved.setAttribute("aria-haspopup", "dialog");
      }
      if (!this.isVisible()) {
        document.body.appendChild(this.element);
        document.addEventListener("pointerdown", this._onOutside, true);
        document.addEventListener("keydown", this._onKey);
        window.addEventListener("scroll", this._onViewport, true);
        window.addEventListener("resize", this._onViewport);
      }
      this._place();
      if (this.options.focus) {
        const first = this.element.querySelector(FOCUSABLE);
        (first || this.element).focus({ preventScroll: true });
      }
      this._emit("show", {});
    }

    toggle(anchor) {
      const resolved = resolveAnchor(anchor);
      if (this.isVisible() && (!resolved || resolved === this._anchor)) this.hide();
      else this.show(anchor);
    }

    _unbindAnchor() {
      if (this._anchor && this._anchor.nodeType === 1) {
        this._anchor.setAttribute("aria-expanded", "false");
      }
    }

    hide(opts = {}) {
      if (!this.isVisible()) return;
      this.element.remove();
      document.removeEventListener("pointerdown", this._onOutside, true);
      document.removeEventListener("keydown", this._onKey);
      window.removeEventListener("scroll", this._onViewport, true);
      window.removeEventListener("resize", this._onViewport);
      this._unbindAnchor();
      const back = this._anchor && this._anchor.nodeType === 1 ? this._anchor : this._returnFocus;
      // Only reclaim focus if it was inside the popup (or nowhere).
      const active = document.activeElement;
      const focusLost = !active || active === document.body || this.element.contains(active);
      if (opts.restoreFocus !== false && focusLost && back && back.isConnected && typeof back.focus === "function") {
        back.focus({ preventScroll: true });
      }
      this._emit("hide", {});
    }

    _rect() {
      if (this._anchor.point) {
        const { x, y } = this._anchor.point;
        return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
      }
      return this._anchor.getBoundingClientRect();
    }

    _place() {
      const el = this.element;
      const box = this._rect();
      el.style.left = "0px";
      el.style.top = "0px";
      const own = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = Number(this.options.offset) || 0;
      const [wanted, align = "center"] = String(this.options.placement || "bottom").split("-");
      const room = {
        bottom: vh - box.bottom - gap - MARGIN,
        top: box.top - gap - MARGIN,
        right: vw - box.right - gap - MARGIN,
        left: box.left - gap - MARGIN,
      };
      const need = (side) => (side === "top" || side === "bottom" ? own.height : own.width);
      const opposite = { bottom: "top", top: "bottom", left: "right", right: "left" };
      let side = SIDES.includes(wanted) ? wanted : "bottom";
      if (room[side] < need(side)) {
        if (room[opposite[side]] >= need(side)) side = opposite[side];
        else side = room[opposite[side]] > room[side] ? opposite[side] : side;
      }
      let left;
      let top;
      if (side === "bottom" || side === "top") {
        top = side === "bottom" ? box.bottom + gap : box.top - gap - own.height;
        left = align === "start" ? box.left : align === "end" ? box.right - own.width : box.left + box.width / 2 - own.width / 2;
      } else {
        left = side === "right" ? box.right + gap : box.left - gap - own.width;
        top = align === "start" ? box.top : align === "end" ? box.bottom - own.height : box.top + box.height / 2 - own.height / 2;
      }
      left = Math.max(MARGIN, Math.min(left, vw - own.width - MARGIN));
      top = Math.max(MARGIN, Math.min(top, vh - own.height - MARGIN));
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      el.dataset.side = side;
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
          console.error("[wapyt] Popup listener failed", error);
        }
      });
    }

    destroy() {
      this.hide({ restoreFocus: false });
      this.element.removeEventListener("keydown", this._onKey);
      this._events = {};
    }
  }

  globalNS.Popup = Popup;
})();
