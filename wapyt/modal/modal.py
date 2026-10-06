from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union

from wapyt._runtime import create_proxy, js, require_js, to_plain


@dataclass
class ModalConfig:
    """
    Declarative options for :class:`ModalWindow`.

    Args:
        title: Header text displayed at the top of the modal.
        width: Pixel value or CSS size for the modal; defaults to ``520``.
        height: Pixel value or CSS size for the modal; defaults to ``360``.
        closable: When ``False`` the chrome hides the close affordance.
        dispose_on_close: The close button, Escape and a backdrop click remove
            the dialog (as :meth:`ModalWindow.close` does) instead of hiding
            it. For a modal built per use; leave it off for one that is built
            once and shown again.
    """

    title: str = ""
    width: Union[int, str] = 520
    height: Union[int, str] = 360
    closable: bool = True
    dispose_on_close: bool = False

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "width": self.width,
            "height": self.height,
            "closable": self.closable,
            "disposeOnClose": self.dispose_on_close,
        }


class ModalWindow:
    """
    Lightweight wrapper around the JavaScript modal component.

    Quick start::

        modal = ModalWindow(ModalConfig(title="Details"))
        modal.set_content(layout.layout)
        modal.on_hide(lambda e: save_draft() if e["reason"] != "code" else None)
        modal.show()

    Events carry how the dialog went away: ``reason`` is ``"button"`` (the
    ×), ``"escape"``, ``"backdrop"`` or ``"code"`` (the app's own
    ``hide()`` / ``close()``). Only the topmost of stacked modals answers
    Escape.
    """

    def __init__(self, config: Optional[ModalConfig] = None) -> None:
        require_js("ModalWindow")
        config_payload = (config or ModalConfig()).to_dict()
        self.modal = js.wapyt.ModalWindow.new(js.JSON.parse(json.dumps(config_payload)))
        self._event_proxies: Dict[str, List[Any]] = {}

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda payload=None: handler(to_plain(payload)))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.modal.on(event_name, proxy)

    def on_show(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The modal became visible."""
        self._bind_event("show", handler)

    def on_hide(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The modal stopped being visible: ``{"reason": "button" | "escape" |
        "backdrop" | "code"}``. Fires before ``on_close`` when it is removed."""
        self._bind_event("hide", handler)

    def on_close(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The modal was removed (``close()``, or a dismissal with
        ``dispose_on_close``): ``{"reason": ...}``. Nothing fires after it."""
        self._bind_event("close", handler)

    def is_visible(self) -> bool:
        return bool(self.modal.isVisible())

    @property
    def body(self) -> Any:
        """
        The modal's content element, for mounting a widget straight into it::

            form = Form(config, container=modal.body)

        ``set_content`` replaces the body wholesale, which destroys a widget
        already mounted there; this hands back the element to build into.
        """
        return self.modal.bodyEl

    def set_content(self, component: Any) -> None:
        self.modal.setContent(component)

    def set_title(self, title: str) -> None:
        self.modal.setTitle(title)

    def show(self) -> None:
        self.modal.show()

    def hide(self) -> None:
        self.modal.hide()

    def close(self) -> None:
        """Remove the modal; ``on_hide`` and ``on_close`` fire with reason
        ``"code"``. Its event handlers are released afterwards."""
        self.modal.close()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()
