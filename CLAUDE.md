# wapyt — wA PyTincture Widgetset

DHTMLX-free widgetset for [pyTincture](https://github.com/pytincture/pytincture). Seven widgets
(Layout, Chat, CardPanel, TabWidget, Sidebar, ModalWindow, ResourceBoard) declared in Python, rendered
as plain DOM by bundled JS, running inside Pyodide. The commercial-licence alternative to `dhxpyt`.

## Related repos

Sibling clones under `~/Development/Pytinc/`, each with its own `CLAUDE.md`:

- `pytincture/` — the framework that loads this widgetset (currently `1.0.0rc5` locally).
- `wAwesomeChat/` — the first real consumer: a multi-provider AI chat app. It is what the escaping
  rules below actually protect, and it is blocked on the missing wheel + manifest described under
  *Status* below. Its modules folder expects the dev wheel at
  `wAwesomeChat/src/wawesomechat/wapyt-99.99.99-py3-none-any.whl`.

## Structure

```
wapyt/
  _runtime.py        # Pyodide bridge: require_js, create_proxy, asset self-loading
  <widget>/          # one dir per widget:
    <widget>.py      #   Python wrapper — thin, forwards to the JS constructor
    <widget>_config.py  #  @dataclass config with .to_dict() → camelCase payload
  assets/            # the JS/CSS that actually renders; one file per widget + wapyt.css
    icons.js         #   shared icon resolution -> MDI; MUST load first (see Icons)
tests/               # *_demo.py = PyTincture demo apps · test_*.py = CPython unit tests
```

Every widget follows the same path: `Config` dataclass → `.to_dict()` → `json.dumps` →
`js.JSON.parse` → `js.wapyt.<Widget>.new(root, payload)`. Events go the other way through
`create_proxy`. The Python side holds no state — it's a typed facade over the JS object.

## How pyTincture chooses and loads this widgetset

Worth knowing before touching packaging, because none of it is configured anywhere obvious.

**Selection is automatic.** `discover_widgetset` (`pytincture/backend/browser_packages.py:601`)
AST-parses the app file, walks its top-level imports, and looks for module-level `__widgetset__` /
`__version__` string constants. `wapyt/__init__.py:5-6` declares them, so any app that does
`from wapyt... import ...` resolves to the pin `wapyt==0.1.0`. There is no config flag — the import
*is* the selection.

**The browser installs a wheel, not your checkout.** `installWidgetset`
(`pytincture/frontend/pytincture.js:1211`) micropip-installs the widgetset. A server-side
`pip install -e .` is irrelevant to it. With an application in play it resolves, in order:

1. a wheel served from `modules_folder`, at the pinned version **or** `PYTINCTURE_DEV_WHEEL_VERSION`
   (default `99.99.99`) — this is the dev loop
2. `BUILTIN_WIDGET_WHEEL_LOCKS`, which contains **only** `dhxpyt==0.9.18`
3. the public index — but only when `allowPublicWidgetIndex`, which is `!application`, i.e. false
   whenever a named app is being served

**Assets are hash-verified.** `loadWidgetsetAssets` (`pytincture.js:1269`) reads
`<package>/pytincture-assets.json` from the installed wheel and enforces: `schema == 1`, package and
version matching the installed distribution, every path owned by the distribution, and a SHA-256
match per file. Only then does it `js.eval` the JS and inject the CSS, **in manifest order**.

### Status: bootable (as of 2026-09-17)

Both missing pieces now exist and a real Chromium boot of `wAwesomeChat` reaches the `ready`
lifecycle stage with all nine constructors registered on `globalThis.wapyt`, and icons rendering.

- `scripts/generate_assets_manifest.py` — ported from `dhx_pytincture_widgetset`; declares the 9
  assets (`wapyt.css` + `icons.js` + seven widget JS) and hashes them. `--check` mode for CI.
- `scripts/dev_wheel.sh` — builds at `PYTINCTURE_DEV_WHEEL_VERSION` (99.99.99) from a temp copy,
  regenerates the manifest, drops the wheel into a modules folder.
- `MANIFEST.in` gained `include wapyt/pytincture-assets.json` — the existing
  `recursive-include wapyt/assets *` does not match a sibling of `assets/`.

```bash
./scripts/dev_wheel.sh ../wAwesomeChat/src/wawesomechat   # rebuild after ANY asset edit
python3 scripts/generate_assets_manifest.py . --check     # CI drift check
```

Load order is mostly free — each *widget* JS touches only its own `globalThis.wapyt.*` entry, with
no load-time cross-references — with one exception: `icons.js` must precede `sidebar.js` and
`chat.js`, which call `wapyt.icons` while rendering. pytincture evaluates strictly in manifest
order, so keep the list stable.

**Runtime deps were removed from `pyproject.toml`.** It declared `pyodide-py` and `itsdangerous`;
neither is imported (`pyodide.ffi` comes from the Pyodide runtime itself and `_runtime.py:21` already
soft-imports it). Left in place, micropip tries to resolve them in the browser at install time.
Keep `dependencies = []` unless something is genuinely imported.

### `require_js` was inverted

`_runtime.py` now checks `js.wapyt.<component>` **before** self-loading, via a `_component_ready`
helper. Previously `_load_assets()` ran unconditionally first; once pytincture's verified loader is
in play that re-evaluated all eight IIFEs, and any widget built between the two passes held a
superseded class object. `_load_assets` is now the offline fallback it reads like it was meant to be.

`require_js` was also re-enabled in `layout.py:41` and `resourceboard.py:48`, so an asset failure
raises the deliberate "assets failed to load" error instead of an opaque `AttributeError`. This
matters most for `Layout` — it is the first widget any app touches.

### Consuming apps need `APP_ENTRYPOINT`

pytincture resolves the browser entrypoint by AST, and its MainWindow detection
(`pytincture/backend/pages.py:_main_window_base_names`) is **hardcoded to `dhxpyt.layout.MainWindow`**
— it never matches a wapyt base. The only fallback is the convention "top-level name == module
name". `tests/*_demo.py` satisfy that by accident (class `layout_demo` in `layout_demo.py`); any
other app must declare `APP_ENTRYPOINT = "ClassName"` or startup fails with HTTP 422.

### Icons: MDI only, never ligature fonts

**Fixed 2026-09-17.** The symptom was button labels overwriting their buttons and each other: the
widgets rendered Material Symbols / Material Icons *ligature* spans
(`<span class="material-icons">send</span>`, where the text content IS the icon), and the
stylesheets for those fonts came from `fonts.googleapis.com` and `cdn.jsdelivr.net`. pytincture
serves `style-src 'self' 'unsafe-inline'`, so all three were blocked, and the spans typeset their
own names in Arial — "add_comment" is ~84px wide inside a 36px round button.

The rule that follows: **never add a ligature-based icon font.** It fails by rendering text, which
wrecks layout rather than just looking empty. pytincture already serves Material Design Icons from
its own origin (`frontend/vendor/materialdesignicons/`, MDI 7.4.47, 7448 classes) and injects it on
every page. MDI is class-based, so a missing glyph degrades to blank space.

`assets/icons.js` owns this. It exposes `wapyt.icons.iconClass / iconElement / iconMarkup` and maps
Material Symbols ligature names onto MDI classes, passing `mdi-*` values straight through and
falling back to `mdi-circle-small` for anything unmapped. **It must stay first among the scripts in
the asset manifest** — `sidebar.js` and `chat.js` call it during render, and pytincture evaluates
strictly in manifest order. This is the one real load-order dependency in the widgetset.

Adding an icon means adding a `LIGATURE_TO_MDI` entry, not a `<link>`. Validate new entries against
the vendored CSS — a class that does not exist there renders nothing:

```bash
python3 - <<'EOF'
import re
css = open("../pytincture/pytincture/frontend/vendor/materialdesignicons/materialdesignicons.css").read()
have = set(re.findall(r'\.mdi-([a-z0-9-]+)::before', css))
src = open("wapyt/assets/icons.js").read()
print([m for _, m in re.findall(r'^\s+([a-z_]+):\s*"([a-z0-9-]+)",', src, re.M) if m not in have] or "all present")
EOF
```

One straggler was fixed separately: `_updateSidebarToggleUi` still assigned a ligature name to
`iconEl.textContent`, leaving the raw string inside the sidebar toggle on top of the glyph. Icon
elements take a **class**, never text — `iconEl.className = wapyt.icons.iconClass(value)`.

`wapyt.css` carries a containment safety net (`width/height: 1em`, `overflow: hidden`) so that even
an unmapped icon or a failure to load MDI itself degrades to blank space instead of reproducing the
original overlap. Verified after the fix: 8 MDI elements, 0 ligature spans, `Material Design Icons`
font `loaded`, **0 CSP violations** (was 2).

### Chat model selection and persistence

`Chat` persists to `localStorage` under `options.storageKey` (the app passes
`"wawesomechat"`). **Without a `storageKey` the prefix gets a random per-instance id**
(`chat.js` `_storagePrefix`), so nothing survives a reload — that is the first thing to check if
persistence "doesn't work".

Which model is selected resolves in this order, in `_applyModelHierarchy`:

1. the **active chat's** `model` (restored with the chat list)
2. `<storageKey>:lastModel` — the last model the user explicitly picked
3. `options.defaultModel` — the app's configured default, for a first-ever visit
4. `availableModels[0]` — catalogue order, the last resort

Only an explicit pick (`_setSelectedModel(..., {persist: true})`) writes `lastModel` and sets
`_userPickedModel`; fallback selections deliberately do not. That flag also guards the
"catalogue grew" branch: apps load their provider list from a BFF *after* the widget first
renders, so the preferred model is often unavailable during the first `_applyModelHierarchy` and
gets replaced by `availableModels[0]`. When `setExtra` later brings the real catalogue, the
preferred model is re-applied — unless the user has since chosen something themselves.

Expose a new default through `ChatConfig.default_model` → `defaultModel`.

### Two classes, one widget — `ChatWidget` vs `WapytChatApp`

`chat.js` defines **two** classes and the split is easy to miss:

- **`WapytChatApp`** (~line 550) — the implementation: DOM, state, all the behaviour.
- **`ChatWidget`** (~line 3315) — the exported façade, and the only thing on `globalThis.wapyt`.
  It constructs `WapytChatApp(mount, options, this)` once the DOM is ready and passes itself as
  `host`.

Two consequences, both of which cost real debugging time:

1. **Methods do not proxy automatically.** `ChatWidget` forwards each public method to `this._app`
   by hand, with a `_pending*` slot for calls that arrive before the DOM is ready. A method added
   only to `WapytChatApp` is invisible to the Python wrapper — `self.chat.<name>` is `undefined`,
   which `chat.py`'s try/except then swallows into silence.
2. **Events must go through the host.** The EventBus the Python wrapper binds to is `ChatWidget`'s.
   `WapytChatApp` reaches it as `this.host.emit(...)` — which is how `send` and `artifact:save`
   already travel. `this.emit(...)` from inside `WapytChatApp` fires into a bus nobody is listening
   to.

Adding anything callable or observable means touching both classes.

### Push-to-talk voice capture

`ChatConfig(voice_input=True)` puts a hold-to-talk mic in the composer. **The widget only records** —
it emits the audio and leaves transcription to the app, so the widgetset needs no STT configuration
and works with any engine.

- `on_voice(handler)` → `{audio: <base64>, mimeType, bytes, durationMs}`; WebM/Opus in practice.
- `on_voice_error(handler)` → permission denied, no device, or a blocking Permissions-Policy.
- `set_composer_text(text, append=, submit=)` → deliver the transcript back.
- `voice_max_seconds` (default 120) caps a take, so a missed `pointerup` — alt-tab mid-press —
  cannot record until the page closes and blow the BFF body limit.

`pointerup` is bound on **`window`**, not the button: releasing after the cursor slides off the
button must still end the take. Base64 because the BFF transport is JSON.

**Two modes, two buttons** — mirroring Pantheon, and deliberately not one control that means both:

| | Hold-to-talk | Continuous (`voice_continuous=True`) |
|---|---|---|
| Control | press and hold | latching toggle |
| Boundary | button release | RMS energy VAD, `vad_silence_ms` of silence |
| Capture | MediaRecorder → WebM/Opus | raw PCM → WAV |
| Result | lands in the composer | **auto-submits** |

**Interim/streaming transcription was tried and removed.** Whisper is not a streaming model — each
call re-transcribes from the start, so earlier words visibly rewrite themselves as context arrives
("quick round is" → "quick brown fox"). It worked, and it was unpleasant enough not to keep. Do not
reintroduce it without a genuinely streaming engine.

Continuous capture taps **raw PCM off the AudioContext** the energy gate already needs, rather than
using MediaRecorder — Pantheon's reason, and it also removes every codec question since the server
decodes WAV through the same PyAV path. Details that matter:

- **Pre-roll** (`HF_PRE_ROLL`, ~0.7s): the gate only opens once speech is *already* audible, so
  without retaining preceding blocks every utterance loses its first syllable.
- **A suspended AudioContext returns silence.** One created outside a user gesture starts
  suspended, and a suspended `AnalyserNode` reads an RMS of 0 forever while the mic stream sits
  open looking perfectly healthy. `startContinuous` resumes it and refuses to arm unless
  `state === "running"`.
- **`ScriptProcessorNode` only runs when connected to a destination** — it is routed through a
  zero-gain node so the mic is not played back.
- **Peak logging once a second** (`[wapyt mic] peak 0.3998 / gate 0.015 OPEN`), straight from
  Pantheon: without it, "nothing happens when I talk" is indistinguishable between a dead mic, a
  suspended context, and too high a gate.

None of Pantheon's half-duplex, barge-in or `looksSelfHeard` machinery is here, because that exists
only to stop a mic hearing its own TTS. Adding TTS would bring all of it back.

**Requires a secure context and microphone permission.** pytincture denies device access by
default with `Permissions-Policy: microphone=()`, a browser-level block that no user consent
overrides; set **`PYTINCTURE_ALLOW_MICROPHONE=1`** (pytincture >= 1.0.0rc8) to opt in.
`http://127.0.0.1` counts as a secure context; `http://<lan-ip>` does not.

## Running

```bash
# demos — build the wheel into tests/ first
./scripts/dev_wheel.sh tests
cd tests && uv run layout_demo.py
# then http://localhost:8070/layout_demo  (or chat_demo / cardpanel_demo / tabs_demo)

# unit tests — CPython only, no browser, no demo dependencies
uv run --group dev pytest tests/
```

`tests/` is two things at once: `tests/pyproject.toml` declares it a separate uv project
(`wapyt-tests`) for the demo apps and their heavy deps — litellm, boto3, pytincture — while the
`test_*.py` files are plain unit tests that share none of it. Collection separates them by filename.

`uv` is at `/home/linuxbrew/.linuxbrew/bin/uv` (Homebrew). Host Python is 3.14.7.

`tests/pyproject.toml` now sources `pytincture` from `../../pytincture` so the demos run
against the local `1.0.0rc5`; a bare `>=` pin would not select a pre-release from PyPI.

## Widget conventions

**Escaping.** Model and remote data reach the DOM through these files, so the rules are load-bearing:

- Text → `textContent`. Markup → `innerHTML` only with an `escapeHtml()` call on every interpolated value.
- Template interpolation escapes by default. The documented opt-out is a **key ending in `Html`**
  (`{modelsHtml}`) — used by `ResourceBoard.detailTemplate`. CardPanel's descriptor engine takes an
  `escape` flag applied at markup destinations and deliberately *not* at `textContent`/`setAttribute`,
  where escaping would surface literal entities.
- Chat artifact chips are the one fragment injected unescaped. They carry a per-widget nonce
  (`chat.js:631`) so model output that merely *looks* like a chip still gets escaped. Never widen that
  to a class-name check — that was the original bug.
- `renderMarkdown` uses `marked` only when `DOMPurify` is also present; `marked` emits raw HTML.
- Artifact previews are `<iframe sandbox="allow-scripts">` fed by `srcdoc`. Never add
  `allow-same-origin` — with `allow-scripts` it cancels the sandbox entirely.

**Pyodide.** Never call `asyncio.run` — it creates and closes a second loop and breaks the WebLoop for
the session. Use `asyncio.ensure_future`. Proxies from `create_proxy` are never destroyed anywhere in
this codebase; `destroy()` methods clear the dict without calling `.destroy()`, so they leak.

**Backends.** Streaming proxies report failures *in-band* as `{"error": {...}}` chunks rather than
raising. `Chat.consume_stream` turns those into `ChatStreamError`; anything else consuming a stream
needs the same check or failures render as an empty message.

## Layout cell sizing (fixed 2026-09-23)

`CellConfig(width=...)` / `height=...` were **silently discarded**. The code set
`cellEl.style.flexBasis` and then `cellEl.style.flex = "0 0 auto"` — the
shorthand resets all three longhands, wiping the basis it had just assigned. So
every sized cell fell back to content width. In IguanaXterm that left the
terminal pane 81px wide with the remote PTY negotiated to 20 columns; it looked
like a terminal bug, not a layout one.

Sizing now goes through the shorthand in one statement, with the conventions
apps actually write:

- `"100%"` → `flex: 1 1 0` (take what is left). A literal `100%` flex-basis
  would demand the whole container and overflow any fixed sibling.
- `"auto"` → `flex: 0 0 auto` (size to content). This is what
  `CellConfig(id="mainwindow_header", height="auto")` in `MainWindow` needs —
  treating it as fill-remainder grows the header to half the window.
- anything else → `flex: 0 0 <size>`.

Cells also now get `min-width: 0; min-height: 0`, without which a flex item
refuses to shrink below its content and a terminal or table pushes the layout
wider instead of scrolling inside it.

Separately, `config.minSize` was being written to `style.minSize`, which is not
a CSS property, so the declared minimum never applied. It now maps to
`minWidth`/`minHeight` by axis.

## Modal sizing (fixed 2026-09-23)

`.wapyt-modal` and its header/body never declared `box-sizing`, so they were
`content-box` while carrying `padding: 1rem 1.5rem`. The body is a flex item of
the modal, so it stretched to a 560px *content* box and then added 48px of
padding on top — a 608px box inside a 562px parent. The content did not scroll,
it overflowed the dialog, because the overflow was on the body rather than in
it. A modal declared at `width=560` also rendered 562px, since the 1px border
sat outside too.

IguanaXterm's session editor is where it showed: nine fields running ~23px past
the rounded corner. Every modal had it; it was only obvious where the content
filled the width. All three chrome elements are now `border-box`.

Worth knowing when sizing a modal: the declared `height` is now honest, so
content taller than it scrolls inside the body rather than the modal growing.
The session editor needed 740px for nine fields plus the action row — at 640 the
Save button sat below the fold.

## Known rough edges

Not bugs to fix blindly — context for when they surface:

- **Three different `None` conventions** across the config dataclasses: `layout`/`chat`/`resourceboard`
  strip `None` via a `_clean` helper, `cardpanel` uses hand-written `if x is not None` chains,
  `sidebar` strips nothing and ships `"title": null`. Also means no optional field can be explicitly
  *cleared* — `None` means "omit", so the JS default wins.
- **Copy-paste**: `_resolve_root` duplicated 5×, `_clean` 3×, `_bind_event` 5× with three different
  argument-conversion behaviours. A `_base.py` mixin would remove ~150 lines.
- **Theming is split**: `wapyt.css` defines `--wapyt-*` tokens but only `modal.js` uses them (4 refs).
  `chat.js` and `sidebar.js` reference zero and hardcode palettes; `cardpanel.js` / `resourceboard.js`
  define their own private variable sets. No file uses `prefers-color-scheme`.
- **Debug prints at import**: `chat.py:14` and `cardpanel.py:12` write to stdout on `import wapyt`,
  with stale `WRAPPER_REVISION` cache-busters.
- `CardPanelConfig` defaults to `title="Data Sources"` with a description about lineage tracking —
  app-specific copy baked into a generic widget.
