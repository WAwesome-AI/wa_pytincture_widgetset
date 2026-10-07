"""
ContextMenu: a standalone right-click menu with icons, shortcut hints, danger
and disabled items, separators and submenus.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from .contextmenu_config import ContextMenuConfig, MenuItem

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore



class ContextMenu:
    """
    A right-click menu, not mounted in a cell: it opens at the pointer.

    Quick start::

        menu = ContextMenu(ContextMenuConfig(items=[
            MenuItem("open", "Open", "mdi-open-in-new", shortcut="Enter"),
            MenuItem("share", "Share", "mdi-share-variant", items=[
                MenuItem("copy_link", "Copy link", "mdi-link"),
                MenuItem("email", "Email…", "mdi-email-outline"),
            ]),
            MenuItem(separator=True),
            MenuItem("delete", "Delete", "mdi-delete", danger=True),
        ]))
        menu.attach("#files", context="files")
        menu.on_select(lambda p: handle(p["id"], p["target"]))

    ``attach`` opens it on right-click, Shift+F10 or the Menu key over an
    element; ``target`` in the payload is the ``data-context`` attribute of the
    nearest element under the pointer that has one (a row id, say). For full
    control call ``show_at(x, y, context=..., hide=[...], disable=[...])``
    from your own handler. Labels and hints are set as text, never markup.
    """

    def __init__(self, config: Optional[ContextMenuConfig] = None) -> None:
        require_js("ContextMenu")
        self.config = config or ContextMenuConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        self.menu = js.wapyt.ContextMenu.new(js.JSON.parse(json.dumps(self.config.to_dict())))

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda *args, **kwargs: handler(*[to_plain(arg) for arg in args], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.menu.on(event_name, proxy)

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item was chosen: ``{"id", "context", "target"}``, plus
        ``checked`` (the new state) for a checkable or group item."""
        self._bind_event("select", handler)

    def on_show(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The menu opened: ``{"context", "target"}``."""
        self._bind_event("show", handler)

    def on_hide(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The menu closed, chosen or dismissed: ``{"context", "target"}``."""
        self._bind_event("hide", handler)

    # ------------------------------------------------------------------
    # Opening
    # ------------------------------------------------------------------

    def attach(self, target: Union[str, Any], context: Any = None) -> None:
        """
        Open on right-click, Shift+F10 or the Menu key over ``target`` (a CSS
        selector or element). ``context`` comes back in every payload.
        """
        self.menu.attach(target, js.undefined if context is None else _to_js(context))

    def detach(self, target: Union[str, Any, None] = None) -> None:
        """Stop opening over ``target``, or over everything when omitted."""
        self.menu.detach(js.undefined if target is None else target)

    def show_at(
        self,
        x: float,
        y: float,
        *,
        context: Any = None,
        target: Optional[str] = None,
        hide: Optional[Iterable[str]] = None,
        disable: Optional[Iterable[str]] = None,
    ) -> None:
        """
        Open at viewport coordinates (``event.clientX`` / ``clientY``).

        ``hide`` and ``disable`` list item ids to drop or grey out for this
        opening only -- per-row permissions, say.
        """
        options = {
            "context": context,
            "target": target,
            "hide": list(hide or []),
            "disable": list(disable or []),
        }
        self.menu.showAt(x, y, js.JSON.parse(json.dumps(options)))

    def hide(self) -> None:
        self.menu.hide()

    def is_open(self) -> bool:
        return bool(self.menu.isOpen())

    def set_items(self, items: List[MenuItem]) -> None:
        payload = ContextMenuConfig(items=list(items)).to_dict()["items"]
        self.menu.setItems(js.JSON.parse(json.dumps(payload)))

    # ------------------------------------------------------------------
    # Item state (kept across openings; ``show_at(hide=, disable=)`` adds to
    # it for one opening)
    # ------------------------------------------------------------------

    def set_disabled(self, ids: Union[str, Iterable[str]], disabled: bool = True) -> None:
        """Grey items out (``disabled=False`` enables them, even ones declared
        ``disabled``)."""
        self.menu.setDisabled(_to_js(_id_list(ids)), bool(disabled))

    def set_hidden(self, ids: Union[str, Iterable[str]], hidden: bool = True) -> None:
        self.menu.setHidden(_to_js(_id_list(ids)), bool(hidden))

    def is_disabled(self, item_id: str) -> bool:
        return bool(self.menu.isDisabled(item_id))

    def is_hidden(self, item_id: str) -> bool:
        return bool(self.menu.isHidden(item_id))

    def set_checked(self, item_id: str, checked: bool = True) -> None:
        """Tick or untick a checkable item; checking a group item unchecks
        the rest of its group. Does not fire ``on_select``."""
        self.menu.setChecked(item_id, bool(checked))

    def is_checked(self, item_id: str) -> bool:
        return bool(self.menu.isChecked(item_id))

    def destroy(self) -> None:
        self.menu.destroy()


def _to_js(value: Any) -> Any:
    return js.JSON.parse(json.dumps(value))


def _id_list(ids: Union[str, Iterable[str]]) -> List[str]:
    return [ids] if isinstance(ids, str) else [str(i) for i in ids]


__all__ = ["ContextMenu", "ContextMenuConfig", "MenuItem"]
