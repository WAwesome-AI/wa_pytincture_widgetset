(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_termhost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" class="wapyt-terminal"></div>`);
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

  // ── Vendored asset loading ─────────────────────────────────────────────────
  // xterm is NOT bundled into the widgetset: it is ~300KB that only terminal
  // apps need, and pytincture evaluates every manifest asset on every page
  // load. The consuming app serves it from its own origin instead (pytincture's
  // CSP is `script-src 'self' ...`, so a CDN is not an option either way) and
  // points `assetBase` at it. One loader promise is shared by every instance.
  const _loaders = new Map();

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-wapyt-src="${CSS.escape(url)}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
        } else {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error(`failed to load ${url}`)));
        }
        return;
      }
      const el = document.createElement("script");
      el.src = url;
      el.async = false;
      el.dataset.wapytSrc = url;
      el.addEventListener("load", () => {
        el.dataset.loaded = "true";
        resolve();
      });
      el.addEventListener("error", () => reject(new Error(`failed to load ${url}`)));
      document.head.appendChild(el);
    });
  }

  function loadCss(url) {
    if (document.querySelector(`link[data-wapyt-href="${CSS.escape(url)}"]`)) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.wapytHref = url;
    document.head.appendChild(link);
  }

  function ensureAssets(base, wantSearch) {
    const key = `${base}|${wantSearch ? "search" : "plain"}`;
    if (_loaders.has(key)) {
      return _loaders.get(key);
    }
    const root = String(base || "/xterm").replace(/\/+$/, "");
    const promise = (async () => {
      loadCss(`${root}/xterm.css`);
      if (!globalThis.Terminal) {
        await loadScript(`${root}/xterm.js`);
      }
      if (!globalThis.FitAddon) {
        await loadScript(`${root}/addon-fit.js`);
      }
      if (wantSearch && !globalThis.SearchAddon) {
        await loadScript(`${root}/addon-search.js`);
      }
      if (!globalThis.Terminal) {
        throw new Error(`xterm did not register window.Terminal (looked under ${root})`);
      }
    })();
    _loaders.set(key, promise);
    return promise;
  }

  // ── Widget ─────────────────────────────────────────────────────────────────

  class Terminal_ {
    constructor(target, options = {}) {
      this.options = Object.assign(
        {
          assetBase: "/xterm",
          wsUrl: null,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 14,
          scrollback: 5000,
          theme: null,
          search: true,
          reconnect: true,
          reconnectMaxAttempts: 5,
          reconnectBaseMs: 1000,
          cursorBlink: true,
        },
        options || {}
      );

      this._events = {};
      this._term = null;
      this._fit = null;
      this._fitTimer = null;
      this._search = null;
      this._ws = null;
      this._dataDisposable = null;
      this._observer = null;
      this._attempts = 0;
      this._reconnectTimer = null;
      this._closedByUser = false;
      this._lastSize = { cols: 0, rows: 0 };

      this._host = resolveHost(target);
      if (!this._host) {
        throw new Error("Unable to mount Terminal – target not found.");
      }
      this._host.classList.add("wapyt-terminal");
      this._renderChrome();

      ensureAssets(this.options.assetBase, this.options.search)
        .then(() => this._boot())
        .catch((error) => {
          this._showOverlay(`Terminal assets failed to load: ${error.message}`);
          this._emit("error", { message: String(error.message || error) });
        });
    }

    _renderChrome() {
      this._host.innerHTML = "";
      this._screen = document.createElement("div");
      this._screen.className = "wapyt-terminal-screen";
      this._host.appendChild(this._screen);

      this._overlay = document.createElement("div");
      this._overlay.className = "wapyt-terminal-overlay";
      this._overlay.hidden = true;
      this._host.appendChild(this._overlay);

      if (this.options.search) {
        this._buildSearchBar();
      }
    }

    _buildSearchBar() {
      const bar = document.createElement("div");
      bar.className = "wapyt-terminal-search";
      bar.hidden = true;
      bar.innerHTML = `
        <input type="text" class="wapyt-terminal-search-input" placeholder="Search" aria-label="Search terminal" />
        <button type="button" class="wapyt-terminal-search-prev" title="Previous">&#8593;</button>
        <button type="button" class="wapyt-terminal-search-next" title="Next">&#8595;</button>
        <button type="button" class="wapyt-terminal-search-close" title="Close">&times;</button>
      `;
      this._host.appendChild(bar);
      this._searchBar = bar;
      this._searchInput = bar.querySelector(".wapyt-terminal-search-input");

      const find = (forward) => {
        const value = this._searchInput.value;
        if (!value || !this._search) return;
        if (forward) {
          this._search.findNext(value);
        } else {
          this._search.findPrevious(value);
        }
      };

      bar.querySelector(".wapyt-terminal-search-next").addEventListener("click", () => find(true));
      bar.querySelector(".wapyt-terminal-search-prev").addEventListener("click", () => find(false));
      bar.querySelector(".wapyt-terminal-search-close").addEventListener("click", () => this.hideSearch());
      this._searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          find(!event.shiftKey);
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.hideSearch();
        }
      });
    }

    _boot() {
      const TerminalCtor = globalThis.Terminal;
      this._term = new TerminalCtor({
        fontFamily: this.options.fontFamily,
        fontSize: this.options.fontSize,
        scrollback: this.options.scrollback,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme || undefined,
        allowProposedApi: true,
      });

      this._fit = new globalThis.FitAddon.FitAddon();
      this._term.loadAddon(this._fit);

      if (this.options.search && globalThis.SearchAddon) {
        this._search = new globalThis.SearchAddon.SearchAddon();
        this._term.loadAddon(this._search);
      }

      this._term.open(this._screen);

      // Ctrl+F opens the search bar instead of the browser's find.
      this._term.attachCustomKeyEventHandler((event) => {
        if (event.type === "keydown" && event.ctrlKey && !event.altKey && event.key === "f") {
          if (this.options.search) {
            event.preventDefault();
            this.showSearch();
            return false;
          }
        }
        return true;
      });

      this._term.onTitleChange((title) => this._emit("title", { title }));

      // A panel that is hidden (an inactive keep-alive tab) has no dimensions,
      // and fitting against zero produces a 1x1 terminal that never recovers.
      // ResizeObserver fires when the panel becomes visible again, so every
      // fit is gated on a real size.
      this._observer = new ResizeObserver(() => this._scheduleFit());
      this._observer.observe(this._host);

      this.fit();
      this._emit("ready", {});

      if (this.options.wsUrl) {
        this.connect();
      }
    }

    // ── Sizing ───────────────────────────────────────────────────────────────

    // A container that is being dragged fires the observer every frame, and
    // each frame that crosses a column boundary is a fresh TIOCSWINSZ on the
    // remote. Measured in a tiled workspace: one 1.3s resize drag sent 41 PTY
    // resizes, all distinct, so the cols/rows dedupe in fit() never engaged.
    // An explicit fit() stays immediate; only the observer is debounced.
    _scheduleFit() {
      const delay = Number(this.options.fitDebounceMs) || 0;
      if (delay <= 0) {
        this.fit();
        return;
      }
      if (this._fitTimer) {
        clearTimeout(this._fitTimer);
      }
      this._fitTimer = setTimeout(() => {
        this._fitTimer = null;
        this.fit();
      }, delay);
    }

    fit() {
      if (!this._term || !this._fit) return;
      const rect = this._host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        return; // hidden panel — wait for the ResizeObserver
      }
      try {
        this._fit.fit();
      } catch (error) {
        return;
      }
      const { cols, rows } = this._term;
      if (cols === this._lastSize.cols && rows === this._lastSize.rows) {
        return;
      }
      this._lastSize = { cols, rows };
      this._sendResize();
    }

    _sendResize() {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._term) return;
      this._ws.send(
        JSON.stringify({ type: "resize", cols: this._term.cols, rows: this._term.rows })
      );
    }

    // ── Connection ───────────────────────────────────────────────────────────

    connect() {
      if (!this.options.wsUrl || !this._term) return;
      this._closedByUser = false;
      this._clearReconnect();

      const url = this._absoluteWsUrl(this.options.wsUrl);
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        this._emit("error", { message: String(error.message || error) });
        return;
      }
      this._ws = socket;

      socket.onopen = () => {
        this._attempts = 0;
        this._hideOverlay();
        this._sendResize();
        this.focus();
      };

      socket.onmessage = ({ data }) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch (error) {
          this._term.write(String(data));
          return;
        }
        switch (msg.type) {
          case "output":
            this._term.write(msg.data);
            break;
          case "connected":
            this._emit("connect", { host: msg.data });
            break;
          case "disconnected":
            this._term.write(`\r\n\x1b[33m[${msg.data || "Disconnected"}]\x1b[0m\r\n`);
            break;
          case "error":
            this._term.write(`\r\n\x1b[31m[${msg.data || "Error"}]\x1b[0m\r\n`);
            this._emit("error", { message: msg.data });
            break;
          default:
            break;
        }
      };

      socket.onerror = () => {
        this._emit("error", { message: "WebSocket error" });
      };

      socket.onclose = (event) => {
        this._ws = null;
        this._emit("disconnect", { code: event.code, clean: event.wasClean });
        if (this._closedByUser || !this.options.reconnect) {
          return;
        }
        // 4401/4404 are the app's auth/not-found codes: retrying cannot help.
        if (event.code === 4401 || event.code === 4404) {
          this._showOverlay(
            event.code === 4401 ? "Not authenticated." : "Session not found."
          );
          return;
        }
        this._scheduleReconnect();
      };

      if (this._dataDisposable) {
        this._dataDisposable.dispose();
      }
      // Keystrokes go straight from xterm to the socket. This path deliberately
      // never crosses into Python: Pyodide is single-threaded on the main
      // thread, and an FFI hop per keypress (and per output frame) is what
      // makes a browser terminal feel laggy.
      this._dataDisposable = this._term.onData((data) => {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
          this._ws.send(JSON.stringify({ type: "input", data }));
        }
      });
    }

    _absoluteWsUrl(url) {
      if (/^wss?:\/\//i.test(url)) {
        return url;
      }
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const path = url.startsWith("/") ? url : `/${url}`;
      return `${proto}//${location.host}${path}`;
    }

    _scheduleReconnect() {
      const max = this.options.reconnectMaxAttempts;
      if (this._attempts >= max) {
        this._showOverlay(`Disconnected. Reconnect failed after ${max} attempts.`);
        this._emit("reconnect_failed", { attempts: this._attempts });
        return;
      }
      this._attempts += 1;
      const delay = this.options.reconnectBaseMs * Math.pow(2, this._attempts - 1);
      this._showOverlay(
        `Disconnected — reconnecting (${this._attempts}/${max})…`
      );
      this._emit("reconnecting", { attempt: this._attempts, delay });
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.connect();
      }, delay);
    }

    _clearReconnect() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
    }

    reconnect() {
      this._attempts = 0;
      this._clearReconnect();
      this.disconnect();
      this.connect();
    }

    disconnect() {
      this._closedByUser = true;
      this._clearReconnect();
      if (this._ws) {
        try {
          this._ws.close();
        } catch (error) {
          /* already closing */
        }
        this._ws = null;
      }
    }

    // ── Terminal surface ─────────────────────────────────────────────────────

    write(text) {
      if (this._term) {
        this._term.write(text);
      }
    }

    clear() {
      if (this._term) {
        this._term.clear();
      }
    }

    focus() {
      if (this._term) {
        this._term.focus();
      }
    }

    showSearch() {
      if (!this._searchBar) return;
      this._searchBar.hidden = false;
      this._searchInput.focus();
      this._searchInput.select();
    }

    hideSearch() {
      if (!this._searchBar) return;
      this._searchBar.hidden = true;
      if (this._search) {
        this._search.clearDecorations();
      }
      this.focus();
    }

    toggleSearch() {
      if (!this._searchBar) return;
      if (this._searchBar.hidden) {
        this.showSearch();
      } else {
        this.hideSearch();
      }
    }

    _showOverlay(message) {
      if (!this._overlay) return;
      this._overlay.textContent = message;
      this._overlay.hidden = false;
    }

    _hideOverlay() {
      if (!this._overlay) return;
      this._overlay.hidden = true;
    }

    destroy() {
      this.disconnect();
      if (this._fitTimer) {
        clearTimeout(this._fitTimer);
        this._fitTimer = null;
      }
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._dataDisposable) {
        this._dataDisposable.dispose();
        this._dataDisposable = null;
      }
      if (this._term) {
        this._term.dispose();
        this._term = null;
      }
      this._host.innerHTML = "";
    }

    // ── Events ───────────────────────────────────────────────────────────────

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
          console.error("[wapyt] Terminal listener failed", error);
        }
      });
    }
  }

  globalThis.wapyt.Terminal = Terminal_;
})();
