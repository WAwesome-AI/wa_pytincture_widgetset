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

## Versioning, CI and releasing (added 2026-10-07)

**Version:** `0.2.0.dev0` since 2026-10-07, a PEP 440 development release on
the way to 0.2.0. 0.2.0 ships once the roadmap's parity items and the
Scheduler are done. The version lives in three places that must agree:
`pyproject.toml`, `wapyt/__init__.py` (`__version__`, a plain string literal
because pytincture reads it by parsing the file) and
`wapyt/pytincture-assets.json`. `tests/test_release_metadata.py` and the
release workflow both check. `__version_tuple__` holds the numeric release
part only, so pre-releases do not break `int()`.

**The asset manifest is now enforced.** It records the version and every
asset's SHA-256, and pytincture refuses a wheel whose manifest does not match.
Until this change it was never regenerated on `main` (every widget PR had
left it stale; apps never noticed because their browser wheel is the 99.99.99
dev wheel, built with a fresh manifest). **After changing anything in
`wapyt/assets/` or the version, run
`python scripts/generate_assets_manifest.py .` and commit the JSON**; CI
fails otherwise.

**CI** (`.github/workflows/ci.yml`, every push to main and every PR): unit
tests, `node --check` on every asset, the manifest `--check`, `uv build`, and
`scripts/check_dist.py`, which opens the wheel and sdist and verifies the
manifest version and every asset hash the way pytincture does, and that the
wheel declares no runtime dependencies.

**Stale manifests on PRs are fixed by CI** (added 2026-10-08). Two open PRs
that both touch `wapyt/assets/` leave the manifest stale as soon as one merges
and the other is updated from main (#49 failed that way). The `manifest` job
regenerates it, commits "Regenerate the asset manifest" as
`github-actions[bot]` to the PR branch, and lets the new commit's own run do
the testing (`test` stands down in the run that pushed). **Pull before pushing
more work to that branch.** The push uses the **`MANIFEST_BOT_TOKEN`** repo
secret (fine-grained PAT, this repo only, Contents: read and write).
`GITHUB_TOKEN` was tried first: its push started a `pull_request` run that
GitHub held as `action_required`, and the `workflow_dispatch` run used to work
around that passed but was not linked to the PR, which showed no checks.
Without the secret, on fork PRs, and on pushes to main, a stale manifest still
fails, with the command to run.

**Releasing** (`.github/workflows/release.yml`):

1. Set the version in all three places (for the release, drop `.dev0`), run
   the manifest script, merge.
2. Tag and push from `main`: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow checks that the tag equals all three versions, re-runs the
   checks, builds, verifies, publishes to PyPI by **trusted publishing** (no
   stored token), and creates a GitHub release with the files (marked
   pre-release for `aN` / `bN` / `rcN` / `.devN`).

**One-time setup, outside this repo:**

- **PyPI:** the `wapyt` project already exists (0.1.0, 2025-12-05, published
  from `schapman1974/wA_pytincture_widgetset`), so a **current owner of that
  PyPI project** must add a trusted publisher: owner `WAwesome-AI`, repository
  `wa_pytincture_widgetset`, workflow `release.yml`, environment `pypi`. (That
  0.1.0 still declares the `pyodide-py` / `itsdangerous` dependencies removed
  since.)
- **GitHub:** create the `pypi` environment in the repo settings (optionally
  with required reviewers, so a tag cannot publish unattended).
- **TestPyPI is not an option for rehearsals:** the name `wapyt` there belongs
  to an unrelated project (a WhatsApp library). Rehearse with a `.devN` tag
  on the real index instead; pip ignores it without `--pre`.

**Consumers:** Monguana and IguanaXterm build wapyt from source at a pinned
commit (`WAPYT_REF`), so the version number does not affect their builds;
their `vendor-wheels/wapyt-0.1.0-*.whl` and wAwesomeChat's `wapyt==0.1.0` pin
need updating when they move to 0.2.x.

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

## Resizable cells / splitters (added 2026-10-06)

`CellConfig(resizable=True)` puts a `Splitter` (`layout.js`) between that cell
and its next sibling (its previous one when it is last). One handle per
adjacent pair, made in `_buildCollection` after the siblings exist.

- **Placement costs nothing.** The handle is a flex item with negative margins
  of `(gap + 8px) / -2`, so it sits centred in the gap and the cells do not
  move. Its hairline (`::after`) shows on hover, keyboard focus and drag.
- **What a drag changes:** a cell with a declared size (or `"auto"`) gets
  `flex: 0 0 <px>`; a fill cell stays filling. Two fill cells split their
  *combined* flex-grow by the new sizes; writing raw px as grow made them
  swallow every other fill sibling. That keeps the ratio across a window
  resize. Bounds come from the computed `min-`/`max-width|height`
  (`min_size` / `max_size`, at least 48px).
- **Cells are `box-sizing: border-box` now.** As content-box, a 240px cell
  measured 242 with its border, so every drag grew it 2px; it also makes
  `width=` exact. Existing sized cells are 2px smaller than before.
- While dragging, the layout root gets `.wapyt-resizing`, which turns off
  `pointer-events` in cell bodies: an iframe (Chat artifacts) or xterm would
  otherwise swallow the pointer mid-drag. pointermove is rAF-throttled;
  Terminal's own ResizeObserver refits it.
- Keyboard: `role="separator"` with `aria-orientation` / `aria-valuenow` (the
  first cell's share), arrows ±10px (Shift ±50), Home/End to the limits,
  Enter or double-click resets both cells to their configured flex (and
  un-pins a cell `set_size` pinned).
- A hidden neighbour hides the handle (`_syncSplitters` on hide/show/setSize).
- Python: `Layout.on_resize` → `{id, size, sibling, sibling_size}` in px (the
  cells before and after the handle) for persisting; `set_size(id, size)` to
  restore; `get_size(id)` along the parent's axis.

`tests/splitters_demo.py` (sidebar, editor/console rows with an iframe, two
fill halves, gap 6); a 21-check Playwright run (no layout shift, drag across an
iframe, payload, min/max clamps, keyboard, reset, row direction, fill ratio
across a window resize, hide/show, set_size/get_size) passed.

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

## Modal events (added 2026-10-06)

`ModalWindow` used to fire nothing, so an app could not tell that × , Escape
or the backdrop had closed its dialog (to save a draft, or to drop a reference
to a disposed modal). Now `on_show`, `on_hide` → `{reason}` and `on_close` →
`{reason}`, where `reason` is `button` / `escape` / `backdrop` (the person) or
`code` (the app's own `hide()` / `close()`). A dismissal with
`dispose_on_close` fires `hide` then `close`; `close()` is idempotent and
nothing fires after it. `show()` on a visible modal does not fire again.
`is_visible()` added. No veto: wapyt's shape is act, then let the app react.

**Only the topmost visible modal answers Escape** (a module-level open stack,
re-ordered on `show()`). Every visible modal used to handle the same keypress,
so one Escape closed a whole stack. The × button also gained
`aria-label="Close"`.

`tests/modal_events_demo.py` (a reused modal and a disposable one stacked on
it); a 12-check Playwright run passed.

## Chart (added 2026-10-08)

`Chart` (`assets/chart.js`, `wapyt/chart/`, `Layout.add_chart`) wraps
**Chart.js 4.5.1, vendored** as `assets/vendor-chartjs.min.js` (MIT; its
licence is `assets/vendor-chartjs.LICENSE.md`). pyTincture's CSP is
`script-src 'self'`, so it cannot come from a CDN; as a manifest asset it is
hash-verified like the rest. It is the npm `dist/chart.umd.min.js` with only
the trailing `sourceMappingURL` comment removed (the map is not shipped).
Fetched from the npm registry with its sha512 checked against
`npm view chart.js@4.5.1 dist.integrity`. To upgrade: same steps, keep the
manifest order (vendor before `chart.js`, which only needs `globalThis.Chart`
at construction). It adds about 208 KB (70 KB gzipped) to every app's
assets; Chart.js runs under the CSP with no violations (checked).

**Sizing is the point.** The chart always fills its container
(`maintainAspectRatio: false`) and Chart.js's own ResizeObserver redraws it:
layout splitters, tabs becoming visible, containers that start at 0x0, and
gridstack tiles (resize, drag-resize, move, viewport reflow), all tested
with real gridstack 14. The canvas sits in `.wapyt-chart-canvas`
(`position: relative; min-width: 0; min-height: 0; overflow: hidden`), which
is what lets it shrink, not just grow, in flex and grid parents. gridstack
animates tile size over ~300ms and the chart follows a frame behind, so a
test must wait for the animation before measuring. `resize_delay` debounces
for heavy dashboards; `chart.resize()` exists for a resize-stop hook.

- **Compact mode:** under 280 x 180 px (a small tile) an automatic legend
  and the axis titles are dropped, decided at creation and in `onResize`
  (switched a frame later, since Chart.js is mid-resize there).
- **Palette and marks** follow the dataviz skill: its validated 8-hue
  categorical palette, light and dark steps, re-validated against wapyt's
  surfaces (`#ffffff` / `#0f172a`; all checks pass, three light slots under
  3:1 contrast, hence the always-present data table). Colours are keyed by
  series label (`_slots`), so `set_data` with a filtered list keeps each
  survivor's colour. A 9th uncoloured series (or pie slice) is refused in
  Python (`check_palette`); JS draws it grey with a warning. One value axis
  only: no dual-axis support on purpose. 2px lines, 4px points with a 2px
  surface ring, bars rounded at the data end, 2px surface gaps between pie
  slices and stacked segments, gridlines on the value axis only, legend for
  2+ series, tooltips in index mode for line / bar.
- **Theme:** a MutationObserver on `<html data-wapyt-theme>` rebuilds each
  chart. Recolouring in place left points with the light surface ring:
  Chart.js caches each element's resolved options. Rebuilds keep series
  visibility (`_keepVisibility`).
- **Accessibility:** the canvas is `role="img"` with a generated label; an
  off-screen `<table>` of the data is always there (`table_toggle=True`
  shows it in place of the chart). Text goes in as text; Chart.js draws on a
  canvas, so data cannot inject markup.

`tests/chart_demo.py`; a 36-check Playwright run passed: one context with
the CSP enforced (no violations), one with `bypass_csp` that injects a
sha512-verified gridstack 14 and builds a six-tile dashboard.

## Window (added 2026-10-08)

`Window` (`assets/window.js`, `wapyt/window/`) is dhxpyt's `window`: a
floating dialog, **non-modal by default**, separate from `ModalWindow` (which
stays the fixed centred dialog the apps build per use) rather than a mode of
it, so their flows are untouched.

- **Stacking:** a module-level `stack` (back to front); `restack()` gives
  z-index 9000+ (non-modal) or 9600+ (modal, with its backdrop one below), so
  windows sit under ModalWindow (9999), popups and menus. A capture
  `pointerdown` brings a window to the front and fires `focus`; a non-modal
  window cannot rise above an open modal one. `data-active` marks the top.
- **Move / resize:** pointer capture on the title bar or one of 8 invisible
  edge grips, rAF-throttled. `html[data-wapyt-window-drag]` turns off
  `pointer-events` on iframes and `.xterm` while dragging (a drag across the
  window's own iframe used to stop). `_clamp` keeps the title bar inside the
  viewport and at least 48px of the window on screen, also on window resize;
  sizes stay within `min_*` / `max_*` (max defaults to the viewport). A west
  or north drag keeps the opposite edge fixed. `move` / `resize` fire on
  release (not per frame) and only when something changed; `set_position` /
  `set_size` / `center` are silent.
- **Maximise** fills the viewport (inline `100vw` / `100vh`) and keeps the
  previous rect for `restore`; grips hide and moving stops. Button,
  double-click on the title bar, or Enter on it.
- **Keyboard:** the title bar has `tabindex=0`: arrows move 10px (Ctrl:
  1px), Shift+arrows resize. Escape closes the topmost window when it is
  modal, or when focus is inside a non-modal one; an Escape already handled
  (`defaultPrevented`, or stopped by a menu / combo) is left alone. A modal
  window traps Tab. `show()` moves focus to the first control (or the window)
  and `hide()` returns it to whatever had it.
- `setContent(string)` sets **text**, not HTML (ModalWindow's sets
  innerHTML). The header, body and footer are `border-box`: a Form mounted
  in the body makes it `width: 100%`, and content-box padding overflowed the
  window (caught in the screenshot).
- `footerEl` is always defined (null without a footer): Pyodide raises
  AttributeError reading a JS property that was never set, which is what
  `Window.footer` first did.

`tests/window_demo.py`; a 45-check Playwright run passed, and the
ModalWindow events (12) and Message (29) suites still pass.

## Tree context menus by node kind (added 2026-09-25)

`TreeAction(kinds=["server", "database"])` shows an entry only on nodes whose
`data["kind"]` is listed; it combines with `scope`. Added for Monguana, whose
branches are different things (a server, a database) needing different menus —
`scope` alone only knows branch vs leaf. Separators that end up between two
hidden groups (or first/last) are hidden too, so per-kind groups need no
bookkeeping. Kinds travel to the DOM joined with U+001F.

`TreeAction(requires=["rename"])` (2026-09-30, Monguana phase 39) shows an
entry only on nodes whose `data["flags"]` list holds **every** name given; it
combines with `kinds` and `scope`. For per-node features `kinds` cannot
express: Monguana puts what a connection's backend supports into each node's
flags, so a tinymongo collection has no *Rename*. A node without `flags` shows
no entry that has `requires`.

## Tree keyboard, checkboxes and drag-and-drop (added 2026-10-08)

`tree.js` was rewritten around three additions; rows are still a flat list
of `.wapyt-tree-row[data-node-id]` (the apps' smoke tests select on that),
clicks still select and toggle, and the context menu is unchanged.

- **Keyboard / ARIA (there was none):** the scroller is `role="tree"`
  (`TreeConfig(label=)` names it), rows are `treeitem`s with
  `aria-level` / `aria-posinset` / `aria-setsize` (the flat-tree form: a
  `role="group"` wrapper would have to sit inside the treeitem and change the
  DOM), `aria-expanded`, `aria-selected`, `aria-checked`. One roving tab stop
  (`_focusId`). Up/Down, Home/End, Right opens or enters, Left closes or goes
  to the parent, Enter activates a leaf or toggles a branch, Space checks (or
  selects), Shift+F10 / Menu opens the context menu. **Every change
  re-renders the rows**, so `_renderNodes` re-focuses the tab-stop row when
  focus was inside the tree before.
- **Checkboxes** (`checkboxes=True`): with `check_cascade` (default) only
  leaves hold state (`_checked`); a branch is checked / mixed / unchecked
  from its leaves (`_checkState`) and checking it sets all of them. Without
  cascade every node is independent. The box is an `aria-hidden` input that
  only takes clicks (the row is the control). `TreeItem(checkbox=False)`
  leaves a same-width gap so icons stay aligned. `setItems` keeps checks for
  ids that still exist and adds items marked `checked`.
- **Drag and drop** (`draggable=True`): pointer events with a 5px threshold,
  a ghost in `<body>`, a drop line positioned in the scroller (now
  `position: relative`), or an inside highlight for a branch's middle half.
  A closed branch hovered for 650ms opens (`_renderDuringDrag` re-attaches
  the line). Just below an **open** branch drops as its first child (that is
  what the line looks like). Rows in the dragged subtree are never targets.
  `droppable=False` refuses children, `draggable=False` pins, and
  `drop_into_leaves` lets a leaf become a branch. Escape cancels; the click
  ending a drag is suppressed; dragging pauses while filtered.
- **Keyboard moves:** Alt+Up/Down among siblings, Alt+Right into the
  sibling above (last child), Alt+Left out after the parent; announced in a
  per-tree `aria-live` region.
- `_applyMove` mutates the item arrays and reindexes (an emptied branch
  becomes a leaf). Moves from code (`move()`, used to revert a refused
  drop) pass `force` and skip the drop rules (a refused drop may need to go
  back into a now-empty parent) but never allow a cycle. `on_move` →
  `{id, node, from_parent, from_index, to_parent, to_index}`;
  `get_items()` returns the current structure.
- No duplicate-id check: Monguana's document view builds ids from key paths,
  and a key containing `/` can repeat one; raising would blank the view.

`tests/tree_dnd_demo.py`; a 55-check Playwright run passed, and the
ContextMenu (29), Popup (29) and tree-tooltip (3) suites still pass.

## DataTable column resize and reorder (added 2026-09-25)

Opt-in: `DataTableConfig(resizable_columns=True, reorderable_columns=True,
min_column_width=48)`. A drag on a header's right edge resizes; dragging a
header (HTML5 drag and drop) onto another moves it before or after, by which
half it is dropped on. Both emit `columns` →
`{reason: "resize"|"reorder", column, columns: [{id, width}]}`
(`DataTable.on_columns`); `get_column_state()` and `move_column()` exist too.
The table keeps the widths in `options.columns`, so `set_columns` with widths
restores a layout. Added for Monguana, which saves layouts per collection.

- **Once any column is resized every column gets a pixel width** (the
  current rendered ones) and the table takes their sum instead of stretching
  to 100%, which is what keeps a dropped edge where it was dropped; a table
  wider than its panel scrolls sideways.
- **Resizable tables are `box-sizing: border-box`** (`[data-resizable]`), so
  a measured header width can be written back unchanged. Content-box added
  the 20 px of padding to every column on each freeze. Scoped, so column
  widths in tables that do not opt in keep their old meaning.
- **The grip sits inside its header.** It used to overhang by 4 px, and each
  sticky header is its own stacking context, so the next header painted over
  the overhang and a press there started a column drag.
- A resize swallows the grip's click so it does not sort, and a column drag
  cannot start while a resize is in progress.

## DataTable per-cell icons (added 2026-09-29)

`ColumnConfig(icon_by="<row key>")` draws the MDI class in that row key as a
small glyph (`.wapyt-datatable-cell-icon`) before a text cell's value;
`<row key>_title` is its tooltip, the same convention as `type="icon"`
columns. A row without the key renders plain text. Added for Monguana's BSON
type markers; style per icon by targeting the MDI class.

## DataTable row/cell classes and hidden columns (added 2026-10-06)

**Classes.** `DataTableConfig(row_class_by="key")` adds the class names in
`row[key]` (a space-separated string or a list) to each `<tr>`;
`ColumnConfig(css=...)` adds static classes to a column's `<th>` and cells;
`ColumnConfig(cell_class_by="key")` adds per-row classes to that column's
cell. The older, undocumented `row["_class"]` still works. Every token goes
through `classTokens()`: only `/^-?[A-Za-z_][\w-]*$/` tokens are added, one at
a time, so a value from data can never throw in `classList.add` or reach an
attribute. `_fillCell` re-applies column and cell classes on every redraw
(edits, `set_cell`), so its old `td.className = "...ellipsis"` became a
`classList.add`.

**Hidden columns.** `ColumnConfig(hidden=True)`, `hide_column`,
`show_column`, `set_column_hidden`, `is_column_hidden`. Hidden columns stay in
`options.columns` (place, width, settings), so showing one puts it back where
it was; `_visibleColumns()` is what renders, filters, freezes, edits, sums
widths and exports by default (`to_csv(columns=[...])` can still name a
hidden one). The filter ignores hidden columns because their text cannot be
seen. `get_column_state()` and the `columns` event now carry `hidden`, and
hide/show emit `columns` with `reason: "hide" | "show"`, so a saved layout
restores visibility too.

`tests/datatable_classes_demo.py`; a 14-check Playwright run passed.

## DataTable inline editing (added 2026-10-06)

`ColumnConfig(editable=True, editor=..., options=..., required=...)`; editors
are `text` (default), `number`, `select`, `checkbox`, `date`.

- **Starting:** double-click an editable cell (anywhere else still fires
  `activate`), or on a focused cell press Enter/F2 or just type (text and
  number start with that character). Editable cells use a roving tabindex:
  one tab stop for the whole table, arrows move between editable cells.
- **Finishing:** Enter saves and keeps focus on the cell; Tab / Shift+Tab save
  and move (off the end of a row onto the next); Escape cancels and stops
  propagation (an enclosing modal stays open); blur saves, or drops an invalid
  value rather than trapping focus. Enter/Tab on an invalid value keep the
  editor open with the message as its tooltip ("Must be a number", "<Header>
  is required").
- **Saving** mutates the row, redraws only that cell (`_fillCell`), and emits
  `edit` with `{id, column, value, old_value, row}`; `value` is typed (number
  or None, bool, string, date `YYYY-MM-DD`). The row does not re-sort until
  the next sort / filter / `set_rows`.
- **Server refusal:** `set_cell(id, col, old_value)` (no event) and
  `set_cell_error(id, col, message)`: red inset, `aria-invalid`, the message
  as the cell's tooltip (overflow-only is turned off for it). Errors are kept
  in `_cellErrors`, survive re-renders, and clear on the next good edit.
- A re-render while an editor is open (`set_rows`, a header sort) saves it
  first. Clicks inside the editor are ignored by `_onRowClick`.
- `checkbox` columns render real checkboxes; click or Space toggles and saves.
  `select` columns display the option label for the stored value.

**Selection no longer re-renders the body.** Every row click used to call
`_refresh()`, which re-sorted the view: a row edited out of sort order jumped
away between the two clicks of a double-click (activating the wrong row), and
focus dropped to `<body>`. Clicks, Ctrl/Shift ranges, row checkboxes,
select-all, `select()` and `clear_selection()` now go through
`_syncSelection()`, which repaints `data-selected` and the checkboxes in place.

`tests/datatable_edit_demo.py`; a 30-check Playwright run (every editor,
keyboard, tab stop, validation, refusal round-trip, no jump, mid-edit
re-render, edit_cell on a new row, modal Escape, dark) plus 7 selection
regression checks passed.

## DataTable frozen columns (added 2026-10-06)

`DataTableConfig(frozen_columns=N)` / `set_frozen_columns(n)`, dhxpyt's
`leftSplit`. The multi-select checkbox column freezes with them.

- `_applyFrozen` gives the first N header and body cells `data-frozen`
  (`"last"` on the edge) and `left` = the summed header widths before them.
  Header widths are authoritative under `table-layout: fixed`; body cells copy
  the offsets. It runs after every body render, so sorts, `set_rows` and
  edits keep it.
- A ResizeObserver on the frozen header cells (`_observeFrozen`, re-armed per
  head render) recomputes offsets when a column is dragged wider or the
  panel resizes; rAF-throttled.
- **Sticky cells must be opaque** or scrolled cells show through, so frozen
  cells carry `--wapyt-bg` and repeat the row's hover and selected tints as
  solid layers (`linear-gradient(tint, tint), var(--wapyt-bg)`), in both
  themes. Frozen headers sit at z-index 3 so the top-left corner stays on top
  when scrolling both ways.
- `data-scrolled-x` on the host (scroll listener) adds the edge shadow only
  once something is underneath; the 1px edge line is always there.
- The table only scrolls sideways once column widths add up to more than the
  panel (fixed widths or `resizable_columns`).

`tests/datatable_frozen_demo.py` (12 columns at 720px, multi-select,
resizable); a 15-check Playwright run (offsets, scroll in both axes,
paint order, opaque selected/dark cells, resize moving offsets, sort,
editing a frozen cell while scrolled, set_frozen_columns 0/3) passed.

## DataTable CSV export (added 2026-10-06)

`to_csv(...)` returns the text; `export_csv(filename, ...)` downloads it
through a Blob and an `<a download>` (pytincture's CSP allows it; the same
pattern as `filetransfer.downloadViaAnchor`) and returns the row count.

- **What is exported is what is shown:** `_view` (filtered, sorted) and
  `options.columns` order, which reordering updates. `selected_only`,
  `columns=[ids]` (picks and orders; icon columns are skipped unless named),
  `raw` (stored values instead of a select column's labels), `header`,
  `delimiter`.
- RFC 4180 quoting (delimiter, quotes, CR/LF, leading/trailing space), CRLF
  line ends, objects as JSON, booleans as `true`/`false`, None empty.
- **`safe=True` (default) guards CSV injection:** text starting `= + - @`, tab
  or CR gets a leading `'` so Excel/Sheets keep it as text. Numbers, and
  strings that are plain numbers (`-5`, `1e3`), are left alone; `-2+3` is not.
- `export_csv` prepends a UTF-8 BOM (`bom=False` to drop it) so Excel reads
  accents; the count comes from the rows, not by splitting the text, since a
  quoted cell can hold newlines.

`tests/datatable_csv_demo.py`; a 16-check Playwright run (parsed back with
Python's `csv`: order, quoting, newlines, accents, injection guard, raw/safe,
columns, delimiter, filter, reordered column, real downloads with BOM and
filename, selected-only, counts, no CSP errors) passed.

## Sidebar groups (added 2026-10-06)

`SidebarItem(items=[...])` is a group: it expands and collapses instead of
being selected, and groups nest (indent via `--wapyt-sidebar-depth`). New
entries: `SidebarHeading(label)`, `SidebarSeparator()`, `SidebarSpacer()` (a
flex-grow block that pushes what follows, e.g. Settings, to the bottom).
Items also take `disabled` and `tooltip`; `badge` may be an int (`0` shows).

- `setActive` opens every group above the active item and marks them
  `data-has-active`, which tints a closed group so the rail shows where the
  active item lives. `aria-current="page"` is on the active item.
- **Collapsed rail:** labels, chevrons, headings and child groups hide;
  top-level items without an icon show their label's first letter; badges
  shrink to a corner dot-count. A group click opens its children in a
  `wapyt.Popup` flyout (`placement: right-start`, class
  `wapyt-sidebar-flyout`), nested groups listed open inside it; Escape closes
  it and focus returns to the group.
- Keyboard: Up/Down/Home/End over visible, enabled items; Right opens a group
  then enters it; Left closes it, or from a child goes to its group.
- `on_toggle` → `{id, expanded, expanded_ids}` (only for the person's
  clicks/keys); `get_expanded` / `set_expanded` / `SidebarConfig(expanded=)`
  persist and restore the tree. `set_items` re-renders keeping open groups and
  the active item; `set_badge(id, None)` clears a badge.
- **Its CSS moved from a `<style>` sidebar.js injected into `wapyt.css`**, on
  the `--wapyt-*` tokens (it used hardcoded rgba colours and its own dark
  values). The `<svg` raw-markup icon path is kept for app-authored icons only.
- `Sidebar._bind_event` kept one proxy per event name, so a second handler
  replaced the first in the dict while both stayed registered; it is a list
  now, and `destroy()` releases them.

No app used wapyt's Sidebar yet (wAwesomeChat's notes refer to dhxpyt's), so
the restructure needed no migration. `tests/sidebar_demo.py`; a 24-check
Playwright run (structure, ARIA, indentation, toggle events, nested select and
ancestor marks, disabled, badges, spacer, keyboard, set_items preserving
state, the rail, rail tooltips, flyout pick and Escape) passed.

## Listbox (added 2026-10-07)

`Listbox` (`assets/listbox.js`, `Layout.add_listbox`) is the base for Kanban:
rich items, live widgets inside items, and drag-and-drop within and between
lists sharing a `group`.

- **Item anatomy.** One `<li>` per item: `.wapyt-listbox-content` (redrawn by
  `update_item`; text fields via textContent, or `template` with `{key}`
  escaped and `{keyHtml}` raw, ResourceBoard's convention),
  `.wapyt-listbox-body` (**never redrawn**; `item_body(id)` hands it out for
  mounting widgets) and `.wapyt-listbox-actions` (`ListAction` buttons).
  Moves relocate the `<li>` node itself, so widgets in the body survive a drag
  into another list; the receiving list re-fills content and actions with its
  own template and actions (`_adopt`).
- **ARIA.** `role="list"` / `"listitem"`, not listbox/option: an option may not
  contain interactive content. Selection is announced with hidden text, and a
  per-list `aria-live` region narrates keyboard moves.
- **Interaction does not fight the drag.** Presses on `INTERACTIVE` elements
  (buttons, inputs, links, `.wapyt-listbox-nodrag`, anything inside the body
  but the body itself) neither select nor start a drag; a drag needs 5px of
  movement and, with `drag_handle`, the grip. The click that ends a drag is
  suppressed.
- **Pointer drag.** The dragged `<li>` leaves the flow (`data-dragging="true"`
  → `display: none`) and a placeholder takes its exact place. The first
  version kept the item faded *and* added a placeholder, which doubled the
  space, so the item under the pointer moved a row and every within-list drop
  snapped back. `_itemEls()` / `_order()` skip the placeholder (it shifted
  every index by one). A `copy` source keeps its item visible
  (`data-dragging="copy"`) and does not reorder. The ghost lives in `<body>`
  and carries its own font and colours. Escape cancels; auto-scroll near the
  list edges; dragging pauses while a filter is active.
- **Keyboard move.** With `draggable`, Space lifts (Ctrl+Space then selects),
  Up/Down move, Left/Right hand the item to the neighbouring list of its group
  (`groupOrder`: document order), Space/Enter drops, Escape returns it.
- **Act, then revert.** `move` fires on the list the item lands in with
  `{id, item, from_list, to_list, from_index, to_index, copy}`
  (`list_id`, else `label`); `move_item(id, index, to=)` puts a refused drop
  back without an event. When moving between lists, insert first and then
  update the source (its empty state and tab stop must see the item gone).
- Ids are unique per list; a copied item keeps its id in the target.

Not built yet: virtual rendering for very long lists.

`tests/listbox_demo.py` (four lists in one group: filter + multi-select +
actions, live ProgressBar and a button in an item body, a template with an
Html key, a copy-only library, a refused move); a 26-check Playwright run
passed.

## Kanban (added 2026-10-07)

`Kanban` (`assets/kanban.js`, `Layout.add_kanban`) is a row of columns, each
a header plus a `wapyt.Listbox`, all in one private drag group
(`wapyt-kanban-<n>`). Cards are Listbox items, so templates, `card_body`
widgets, actions and keyboard moves come from Listbox; kanban.js only adds
the board. It talks to Listbox through its public methods, plus setting
`list.options.accept`.

- **Counts and WIP.** `_refresh(col)` after every move / add / remove writes
  "n" or "n / limit" and sets `data-full` (amber) / `data-over` (red).
  `wip_strict` makes a full column refuse drops by turning its Listbox's
  `accept` off, so the placeholder never appears there (no revert needed);
  the column still reorders its own cards, and `add_card` from code can
  exceed the limit (then it shows red). A collapsed column also has
  `accept` off.
- **Events.** Listbox `move` → board `move` `{id, card, from_column,
  to_column, from_index, to_index}`; `move_card` reverts silently. Selection
  is single across the board: a `select` in one column clears the others
  under a `_quiet` guard so the clears do not re-emit.
- **Columns.** Header drag (pointer, 5px threshold, drops before the first
  column whose centre is right of the pointer) or Alt+Left / Alt+Right on a
  focused header; `on_column_move` with the new order; `move_column` is
  silent for restoring a saved order. Collapse turns a column into a 44px
  strip with a vertical title.
- `--wapyt-kanban-accent` (per-column `color`) is the top edge. The dark rule
  sets `border-color`, which reset that edge; it sets `border-top-color`
  back.
- Card ids are unique across the board (checked in `KanbanConfig.to_dict`).
- Not built yet: swimlanes.

`tests/kanban_demo.py`; a 20-check Playwright run passed.

## Base font (added 2026-10-06)
`--wapyt-font-family` (in `wapyt.css` `:root`, a system-UI stack) is applied to
`.wapyt-layout` and `.wapyt-modal`. Before it, neither set a font, so cell
headers, `attach_html` content and every modal title fell back to the
browser's serif default; Monguana and IguanaXterm each carried a
`.wapyt-modal{font-family:…}` rule to cover it. The modal needs its own
declaration because it is mounted on `<body>`, outside any layout. Restyle by
overriding the property, not by styling `body` — the layout no longer
inherits from it.

## Message: toasts and dialogs (added 2026-10-06)

`wapyt.message` (`assets/message.js`, `globalThis.wapyt.Message`) replaces the
`_toast()` helpers Monguana and IguanaXterm each wrote and their
`window.confirm()` calls. Module functions, like `filetransfer`: `toast(text,
kind, timeout_ms)`, `dismiss`, `dismiss_all`, and the coroutines `alert`,
`confirm` (→ bool) and `prompt` (→ str | None). The JS `dialog()` returns a
Promise of `{ok, value}`, which the Python side awaits.

- Everything goes in through `textContent`; `white-space: pre-line` keeps the
  "Question?\n\nConsequence." shape the apps' confirms already use.
- Cancel, Escape and a backdrop click never confirm. `danger=True` starts focus
  on Cancel so Enter cannot destroy anything. Tab is trapped in the dialog and
  focus returns to the trigger on close. Only the topmost of stacked dialogs
  handles keys.
- `prompt(..., password=True)` masks the input with `autocomplete="new-password"`,
  so the browser does not fill a saved password into a reset field.
- Toasts: bottom-centre stack, at most four (oldest goes), `timeout_ms=0` is
  sticky, hover pauses the timer. Errors get `role="alert"`, the rest
  `role="status"`.
- Theming uses the `<html>` `data-wapyt-theme` ancestor selector rather than
  stamping the attribute on the overlay as `modal.js` does, so a theme change
  applies to an open dialog too.

`tests/message_demo.py` drives every path; a 29-check Playwright run against it
(results, keys, focus trap/restore, escaping, toast cap/timers, dark theme)
passed.

## Toolbar (added 2026-10-06)

`Toolbar` (`assets/toolbar.js`, `Layout.add_toolbar(id="mainwindow_header", ...)`)
replaces the toolbars Monguana and IguanaXterm built from HTML. Items:
`ToolbarButton`, `ToolbarText`, `ToolbarSeparator`, `ToolbarSpacer`.

- Buttons take `variant` (`primary` / `accent` / `danger`), `toggle=True`, or
  `group="..."` for one-of-several choices (IguanaXterm's tabbed/tiled switch);
  pressed state is `aria-pressed`. `on_click` → `{id, group, active}`.
- `hidden=` plus `set_hidden` / `set_text` / `set_badge` cover the buttons the
  apps show and relabel at runtime ("Reconnect 3", "Update 2.4.0"); a
  `ToolbarText` holds the signed-in user's name.
- **Compact mode** (`compact="auto"`): a ResizeObserver drops labels to icons
  once the labelled toolbar overflows, remembering the labelled width so it
  expands again only when that fits. Labels stay as `title` and the
  accessible name. `keep_label=True` exempts a button; a button with no icon
  always keeps its text.
- WAI-ARIA toolbar keyboard model: one tab stop, arrows/Home/End move.
- `on_click` payloads have real `None` for a plain button's `group` /
  `active` (see *JsNull* below).

`tests/toolbar_demo.py` reproduces IguanaXterm's toolbar; a 26-check
Playwright run against it passed.

### Dropdown and split buttons (added 2026-10-08)

`ToolbarButton(items=[MenuItem...])` is a WAI-ARIA menu button: it opens a
`wapyt.ContextMenu` (class `wapyt-toolbar-menu`) under itself instead of
firing `click`, so submenus, shortcuts, separators, checkable and group items
come from ContextMenu. `split=True` keeps the button a command and adds an
arrow button (`.wapyt-toolbar-arrow`, `data-part="arrow"`, same `data-id`)
inside a `.wapyt-toolbar-split` wrapper; the wrapper is what hides, and the
menu is placed under the whole wrapper.

- The element that opens the menu is `entry.opener` (the button, or the
  arrow) and is the menu's `owner`, so pressing it while open closes the menu
  instead of the document listener closing it and the click reopening it.
  The opener is focused **before** `showAt`, which is what ContextMenu
  returns focus to on close.
- Keys on an opener: Enter / Space / ArrowDown open on the first item,
  ArrowUp on the last. Inside the menu, Left / Right at the top level
  (`onEdge`) close it and move along the toolbar, opening the neighbour if it
  is also an opener (a split arrow counts), as in MenuBar.
- Events: `select` → `{id, menu, checked?}` (`menu` is the button id),
  `open` → `{id}`. Dropdown buttons never fire `click`; a split's main part
  does.
- Button ids and every menu item id share one namespace (checked in
  `ToolbarConfig.to_dict`), so `set_disabled` / `set_hidden` / `is_*` route an
  unknown toolbar id to the dropdown holding it (`_menuFor`). Plus
  `set_checked`, `set_menu_items` (an empty menu does not open),
  `open_menu`, `close_menu`, `is_menu_open`.
- A dropdown cannot be `toggle` / `group` unless split; `split` needs `items`.
- The chevron (`mdi-menu-down`) stays in compact mode.

`tests/toolbar_dropdown_demo.py`; a 48-check Playwright run (ARIA,
escaping, open / close / reopen, focus return, every key, submenus, Left /
Right across dropdowns and a split arrow, checkable and radio items, split
click vs arrow, outside press, switching menus, empty and refilled menus,
disabled and hidden menu items, hidden split, open_menu, one tab stop,
viewport clamp at the right edge, compact, dark) passed, and the Toolbar (26),
ContextMenu (29) and MenuBar (26) suites still pass. The Toolbar suite's
"tooltip keeps label" check read `title`, which tooltip.js (#36) moves into
`data-wapyt-tooltip` on first hover; it now accepts either.

## ContextMenu (added 2026-10-06)

`ContextMenu` (`assets/contextmenu.js`) is a standalone right-click menu:
`MenuItem(id, label, icon, shortcut, danger, disabled, items, separator)`,
submenus via `items`. Not mounted in a cell.

- `attach(target, context)` opens it on right-click, Shift+F10 or the Menu
  key; the payload's `target` is the `data-context` of the nearest such
  ancestor of the click (a row id). `show_at(x, y, context=, hide=[], disable=[])`
  is the per-opening form; `hide`/`disable` replace what Tree does with
  `kinds`/`requires`. `on_select` → `{id, context, target}`.
- WAI-ARIA menu: focus moves in, arrows/Home/End/Enter/Escape, ArrowRight
  opens and ArrowLeft closes a submenu, focus returns to the opener. Disabled
  items stay focusable but cannot be chosen.
- Separators that would lead, trail or double up after hiding are dropped.
- One menu open per page; document listeners are added on open and removed
  on close. Positions clamp to the viewport; submenus flip left at the edge.
  Window blur closes it too.
- `menuClass` / `itemClass` add class names beside `wapyt-cmenu*`, and an
  item's `data` dict becomes `data-*` attributes, so a widget moving onto it
  keeps its old selectors.

**Tree, DataTable and Terminal use it** (2026-10-06). Their old menus had
Escape as the only key, no focus handling, and a document `keydown` listener
per instance that was never removed. `TreeAction` / `TableAction` and the event
payloads are unchanged. Each action gets an internal id (`a0`, `a1`…) because
apps reuse ids such as `delete` within one table; Tree computes the per-node
`hide` list from `scope` / `kinds` / `requires`. The panels keep
`wapyt-tree-menu` / `wapyt-datatable-menu` / `wapyt-terminal-menu` and the items
`data-action-id` (Tree, DataTable) or `data-action` (Terminal), which the apps'
smoke tests select on. Terminal's Copy is disabled per opening without a
selection; the menu sits on `<body>`, so a click never reaches xterm, and
Escape is consumed instead of going to the shell. The old menu CSS is gone.

`tests/contextmenu_demo.py` drives it; a 29-check Playwright run passed (this
said 30 until 2026-10-07; the suite has 29).

**Persistent item state and checked items (added 2026-10-07, for MenuBar).**
`set_disabled(ids)` / `set_hidden(ids)` / `is_*` keep state across openings
(`showAt(hide=, disable=)` still adds to it for one opening; `disabled=False`
overrides an item's own `disabled`). `MenuItem(checkable=True)` is a
`menuitemcheckbox` and `MenuItem(group="...")` a `menuitemradio`; choosing
flips / checks it and `select` carries `checked`. `set_checked` is silent. The
tick or radio dot is drawn in the icon slot (`.wapyt-cmenu-check`). Two
JS-only options serve MenuBar: `owner` (an element whose presses are not
"outside") and `onEdge(dir)` (Left / Right at the top level). `_findItem` /
`_groupMembers` recurse with `item.items || []`: passing `undefined` re-used
the default parameter (`this._items`) and recursed forever, which the first
MenuBar run caught.

## MenuBar (added 2026-10-07)

`MenuBar` (`assets/menubar.js`, `Layout.add_menubar(id="mainwindow_header")`)
is a WAI-ARIA `menubar`: top-level `MenuItem`s with `items` open a
`wapyt.ContextMenu` dropdown (class `wapyt-menubar-menu`, placed flush under
the title); one without `items` is a plain command (`select` with
`menu: None`). One tab stop; Left/Right/Home/End on the bar, Down/Enter/Space
open; inside a dropdown Left/Right at the top level move to the neighbouring
menu (`onEdge`), plain commands and disabled titles just take focus; once a
menu is open, `pointerenter` on another title switches to it. Each dropdown
is created with `owner: bar`, so clicking the open title closes it instead of
the document listener closing and the click reopening it. State methods
(`set_disabled`, `set_hidden`, `set_checked`, `is_*`) find the dropdown that
holds the id; top-level titles keep their own hidden/disabled state.
`on_select` → `{id, menu, checked?}`, `on_open` → `{id}`. Ids must be unique
across the whole bar; separators are not allowed at the top level.

`tests/menubar_demo.py`; a 26-check Playwright run passed, plus the 29-check
ContextMenu suite against the same build.

Toolbar and ContextMenu separators use `--wapyt-divider` / `--wapyt-divider-dark`
(#cbd5e1 / #475569). The border tokens they first used were invisible as a
line in dark mode: `--wapyt-border-dark` on `--wapyt-surface-dark` is 1.00:1.

## Popup and tooltips (added 2026-10-06)

**Tooltips** (`assets/tooltip.js`, loaded right after `icons.js`) are one
shared `role="tooltip"` element driven by delegated document listeners, not a
per-widget feature:

- Any element with `data-wapyt-tooltip` gets one (`tooltip(el, text)` and
  `tooltip_attr(text)` for string-built markup set it).
- **Any wapyt-built element with a native `title`** (a class starting
  `wapyt-`) is upgraded the first time it is pointed at or focused: the title
  moves into `data-wapyt-tooltip`, so the browser's own tooltip never doubles
  ours. That is how Toolbar, DataTable, Tree and Sidebar got styled tooltips
  without changing. An icon-only control whose title was its only name keeps
  it as `aria-label`. An app's own markup keeps native titles unless it opts in.
- `data-wapyt-tooltip-overflow` shows it only when the text is cut off. The
  upgrade sets it on `*-ellipsis` elements (DataTable cells), and tree.js sets
  it on labels without an explicit `node.tooltip`, so neither repeats text
  that is already fully visible.
- Hover shows after 450ms, then instantly for 400ms after one hides
  (moving along a toolbar); keyboard focus (`:focus-visible`) shows at once,
  a mouse-click focus does not. Escape, a press, scroll or blur hides it.
  `aria-describedby` points at the tooltip only while it is shown.
  `set_tooltips_enabled(False)` turns them all off.

**Popup** (`assets/popup.js`) is an anchored `role="dialog"` popover: content
goes in `popup.body` (mount a Form there) or `set_text`. It lives in `<body>`
while open (`position: fixed`, z-index 10030: above modals, below menus,
combo lists and tooltips), placed by `placement` (`bottom`/`top`/`left`/`right`,
`-start`/`-end` align an edge), flipping to the opposite side, or whichever has
more room, then clamped to the viewport. Anchors: element, selector or
`(x, y)`.

- Escape closes it and returns focus to the anchor; it stops propagation, so
  an enclosing ModalWindow stays open. A combo inside handles its own Escape
  first.
- An outside press closes it without stealing focus back. Presses on the
  anchor (so `toggle` works from its click) and on `.wapyt-form-combo-list` /
  `.wapyt-cmenu` (opened from inside, but living in `<body>`) do not count.
- The anchor gets `aria-expanded`, `aria-controls` and `aria-haspopup`.
- It follows the anchor on scroll/resize and closes if the anchor leaves the
  page.

`tests/popup_demo.py`; a 29-check Playwright run (delay, warm hand-off,
literal text, aria-describedby, app titles untouched, tooltip_attr and
tooltip() placements, truncated vs fitting cells, keyboard, Escape; popup
placement, focus in and back, combo inside, toggle, outside press, form
submit, point anchor, viewport clamp, flip, detached anchor, inside a modal,
dark) passed, plus 3 tree-label checks.

## ProgressBar (added 2026-10-06)

`ProgressBar` (`assets/progressbar.js`, `Layout.add_progressbar`) and
`progress_html()` share one markup and stylesheet. IguanaXterm's transfer queue
and Monguana's dashboard meters each drew their own.

- `set_value(value, max=None, text=None)` only touches the fill width and two
  text nodes, so a transfer callback can call it several times a second.
  `text` replaces the percentage ("42%  1.2 MB"); `""` restores it.
- States `active` / `done` / `error` / `paused` (blue / green / red / amber);
  `set_indeterminate(True)` for an unknown total (sliding bar, no
  `aria-valuenow`; reduced motion shows a static dim bar).
- `compact=True` is one line (label, bar, value) for rows and tiles;
  `label_width` / `value_width` line the bars of a stacked list up.
- `progress_html(value, max, label=, text=, state=, compact=)` is the
  no-JS form for string-built UIs, every string escaped. Pass a fraction with
  `max=1`.
- `role="progressbar"` with `aria-valuemin/max/now/valuetext` and the label as
  `aria-label`.

`tests/progressbar_demo.py` simulates a queue; a 10-check Playwright run
(in-place updates, indeterminate, final states and colours, progress_html
matching the widget, compact height, alignment) passed.

## JsNull → None in every widget (fixed 2026-10-06)

Pyodide maps JS `undefined` to `None` but `null` to `pyodide.ffi.jsnull`
(`JsNull`), both for a JS function's return value and inside `to_py()`.
`JsNull` is falsy but `is None` / `== None` are False, so `if x is None:` took
the wrong branch. (It does serialise with `json.dumps`, as `null`.) It leaked
from Tree (`on_select` when the selection clears; `get_selected`, `get_node`,
`get_parent_id` with nothing to return), DataTable (`on_select.id` whenever
0 or 2+ rows are selected; `get_row` for a missing id), Sidebar and TabWidget
`get_active`, and Layout's events, which handed over raw JS objects.

`wapyt._runtime.to_plain()` converts recursively and maps `JsNull` to `None`;
every `_bind_event` and getter uses it, and Layout's `add_event_handler` now
passes dicts (`{"id", "cell"}`, `cell` still a JS object, `None` for the root).
`tests/test_jsnull.py` guards against a wrapper calling `.to_py()` directly
again. Verified in Chromium: the same page reports `JsNull` on the old wheel
and `None` on this one for all seven values.

## File-transfer CSRF cookie (fixed 2026-10-06)

`filetransfer.js` used to send `X-CSRF-Token` only for cookies matching
`pytincture…csrf`, so an app using pytincture's `cookie_namespace` (#376) got
403 on every upload. It now reads the exact cookie pytincture names in
`globalThis.__pytinctureCsrfCookieName`, and never another app's on the same
host; without that hint (older runtime, standalone page) it accepts
pytincture's shapes, `__Host-<ns>-csrf` / `<ns>-dev-csrf`, preferring the
default namespace. `tests/test_filetransfer_csrf.py` runs the real function
under Node.

## Form field types (added 2026-10-06)

`FieldConfig(type=...)` now also takes `date`, `time`, `datetime-local`,
`color`, `range`, `radio`, `toggle` and `checkbox_group`; an unknown type
raises `ValueError` in `to_dict()` instead of silently rendering a text box.
`form.js` routes every read and write through type sets (`DATELIKE`,
`BOUNDED`, `BOOLEAN`, `GROUPS`) and `_readControl` / `_writeControl`.

- **Values.** Date-likes read back as ISO strings, `None` when empty, and take
  `datetime.date` / `time` / `datetime` on the way in (`iso_value`, and
  `json_default` for `set_values`); aware datetimes are refused. `range` reads
  as a number, `toggle` as a bool, `radio` as the picked value or `None`,
  `checkbox_group` as a list. An unset `range` keeps the browser's midpoint.
- **Groups** are a borderless `<fieldset>` (`role="radiogroup"` / `"group"`)
  labelled through `aria-labelledby`, so `fieldset.disabled` disables every
  option and `_focusEntry` focuses the picked (or first) option on an invalid
  submit. Radio names are the per-instance control id, so two forms never
  share a set. `inline=True` lays options in a row; `set_field_options` works
  on groups and keeps whatever is still offered selected.
- **Bounds.** `min` / `max` apply to number, range and date-likes and are
  checked through the control's own `validity.rangeUnderflow/Overflow`. The
  default copy quotes the ISO bound ("Must be 2026-01-01 or later") even though
  the picker shows a locale format; `range_message` overrides it.
- **Toggle** is the checkbox itself with `appearance: none`, `role="switch"`
  and a `::before` knob. Its selectors carry `.wapyt-form-row` on purpose:
  `.wapyt-form-row[data-inline] .wapyt-form-control { width: auto }` otherwise
  wins and collapses it to zero width.
- Dark theme sets `color-scheme: dark` on the form so native picker icons and
  popups are not black on dark.

`tests/form_demo.py` has every type; a 23-check Playwright run (values and
types, ARIA, escaping, range readout, keyboard, required groups, number and
date bounds, set_values with date objects, set_field_options, dark scheme)
passed.

### Combo (added 2026-10-06)

`type="combo"` is a searchable select: the `Combo` class in `form.js`, a
WAI-ARIA combobox (`role="combobox"`, `aria-activedescendant`) over a
`role="listbox"`. `multiple=True` picks several values as chips and reads back
as a list; `allow_custom=True` keeps typed text that is not an option.

- **The listbox lives in `<body>`**, `position: fixed`, z-index 10045, and is
  attached only while open, so a modal's or a cell's overflow cannot clip it
  and nothing is left behind when a form is thrown away. It flips above the
  field when there is no room below and follows scrolls and resizes.
- **Change fires on a pick, never on typing**; typing only filters
  (case-insensitive substring on the label). Enter in an open list picks and
  does not submit the form; Escape closes the list and stops there, so an
  enclosing modal stays open; Backspace in an empty multi combo drops the last
  chip.
- **Blur commits the text:** an exact label match picks it, unmatched text
  reverts (or is kept with `allow_custom`), and clearing the box clears a
  single combo. Clicking a single combo selects its text so typing starts a
  new search instead of appending to the current label.
- `set_values` / `set_field_options` drop values that are not options unless
  `allow_custom` is on.
- The inner input's reset is four classes deep on purpose: modal.js injects
  `.wapyt-modal-body input` rules (0,3,1 when dark) that otherwise draw a box
  inside the combo. The same rule gave a dark-modal toggle a border, so the
  dark toggle rule sets `border: 0` too.

The same demo has combos inline and in a modal; a 30-check Playwright run
(ARIA, filtering, keyboard, blur rules, chips, custom values, escaping,
required, set_values / set_field_options, overflow past the modal, Escape not
closing the modal, both themes inside a modal) passed alongside the 23
field-type checks. (Both PRs, #31 and #32, said 25; the suite has 23.)

### clear and reset (added 2026-10-06)

`Form.clear(values=True, errors=True)` empties every field and/or removes
errors; `Form.reset()` puts back each field's configured `value`. Both are
silent (no `change`), like `set_values`. "Empty" per control
(`_emptyValue`): checkboxes and toggles off, groups and combos empty, radio
and date-likes `None`, a select with nothing chosen (reads `""`); native range
and colour inputs cannot be blank, so a range goes to its `min` (or 0) and a
colour to `#000000`. `reset()` gives a field without a configured value what a
fresh form shows (`_defaultValue`): a range at its midpoint, a select with
nothing chosen.

**Fixed with it: an unset range started at its max.** The browser gives a new
range input 50 (the 0–100 midpoint) before `min` / `max` are set, and setting
`max=20` then clamped it to 20. `_writeControl` now puts an unset range at the
midpoint of its own min and max.

`tests/form_clear_demo.py` (every type); a 10-check Playwright run passed, and
the field-type and combo suites still pass (23 + 30).

### Two-thumb range and tick marks (added 2026-10-08)

`FieldConfig(type="range", range=True)` reads back `[low, high]` and takes a
two-item list or tuple (`None` for either end means that bound; unset spans
the whole range). It is `RangeSlider` in `form.js`, not a native input: a
`role="group"` named by the label, with two focusable `role="slider"` thumbs
whose `aria-valuemin` / `max` are the limits the other thumb sets (the APG
multi-thumb pattern). Thumbs never cross; values snap to `step`
(`snapValue`, rounded to the step's decimals so 0.1 steps stay clean) and
`set_values` puts a reversed pair in order.

- **Pointer:** a press on the track moves the nearer thumb (or the one on that
  side) and captures the pointer; when both thumbs sit on the same value, the
  first movement's direction picks which. When both are at `min`, the high
  thumb is stacked on top so it stays grabbable.
- **Keyboard:** arrows step, Page Up / Down move a tenth of the range, Home /
  End go to the thumb's limit. `change` fires on every real move, as the
  native range does while dragging.
- `clear()` and `reset()` without a configured value give `[min, max]`;
  `set_field_disabled` drops both thumbs out of the tab order.
- **Ticks** (`ticks`, `major_ticks`, `tick_labels`) work on one- and
  two-thumb ranges. Marks are inset by 8px each end, the travel of a 16px
  thumb centre, which matches Chromium's native thumb; the custom slider is
  built to the same geometry. More than 200 marks draws none.
- **The readout has a fixed width now** (the widest possible text, in `ch`).
  It is a flex sibling of the track, so a readout growing from "0 – 500" to
  "150 – 500" shrank the track under the pointer mid-drag; the Playwright run
  caught it.

`tests/form_range_demo.py`; a 40-check Playwright run (ARIA limits, escaping,
keyboard, no crossing, floats, track click, drags, stacked thumbs, tick
alignment for both kinds, set_values / clear / reset, disabled, label click,
Tab order, submit, dark) passed, and the field-type, combo and clear suites
still pass (23 + 30 + 10).

### Buttons and label position (added 2026-10-08)

**`FormButton`** goes in `FormConfig.fields` (its own `.wapyt-form-row`
with `data-kind="button"`, so `span` works and left-label forms line it up
with the controls) or in `FormConfig.buttons` (the action row, before Cancel
and Submit). Buttons live in `this._buttons`, never `_controls`, so
`get_values`, `validate`, `clear` and `focusFirst` ignore them; ids are
unique across fields and buttons (`FormConfig.to_dict`).

- `on_click` → `{id}`. A `submit=True` button validates first: on success
  `click` carries `{id, values}`, otherwise `invalid` carries `{errors, id}`
  and focus goes to the first bad field. It never fires `submit`, and it is
  `type="button"`, so Enter still submits through the main Submit.
- `_syncButton` derives `disabled` from the button's own state, its
  `loading` flag and, for submit buttons only, `set_busy`, so turning one off
  never re-enables a button another still holds. `set_button_loading` shows a
  spinner (static under reduced motion) and sets `aria-busy`.
- `show_field` / `hide_field` / `set_field_disabled` take button ids; an
  action-row button has no row, so it hides itself.
- Variants: `default` (outlined), `primary`, `danger`, `link`; `full`.
- The action row now **wraps**: with several buttons it set the form's
  minimum width, which also defeated the narrow fallback below. The dark
  outlined button border moved to `--wapyt-divider-dark` (the border token is
  invisible on the dark surface).

**Label position.** `FormConfig(label_position="left", label_width=...)`,
per field `label_position` / `label_width` / `hidden_label`. A left row is a
grid (`--wapyt-form-label-width`, default 160px): label in column 1,
everything else in column 2, `align-items: baseline` so the label sits on the
control's text line (`center` for checkbox / toggle, `start` for ranges,
which have no text baseline). Checkbox and toggle rows put the label first in
left mode; the native checkbox's 4px left margin is zeroed there.

- **The display rule must skip `[hidden]`.** It outranks
  `.wapyt-form-row[hidden]`, and the first version left hidden left-label
  rows on screen.
- **Narrow fallback:** a row whose control column would be under 160px gets
  `data-narrow` and goes back to top labels (`_watchNarrow`, a
  ResizeObserver on the form, measuring the label track from
  `gridTemplateColumns` while not narrow). Not a container query:
  inline-size containment would collapse a form inside a shrink-to-fit
  Popup.
- `hidden_label` is the usual visually-hidden clip, so the label still names
  the control; left rows keep their control in column 2 regardless.

`tests/form_buttons_demo.py` (every field kind with left labels, field,
full-width and action-row buttons, a narrow modal); a 38-check Playwright run
(column alignment, baseline, help placement, checkbox column, per-field
override, hidden label, escaping, label click, placement and order, variants,
values, click / submit-button / invalid / Enter, loading, text, disabled,
hidden, busy, narrow modal and viewport and back, dark) passed, and the
field-type, combo, clear and range suites still pass (23 + 30 + 10 + 40).

### Fieldsets, spacers and static fields (added 2026-10-08)

`FormConfig.fields` now takes layout items besides fields; `_createItem`
dispatches on `type` (`fieldset`, `spacer`, `button`, else a field) and
passes an inherited label position down.

- **`FormFieldset`** is a real `<fieldset>` + `<legend>` with its own grid
  (`.wapyt-form-fieldset-body`, `columns` 1-3) and nests. Its `id` goes in
  `_rows` (so `show_field` / `hide_field` work) and `_fieldsets`
  (`set_field_disabled` sets `fieldset.disabled`). Its fields stay flat in
  `get_values`; ids are unique across the whole form, nesting included
  (`_collect_form_ids`). `label_position` / `label_width` on a fieldset are
  defaults for everything inside.
- **A disabled fieldset only disables native controls.** Three things needed
  help: Combo checked `input.disabled`, which stays false under a disabled
  fieldset, so it opened anyway (now `matches(":disabled")`); RangeSlider is
  divs, so `_syncSliders` sets each slider to its own `selfDisabled` or any
  disabled fieldset around it (a slider disabled on its own stays disabled
  when its fieldset is re-enabled); group focus filters use `:disabled` too.
- **Validation now skips inactive fields** (`_isInactive`): disabled, by
  itself or a fieldset, or hidden, itself or any ancestor up to the form
  element (not beyond: a form in a background tab must still validate).
  **Behaviour change:** a hidden or disabled `required` field used to fail
  validation; with conditional sections that blocked every submit invisibly.
  The browser's own forms skip disabled controls the same way. They are
  still in `get_values`. `focus_first` uses the same test.
- **`FormSpacer`**: an empty grid cell (`span`) or a fixed gap (`height`);
  hidable by `id`.
- **`type="static"`**: an `<output>` (labelable, announced with its label,
  not a tab stop). The value is kept as given in `entry.value` (string,
  number) for `get_values`, shown via textContent, `placeholder` while
  empty (`data-empty`). It cannot be `required`, is never validated, and
  `clear()` empties it.
- `set_values`, `clear` and `reset` stay silent, so an app that enables a
  section from `on_change` must re-apply it after calling them.

`tests/form_fieldsets_demo.py` (static values, a two-column fieldset, an
SSH-key fieldset a radio shows, a proxy fieldset a toggle enables with a
nested fieldset, slider, combo and button inside, spacers); a 38-check
Playwright run passed, and the field-type, combo, clear, range and buttons
suites still pass (23 + 30 + 10 + 40 + 38).

### Validators and success messages (added 2026-10-08)

`FieldConfig(validate=fn)` takes a **Python** function: pyTincture runs the
app's UI code in the browser under Pyodide, so the wrapper hands it to the JS
as a `create_proxy`, exactly like an event handler. (An earlier note in the
Roadmap said validators had to be server-side because "Python can't run in
the browser"; that was wrong.) The callable is **not** in `to_dict()`;
`Form.__init__` walks the fields, fieldsets included (`_iter_fields`), and
calls `set_validator`, which can also replace (`fn`) or remove (`None`) one
at runtime and destroys the replaced proxy.

- `validate()` order: skip inactive fields → `required` → (empty stops here)
  → built-ins (`_builtinError`: bounds, min length, pattern, matches) →
  `_validatorError(entry, value, values)`. So validators only see non-empty
  values of shown, enabled fields; booleans and ranges are never empty.
  `values` is one `getValues()` snapshot per `validate()`, taken lazily.
- Result: `None` / `""` / `True` = fine, `False` = "Invalid value", anything
  else is the message (`String()`ed). The Python wrapper catches an
  exception, prints the traceback and returns "Invalid value"; the JS also
  catches, so a failing validator never breaks a submit. **Pyodide sends
  Python stderr to `console.warn`, not `console.error`**: look there for
  the traceback.
- It is synchronous: an `async def` validator would hand back a coroutine,
  not a message. Validators that must ask the BFF need a different design.
- `success_message` reuses the error slot with `data-state="success"`
  (green), for fields that passed and are non-empty; `setError` clears the
  state, so the next edit or validation removes it. It does not set
  `aria-invalid`.

`tests/form_validators_demo.py` (text, cross-field dates, multi combo,
two-thumb range, toggle, one raising, one returning `False`, one in a hidden
fieldset, runtime replace and remove); a 24-check Playwright run passed, and
the field-type, combo, clear, range, buttons and fieldsets suites still pass
(23 + 30 + 10 + 40 + 38 + 38).

### Focus events, set_focus and validate_field (added 2026-10-08)

`on_focus` → `{id}` and `on_blur` → `{id, value}` come from one
`focusin` / `focusout` pair on the `<form>` element. `_fieldIdOf(node)` maps
a node to its field through the closest `.wapyt-form-row` (button rows and
nodes outside the form give null), and an event is dropped when
`relatedTarget` belongs to the same field, so moving between radio options,
a range's two thumbs or a combo's parts is neither a blur nor a focus. Form
buttons fire no focus events. Window switches blur and refocus like native
inputs.

- **Combo chip × buttons now `preventDefault` on mousedown.** A focused ×
  is removed with its chip, which dropped focus to `<body>` (a blur with no
  `relatedTarget`) before the combo refocused its input: a spurious
  blur / focus pair on every chip removal.
- `set_focus(id)` → bool: fields through `_focusEntry` (a group's checked
  option, a range's low thumb), `FormButton`s directly; False without moving
  focus for static, hidden or disabled ones (`_isInactive`); unknown ids
  throw. `get_focused()` → the focused field's or button's id, or None.
- `validate_field(id)` runs one field through `_checkField` (the same
  required → built-ins → validator path `validate()` now uses) and sets only
  that field's message or success message. For validate-on-blur:
  `form.on_blur(lambda p: form.validate_field(p["id"]))`.

`tests/form_focus_demo.py`; a 24-check Playwright run passed, and the
field-type, combo, clear, range, buttons, fieldsets and validators suites
still pass.

### set_properties / get_properties (added 2026-10-08)

`Form.set_properties(id, **props)` changes a field or button after build;
the wrapper checks names against `_FIELD_PROPERTIES` / `_BUTTON_PROPERTIES`
(snake → camel) and the JS `setProperties` writes them into `entry.field`
(the spec validation reads) and redraws what shows them:

- `label` / `required` → `_renderLabel` (text, the `*` mark, and
  `aria-required` on inputs and radio groups; not on checkbox groups, sliders
  or static fields). A static field cannot become required.
- `help` → `_renderHelp` creates, changes or removes the help line just
  above the error slot (`entry.helpEl`, `entry.errorEl`).
- `min` / `max` / `step` → `_applyBounds`: native attributes (`None`
  removes), or new `slider.bounds` and a re-snap of both thumbs; tick scales
  are rebuilt (`entry.scale`) and the readout re-sized (`_sizeOutput`).
- `readonly` reaches the two-thumb slider too (`aria-readonly` is now also
  removed when it is turned off).
- Validation-only keys (`min_length`, `pattern`, `matches`, the messages,
  `success_message`) are stored and take effect on the next check.
- Buttons: `text`, `icon` (None removes it), `tooltip`, `variant`.

`get_properties(id)` returns the same names. `tests/form_properties_demo.py`;
a 30-check Playwright run passed, and the earlier Form suites still pass.

### Whole-form disable and hide (added 2026-10-08)

Every row, the form-wide error and the action row now sit inside one
`<fieldset class="wapyt-form-frame">` with **`display: contents`**, so the
rows are still items of the form's grid (spans, columns and left labels are
unchanged; the Playwright run compares positions) while `disable()` sets
`frame.disabled` and the browser disables every native control at once,
Submit and Cancel included. A field or fieldset disabled on its own stays
disabled after `enable()`, because nothing is written to the controls.
`_syncSliders` counts the frame as a disabling ancestor, and `submit()`
returns early while the frame is disabled. `hide()` / `show()` set `hidden`
on the `<form>` (`.wapyt-form-body[hidden]` keeps it out of the grid
display rule). `FormConfig(disabled=, hidden=)` set the initial state.

Nothing in wapyt or the apps used a child selector under `.wapyt-form-body`
(checked), so the extra wrapper broke no styles. `tests/form_disable_demo.py`;
a 17-check Playwright run passed.

### max_length, field icons, disabled options (added 2026-10-08)

- **`max_length`** (text-like fields and textarea) sets the native
  `maxlength`, which stops typing, and is validated too (`_builtinError`,
  after `min_length`), because `set_values` bypasses the attribute.
  `max_length_message`; settable through `set_properties` (`None` removes
  the attribute).
- **`icon`** (text-like inputs, date/time pickers, select, combo): an MDI
  `<i aria-hidden>` on the left. An input or select is wrapped in
  `.wapyt-form-input-wrap` (positioned; the control gets `padding-left: 32px`)
  only when an icon is first needed (`_renderIcon`, `entry.iconHost` null
  until then; undefined for kinds that cannot have one, which throw); a combo
  hosts the icon in its own box. The icon has `pointer-events: none`, so a
  click on it lands in the input. `set_properties(icon=...)` adds, changes or
  removes it; the wrap stays.
- **`SelectOption(disabled=True)`**: `option.disabled` in a select,
  `input.disabled` (and a dimmed label) in radio / checkbox groups, so the
  browser's own arrow keys skip it; in a combo the item gets `aria-disabled`,
  `_pick` ignores it and `_setActive(index, dir)` walks past disabled items
  (staying put if nothing enabled lies that way). The app can still set a
  disabled option's value.

`tests/form_options_demo.py`; a 26-check Playwright run passed. (Two test
lessons: Playwright will not click an element with `pointer-events: none` or
`aria-disabled`, which is the behaviour being tested; click by coordinates or
with `force=True`.)

### Async validators (added 2026-10-08)

A validator may be an `async def` (to ask the BFF). The wrapper's `call`
checks `inspect.isawaitable` on the result and returns an inner coroutine
that also turns an exception into "Invalid value"; Pyodide hands a
coroutine to JS as a **thenable proxy**, so `_validatorError` returns
`Promise.resolve(result).then(normalise, failed)` and destroys the proxy
afterwards.

- `_checkField` bumps `entry.checks` on every check, and `emitChange` bumps
  it on every edit; a check's `token` is that count, and a result whose token
  is stale is dropped. `validate()` stays synchronous: it starts async checks
  (`_showWhenDone`), keeps them in `this._pending`, and returns the errors it
  has. `validateAsync()` / `validateFieldAsync()` (Python
  `validate_async` / `validate_field_async`) wait for them.
- `submit()` and `submit=True` buttons: sync errors fail at once; otherwise
  `_afterPending` waits with `_checking` set (Submit and submit buttons
  disabled, `data-checking` on the host, second submits ignored), then emits
  `submit` / `click` or `invalid`. An edit during the wait abandons that
  submit.
- **Pending shows as a spinner after the label** (`data-checking` on the
  row, `aria-busy` on the control), not as "Checking…" text. A text line
  appearing on blur moved the button being pressed down before mouseup, so
  the click was lost.
- **That was a general bug, also with sync `validate_field` on blur (#56's
  recipe):** an error line appearing on blur moves the button under the
  pointer. `whenPointerFree` (module level: capture `pointerdown` /
  `pointerup` / `pointercancel` on document) queues the message updates of
  `validate_field` and of async results while a pointer is held, and runs
  them in a `setTimeout(0)` after release, which is after the click (same
  task as pointerup). Keyboard use is unaffected.

`tests/form_async_validators_demo.py` (an `asyncio.sleep` validator with a
settable delay); a 19-check Playwright run passed.

### File and avatar fields (added 2026-10-08)

`type="file"` and `type="avatar"` are one class, `FilePicker` in `form.js`.
The field's control (`entry.el`, what labels, focus and `:disabled` use) is
a real `<button>` that clicks a hidden `<input type=file>`; drops land on the
zone (file) or the picture button (avatar).

- **Files never leave the browser on their own.** `get_values` reports
  `{name, size, type}` (a list for `file`; for `avatar` the URL the app set,
  the metadata once a new picture is chosen, or None). `Form.get_files(id)`
  returns the `File` objects and `Form.adopt_files(id)` registers them with
  `filetransfer` (`registerExternal`) and returns handle ids for
  `filetransfer.upload(url, file_id)`, so uploads keep progress and the CSRF
  token. The form does no uploading itself (dhxpyt's `target` / `autosend`
  are deliberately not copied).
- Rules are applied as files arrive (`_add`): `accept` (native syntax:
  `.ext`, `type/sub`, `type/*`; avatar defaults to `image/*`), `max_size`
  (bytes), `max_files` (file + multiple); duplicates (name + size +
  lastModified) are skipped. Rejected files are not added; the reasons go to
  the error slot, one per line (`.wapyt-form-error` is `white-space:
  pre-line` now). A single file field replaces its file.
- **The avatar preview is a `data:` URL** from FileReader: pyTincture's CSP
  is `img-src 'self' data: https:`, so `URL.createObjectURL`'s `blob:` URLs
  would be blocked. An app-set URL must be same-origin, https or data.
- `set_values` can only clear a picker (None / [] ) or give an avatar a URL;
  `FieldConfig` refuses preset files. `clear()` empties; `reset()` restores
  an avatar's configured URL.
- Avatar rows are `data-kind="avatar"` so left labels centre on the picture
  (the button has no text baseline).

`tests/form_files_demo.py` (fixtures written to the scratchpad; files fed
through the hidden input and a synthetic `DataTransfer` drop); a 29-check
Playwright run passed.

### Toggle group (added 2026-10-08)

`type="toggle_group"` is `ToggleGroup` in `form.js`: segmented `<button>`s in
a borderless `<fieldset>` (so field, fieldset and whole-form disabling work
natively and `_isInactive` sees it). One choice is a WAI-ARIA radio group
(`role="radio"`, `aria-checked`; arrows move **and select**, wrapping and
skipping disabled options; clicking the chosen one does nothing); `multiple`
makes toggle buttons in a `role="group"` (`aria-pressed`; arrows only move,
Space / Enter toggle). One tab stop either way (the first chosen, else the
first enabled). Value: the choice or None; a list with `multiple`.
`SelectOption(icon=...)` shows an icon on a segment (other kinds ignore it).

- Rows are `data-kind="toggles"` and centre their left label: a fieldset
  offers the grid no baseline, so `baseline` put the label at the top.
- Hover tints **unchosen** segments only; the hover rule outranked the
  chosen fill, so the segment under the pointer looked unselected.
- `aria-required` goes on the radio-group form only (not on a `group`, nor
  on file / avatar buttons, which #61 had set it on).

`tests/form_toggle_group_demo.py`; a 31-check Playwright run passed, and all
earlier Form suites still pass (348 checks).

## Pagination (added 2026-10-06)

`Pagination` (`assets/pagination.js`, `Layout.add_pagination`) replaces
Monguana's hand-built pager: first / previous / next / last, a "page N of M"
box (or `numbers=True` buttons, `1 … 4 5 6 … 20`), a page-size selector shown
when `page_sizes` is set, and a summary ("1–50 of 1,234", "≈" when
`exact=False`).

- **`on_change` fires only for the person's moves** (`{page, page_size,
  offset}`), plus one case: `set_total` shrinking the list under the current
  page clamps to the new last page and fires, so the app reloads it. The
  setters (`set_total`, `set_page`, `set_page_size`, `set_busy`) are silent,
  so a load handler can call them without looping.
- **Unknown totals** (`total=None`, Monguana's count timeout): no Last button
  and no "of M"; Next follows `has_more`; `shown` (rows on this page) keeps the
  summary right on a short final page ("41–57"). Numbered mode needs a total
  and falls back to the page box without one.
- Changing page size returns to page 1. A non-number typed in the box reverts
  without firing; a too-large one clamps to the last page.
- `set_busy(True)` disables every control while a page loads.
- `page_slice(rows, page, size)` and `pager.page_rows(rows)` page an
  in-memory list.
- `None` crosses the FFI as `js.undefined` in `set_total`, as in
  `Form.set_error`. Dark-theme input borders use `--wapyt-divider-dark`;
  `--wapyt-border-dark` is invisible on the dark surface.

`tests/pagination_demo.py` covers server-paged, numbered, unknown-total and
in-memory pagers; a 24-check Playwright run (busy state, jump box clamping and
reverting, page size, shrinking totals, number windows, unknown totals,
page_rows, keyboard, dark borders, wrapping at 360px) passed.

## Known rough edges

Not bugs to fix blindly — context for when they surface:

- **Three different `None` conventions** across the config dataclasses: `layout`/`chat`/`resourceboard`
  strip `None` via a `_clean` helper, `cardpanel` uses hand-written `if x is not None` chains,
  `sidebar` strips nothing and ships `"title": null`. Also means no optional field can be explicitly
  *cleared* — `None` means "omit", so the JS default wins.
- **Copy-paste**: `_resolve_root` duplicated 5×, `_clean` 3×, `_bind_event` 5× with three different
  argument-conversion behaviours. A `_base.py` mixin would remove ~150 lines.
- **Theming is split**: `wapyt.css` defines `--wapyt-*` tokens but only `modal.js` uses them (4 refs).
  `chat.js` references zero and hardcodes a palette (`sidebar.js` moved onto the tokens on 2026-10-06); `cardpanel.js` / `resourceboard.js`
  define their own private variable sets. No file uses `prefers-color-scheme`.
- **Debug prints at import**: `chat.py:14` and `cardpanel.py:12` write to stdout on `import wapyt`,
  with stale `WRAPPER_REVISION` cache-busters.
- **The modal's × button calls `hide()` unless `ModalConfig(dispose_on_close=True)`**
  (added 2026-09-25), which makes ×, Escape and a backdrop click `close()` —
  remove — the dialog. Off by default because wAwesomeChat builds its modals
  once and reopens them; Monguana, which builds one per use, turns it on.
  `close()` also removes the modal's document-level Escape listener, which
  used to outlive every dialog.
