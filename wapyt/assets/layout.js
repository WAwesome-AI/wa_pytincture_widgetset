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
    }

    show() {
      if (!this.element.classList.contains("wapyt-cell-hidden")) {
        return;
      }
      this.layout._emit("beforeShow", { id: this.id, cell: this });
      this.element.classList.remove("wapyt-cell-hidden");
      this.layout._emit("afterShow", { id: this.id, cell: this });
    }

    isVisible() {
      return !this.element.classList.contains("wapyt-cell-hidden");
    }
  }

  class Layout {
    constructor(rootTarget, options = {}) {
      this._events = {};
      this._progress = new Map();
      this.cells = new Map();
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
      cells.forEach((config) => {
        const normalized = Object.assign({}, config);
        normalized.id = normalized.id || makeId();
        const cell = this._createCell(container, normalized, direction, parentCell);
        this.cells.set(cell.id, cell);
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

      if (direction === "row" && config.width != null) {
        cellEl.style.flexBasis = formatSize(config.width);
      }
      if (direction === "column" && config.height != null) {
        cellEl.style.flexBasis = formatSize(config.height);
      }
      const hasFixedSize =
        (direction === "row" && config.width != null) ||
        (direction === "column" && config.height != null);
      if (hasFixedSize) {
        cellEl.style.flex = "0 0 auto";
      } else if (config.grow != null || config.shrink != null) {
        const grow = config.grow != null ? config.grow : 1;
        const shrink = config.shrink != null ? config.shrink : 1;
        cellEl.style.flex = `${grow} ${shrink} 0`;
      }
      if (config.grow != null) {
        cellEl.style.flexGrow = config.grow;
      }
      if (config.shrink != null) {
        cellEl.style.flexShrink = config.shrink;
      }
      if (config.minSize != null) {
        cellEl.style.minSize = formatSize(config.minSize);
      }

      container.appendChild(cellEl);
      const cell = new LayoutCell(this, config, cellEl, body, parentCell);
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

