"""
ThemeEditor: pick a palette, then adjust any colour for light and dark, the
corner radius and the font, live on the page. Plus the functions an app uses
to apply a saved theme without mounting the editor.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._base import WidgetBase
from .._runtime import require_js, to_plain
from .themeeditor_config import ThemeEditorConfig, ThemePalette, check_theme

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


def _to_js(value: Any) -> Any:
    return js.JSON.parse(json.dumps(value))


class ThemeEditor(WidgetBase):
    """
    A theme editor in a container.

    Quick start::

        editor = self.add_themeeditor("settings", ThemeEditorConfig(storage_key="myapp:theme"))
        editor.on_change(lambda e: api.save_theme(e["theme"]))   # or let storage_key keep it

    and at startup, before building the UI, so the page opens themed::

        restore_theme("myapp:theme")         # from the browser
        apply_theme(user["theme"])           # or from your server

    Everything built on the ``--wapyt-*`` tokens follows the theme. Chat,
    CardPanel and ResourceBoard keep their own colours for now.
    """

    _js_attr = "editor"

    def __init__(
        self,
        config: Optional[ThemeEditorConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("ThemeEditor requires a container or a root element.")
        require_js("ThemeEditor")
        self.config = config or ThemeEditorConfig()
        target = self._resolve_root(container=container, root=root)
        if target is None:
            raise RuntimeError("Unable to resolve root element for ThemeEditor.")
        self.editor = js.wapyt.ThemeEditor.new(target, _to_js(self.config.to_dict()))

    def _custom_palettes(self) -> List[str]:
        return [p.id for p in (self.config.palettes or []) if isinstance(p, ThemePalette)]

    # Events ------------------------------------------------------------
    def on_change(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Fires when the person commits a change (not on every drag step):
        ``{theme, source, key, mode}``. ``source`` is ``palette``, ``token``,
        ``reset-token``, ``radius``, ``font``, ``reset``, ``import`` or
        ``code``; ``key`` names the token for ``token`` / ``reset-token``.
        """
        self._bind_event("change", handler)

    def on_mode(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires with ``{mode}`` when the Light / Dark switch changes."""
        self._bind_event("mode", handler)

    # Theme -------------------------------------------------------------
    def get_theme(self) -> Dict[str, Any]:
        """The theme: palette, per-mode overrides, radius and font."""
        return to_plain(self.editor.getTheme())

    def get_resolved(self) -> Dict[str, Any]:
        """Every token's value for both modes, plus radius and the font CSS."""
        return to_plain(self.editor.getResolved())

    def set_theme(self, theme: Dict[str, Any], *, silent: bool = False) -> None:
        """Load a theme; fires ``change`` (source ``code``) unless ``silent``."""
        self.editor.setTheme(_to_js(check_theme(theme, self._custom_palettes())), _to_js({"silent": silent}))

    def set_palette(self, palette_id: str, *, silent: bool = False) -> None:
        """Switch palette, dropping the adjustments made to the previous one."""
        self.editor.setPalette(palette_id, _to_js({"silent": silent}))

    def reset(self, *, silent: bool = False) -> None:
        """Back to the Default palette with no adjustments."""
        self.editor.reset(_to_js({"silent": silent}))

    def set_mode(self, mode: str) -> None:
        """Edit the ``"light"`` or ``"dark"`` colours (and preview them)."""
        if mode not in ("light", "dark"):
            raise ValueError("mode must be 'light' or 'dark'")
        self.editor.setMode(mode)

    def get_mode(self) -> str:
        return str(self.editor.getMode())

    def destroy(self) -> None:
        """Remove the editor. The applied theme stays on the page."""
        self._dispose()


# Page-level helpers ------------------------------------------------------

def _theme_js() -> Any:
    require_js("ThemeEditor")
    return js.wapyt.theme


def apply_theme(theme: Optional[Dict[str, Any]], *, palettes: Optional[List[ThemePalette]] = None) -> Optional[Dict[str, Any]]:
    """
    Apply a theme to the page (``None`` removes it, back to the stylesheet).
    Register custom palettes the theme refers to with ``palettes``.
    """
    ns = _theme_js()
    custom = [p.to_dict() for p in (palettes or [])]
    for spec in custom:
        ns.registerPalette(_to_js(spec))
    if theme is None:
        ns.apply(None)
        return None
    checked = check_theme(theme, [p["id"] for p in custom])
    return to_plain(ns.apply(_to_js(checked)))


def restore_theme(storage_key: str, *, palettes: Optional[List[ThemePalette]] = None) -> Optional[Dict[str, Any]]:
    """Apply the theme saved under ``storage_key`` (by a ThemeEditor), if any."""
    ns = _theme_js()
    for p in palettes or []:
        ns.registerPalette(_to_js(p.to_dict()))
    return to_plain(ns.restore(storage_key))


def current_theme() -> Optional[Dict[str, Any]]:
    """The theme applied by ``apply_theme`` / a ThemeEditor, or None."""
    return to_plain(_theme_js().current())


__all__ = ["ThemeEditor", "apply_theme", "restore_theme", "current_theme"]
