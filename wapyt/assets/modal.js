(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function toSize(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === "number") {
      return `${value}px`;
    }
    return value;
  }

  class ModalWindow {
    constructor(options = {}) {
      this.options = Object.assign(
        {
          title: "",
          width: 520,
          height: 360,
          closable: true,
        },
        options || {}
      );
      this._visible = false;
      this._createDom();
    }

    _createDom() {
      this.overlay = document.createElement("div");
      this.overlay.className = "wapyt-modal-overlay";
      this.overlay.style.display = "none";
      this.overlay.addEventListener("click", (event) => {
        if (event.target === this.overlay) {
          this.hide();
        }
      });

      this.modal = document.createElement("div");
      this.modal.className = "wapyt-modal";
      this.modal.style.width = toSize(this.options.width) || "";
      this.modal.style.height = toSize(this.options.height) || "";

      const header = document.createElement("div");
      header.className = "wapyt-modal-header";
      this.titleEl = document.createElement("span");
      this.titleEl.className = "wapyt-modal-title";
      this.setTitle(this.options.title || "");
      header.appendChild(this.titleEl);

      if (this.options.closable) {
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "wapyt-modal-close";
        closeBtn.innerHTML = "&times;";
        closeBtn.addEventListener("click", () => this.hide());
        header.appendChild(closeBtn);
      }

      this.bodyEl = document.createElement("div");
      this.bodyEl.className = "wapyt-modal-body";

      this.modal.appendChild(header);
      this.modal.appendChild(this.bodyEl);
      this.overlay.appendChild(this.modal);
      document.body.appendChild(this.overlay);

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this._visible) {
          this.hide();
        }
      });
    }

    setTitle(title) {
      this.titleEl.textContent = title || "";
    }

    setContent(component) {
      this.bodyEl.innerHTML = "";
      if (!component) {
        return;
      }
      if (typeof component === "string") {
        this.bodyEl.innerHTML = component;
        return;
      }
      if (component instanceof HTMLElement) {
        this.bodyEl.appendChild(component);
        return;
      }
      if (component.getRootElement) {
        const root = component.getRootElement();
        if (root) {
          this.bodyEl.appendChild(root);
        }
      } else if (component.element) {
        this.bodyEl.appendChild(component.element);
      }
    }

    _applyTheme() {
      const theme = document.documentElement.getAttribute("data-wapyt-theme") || "light";
      this.overlay.setAttribute("data-wapyt-theme", theme);
    }

    show() {
      this._applyTheme();
      this.overlay.style.display = "flex";
      this._visible = true;
    }

    hide() {
      this.overlay.style.display = "none";
      this._visible = false;
    }

    close() {
      this.hide();
      this.overlay.remove();
    }
  }

  if (!document.querySelector("style[data-wapyt-modal]")) {
    const style = document.createElement("style");
    style.setAttribute("data-wapyt-modal", "true");
    style.textContent = `
.wapyt-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.wapyt-modal-overlay[data-wapyt-theme="dark"] {
  background: rgba(0, 0, 0, 0.7);
}
.wapyt-modal {
  background: var(--wapyt-bg, #fff);
  color: var(--wapyt-text, #0f172a);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.35);
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
}
.wapyt-modal {
  border: 1px solid rgba(15,23,42,0.1);
}
.wapyt-modal-overlay[data-wapyt-theme="dark"] .wapyt-modal {
  background: var(--wapyt-bg-dark, #0f172a);
  color: var(--wapyt-text-dark, #f8fafc);
  border: 1px solid rgba(248,250,252,0.12);
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
}
.wapyt-modal-overlay[data-wapyt-theme="dark"] .wapyt-modal-header {
  border-bottom: 1px solid rgba(248,250,252,0.15);
}

.wapyt-modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.wapyt-modal-body {
  padding: 1rem 1.5rem;
  overflow: auto;
  flex: 1 1 auto;
}
.wapyt-modal-body input,
.wapyt-modal-body textarea {
  background: rgba(15,23,42,0.05);
  border: 1px solid rgba(15,23,42,0.15);
  border-radius: 8px;
}
.wapyt-modal-overlay[data-wapyt-theme="dark"] .wapyt-modal-body input,
.wapyt-modal-overlay[data-wapyt-theme="dark"] .wapyt-modal-body textarea {
  background: rgba(248,250,252,0.05);
  border: 1px solid rgba(248,250,252,0.1);
  color: inherit;
}

.wapyt-modal-close {
  border: none;
  background: transparent;
  font-size: 1.25rem;
  cursor: pointer;
}
.wapyt-modal-overlay[data-wapyt-theme="dark"] .wapyt-modal-close {
  color: inherit;
}
`;
    document.head.appendChild(style);
  }

  //globalThis.wapyt = globalThis.wapyt || {};
  globalThis.wapyt.ModalWindow = ModalWindow;
})();
