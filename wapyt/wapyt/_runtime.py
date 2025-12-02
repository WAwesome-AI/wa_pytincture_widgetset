"""
Utilities to help wapyt import cleanly outside the Pyodide/browser runtime.
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
    return _create_proxy(callback)


def _inject_css(content: str) -> None:
    style = js.document.createElement("style")
    style.innerHTML = content
    js.document.head.appendChild(style)


def _load_assets(force: bool = False) -> None:
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


def require_js(component: str) -> None:
    if js is None:
        raise RuntimeError(
            f"{component} requires the browser runtime. This code should only run inside Pyodide."
        )
    _load_assets()
    if not hasattr(js, "wapyt") or not getattr(js.wapyt, component, None):
        _load_assets(force=True)
        if not hasattr(js, "wapyt") or not getattr(js.wapyt, component, None):
            raise RuntimeError(
                f"wapyt assets failed to load component '{component}'. Ensure the widgetset JavaScript is included."
            )
