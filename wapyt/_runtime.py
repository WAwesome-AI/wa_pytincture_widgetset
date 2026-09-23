"""
Utilities that bridge the Python API to the Pyodide/browser runtime.

The helpers in this module:

* gracefully degrade when running on CPython so importing ``wapyt`` offline works
* ensure the JS/CSS asset bundle is injected exactly once (`require_js`)
* keep Pyodide proxies alive while Python callbacks are registered
"""
from __future__ import annotations

from typing import Any
from importlib import resources

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore

try:  # pragma: no cover
    from pyodide.ffi import create_proxy as _create_proxy  # type: ignore
except Exception:  # pragma: no cover
    def _missing_create_proxy(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            "wapyt widgets require the Pyodide runtime (pyodide.ffi.create_proxy unavailable)."
        )

    _create_proxy = _missing_create_proxy  # type: ignore

_assets_loaded = False


def create_proxy(callback):  # type: ignore
    """
    Wrap a Python callable so it can be passed to JavaScript.

    This defers to :func:`pyodide.ffi.create_proxy` inside Pyodide and raises
    a clear RuntimeError when invoked on CPython.
    """
    return _create_proxy(callback)


def _inject_css(content: str) -> None:
    style = js.document.createElement("style")
    style.innerHTML = content
    js.document.head.appendChild(style)


def _load_assets(force: bool = False) -> None:
    """
    Evaluate bundled JS files and inject CSS once per session.

    Args:
        force: When ``True`` the assets are reloaded even if we previously ran.
    """
    global _assets_loaded
    if js is None:
        return
    if _assets_loaded and not force:
        return
    asset_root = None
    for package_name in ("wapyt.assets", "wapyt.wapyt.assets"):
        try:
            asset_root = resources.files(package_name)
            break
        except Exception:
            continue
    if asset_root is None:
        return
    for entry in asset_root.iterdir():
        suffix = entry.suffix.lower()
        if suffix not in {".js", ".css"}:
            continue
        try:
            content = entry.read_text()
        except Exception:
            continue
        if suffix == ".js":
            js.eval(content)
        else:
            _inject_css(content)
    _assets_loaded = True


def _component_ready(component: str) -> bool:
    """True when ``window.wapyt.<component>`` is already registered."""
    return bool(hasattr(js, "wapyt") and getattr(js.wapyt, component, None))


def require_js(component: str) -> None:
    """
    Ensure the requested widget constructor is available on ``window.wapyt``.

    Raises:
        RuntimeError: if the current interpreter is not Pyodide or the assets
        failed to register the requested component.
    """
    if js is None:
        raise RuntimeError(
            f"{component} requires the browser runtime. This code should only run inside Pyodide."
        )
    # Check before loading. When pytincture serves this widgetset it has already
    # evaluated the assets through its own hash-verified loader, in manifest
    # order; self-loading again would re-run all eight IIFEs and leave any widget
    # built in between holding a superseded class object. _load_assets is the
    # offline fallback for when nothing else has injected the bundle.
    if _component_ready(component):
        return
    _load_assets()
    if not _component_ready(component):
        _load_assets(force=True)
        if not _component_ready(component):
            raise RuntimeError(
                f"wapyt assets failed to load component '{component}'. Ensure the widgetset JavaScript is included."
            )
