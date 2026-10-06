"""
Popup (an anchored popover) and tooltips.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from .popup_config import TOOLTIP_PLACEMENTS, PopupConfig, _check_placement, tooltip_attr

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore

Anchor = Union[str, Any]


def _anchor(anchor: Anchor) -> Any:
    """A selector or element passes through; ``(x, y)`` becomes a point."""
    if isinstance(anchor, (tuple, list)) and len(anchor) == 2:
        return js.JSON.parse(json.dumps({"x": anchor[0], "y": anchor[1]}))
    if hasattr(anchor, "getContainer"):
        return anchor.getContainer()
    if hasattr(anchor, "element") and not isinstance(anchor, str):
        return anchor.element
    return anchor


class Popup:
    """
    An anchored popover for pickers, help text and small forms.

    Quick start::

        popup = Popup(PopupConfig(placement="bottom-start", label="Filter"))
        Form(FormConfig(fields=[...]), container=popup.body)
        popup.toggle("#filter-button")

    The popup lives in ``<body>`` while open, so overflow cannot clip it. It
    flips to the side with room, closes on Escape (focus returns to the
    anchor) or on a press outside, and closes by itself if its anchor leaves
    the page. Anchors are an element, a CSS selector or an ``(x, y)`` point.
    """

    def __init__(self, config: Optional[PopupConfig] = None) -> None:
        require_js("Popup")
        self.config = config or PopupConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        self.popup = js.wapyt.Popup.new(js.JSON.parse(json.dumps(self.config.to_dict())))

    @property
    def body(self) -> Any:
        """The element to mount content into, like ``ModalWindow.body``."""
        return self.popup.body

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda *args, **kwargs: handler(*[to_plain(arg) for arg in args], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.popup.on(event_name, proxy)

    def on_show(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("show", handler)

    def on_hide(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires however it closed: Escape, an outside press or :meth:`hide`."""
        self._bind_event("hide", handler)

    def show(self, anchor: Anchor) -> None:
        self.popup.show(_anchor(anchor))

    def toggle(self, anchor: Anchor) -> None:
        """Open at ``anchor``, or close if already open there."""
        self.popup.toggle(_anchor(anchor))

    def hide(self) -> None:
        self.popup.hide()

    def is_visible(self) -> bool:
        return bool(self.popup.isVisible())

    def set_text(self, text: str) -> None:
        """Replace the content with plain text."""
        self.popup.setText(str(text))

    def attach_html(self, html: str) -> None:
        """Replace the content with raw HTML the app built and escaped itself."""
        self.popup.attachHTML(html)

    def destroy(self) -> None:
        self.popup.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


def tooltip(target: Anchor, text: Optional[str], placement: Optional[str] = None, *, overflow: bool = False) -> None:
    """
    Give an element a styled tooltip (shown on hover after a short delay and
    at once on keyboard focus); empty ``text`` removes it. ``overflow=True``
    shows it only while the element's text is cut off.
    """
    require_js("tooltip")
    if placement is not None:
        _check_placement(placement, TOOLTIP_PLACEMENTS)
    element = js.document.querySelector(target) if isinstance(target, str) else _anchor(target)
    if element is None:
        raise ValueError(f"tooltip target not found: {target!r}")
    js.wapyt.tooltip.set(
        element,
        text or "",
        placement or js.undefined,
        js.JSON.parse(json.dumps({"overflow": bool(overflow)})),
    )


def set_tooltips_enabled(enabled: bool) -> None:
    """Turn every wapyt tooltip off or back on."""
    require_js("tooltip")
    js.wapyt.tooltip.setEnabled(bool(enabled))


__all__ = ["Popup", "PopupConfig", "tooltip", "tooltip_attr", "set_tooltips_enabled"]
