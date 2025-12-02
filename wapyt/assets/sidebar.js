(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function ensureIconFonts() {
    if (!document.getElementById("wapyt-material-icons")) {
      const link = document.createElement("link");
      link.id = "wapyt-material-icons";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded";
      document.head.appendChild(link);
    }
    if (!document.getElementById("wapyt-mdi-icons")) {
      const link = document.createElement("link");
      link.id = "wapyt-mdi-icons";
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/@mdi/font@7/css/materialdesignicons.min.css";
      document.head.appendChild(link);
    }
  }

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_sidebar_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-sidebar"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") {
      return document.querySelector(target) || document.getElementById(target);
    }
    if (target && target.nodeType === 1) {
      return target;
    }
    return null;
  }

  class Sidebar {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          title: "Navigation",
          collapseButton: true,
          collapsed: false,
          items: [],
          active: null,
        },
        options || {}
      );
      this._events = {};
      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount Sidebar – target not found.");
      }
      this._host.classList.add("wapyt-sidebar");
      ensureIconFonts();
      this._render();
    }

    _render() {
      this._host.innerHTML = "";
      this._host.dataset.collapsed = this.options.collapsed ? "true" : "false";

      const header = document.createElement("div");
      header.className = "wapyt-sidebar-header";
      if (this.options.title) {
        const title = document.createElement("span");
        title.className = "wapyt-sidebar-title";
        title.textContent = this.options.title;
        header.appendChild(title);
      }
      if (this.options.collapseButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wapyt-sidebar-toggle";
        btn.setAttribute("aria-label", "Toggle sidebar");
        btn.innerHTML = '<span aria-hidden="true">‹</span>';
        btn.addEventListener("click", () => this.toggle());
        header.appendChild(btn);
      }
      this._host.appendChild(header);

      this._list = document.createElement("nav");
      this._list.className = "wapyt-sidebar-list";
      this.options.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wapyt-sidebar-item";
        button.dataset.itemId = item.id;
        button.title = item.label || "";

        const icon = this._renderIcon(item.icon);
        if (icon) {
          button.appendChild(icon);
        }

        const label = document.createElement("span");
        label.className = "wapyt-sidebar-label";
        label.textContent = item.label;
        button.appendChild(label);

        if (item.badge) {
          const badge = document.createElement("span");
          badge.className = "wapyt-sidebar-badge";
          badge.textContent = item.badge;
          button.appendChild(badge);
        }

        button.addEventListener("click", () => {
          this.setActive(item.id);
          this._emit("select", { id: item.id, data: item.data || {} });
        });
        this._list.appendChild(button);
      });
      this._host.appendChild(this._list);
      if (this.options.active) {
        this.setActive(this.options.active);
      }
    }

    _renderIcon(iconValue) {
      if (!iconValue) {
        return null;
      }
      const span = document.createElement("span");
      span.className = "wapyt-sidebar-icon";
      const value = iconValue.trim();
      if (!value) {
        return null;
      }
      if (value.includes("mdi")) {
        span.className = `wapyt-sidebar-icon ${value}`;
      } else if (value.startsWith("<")) {
        span.innerHTML = value;
      } else {
        span.classList.add("material-symbols-rounded");
        span.textContent = value;
      }
      return span;
    }

    collapse() {
      this._host.dataset.collapsed = "true";
      this._emit("collapse");
    }

    expand() {
      this._host.dataset.collapsed = "false";
      this._emit("expand");
    }

    toggle() {
      const next = this._host.dataset.collapsed !== "true";
      this._host.dataset.collapsed = next ? "true" : "false";
      this._emit(next ? "collapse" : "expand");
    }

    setActive(id) {
      if (!id) {
        return;
      }
      Array.from(this._list.querySelectorAll(".wapyt-sidebar-item")).forEach(
        (item) => {
          item.dataset.active = item.dataset.itemId === id ? "true" : "false";
        }
      );
      this.options.active = id;
    }

    getActive() {
      return this.options.active || null;
    }

    on(event, handler) {
      if (!this._events[event]) {
        this._events[event] = new Set();
      }
      this._events[event].add(handler);
    }

    _emit(event, payload) {
      const listeners = this._events[event];
      if (!listeners) return;
      listeners.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] Sidebar handler failed", error);
        }
      });
    }
  }

  if (!document.querySelector("style[data-wapyt-sidebar]")) {
    const style = document.createElement("style");
    style.setAttribute("data-wapyt-sidebar", "true");
    style.textContent = `
.wapyt-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 220px;
  border-right: 1px solid rgba(15,23,42,0.08);
  background: rgba(248,250,252,0.85);
  transition: width 0.2s ease;
  overflow: hidden;
}
[data-wapyt-theme="dark"] .wapyt-sidebar {
  background: rgba(15,18,23,0.6);
  border-color: rgba(248,250,252,0.08);
}
.wapyt-sidebar[data-collapsed="true"] {
  width: 64px;
}
.wapyt-sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
}
.wapyt-sidebar-toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
}
.wapyt-sidebar-list {
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 0.25rem;
  flex: 1 1 auto;
  overflow-y: auto;
}
.wapyt-sidebar-item {
  border: none;
  background: transparent;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: background 0.2s ease;
}
.wapyt-sidebar-item[data-active="true"] {
  background: rgba(59,130,246,0.12);
  color: #1e40af;
}
.wapyt-sidebar-icon {
  width: 1.25rem;
  text-align: center;
  opacity: 0.7;
  font-family: 'Material Symbols Rounded', 'Material Icons', sans-serif;
  font-size: 1.25rem;
}
.wapyt-sidebar-icon.mdi {
  font-family: "Material Design Icons";
  font-size: 1.2rem;
}
.wapyt-sidebar-badge {
  margin-left: auto;
  background: rgba(15,23,42,0.08);
  padding: 0 0.4rem;
  border-radius: 999px;
  font-size: 0.75rem;
}
.wapyt-sidebar[data-collapsed="true"] .wapyt-sidebar-label,
.wapyt-sidebar[data-collapsed="true"] .wapyt-sidebar-badge {
  display: none;
}
`;
    document.head.appendChild(style);
  }

  //globalThis.wapyt = globalThis.wapyt || {};
  globalThis.wapyt.Sidebar = Sidebar;
})();
