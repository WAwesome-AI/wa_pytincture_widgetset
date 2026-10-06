(function () {
  let autoId = 0;
  
  function makeId() {
    autoId += 1;
    return `wapyt-cell-${autoId}`;
  }

  function formatSize(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === "number") {
      return `${value}px`;
    }
    return `${value}`;
  }

  function toClassList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return String(value)
      .split(" ")
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  class LayoutCell {
    constructor(layout, config, element, body, parentCell = null) {
      this.layout = layout;
      this.config = config;
      this.element = element;
      this.body = body;
      this.parentCell = parentCell;
      this.id = config.id || makeId();
      this._widget = null;
      this._collapsed = Boolean(config.collapsed);
      element.dataset.cellId = this.id;
      if (this._collapsed) {
        element.classList.add("wapyt-cell-collapsed");
      }
      if (config.hidden) {
        this.hide();
      }
    }

    getContainer() {
      return this.body;
    }

    getParent() {
      return this.parentCell;
    }

    getWidget() {
      return this._widget;
    }

    attach(component /*, config */) {
      this.detach();
      if (component == null) {
        return null;
      }
      if (typeof component === "string") {
        this.attachHTML(component);
        this._widget = null;
        return null;
      }
      if (component instanceof HTMLElement) {
        this.body.appendChild(component);
        this._widget = component;
        return component;
      }
      if (component && typeof component.getRootElement === "function") {
        const root = component.getRootElement();
        if (root) {
          this.body.appendChild(root);
          this._widget = component;
          return component;
        }
      }
      if (component && component.root instanceof HTMLElement) {
        this.body.appendChild(component.root);
        this._widget = component;
        return component;
      }
      if (component && component.element instanceof HTMLElement) {
        this.body.appendChild(component.element);
        this._widget = component;
        return component;
      }
      if (component && typeof component === "object" && component.nodeType === 1) {
        this.body.appendChild(component);
        this._widget = component;
        return component;
      }
      this._widget = component;
      return component;
    }

    attachHTML(html) {
      this.body.innerHTML = html || "";
      this._widget = null;
    }

    detach() {
      while (this.body.firstChild) {
        this.body.removeChild(this.body.firstChild);
      }
      this._widget = null;
    }

    collapse(initial = false) {
      this._collapsed = true;
      this.element.classList.add("wapyt-cell-collapsed");
      if (!initial) {
        this.layout._emit("afterCollapse", { id: this.id, cell: this });
      }
    }

    expand(initial = false) {
      this._collapsed = false;
      this.element.classList.remove("wapyt-cell-collapsed");
      if (!initial) {
        this.layout._emit("afterExpand", { id: this.id, cell: this });
      }
    }

    toggle() {
      if (this._collapsed) {
        this.expand();
      } else {
        this.collapse();
      }
    }

    isCollapsed() {
      return this._collapsed;
    }

    hide() {
      if (!this.element.classList.contains("wapyt-cell-hidden")) {
        this.layout._emit("beforeHide", { id: this.id, cell: this });
      }
      this.element.classList.add("wapyt-cell-hidden");
      this.layout._emit("afterHide", { id: this.id, cell: this });
      this.layout._syncSplitters();
    }

    show() {
      if (!this.element.classList.contains("wapyt-cell-hidden")) {
        return;
      }
      this.layout._emit("beforeShow", { id: this.id, cell: this });
      this.element.classList.remove("wapyt-cell-hidden");
      this.layout._emit("afterShow", { id: this.id, cell: this });
      this.layout._syncSplitters();
    }

    isVisible() {
      return !this.element.classList.contains("wapyt-cell-hidden");
    }

    // Size along the parent's axis: width in a row of columns, height in a
    // column of rows.
    getSize() {
      const box = this.element.getBoundingClientRect();
      return Math.round(this.direction === "row" ? box.width : box.height);
    }

    setSize(size) {
      if (size == null) return;
      this.element.style.flex = `0 0 ${formatSize(size)}`;
      this._fill = false;
      this.layout._syncSplitters();
    }

    fills() {
      return Boolean(this._fill);
    }
  }

  const SPLIT_STEP = 10;
  const SPLIT_STEP_LARGE = 50;
  const SPLIT_MIN = 48;

  // A drag handle between two sibling cells, made when either sets
  // `resizable`. It sits inside the gap with negative margins, so adding one
  // does not move anything. Cells with a declared size get a new pixel size;
  // two fill cells instead trade flex-grow, so their ratio survives a window
  // resize.
  class Splitter {
    constructor(layout, before, after, direction) {
      this.layout = layout;
      this.before = before;
      this.after = after;
      this.direction = direction;
      this.initial = [before, after].map((cell) => [cell.element.style.flex, cell._fill]);

      const handle = document.createElement("div");
      handle.className = "wapyt-splitter";
      handle.dataset.direction = direction;
      handle.tabIndex = 0;
      handle.setAttribute("role", "separator");
      // A separator between columns is vertical.
      handle.setAttribute("aria-orientation", direction === "row" ? "vertical" : "horizontal");
      handle.setAttribute("aria-controls", before.element.id);
      const name = before.config.header || before.id;
      handle.setAttribute("aria-label", `Resize ${name}`);
      handle.title = "Drag to resize · double-click to reset";
      this.handle = handle;
      before.element.after(handle);

      handle.addEventListener("pointerdown", (event) => this._start(event));
      handle.addEventListener("keydown", (event) => this._key(event));
      handle.addEventListener("dblclick", () => this.reset());
    }

    _limits(cell) {
      const style = getComputedStyle(cell.element);
      const min = parseFloat(this.direction === "row" ? style.minWidth : style.minHeight);
      const max = parseFloat(this.direction === "row" ? style.maxWidth : style.maxHeight);
      return [Math.max(SPLIT_MIN, Number.isFinite(min) ? min : 0), Number.isFinite(max) ? max : Infinity];
    }

    // Move the boundary by `delta` px from the sizes measured at `from`.
    _apply(from, delta) {
      const [aMin, aMax] = this._limits(this.before);
      const [bMin, bMax] = this._limits(this.after);
      const total = from[0] + from[1];
      let a = from[0] + delta;
      a = Math.min(a, aMax, total - bMin);
      a = Math.max(a, aMin, total - bMax);
      const b = total - a;
      const aFill = this.before.fills();
      const bFill = this.after.fills();
      if (aFill && bFill) {
        // Split the pair's combined flex-grow by the new sizes. Raw pixel
        // values would swamp any other fill sibling's grow of 1.
        const grow = (cell) => parseFloat(cell.element.style.flex) || 1;
        const share = grow(this.before) + grow(this.after);
        const ga = (share * a) / total;
        const gb = share - ga;
        this.before.element.style.flex = `${ga} ${ga} 0`;
        this.after.element.style.flex = `${gb} ${gb} 0`;
      } else {
        if (!aFill) this.before.element.style.flex = `0 0 ${Math.round(a)}px`;
        if (!bFill) this.after.element.style.flex = `0 0 ${Math.round(b)}px`;
      }
      this.sync();
    }

    _sizes() {
      return [this.before.getSize(), this.after.getSize()];
    }

    _start(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      this.handle.focus();
      this.handle.setPointerCapture(event.pointerId);
      const from = this._sizes();
      const origin = this.direction === "row" ? event.clientX : event.clientY;
      const root = this.layout.root;
      // Iframes (chat artifacts) and terminals would swallow the pointer.
      root.classList.add("wapyt-resizing");
      root.dataset.resizing = this.direction;
      this.handle.dataset.active = "true";
      let frame = 0;
      let last = event;
      const move = (e) => {
        last = e;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const pos = this.direction === "row" ? last.clientX : last.clientY;
          this._apply(from, pos - origin);
        });
      };
      const end = () => {
        if (frame) cancelAnimationFrame(frame);
        const pos = this.direction === "row" ? last.clientX : last.clientY;
        this._apply(from, pos - origin);
        root.classList.remove("wapyt-resizing");
        delete root.dataset.resizing;
        delete this.handle.dataset.active;
        this.handle.removeEventListener("pointermove", move);
        this.handle.removeEventListener("pointerup", end);
        this.handle.removeEventListener("pointercancel", end);
        this._emit();
      };
      this.handle.addEventListener("pointermove", move);
      this.handle.addEventListener("pointerup", end);
      this.handle.addEventListener("pointercancel", end);
    }

    _key(event) {
      const back = this.direction === "row" ? "ArrowLeft" : "ArrowUp";
      const forward = this.direction === "row" ? "ArrowRight" : "ArrowDown";
      const step = event.shiftKey ? SPLIT_STEP_LARGE : SPLIT_STEP;
      let delta = null;
      if (event.key === back) delta = -step;
      else if (event.key === forward) delta = step;
      else if (event.key === "Home") delta = -Infinity;
      else if (event.key === "End") delta = Infinity;
      else if (event.key === "Enter") {
        event.preventDefault();
        this.reset();
        return;
      }
      if (delta == null) return;
      event.preventDefault();
      const from = this._sizes();
      this._apply(from, Number.isFinite(delta) ? delta : delta > 0 ? from[1] : -from[0]);
      this._emit();
    }

    reset() {
      [this.before, this.after].forEach((cell, i) => {
        [cell.element.style.flex, cell._fill] = this.initial[i];
      });
      this.sync();
      this._emit();
    }

    _emit() {
      const [size, siblingSize] = this._sizes();
      this.layout._emit("afterResize", {
        id: this.before.id, size, sibling: this.after.id, sibling_size: siblingSize,
      });
    }

    // Hidden when either side is; aria-valuenow is the first cell's share.
    sync() {
      const visible = this.before.isVisible() && this.after.isVisible();
      this.handle.hidden = !visible;
      if (!visible) return;
      const [a, b] = this._sizes();
      this.handle.setAttribute("aria-valuemin", "0");
      this.handle.setAttribute("aria-valuemax", "100");
      this.handle.setAttribute("aria-valuenow", String(a + b ? Math.round((a * 100) / (a + b)) : 50));
    }
  }

  class Layout {
    constructor(rootTarget, options = {}) {
      this._events = {};
      this._progress = new Map();
      this.cells = new Map();
      this._splitters = [];
      this.options = Object.assign({ type: "line", gap: null }, options || {});
      const resolved = Layout._resolveRoot(rootTarget);
      this.root = resolved.element || document.createElement("div");
      this._ownsRoot = resolved.owned || !resolved.element;
      this.root.classList.add("wapyt-layout");
      if (this.options.css) {
        toClassList(this.options.css).forEach((cls) => this.root.classList.add(cls));
      }
      if (this.options.borderless) {
        this.root.classList.add("wapyt-layout-borderless");
      }
      this.root.dataset.layoutType = this.options.type || "line";
      this._buildRoot();
    }

    static _resolveRoot(target) {
      if (!target) {
        return { element: null, owned: true };
      }
      if (typeof target === "string") {
        let host = document.querySelector(target);
        if (!host && !target.startsWith("#")) {
          host = document.getElementById(target);
        }
        return { element: host, owned: false };
      }
      if (target && target.nodeType === 1) {
        return { element: target, owned: false };
      }
      if (target && typeof target.attachHTML === "function") {
        const mountId = makeId();
        target.attachHTML(`<div id="${mountId}" class="wapyt-layout"></div>`);
        return { element: document.getElementById(mountId), owned: true };
      }
      return { element: null, owned: false };
    }

    _buildRoot() {
      this.root.innerHTML = "";
      const content = document.createElement("div");
      content.className = "wapyt-layout-root";
      if (this.options.gap != null) {
        content.style.setProperty("--wapyt-gap", formatSize(this.options.gap));
      }
      if (this.options.gap != null) {
        content.style.setProperty("--wapyt-gap", formatSize(this.options.gap));
      } else {
        content.style.setProperty("--wapyt-gap", "0px");
      }
      this.root.appendChild(content);

      if (Array.isArray(this.options.rows)) {
        this._buildCollection(content, this.options.rows, "column", null);
      } else if (Array.isArray(this.options.cols)) {
        this._buildCollection(content, this.options.cols, "row", null);
      }
    }

    _buildCollection(container, cells, direction, parentCell) {
      container.classList.add(
        direction === "row" ? "wapyt-flex-row" : "wapyt-flex-column"
      );
      const siblings = [];
      cells.forEach((config) => {
        const normalized = Object.assign({}, config);
        normalized.id = normalized.id || makeId();
        const cell = this._createCell(container, normalized, direction, parentCell);
        this.cells.set(cell.id, cell);
        siblings.push(cell);
        if (Array.isArray(normalized.rows)) {
          const nested = document.createElement("div");
          nested.className = "wapyt-nested";
          cell.body.appendChild(nested);
          this._buildCollection(nested, normalized.rows, "column", cell);
        } else if (Array.isArray(normalized.cols)) {
          const nested = document.createElement("div");
          nested.className = "wapyt-nested";
          cell.body.appendChild(nested);
          this._buildCollection(nested, normalized.cols, "row", cell);
        }
        if (normalized.html) {
          cell.attachHTML(normalized.html);
        }
        this._emit("afterAdd", { id: cell.id, cell });
      });
      for (let i = 0; i + 1 < siblings.length; i += 1) {
        const [before, after] = [siblings[i], siblings[i + 1]];
        if (before.config.resizable || after.config.resizable) {
          this._splitters.push(new Splitter(this, before, after, direction));
        }
      }
      if (this._splitters.length) requestAnimationFrame(() => this._syncSplitters());
    }

    _syncSplitters() {
      this._splitters.forEach((splitter) => splitter.sync());
    }

    _createCell(container, config, direction, parentCell) {
      const cellEl = document.createElement("div");
      cellEl.className = "wapyt-cell";
      if (config.css) {
        toClassList(config.css).forEach((cls) => cellEl.classList.add(cls));
      }

      const inner = document.createElement("div");
      inner.className = "wapyt-cell-inner";
      cellEl.appendChild(inner);

      let toggleButton = null;
      if (config.header) {
        const header = document.createElement("div");
        header.className = "wapyt-cell-header";
        header.textContent = config.header;
        if (config.collapsible) {
          toggleButton = document.createElement("button");
          toggleButton.type = "button";
          toggleButton.className = "wapyt-cell-toggle";
          toggleButton.setAttribute("aria-label", "Toggle section");
          toggleButton.textContent = "▾";
          header.appendChild(toggleButton);
        }
        inner.appendChild(header);
      }

      const body = document.createElement("div");
      body.className = "wapyt-cell-body";
      inner.appendChild(body);

      // Sizing must go through the `flex` shorthand in ONE statement. Assigning
      // `flexBasis` and then `flex` resets the basis back to `auto` — the
      // shorthand sets all three longhands — which silently discarded every
      // declared width and left each cell sized to its content.
      const declaredSize =
        direction === "row" ? config.width : config.height;

      // "100%" on a cell means "take what is left", the convention layouts are
      // written with. As a literal flex-basis it would instead demand the full
      // container and overflow any fixed sibling.
      //
      // "auto" keeps its CSS meaning — size to content — which is what a header
      // strip wants. Treating it as fill-remainder makes the header grow to
      // half the window.
      const fillsRemainder = declaredSize === "100%";
      const sizesToContent = declaredSize === "auto";

      if (sizesToContent) {
        cellEl.style.flex = "0 0 auto";
      } else if (declaredSize != null && !fillsRemainder) {
        const grow = config.grow != null ? config.grow : 0;
        const shrink = config.shrink != null ? config.shrink : 0;
        cellEl.style.flex = `${grow} ${shrink} ${formatSize(declaredSize)}`;
      } else {
        const grow = config.grow != null ? config.grow : 1;
        const shrink = config.shrink != null ? config.shrink : 1;
        cellEl.style.flex = `${grow} ${shrink} 0`;
      }

      // A flex item will not shrink below its content without this, which is
      // what lets a terminal or a table scroll inside its cell instead of
      // pushing the layout wider.
      cellEl.style.minWidth = "0";
      cellEl.style.minHeight = "0";

      if (config.minSize != null) {
        // `style.minSize` is not a CSS property; the declared minimum was
        // being dropped entirely.
        const axis = direction === "row" ? "minWidth" : "minHeight";
        cellEl.style[axis] = formatSize(config.minSize);
      }
      if (config.maxSize != null) {
        cellEl.style[direction === "row" ? "maxWidth" : "maxHeight"] = formatSize(config.maxSize);
      }

      container.appendChild(cellEl);
      const cell = new LayoutCell(this, config, cellEl, body, parentCell);
      cell.direction = direction;
      cellEl.id = cellEl.id || `wapyt-cell-el-${cell.id}`;
      // Whether this cell takes the space left over rather than a size of its
      // own. Dragging keeps a fill cell filling; setSize() pins it.
      cell._fill = !sizesToContent && (declaredSize == null || fillsRemainder);
      if (toggleButton) {
        toggleButton.addEventListener("click", () => {
          if (cell.isCollapsed()) {
            cell.expand();
          } else {
            cell.collapse();
          }
        });
      }
      return cell;
    }

    getCell(id) {
      return this.cells.get(id) || null;
    }

    attach(id, component, config) {
      const cell = this.getCell(id);
      if (!cell) return null;
      return cell.attach(component, config);
    }

    attachHTML(id, html) {
      const cell = this.getCell(id);
      if (cell) {
        cell.attachHTML(html);
      }
    }

    removeCell(id) {
      const cell = this.getCell(id);
      if (!cell) return;
      this._emit("beforeRemove", { id, cell });
      cell.detach();
      if (cell.element.parentNode) {
        cell.element.parentNode.removeChild(cell.element);
      }
      this.cells.delete(id);
      this._emit("afterRemove", { id, cell });
    }

    resize() {
      window.requestAnimationFrame(() => {
        this.root.dispatchEvent(new CustomEvent("wapyt:resize"));
      });
    }

    progressShow(id, text) {
      const target =
        (id && this.getCell(id)?.element) ||
        this.root.querySelector(`[data-cell-id="${id}"]`) ||
        this.root;
      if (!target) return;
      let overlay = this._progress.get(target);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "wapyt-progress-overlay";
        const label = document.createElement("div");
        label.className = "wapyt-progress-label";
        overlay.appendChild(label);
        target.appendChild(overlay);
        this._progress.set(target, overlay);
      }
      overlay.querySelector(".wapyt-progress-label").textContent =
        text || "Loading…";
      overlay.classList.add("visible");
    }

    progressHide(id) {
      const target =
        (id && this.getCell(id)?.element) ||
        this.root.querySelector(`[data-cell-id="${id}"]`) ||
        this.root;
      const overlay = target ? this._progress.get(target) : null;
      if (overlay) {
        overlay.classList.remove("visible");
      }
    }

    registerEvent(name, handler) {
      if (!this._events[name]) {
        this._events[name] = [];
      }
      this._events[name].push(handler);
    }

    _emit(name, detail) {
      const listeners = this._events[name];
      if (!listeners || !listeners.length) {
        return;
      }
      listeners.forEach((handler) => {
        try {
          handler(detail);
        } catch (err) {
          console.error("[wapyt] layout event handler failed", err);
        }
      });
    }

    forEach(callback) {
      Array.from(this.cells.values()).forEach((cell, index, all) => {
        callback(cell, index, all);
      });
    }

    destructor() {
      this._emit("beforeRemove", { id: "__root__", cell: null });
      this.cells.clear();
      this._events = {};
      if (this.root) {
        if (this._ownsRoot && this.root.parentNode) {
          this.root.parentNode.removeChild(this.root);
        } else {
          this.root.innerHTML = "";
        }
      }
      this._emit("afterRemove", { id: "__root__", cell: null });
    }

    getRootElement() {
      return this.root;
    }
  }

  globalThis.wapyt = globalThis.wapyt || {};
  globalThis.wapyt.Layout = Layout;
  globalThis.wapyt.LayoutCell = LayoutCell;
})();

