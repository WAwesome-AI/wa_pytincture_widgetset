(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_tabhost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-tabwidget"></div>`);
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

  function normalizeTabs(tabs) {
    if (!Array.isArray(tabs)) {
      return [];
    }
    return tabs
      .map((tab, index) => {
        if (!tab) return null;
        const id = tab.id || `tab-${index + 1}`;
        return Object.assign({ id, title: `Tab ${index + 1}` }, tab);
      })
      .filter(Boolean);
  }

  class TabPanel {
    constructor(tabId, element) {
      this.id = tabId;
      this.element = element;
      this.body = element;
      this._widget = null;
    }

    attach(component) {
      this.detach();
      if (component == null) {
        return null;
      }
      if (typeof component === "string") {
        this.attachHTML(component);
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

    getContainer() {
      return this.body;
    }
  }

  class TabWidget {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          tabs: [],
          active: null,
          orientation: "top",
          fillHeight: true,
          keepAlive: true,
        },
        options || {}
      );
      this._events = {};
      this._tabs = [];
      this._panels = new Map();
      this._buttons = new Map();
      this._activeTab = null;

      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount TabWidget – target not found.");
      }
      this._renderChrome();
      this.setTabs(this.options.tabs);
      const initial =
        this.options.active ||
        (this._tabs.length ? this._tabs[0].id : null);
      if (initial) {
        this.setActive(initial);
      }
      this._emit("ready");
    }

    _renderChrome() {
      this._host.classList.add("wapyt-tabwidget");
      this._tabsBar = document.createElement("div");
      this._tabsBar.className = "wapyt-tabwidget-tabs";
      this._panelsHost = document.createElement("div");
      this._panelsHost.className = "wapyt-tabwidget-panels";
      this._host.innerHTML = "";
      this._host.appendChild(this._tabsBar);
      this._host.appendChild(this._panelsHost);
      this._host.dataset.orientation = this.options.orientation || "top";
      if (this.options.fillHeight) {
        this._host.classList.add("wapyt-tabwidget-fill");
      }
    }

    _clear() {
      this._tabsBar.innerHTML = "";
      this._panelsHost.innerHTML = "";
      this._panels.clear();
      this._buttons.clear();
      this._activeTab = null;
    }

    setTabs(tabs) {
      this._clear();
      this._tabs = normalizeTabs(tabs);
      this._tabs.forEach((tab, index) => {
        const button = this._createButton(tab, index);
        const panel = this._createPanel(tab, index);
        this._buttons.set(tab.id, button);
        this._panels.set(tab.id, panel);
      });
    }

    _createButton(tab, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wapyt-tab";
      button.dataset.tabId = tab.id;
      button.innerHTML = `
        <span class="wapyt-tab-title">${tab.title || tab.id}</span>
        ${
          tab.badge != null
            ? `<span class="wapyt-tab-badge">${tab.badge}</span>`
            : ""
        }
      `;
      if (tab.disabled) {
        button.setAttribute("aria-disabled", "true");
      }
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-disabled") === "true") return;
        this.setActive(tab.id, { viaClick: true });
      });
      if (tab.closable) {
        const closer = document.createElement("span");
        closer.className = "wapyt-tab-close";
        closer.setAttribute("role", "button");
        closer.innerHTML = "×";
        closer.addEventListener("click", (event) => {
          event.stopPropagation();
          this._emit("close", { id: tab.id });
          this.removeTab(tab.id);
        });
        button.appendChild(closer);
      }
      const targetIndex =
        typeof index === "number"
          ? Math.min(Math.max(index, 0), this._tabsBar.children.length)
          : this._tabsBar.children.length;
      if (targetIndex >= 0 && targetIndex < this._tabsBar.children.length) {
        this._tabsBar.insertBefore(button, this._tabsBar.children[targetIndex]);
      } else {
        this._tabsBar.appendChild(button);
      }
      return button;
    }

    _createPanel(tab, index) {
      const panelEl = document.createElement("div");
      panelEl.className = "wapyt-tab-panel";
      panelEl.dataset.tabId = tab.id;
      if (tab.html) {
        panelEl.innerHTML = tab.html;
      }
      const adapter = new TabPanel(tab.id, panelEl);
      const insertIndex =
        typeof index === "number"
          ? Math.min(Math.max(index, 0), this._panelsHost.children.length)
          : this._panelsHost.children.length;
      if (insertIndex >= 0 && insertIndex < this._panelsHost.children.length) {
        this._panelsHost.insertBefore(panelEl, this._panelsHost.children[insertIndex]);
      } else {
        this._panelsHost.appendChild(panelEl);
      }
      return adapter;
    }

    setActive(tabId, meta = {}) {
      if (!tabId || !this._panels.has(tabId)) {
        return;
      }
      if (this._activeTab === tabId) {
        return;
      }
      if (this._activeTab && this._buttons.has(this._activeTab)) {
        this._buttons.get(this._activeTab).dataset.active = "false";
      }
      if (this._activeTab && this._panels.has(this._activeTab)) {
        this._panels
          .get(this._activeTab)
          .element.setAttribute("data-active", "false");
      }

      this._activeTab = tabId;
      const button = this._buttons.get(tabId);
      const panel = this._panels.get(tabId);
      if (button) {
        button.dataset.active = "true";
      }
      if (panel) {
        panel.element.setAttribute("data-active", "true");
      }
      this._emit("change", { id: tabId, viaClick: Boolean(meta.viaClick) });
    }

    getActive() {
      return this._activeTab;
    }

    addTab(tabConfig, index) {
      const tab = normalizeTabs([tabConfig])[0];
      if (!tab) return;
      let insertIndex = index;
      if (insertIndex == null || insertIndex < 0 || insertIndex > this._tabs.length) {
        insertIndex = this._tabs.length;
        this._tabs.push(tab);
      } else {
        this._tabs.splice(insertIndex, 0, tab);
      }
      const button = this._createButton(tab, insertIndex);
      const panel = this._createPanel(tab, insertIndex);
      this._buttons.set(tab.id, button);
      this._panels.set(tab.id, panel);
      this.setActive(tab.id);
    }

    removeTab(tabId) {
      const idx = this._tabs.findIndex((tab) => tab.id === tabId);
      if (idx === -1) return;
      this._tabs.splice(idx, 1);
      const button = this._buttons.get(tabId);
      if (button) {
        button.remove();
        this._buttons.delete(tabId);
      }
      const panel = this._panels.get(tabId);
      if (panel) {
        panel.element.remove();
        this._panels.delete(tabId);
      }
      if (this._activeTab === tabId) {
        const fallback = this._tabs[idx] || this._tabs[idx - 1] || null;
        this._activeTab = null;
        if (fallback) {
          this.setActive(fallback.id);
        }
      }
    }

    attach(tabId, component) {
      const panel = this.getCell(tabId);
      if (panel) {
        panel.attach(component);
      }
    }

    attachHTML(tabId, html) {
      const panel = this.getCell(tabId);
      if (panel) {
        panel.attachHTML(html);
      }
    }

    disableTab(tabId) {
      const button = this._buttons.get(tabId);
      if (button) {
        button.setAttribute("aria-disabled", "true");
      }
    }

    enableTab(tabId) {
      const button = this._buttons.get(tabId);
      if (button) {
        button.removeAttribute("aria-disabled");
      }
    }

    setBadge(tabId, badge) {
      const button = this._buttons.get(tabId);
      if (!button) return;
      let badgeEl = button.querySelector(".wapyt-tab-badge");
      if (badge == null) {
        if (badgeEl) {
          badgeEl.remove();
        }
        return;
      }
      if (!badgeEl) {
        badgeEl = document.createElement("span");
        badgeEl.className = "wapyt-tab-badge";
        button.appendChild(badgeEl);
      }
      badgeEl.textContent = badge;
    }

    getCell(tabId) {
      return this._panels.get(tabId) || null;
    }

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
          console.error("[wapyt] TabWidget listener failed", error);
        }
      });
    }
  }

  //globalThis.wapyt = globalThis.wapyt || {};
  globalThis.wapyt.TabWidget = TabWidget;
})();
