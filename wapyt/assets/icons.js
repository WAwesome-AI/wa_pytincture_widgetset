(function () {
  // Shared icon resolution for every wapyt widget.
  //
  // Why this exists: the widgets used to render Material Symbols / Material
  // Icons *ligature* spans -- `<span class="material-icons">send</span>`, where
  // the text content IS the icon and the font substitutes a glyph. The
  // stylesheets for those fonts were pulled from fonts.googleapis.com and
  // jsdelivr, and pytincture serves a CSP of `style-src 'self' 'unsafe-inline'`,
  // so every one of them was blocked. The spans then rendered as literal Arial
  // text -- "add_comment" is 84px wide inside a 36px round button, so the labels
  // overflowed their buttons and overlapped each other.
  //
  // The fix is to use the icon font pytincture already ships and injects:
  // Material Design Icons, served from its own origin at
  // frontend/vendor/materialdesignicons/. MDI is class-based (`mdi mdi-send`),
  // not ligature-based, so nothing renders as text when it is missing.
  //
  // This module must load BEFORE any widget that draws an icon; the asset
  // manifest lists it first and pytincture evaluates in manifest order.

  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  // Material Symbols/Icons ligature name -> MDI class suffix.
  // Only names actually used by the widgets and by known apps need an entry;
  // anything unmapped falls back to a neutral dot rather than leaking text.
  const LIGATURE_TO_MDI = {
    add: "plus",
    add_comment: "comment-plus",
    arrow_back: "arrow-left",
    arrow_forward: "arrow-right",
    attach_file: "paperclip",
    check: "check",
    chevron_left: "chevron-left",
    chevron_right: "chevron-right",
    close: "close",
    code: "code-tags",
    content_copy: "content-copy",
    dark_mode: "weather-night",
    delete: "delete",
    delete_sweep: "delete-sweep",
    description: "file-document-outline",
    download: "download",
    edit: "pencil",
    error: "alert-circle-outline",
    expand_less: "chevron-up",
    expand_more: "chevron-down",
    folder: "folder-outline",
    light_mode: "weather-sunny",
    menu: "menu",
    mic: "microphone",
    mic_off: "microphone-off",
    microphone: "microphone",
    mic_continuous: "microphone-message",
    menu_open: "menu-open",
    more_vert: "dots-vertical",
    open_in_new: "open-in-new",
    person: "account",
    refresh: "refresh",
    search: "magnify",
    send: "send",
    settings: "cog-outline",
    smart_toy: "robot-outline",
    star: "star",
    stop: "stop",
    visibility: "eye-outline",
    warning: "alert-outline",
  };

  const FALLBACK_MDI = "circle-small";

  // Accepts whatever an app or widget already passes:
  //   "mdi mdi-send" / "mdi-send"  -> used as-is (MDI is a first-class input)
  //   "send"                       -> mapped ligature name
  //   ""                           -> fallback dot
  // Returns a class string, never markup, so callers choose the element.
  function iconClass(value) {
    const raw = (value ?? "").toString().trim();
    if (!raw) return `mdi mdi-${FALLBACK_MDI}`;
    if (raw.includes("mdi-")) {
      return raw.includes("mdi ") || raw.startsWith("mdi ") ? raw : `mdi ${raw}`;
    }
    const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
    return `mdi mdi-${LIGATURE_TO_MDI[key] || FALLBACK_MDI}`;
  }

  // Build an icon element. Never uses innerHTML: `value` can reach here from
  // model output and provider metadata, and a class attribute is the only thing
  // we ever set from it.
  function iconElement(value, extraClass) {
    const el = document.createElement("i");
    el.className = extraClass
      ? `${extraClass} ${iconClass(value)}`
      : iconClass(value);
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  // For the template-string call sites in chat.js. The class string is built
  // from a fixed lookup table, so it contains no caller-controlled text --
  // an unmapped name yields FALLBACK_MDI rather than being interpolated.
  function iconMarkup(value, extraClass) {
    const cls = extraClass
      ? `${extraClass} ${iconClass(value)}`
      : iconClass(value);
    return `<i class="${cls}" aria-hidden="true"></i>`;
  }

  globalNS.icons = {
    iconClass,
    iconElement,
    iconMarkup,
    LIGATURE_TO_MDI,
  };
})();
