"""
Window widget: a movable, resizable dialog, non-modal by default.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, js, require_js, to_plain

Size = Union[int, float, str]


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class WindowConfig:
    """
    Options for :class:`Window`.

    Args:
        title: Title bar text.
        width / height: Starting size in pixels (or a ``"px"`` string).
        left / top: Starting position in pixels; ``None`` centres it.
        min_width / min_height: Smallest size a resize allows (default
            200 x 120); max_width / max_height: largest (default: the
            viewport).
        movable: Drag the title bar to move it (default on).
        resizable: Drag an edge or corner to resize it (default on).
        modal: Put a backdrop behind it and keep Tab inside it. Off by
            default: other windows and the page stay usable.
        closable: Show the close button; Escape closes it too (for a
            non-modal window, while focus is inside it).
        maximizable: Show the maximise button; double-clicking the title
            bar or Enter on it also maximises and restores.
        maximized: Start maximised.
        footer: Add a footer strip under the body, for buttons
            (``Window.footer``).
        dispose_on_close: The close button and Escape remove the window
            (as :meth:`Window.close` does) instead of hiding it.
    """

    title: str = ""
    width: Size = 480
    height: Size = 320
    left: Optional[Size] = None
    top: Optional[Size] = None
    min_width: Size = 200
    min_height: Size = 120
    max_width: Optional[Size] = None
    max_height: Optional[Size] = None
    movable: bool = True
    resizable: bool = True
    modal: bool = False
    closable: bool = True
    maximizable: bool = True
    maximized: bool = False
    footer: bool = False
    dispose_on_close: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return _clean({
            "title": self.title,
            "width": self.width,
            "height": self.height,
            "left": self.left,
            "top": self.top,
            "minWidth": self.min_width,
            "minHeight": self.min_height,
            "maxWidth": self.max_width,
            "maxHeight": self.max_height,
            "movable": self.movable,
            "resizable": self.resizable,
            "modal": self.modal,
            "closable": self.closable,
            "maximizable": self.maximizable,
            "maximized": self.maximized,
            "footer": self.footer,
            "disposeOnClose": self.dispose_on_close,
        })


class Window:
    """
    A floating window on top of the page.

    Quick start::

        win = Window(WindowConfig(title="Query", width=640, height=420, footer=True))
        form = Form(config, container=win.body)
        Toolbar(ToolbarConfig(items=[...]), container=win.footer)
        win.on_move(lambda p: save_prefs(win=p))
        win.show()

    It is non-modal by default: the page and other windows stay usable, and
    pressing a window brings it to the front. Events carry how it went away,
    as with :class:`~wapyt.ModalWindow`: ``reason`` is ``"button"``,
    ``"escape"`` or ``"code"``.
    """

    def __init__(self, config: Optional[WindowConfig] = None) -> None:
        require_js("Window")
        self.config = config or WindowConfig()
        self.window = js.wapyt.Window.new(js.JSON.parse(json.dumps(self.config.to_dict())))
        self._event_proxies: Dict[str, List[Any]] = {}

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda payload=None: handler(to_plain(payload)))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.window.on(event_name, proxy)

    # Events ------------------------------------------------------------

    def on_show(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("show", handler)

    def on_hide(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """``{"reason": "button" | "escape" | "code"}``."""
        self._bind_event("hide", handler)

    def on_close(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The window was removed: ``{"reason": ...}``. Nothing fires after it."""
        self._bind_event("close", handler)

    def on_move(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Moved by the person (drag or arrow keys): ``{"left", "top"}``."""
        self._bind_event("move", handler)

    def on_resize(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Resized, maximised or restored by the person:
        ``{"width", "height", "maximized"}`` (plus ``left`` / ``top`` after
        an edge drag, which can move it)."""
        self._bind_event("resize", handler)

    def on_focus(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The window came to the front."""
        self._bind_event("focus", handler)

    # Content -----------------------------------------------------------

    @property
    def body(self) -> Any:
        """The content element, to mount a widget into (``container=win.body``)."""
        return self.window.bodyEl

    @property
    def footer(self) -> Any:
        """The footer element (``WindowConfig(footer=True)``), else None."""
        element = self.window.footerEl
        return None if to_plain(element) is None else element

    def set_content(self, component: Any) -> None:
        """Replace the body with an element or a widget's root. A string is
        shown as text (not parsed as HTML)."""
        self.window.setContent(component)

    def set_title(self, title: str) -> None:
        self.window.setTitle(title)

    # Showing -----------------------------------------------------------

    def show(self) -> None:
        """Show it (focus moves to its first control) and bring it to the front."""
        self.window.show()

    def hide(self) -> None:
        self.window.hide()

    def close(self) -> None:
        """Remove the window; its event handlers are released afterwards."""
        self.window.close()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()

    def is_visible(self) -> bool:
        return bool(self.window.isVisible())

    def bring_to_front(self) -> None:
        self.window.bringToFront()

    # Geometry ----------------------------------------------------------

    def set_position(self, left: Size, top: Size) -> None:
        """Move it (kept on screen); no ``on_move``."""
        self.window.setPosition(left, top)

    def get_position(self) -> Dict[str, int]:
        return to_plain(self.window.getPosition()) or {}

    def set_size(self, width: Optional[Size] = None, height: Optional[Size] = None) -> None:
        """Resize it within its limits; no ``on_resize``."""
        self.window.setSize(js.undefined if width is None else width, js.undefined if height is None else height)

    def get_size(self) -> Dict[str, int]:
        return to_plain(self.window.getSize()) or {}

    def center(self) -> None:
        self.window.center()

    def maximize(self) -> None:
        self.window.maximize()

    def restore(self) -> None:
        self.window.restore()

    def is_maximized(self) -> bool:
        return bool(self.window.isMaximized())


__all__ = ["Window", "WindowConfig"]
