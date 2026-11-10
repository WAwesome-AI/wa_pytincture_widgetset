"""
Plumbing shared by the widget wrappers.

Every wrapper holds one JS widget and does the same three things with it:
find the element to mount into, bind Python handlers to its events, and
release those handlers when the widget goes away. They used to carry their own
copies of this code, with slightly different handler signatures and with most
``destroy()`` methods forgetting the proxies. ``WidgetBase`` is the one copy.

A subclass names the attribute holding its JS widget in ``_js_attr``.
"""
from __future__ import annotations

import asyncio
import inspect
from typing import Any, Callable, Dict, List, Optional, Union

from . import _runtime
from ._runtime import create_proxy, to_plain


def resolve_root(container: Any = None, root: Optional[Union[str, Any]] = None) -> Any:
    """
    The DOM element a widget mounts into.

    ``container`` wins when given: a layout cell (``getContainer()``), a
    wrapper with an ``element``, or an element itself. Otherwise ``root`` is a
    CSS selector or element id string, or an element.
    """
    if container is not None:
        if hasattr(container, "getContainer"):
            return container.getContainer()
        if hasattr(container, "element"):
            return container.element
        return container
    if isinstance(root, str):
        document = _runtime.js.document
        return document.querySelector(root) or document.getElementById(root)
    return root


class WidgetBase:
    """Event binding and proxy lifetimes for a wrapper around one JS widget."""

    #: Name of the attribute holding the JS widget (``"chart"``, ``"board"``...).
    _js_attr: str = ""

    @property
    def _js_widget(self) -> Any:
        return getattr(self, self._js_attr, None)

    @property
    def _proxies(self) -> Dict[str, List[Any]]:
        # Created on first use, so wrappers built without __init__ (the unit
        # tests use object.__new__) still work.
        return self.__dict__.setdefault("_event_proxies", {})

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        return resolve_root(container, root)

    def _convert_payload(self, value: Any) -> Any:
        """Turn an event argument into plain Python. Override to post-process."""
        return to_plain(value)

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        """
        Call ``handler`` with the converted payload whenever the JS widget
        emits ``event_name``.

        The handler gets exactly the arguments the widget emitted (one payload
        for every widget today; none for CardPanel's ``add``). An ``async``
        handler is scheduled on the running loop. A plain handler's return
        value goes back to JS, which Chat uses to mark an event handled.
        """
        def call(*args: Any) -> Any:
            result = handler(*[self._convert_payload(arg) for arg in args])
            if inspect.isawaitable(result):
                asyncio.ensure_future(result)
                return None
            return result

        proxy = create_proxy(call)
        self._proxies.setdefault(event_name, []).append(proxy)
        self._js_widget.on(event_name, proxy)

    def _release_proxies(self) -> None:
        """
        Unhook and destroy every bound handler.

        Each proxy is removed from the JS widget first (when it has ``off``),
        so an event that arrives late, like a terminal socket closing after
        ``destroy()``, finds no listener instead of a destroyed proxy.
        """
        widget = self._js_widget
        off = getattr(widget, "off", None) if widget is not None else None
        for event_name, proxies in self._proxies.items():
            for proxy in proxies:
                if off is not None:
                    try:
                        off(event_name, proxy)
                    except Exception:
                        pass
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._proxies.clear()

    def _dispose(self) -> None:
        """Destroy the JS widget, then release the handlers whatever happens."""
        try:
            widget = self._js_widget
            if widget is not None and hasattr(widget, "destroy"):
                widget.destroy()
        finally:
            self._release_proxies()
