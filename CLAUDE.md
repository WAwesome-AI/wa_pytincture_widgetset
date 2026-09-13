# wapyt — wA PyTincture Widgetset

DHTMLX-free widgetset for [pyTincture](https://github.com/schapman1974/pytincture). Seven widgets
(Layout, Chat, CardPanel, TabWidget, Sidebar, ModalWindow, ResourceBoard) declared in Python, rendered
as plain DOM by bundled JS, running inside Pyodide. The commercial-licence alternative to `dhxpyt`.

## Structure

```
wapyt/
  _runtime.py        # Pyodide bridge: require_js, create_proxy, asset self-loading
  <widget>/          # one dir per widget:
    <widget>.py      #   Python wrapper — thin, forwards to the JS constructor
    <widget>_config.py  #  @dataclass config with .to_dict() → camelCase payload
  assets/            # the JS/CSS that actually renders; one file per widget + wapyt.css
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

### Status: not yet bootable as a widgetset

Two things are missing. Until both exist, pointing pyTincture at wapyt fails at startup:

| Missing | Failure |
|---|---|
| `wapyt-<version>-py3-none-any.whl` in `modules_folder` | `No trusted backend wheel is available for wapyt==0.1.0` |
| `wapyt/pytincture-assets.json` | `Widgetset wapyt==0.1.0 must provide an owned, explicitly hashed pytincture-assets.json manifest` |

`dhx_pytincture_widgetset/scripts/` has both tools already and they port almost verbatim:
`generate_assets_manifest.py` (hashes a declared asset list; has a `--check` mode for CI) and
`dev_wheel.sh` (builds at the dev version from a temp copy, regenerates the manifest, drops the wheel
into a modules folder). For wapyt the manifest needs 8 entries — `wapyt/assets/wapyt.css` plus the
seven JS files, in load order. `MANIFEST.in` also needs `include wapyt/pytincture-assets.json`; the
existing `recursive-include wapyt/assets *` will not pick it up.

### Once a manifest exists, fix `require_js` first

`_runtime.py` has its own loader: `_load_assets()` walks `importlib.resources` and `js.eval`s
whatever it finds, in `iterdir()` order. That was the only path before pyTincture's verified loader
entered the picture — with a manifest, assets get evaluated **twice**, because `require_js` calls
`_load_assets()` unconditionally before checking whether the component is already present
(`_runtime.py:97`). Mostly idempotent (each file is an IIFE reassigning `globalThis.wapyt.*`, style
injectors are guarded) but instances built before the second pass hold superseded class objects.

Invert it: check `js.wapyt.<component>` first, self-load only if absent. Then the manifest is
primary and `_load_assets` is the offline fallback it reads like it was meant to be.

## Running

```bash
# demos — needs a wheel in tests/ first (see above)
cd ../pytincture && uv run pytincture launch_service --modules_folder ../wa_pytincture_widgetset/tests --port 8070
# then http://localhost:8070/layout_demo  (or chat_demo / cardpanel_demo / tabs_demo)

# unit tests — CPython only, no browser, no demo dependencies
uv run --group dev pytest tests/
```

`tests/` is two things at once: `tests/pyproject.toml` declares it a separate uv project
(`wapyt-tests`) for the demo apps and their heavy deps — litellm, boto3, pytincture — while the
`test_*.py` files are plain unit tests that share none of it. Collection separates them by filename.

`uv` is not on PATH on this machine; it may be inside a distrobox.

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

## Known rough edges

Not bugs to fix blindly — context for when they surface:

- **Three different `None` conventions** across the config dataclasses: `layout`/`chat`/`resourceboard`
  strip `None` via a `_clean` helper, `cardpanel` uses hand-written `if x is not None` chains,
  `sidebar` strips nothing and ships `"title": null`. Also means no optional field can be explicitly
  *cleared* — `None` means "omit", so the JS default wins.
- **`require_js` is commented out** in `Layout` (`layout.py:41`) and `ResourceBoard`
  (`resourceboard.py:48`); those two fail with an opaque `AttributeError` instead of the deliberate
  "assets failed to load" error the other five raise.
- **Copy-paste**: `_resolve_root` duplicated 5×, `_clean` 3×, `_bind_event` 5× with three different
  argument-conversion behaviours. A `_base.py` mixin would remove ~150 lines.
- **Theming is split**: `wapyt.css` defines `--wapyt-*` tokens but only `modal.js` uses them (4 refs).
  `chat.js` and `sidebar.js` reference zero and hardcode palettes; `cardpanel.js` / `resourceboard.js`
  define their own private variable sets. No file uses `prefers-color-scheme`.
- **Debug prints at import**: `chat.py:14` and `cardpanel.py:12` write to stdout on `import wapyt`,
  with stale `WRAPPER_REVISION` cache-busters.
- **Unused declared deps**: `itsdangerous` and `pyodide-py` are in `pyproject.toml` but imported
  nowhere. `pyodide-py` as a hard dep also contradicts `_runtime.py`'s deliberate soft import.
- `CardPanelConfig` defaults to `title="Data Sources"` with a description about lineage tracking —
  app-specific copy baked into a generic widget.
- `pyproject.toml` `homepage` still points at `schapman1974/wA_pytincture_widgetset`; the repo is
  `WAwesome-AI/wa_pytincture_widgetset`.
