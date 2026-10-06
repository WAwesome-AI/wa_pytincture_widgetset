(function () {
  // Message: toasts plus alert / confirm / prompt dialogs.
  //
  // Apps were each hand-rolling a toast and calling window.confirm(), which
  // cannot be styled, blocks the whole page, and is suppressed in some embedded
  // browsers. Everything here is mounted on <body>, outside any layout, and all
  // caller text is set with textContent -- messages routinely carry server and
  // model output.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  const KIND_ICONS = {
    info: "mdi-information-outline",
    success: "mdi-check-circle-outline",
    warning: "mdi-alert-outline",
    error: "mdi-alert-circle-outline",
  };
  const MAX_TOASTS = 4;

  function icon(kind, extraClass) {
    const value = KIND_ICONS[kind] || KIND_ICONS.info;
    if (globalNS.icons) {
      return globalNS.icons.iconElement(value, extraClass);
    }
    const el = document.createElement("i");
    el.className = `${extraClass} mdi ${value}`;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  function reducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // ── Toasts ───────────────────────────────────────────────────────────────

  let toastSeq = 0;
  const toasts = new Map(); // id -> {el, timer, remaining, started}

  function toastHost() {
    let host = document.querySelector(".wapyt-toasts");
    if (!host) {
      host = document.createElement("div");
      host.className = "wapyt-toasts";
      document.body.appendChild(host);
    }
    return host;
  }

  function startTimer(id) {
    const entry = toasts.get(id);
    if (!entry || !(entry.remaining > 0)) return;
    entry.started = Date.now();
    entry.timer = window.setTimeout(() => dismiss(id), entry.remaining);
  }

  function pauseTimer(id) {
    const entry = toasts.get(id);
    if (!entry || !entry.timer) return;
    window.clearTimeout(entry.timer);
    entry.timer = null;
    entry.remaining = Math.max(500, entry.remaining - (Date.now() - entry.started));
  }

  function toast(text, options = {}) {
    const kind = KIND_ICONS[options.kind] ? options.kind : "info";
    const timeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 4000;
    const id = `wapyt-toast-${++toastSeq}`;

    const el = document.createElement("div");
    el.className = "wapyt-toast";
    el.dataset.kind = kind;
    el.id = id;
    // Errors interrupt a screen reader; everything else waits its turn.
    el.setAttribute("role", kind === "error" ? "alert" : "status");

    el.appendChild(icon(kind, "wapyt-toast-icon"));
    const body = document.createElement("div");
    body.className = "wapyt-toast-text";
    body.textContent = text == null ? "" : String(text);
    el.appendChild(body);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "wapyt-toast-close";
    close.setAttribute("aria-label", "Dismiss");
    const closeIcon = document.createElement("i");
    closeIcon.className = "mdi mdi-close";
    closeIcon.setAttribute("aria-hidden", "true");
    close.appendChild(closeIcon);
    close.addEventListener("click", () => dismiss(id));
    el.appendChild(close);

    // Hovering keeps a toast up long enough to read; leaving resumes it.
    el.addEventListener("mouseenter", () => pauseTimer(id));
    el.addEventListener("mouseleave", () => startTimer(id));

    const host = toastHost();
    host.appendChild(el);
    toasts.set(id, { el, timer: null, remaining: timeout, started: 0 });
    // Oldest first out, so a burst of messages cannot cover the page.
    while (host.children.length > MAX_TOASTS) {
      dismiss(host.firstElementChild.id, true);
    }
    window.requestAnimationFrame(() => el.setAttribute("data-visible", ""));
    startTimer(id);
    return id;
  }

  function dismiss(id, immediate = false) {
    const entry = toasts.get(id);
    if (!entry) return false;
    toasts.delete(id);
    if (entry.timer) window.clearTimeout(entry.timer);
    const { el } = entry;
    if (immediate || reducedMotion()) {
      el.remove();
    } else {
      el.removeAttribute("data-visible");
      window.setTimeout(() => el.remove(), 200);
    }
    return true;
  }

  function dismissAll() {
    Array.from(toasts.keys()).forEach((id) => dismiss(id, true));
  }

  // ── Dialogs ──────────────────────────────────────────────────────────────

  let dialogSeq = 0;

  // Resolves to {ok: bool, value: string|null}. kind is alert | confirm | prompt.
  function dialog(options = {}) {
    return new Promise((resolve) => {
      const kind = ["alert", "confirm", "prompt"].includes(options.kind) ? options.kind : "alert";
      const seq = ++dialogSeq;
      const previousFocus = document.activeElement;

      const overlay = document.createElement("div");
      overlay.className = "wapyt-msg-overlay";

      const box = document.createElement("div");
      box.className = "wapyt-msg-dialog";
      box.setAttribute("role", kind === "prompt" ? "dialog" : "alertdialog");
      box.setAttribute("aria-modal", "true");
      if (options.danger) box.dataset.danger = "true";

      if (options.title) {
        const title = document.createElement("h2");
        title.className = "wapyt-msg-title";
        title.id = `wapyt-msg-title-${seq}`;
        title.textContent = String(options.title);
        box.appendChild(title);
        box.setAttribute("aria-labelledby", title.id);
      }

      const text = document.createElement("div");
      text.className = "wapyt-msg-text";
      text.id = `wapyt-msg-text-${seq}`;
      // pre-line in CSS keeps "Question?\n\nConsequence." paragraphs.
      text.textContent = options.text == null ? "" : String(options.text);
      box.appendChild(text);
      box.setAttribute("aria-describedby", text.id);
      if (!options.title) box.setAttribute("aria-labelledby", text.id);

      let input = null;
      if (kind === "prompt") {
        input = document.createElement("input");
        input.type = options.password ? "password" : "text";
        input.className = "wapyt-msg-input";
        if (options.password) {
          // "new-password" keeps the browser from filling in a saved password:
          // a password prompt is almost always choosing or resetting one.
          input.autocomplete = "new-password";
          input.spellcheck = false;
          input.setAttribute("autocapitalize", "off");
        }
        input.value = options.value == null ? "" : String(options.value);
        if (options.placeholder) input.placeholder = String(options.placeholder);
        input.setAttribute("aria-labelledby", text.id);
        box.appendChild(input);
      }

      const actions = document.createElement("div");
      actions.className = "wapyt-msg-actions";
      let cancelBtn = null;
      if (kind !== "alert") {
        cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "wapyt-msg-btn";
        cancelBtn.textContent = options.cancelText || "Cancel";
        actions.appendChild(cancelBtn);
      }
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "wapyt-msg-btn wapyt-msg-btn-primary";
      if (options.danger) okBtn.classList.add("wapyt-msg-btn-danger");
      okBtn.textContent = options.okText || "OK";
      actions.appendChild(okBtn);
      box.appendChild(actions);

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      let settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeydown, true);
        overlay.remove();
        if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
          previousFocus.focus();
        }
        resolve({ ok, value: kind === "prompt" && ok ? input.value : null });
      }

      function focusables() {
        return Array.from(box.querySelectorAll("button, input")).filter((el) => !el.disabled);
      }

      function onKeydown(event) {
        // Only the topmost dialog handles keys when several are stacked.
        const overlays = document.querySelectorAll(".wapyt-msg-overlay");
        if (overlays[overlays.length - 1] !== overlay) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(kind === "alert");
        } else if (event.key === "Enter" && event.target === input) {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Tab") {
          // Keep focus inside the dialog.
          const items = focusables();
          if (!items.length) return;
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
      }

      okBtn.addEventListener("click", () => finish(true));
      if (cancelBtn) cancelBtn.addEventListener("click", () => finish(false));
      // A backdrop click never confirms: it cancels, or acknowledges an alert.
      overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) finish(kind === "alert");
      });
      document.addEventListener("keydown", onKeydown, true);

      if (input) {
        input.focus();
        input.select();
      } else if (options.danger && cancelBtn) {
        // A destructive confirm starts on Cancel, so Enter does not destroy.
        cancelBtn.focus();
      } else {
        okBtn.focus();
      }
    });
  }

  globalNS.Message = { toast, dismiss, dismissAll, dialog };
})();
