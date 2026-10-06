(function () {
  // Tooltips: one shared role="tooltip" element, driven by delegated listeners
  // on the document. Any element with data-wapyt-tooltip gets one. So does any
  // wapyt-built element (a class starting "wapyt-") that carries a native
  // title: the title moves into data-wapyt-tooltip the first time it is
  // pointed at or focused, so Toolbar, DataTable, Tree and Sidebar get styled,
  // keyboard-reachable tooltips without each one changing. An app's own markup
  // keeps its native titles unless it opts in.
  //
  // Text goes in through textContent.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});
  if (globalNS.tooltip && globalNS.tooltip._installed) return;

  const SHOW_DELAY = 450;
  const WARM_MS = 400; // moving between targets soon after one hid shows at once
  const GAP = 6;
  const MARGIN = 8;

  let tip = null;
  let current = null;
  let timer = 0;
  let lastHidden = 0;
  let enabled = true;

  function tipEl() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "wapyt-tooltip";
      tip.id = "wapyt-tooltip";
      tip.setAttribute("role", "tooltip");
    }
    return tip;
  }

  function ownedByWapyt(el) {
    return Array.from(el.classList || []).some((cls) => cls.startsWith("wapyt-"));
  }

  // Move a wapyt element's title into the data attribute, so the browser's
  // own tooltip never doubles ours. An icon-only control whose title was its
  // only name keeps it as aria-label.
  function upgrade(el) {
    const title = el.getAttribute("title");
    if (title && ownedByWapyt(el)) {
      el.dataset.wapytTooltip = title;
      el.removeAttribute("title");
      // A truncating cell only needs its tooltip when the text is cut off.
      if (Array.from(el.classList).some((cls) => cls.endsWith("ellipsis"))) {
        el.dataset.wapytTooltipOverflow = "true";
      }
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !el.textContent.trim()) {
        el.setAttribute("aria-label", title);
      }
    }
  }

  function targetOf(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== document.body) {
      upgrade(el);
      if (el.dataset && el.dataset.wapytTooltip) return el;
      el = el.parentElement;
    }
    return null;
  }

  function place(anchor) {
    const el = tipEl();
    const box = anchor.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    const wanted = anchor.dataset.wapytTooltipPlacement || "top";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = wanted;
    if (side === "top" && box.top - own.height - GAP < MARGIN) side = "bottom";
    else if (side === "bottom" && box.bottom + own.height + GAP > vh - MARGIN) side = "top";
    else if (side === "left" && box.left - own.width - GAP < MARGIN) side = "right";
    else if (side === "right" && box.right + own.width + GAP > vw - MARGIN) side = "left";
    let left;
    let top;
    if (side === "top" || side === "bottom") {
      left = box.left + box.width / 2 - own.width / 2;
      top = side === "top" ? box.top - own.height - GAP : box.bottom + GAP;
    } else {
      top = box.top + box.height / 2 - own.height / 2;
      left = side === "left" ? box.left - own.width - GAP : box.right + GAP;
    }
    left = Math.max(MARGIN, Math.min(left, vw - own.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - own.height - MARGIN));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.dataset.side = side;
  }

  function show(anchor) {
    clearTimeout(timer);
    const text = anchor.dataset.wapytTooltip;
    if (!enabled || !text || !anchor.isConnected) return;
    if (anchor.dataset.wapytTooltipOverflow === "true" && anchor.scrollWidth <= anchor.clientWidth) return;
    const el = tipEl();
    el.textContent = text;
    if (!el.isConnected) document.body.appendChild(el);
    el.dataset.visible = "true";
    current = anchor;
    const described = (anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if (!described.includes(el.id)) anchor.setAttribute("aria-describedby", [...described, el.id].join(" "));
    place(anchor);
  }

  function hide() {
    clearTimeout(timer);
    if (!current) return;
    const described = (current.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== "wapyt-tooltip");
    if (described.length) current.setAttribute("aria-describedby", described.join(" "));
    else current.removeAttribute("aria-describedby");
    current = null;
    lastHidden = Date.now();
    if (tip) {
      delete tip.dataset.visible;
      tip.remove();
    }
  }

  function schedule(anchor, immediate) {
    if (anchor === current) return;
    hide();
    clearTimeout(timer);
    if (immediate || Date.now() - lastHidden < WARM_MS) show(anchor);
    else timer = setTimeout(() => show(anchor), SHOW_DELAY);
  }

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const anchor = targetOf(event.target);
    if (anchor) schedule(anchor, false);
    else if (current || timer) hide();
  }, true);
  document.addEventListener("pointerout", (event) => {
    if (!current && !timer) return;
    const to = event.relatedTarget && targetOf(event.relatedTarget);
    if (!to) hide();
  }, true);
  // Keyboard focus shows at once; a mouse click's focus does not.
  document.addEventListener("focusin", (event) => {
    const anchor = targetOf(event.target);
    if (!anchor) return;
    let keyboard = true;
    try { keyboard = event.target.matches(":focus-visible"); } catch (_e) { /* old engine */ }
    if (keyboard) schedule(anchor, true);
  }, true);
  document.addEventListener("focusout", () => hide(), true);
  document.addEventListener("pointerdown", () => hide(), true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && current) hide();
  }, true);
  window.addEventListener("scroll", () => hide(), true);
  window.addEventListener("resize", () => hide());

  globalNS.tooltip = {
    _installed: true,
    // Give any element a tooltip; empty text removes it.
    // options.overflow: only when the element's text is cut off.
    set(el, text, placement, options) {
      if (!el) return;
      if (text) el.dataset.wapytTooltip = String(text);
      else delete el.dataset.wapytTooltip;
      if (placement) el.dataset.wapytTooltipPlacement = String(placement);
      if (options && options.overflow) el.dataset.wapytTooltipOverflow = "true";
      el.removeAttribute("title");
      if (el === current) (text ? show(el) : hide());
    },
    show(el) { if (el) show(el); },
    hide,
    // Turn every tooltip off (and back on), e.g. for a kiosk or a test run.
    setEnabled(on) {
      enabled = Boolean(on);
      if (!enabled) hide();
    },
  };
})();
