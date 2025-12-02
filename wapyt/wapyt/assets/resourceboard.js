(function () {
  globalThis.wapyt = globalThis.wapyt || {};

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_resourceboard_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-resourceboard"></div>`);
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

  class ResourceBoard {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          title: "",
          items: [],
          selected: null,
          listWidth: 280,
          addButtonText: null,
          detailTemplate: null,
          emptyState: "Select a resource on the left to view details.",
        },
        options || {}
      );
      this._events = {};
      this._items = [];
      this._selected = null;
      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount ResourceBoard – target not found.");
      }
      this._renderChrome();
      this.setItems(this.options.items);
      const targetSelection = this.options.selected || (this._items[0] ? this._items[0].id : null);
      if (targetSelection) {
        this.select(targetSelection);
      } else {
        this._renderDetail(null);
      }
    }

    _renderChrome() {
      this._host.classList.add("wapyt-resourceboard");
      this._host.innerHTML = "";
      const header = document.createElement("div");
      header.className = "wapyt-rb-header";
      const title = document.createElement("span");
      title.textContent = this.options.title || "";
      header.appendChild(title);
      if (this.options.addButtonText) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "wapyt-rb-add";
        addBtn.textContent = this.options.addButtonText;
        addBtn.addEventListener("click", () => this._emit("add"));
        header.appendChild(addBtn);
      }
      this._host.appendChild(header);

      const body = document.createElement("div");
      body.className = "wapyt-rb-body";
      this._list = document.createElement("div");
      this._list.className = "wapyt-rb-list";
      if (this.options.listWidth) {
        this._list.style.width = `${this.options.listWidth}px`;
      }
      body.appendChild(this._list);
      this._detail = document.createElement("div");
      this._detail.className = "wapyt-rb-detail";
      body.appendChild(this._detail);
      this._host.appendChild(body);
    }

    setItems(items) {
      if (!Array.isArray(items)) {
        throw new TypeError("ResourceBoard.setItems expects a list of items.");
      }
      this._items = items
        .map((item) => {
          if (!item || !item.id) {
            return null;
          }
          const normalized = Object.assign({ extra: {} }, item);
          return normalized;
        })
        .filter(Boolean);
      this._renderList();
    }

    select(itemId) {
      if (!itemId) {
        this._selected = null;
        this._renderSelection();
        this._renderDetail(null);
        return;
      }
      const match = this._items.find((item) => item.id === itemId);
      if (!match) {
        return;
      }
      const isSameSelection = this._selected === itemId;
      this._selected = itemId;
      this._renderSelection();
      this._renderDetail(match);
      if (!isSameSelection) {
        this._emit("select", { id: match.id, item: match });
      }
    }

    _renderList() {
      this._list.innerHTML = "";
      this._items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wapyt-rb-item";
        button.dataset.resourceId = item.id;
        button.innerHTML = `
          <div class="wapyt-rb-item-title">${item.title || ""}</div>
          ${item.subtitle ? `<div class="wapyt-rb-item-sub">${item.subtitle}</div>` : ""}
        `;
        button.addEventListener("click", () => this.select(item.id));
        this._list.appendChild(button);
      });
      this._renderSelection();
    }

    _renderSelection() {
      const buttons = this._list.querySelectorAll(".wapyt-rb-item");
      buttons.forEach((btn) => {
        btn.dataset.active = btn.dataset.resourceId === this._selected ? "true" : "false";
      });
    }

    _renderDetail(item) {
      if (!item) {
        this._detail.innerHTML = `<div class="wapyt-rb-empty">${this.options.emptyState || ""}</div>`;
        return;
      }
      const context = this._buildDetailContext(item);
      if (this.options.detailTemplate) {
        this._detail.innerHTML = this._interpolate(this.options.detailTemplate, context);
      } else {
        this._detail.innerHTML = `
          <div class="wapyt-rb-detail-card">
            <div class="wapyt-rb-detail-header">
              <div>
                <h2>${item.title || ""}</h2>
                ${item.subtitle ? `<p>${item.subtitle}</p>` : ""}
              </div>
              ${
                context.status
                  ? `<span class="wapyt-rb-status">${context.status}</span>`
                  : ""
              }
            </div>
            ${
              context.modelsHtml
                ? `<div class="wapyt-rb-detail-section">
                     <strong>Models</strong>
                     <div class="wapyt-rb-models">${context.modelsHtml}</div>
                   </div>`
                : ""
            }
          </div>
        `;
      }
      this._wireDetailActions(item);
    }

    _buildDetailContext(item) {
      const ctx = Object.assign({}, item.extra || {}, item);
      if (!ctx.modelsHtml && Array.isArray(item.extra?.models)) {
        ctx.modelsHtml = item.extra.models
          .map((model) => `<span class="wapyt-rb-chip">${model}</span>`)
          .join("");
      }
      return ctx;
    }

    _interpolate(template, context) {
      return template.replace(/\{([^}]+)\}/g, (_, token) => {
        const key = token.trim();
        const parts = key.split(".");
        let value = context;
        for (const part of parts) {
          if (value == null) {
            break;
          }
          value = value[part];
        }
        if (value == null) {
          return "";
        }
        if (Array.isArray(value)) {
          return value.join(", ");
        }
        return String(value);
      });
    }

    _wireDetailActions(item) {
      this._detail.querySelectorAll("[data-rb-action]").forEach((element) => {
        const action = element.getAttribute("data-rb-action");
        if (!action) {
          return;
        }
        element.addEventListener("click", (event) => {
          event.preventDefault();
          const dataset = {};
          if (element.dataset) {
            Object.keys(element.dataset).forEach((key) => {
              if (key === "rbAction") {
                return;
              }
              dataset[key] = element.dataset[key];
            });
          }
          this._emit("action", { action, item, id: item.id, data: dataset });
        });
      });
    }

    on(event, handler) {
      if (!this._events[event]) {
        this._events[event] = new Set();
      }
      this._events[event].add(handler);
    }

    _emit(event, payload) {
      const listeners = this._events[event];
      if (!listeners) {
        return;
      }
      listeners.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] ResourceBoard handler failed", error);
        }
      });
    }
  }

  if (!document.querySelector("style[data-wapyt-resourceboard]")) {
    const style = document.createElement("style");
    style.setAttribute("data-wapyt-resourceboard", "true");
    style.textContent = `
.wapyt-resourceboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  --rb-surface: #f5f7fb;
  --rb-panel: #ffffff;
  --rb-panel-alt: #eef2ff;
  --rb-border: rgba(15,23,42,0.12);
  --rb-border-strong: rgba(15,23,42,0.2);
  --rb-foreground: #0f172a;
  --rb-muted: #475569;
  --rb-chip-bg: rgba(37,99,235,0.08);
  --rb-chip-border: rgba(37,99,235,0.25);
  --rb-accent: #2563eb;
  --rb-accent-contrast: #f8fafc;
  --rb-shadow: 0 12px 32px rgba(15,23,42,0.08);
  background: var(--rb-surface);
  color: var(--rb-foreground);
}
[data-wapyt-theme="dark"] .wapyt-resourceboard {
  --rb-surface: #050b18;
  --rb-panel: #0f172a;
  --rb-panel-alt: #111f33;
  --rb-border: rgba(226,232,240,0.12);
  --rb-border-strong: rgba(226,232,240,0.25);
  --rb-foreground: #e2e8f0;
  --rb-muted: #94a3b8;
  --rb-chip-bg: rgba(96,165,250,0.15);
  --rb-chip-border: rgba(148,163,184,0.5);
  --rb-accent: #60a5fa;
  --rb-accent-contrast: #051225;
  --rb-shadow: 0 18px 36px rgba(0,0,0,0.45);
}
.wapyt-rb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--rb-border);
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  font-size: 0.75rem;
  background: var(--rb-panel);
}
.wapyt-rb-add {
  border: none;
  background: var(--rb-panel-alt);
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  cursor: pointer;
  color: var(--rb-foreground);
}
.wapyt-rb-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--rb-panel);
}
.wapyt-rb-list {
  border-right: 1px solid var(--rb-border);
  background: var(--rb-panel-alt);
  overflow-y: auto;
  min-width: 200px;
}
.wapyt-rb-item {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0.75rem 1rem;
  text-align: left;
  cursor: pointer;
  border-bottom: 1px solid var(--rb-border);
  color: var(--rb-foreground);
  transition: background 120ms linear;
}
.wapyt-rb-item[data-active="true"],
.wapyt-rb-item:hover {
  background: rgba(37,99,235,0.12);
}
.wapyt-rb-item-title {
  font-weight: 600;
}
.wapyt-rb-item-sub {
  font-size: 0.8rem;
  color: var(--rb-muted);
}
.wapyt-rb-detail {
  flex: 1 1 auto;
  padding: 1rem 1.5rem;
  overflow: auto;
  background: var(--rb-panel);
}
.wapyt-rb-empty {
  color: var(--rb-muted);
  padding: 2rem;
}
.wapyt-rb-detail-card {
  background: var(--rb-panel-alt);
  border: 1px solid var(--rb-border);
  border-radius: 16px;
  padding: 1rem 1.25rem;
  box-shadow: var(--rb-shadow);
}
.wapyt-rb-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.wapyt-rb-detail-header h2 {
  margin: 0;
}
.wapyt-rb-status {
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  background: var(--rb-chip-bg);
  color: var(--rb-accent);
  font-size: 0.8rem;
  border: 1px solid var(--rb-chip-border);
}
.wapyt-rb-detail-section {
  margin-top: 1rem;
}
.wapyt-rb-models {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.wapyt-rb-chip {
  border-radius: 999px;
  border: 1px solid var(--rb-chip-border);
  padding: 0.25rem 0.75rem;
  font-size: 0.85rem;
  background: var(--rb-chip-bg);
}
.rb-primary {
  background: var(--rb-accent);
  color: var(--rb-accent-contrast);
  border: none;
  border-radius: 10px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
}
.rb-secondary {
  border: 1px solid var(--rb-border-strong);
  background: transparent;
  border-radius: 10px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  margin-right: 0.5rem;
  color: var(--rb-foreground);
}
.provider-detail {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.provider-detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.provider-detail-sub {
  margin: 0;
  color: var(--rb-muted);
}
.provider-detail-status {
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  background: var(--rb-chip-bg);
  border: 1px solid var(--rb-chip-border);
  color: var(--rb-accent);
}
.provider-detail-models {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.provider-chip {
  border-radius: 999px;
  border: 1px solid var(--rb-border-strong);
  padding: 0.2rem 0.6rem;
  color: var(--rb-foreground);
  background: transparent;
  cursor: pointer;
  transition: all 120ms linear;
}
.provider-chip[data-selected="true"] {
  background: var(--rb-accent);
  color: var(--rb-accent-contrast);
  border-color: var(--rb-accent);
}
.provider-empty {
  color: var(--rb-muted);
}
.provider-detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
`;
    document.head.appendChild(style);
  }

  //globalThis.wapyt = globalThis.wapyt || {};
  globalThis.wapyt.ResourceBoard = ResourceBoard;
})();
