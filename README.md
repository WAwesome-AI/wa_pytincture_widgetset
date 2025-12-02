# wA PyTincture Widgetset (`wapyt`)

`wapyt` is a lightweight widgetset for [pyTincture](https://github.com/schapman1974/pytincture) that avoids the commercial DHTMLX dependency used by the legacy package. It focuses on a DOM-driven layout engine and a set of first-class widgets that can be composed entirely from Python when running inside Pyodide.

## Highlights
- **Theme-aware layout**: Flexbox-based layout manager that mirrors the familiar `LayoutConfig`/`CellConfig` API, supports nested rows/columns, and exposes helper methods such as `attach_html`, `collapse`, `toggle`, `hide`, etc.
- **Widgets that don’t require DHTMLX**: Native Chat, CardPanel, TabWidget, Sidebar, ModalWindow, and ResourceBoard implementations with the streaming/events helpers the PyTincture samples expect.
- **`MainWindow` wrapper**: Thin helper built on top of `Layout` so existing apps can continue to expose a `MainWindow` class with no additional boilerplate.
- **PyTincture metadata**: Exposes `__widgetset__ = "wapyt"` so the platform can auto-discover the package name/version during `***WIDGETSET***` substitution.
- **Test/demo apps**: Located under `tests/` to show how to embed the widgets inside PyTincture applications.

## Widget Catalog
- `Layout` / `MainWindow`: Flexbox-driven layout primitives plus a drop-in `MainWindow` helper that mirrors the legacy PyTincture entrypoint.
- `Chat`: Streaming chat surface with agent metadata, artifact events, and helpers for incremental responses.
- `CardPanel`: Searchable, template-driven card grid with add/view/action callbacks and custom renderers.
- `TabWidget`: Lightweight tab host that supports badges, closable tabs, and attaching HTML or PyTincture components per tab.
- `Sidebar`: Collapsible navigation rail with badges, icons, and selection events for driving the rest of your layout.
- `ModalWindow`: Simple modal shell that can host arbitrary Layout instances or HTML snippets.
- `ResourceBoard`: Master/detail resource explorer with selectable rows, action hooks, and optional add button wiring.

## Runtime Architecture
- Layouts and widgets are declared in Python but render as DOM nodes through the JavaScript bundles under `wapyt/assets/`. Each helper (e.g., `Layout.add_chat`) forwards config dictionaries directly to the matching JS constructor.
- The `wapyt/_runtime.py` bridge exposes `require_js` to lazily inject JS/CSS exactly once per interpreter and `create_proxy` to keep Pyodide callback proxies alive for event handlers.
- Layout cells are plain flexbox containers (`wapyt/assets/layout.js` + `wapyt/assets/wapyt.css`), so attaching raw HTML or third-party widgets is as simple as calling `layout.attach_html(cell_id, markup)`.
- Because everything routes through `window.wapyt`, you can add new widgets by dropping a JS file into `wapyt/assets/`, exporting a constructor, and calling `require_js("MyWidget")` before instantiating it from Python.

## Getting Started

```bash
cd wapyt
uv venv --python 3.13 && source .venv/bin/activate
uv pip install -e .
```

Then run a PyTincture example pointing at this widgetset:

```bash
cd ../pytincture
uv run pytincture launch_service --modules_folder ../wA_pytincture_widgetset/tests --port 8070
```

Open http://localhost:8070/layout_demo in your browser to see the native layout, and swap in `chat_demo` / `cardpanel_demo` / `tabs_demo` to explore the specialized widgets.

## Package Layout

```
wapyt/
  ├── chat/        # Chat widget config + wrapper
  ├── cardpanel/   # CardPanel widget config + wrapper
  ├── layout/      # Layout/MainWindow helpers
  ├── modal/       # ModalWindow + config
  ├── resourceboard/ # ResourceBoard widget + config
  ├── sidebar/     # Sidebar widget config + wrapper
  ├── tabwidget/   # Tab widget config + wrapper
  └── assets/      # JS + CSS evaluated automatically by PyTincture
```


## Development Notes

- The JavaScript bundles define the `window.wapyt` namespace and are evaluated automatically by PyTincture’s loader (see `pytincture/frontend/pytincture.js`).
- Layout styles live in `assets/wapyt.css`; adjust tokens there to integrate with your design system.
- The tests are intentionally small, framework-free PyTincture apps so you can copy/paste into your own projects.

## License

MIT – see `pyproject.toml` for details.
