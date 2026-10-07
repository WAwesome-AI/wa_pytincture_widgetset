"""
MenuBar: a horizontal application menu whose titles open ContextMenu dropdowns.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from ..contextmenu.contextmenu_config import MenuItem
from .menubar_config import MenuBarConfig

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


def _id_list(ids: Union[str, Iterable[str]]) -> List[str]:
    return [ids] if isinstance(ids, str) else [str(i) for i in ids]


class MenuBar:
    """
    A File / Edit / View style menu bar, usually in ``mainwindow_header``.

    Quick start::

        bar = layout.add_menubar("mainwindow_header", MenuBarConfig(items=[
            MenuItem("file", "File", items=[
                MenuItem("new", "New", "mdi-file-outline", shortcut="Ctrl+N"),
                MenuItem("open", "Open…", "mdi-folder-open-outline"),
                MenuItem(separator=True),
                MenuItem("quit", "Quit"),
            ]),
            MenuItem("view", "View", items=[
                MenuItem("wrap", "Word wrap", checkable=True, checked=True),
                MenuItem("light", "Light", group="theme", checked=True),
                MenuItem("dark", "Dark", group="theme"),
            ]),
            MenuItem("help", "Help"),            # a plain command on the bar
        ]))
        bar.on_select(lambda p: run(p["id"]))

    Keyboard: one tab stop; Left / Right move between titles, Down / Enter /
    Space open a menu, Left / Right inside an open menu move to the
    neighbouring one, Escape closes and returns to the title. Once a menu is
    open, pointing at another title switches to it.
    """

    def __init__(
        self,
        config: Optional[MenuBarConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("MenuBar requires a container or a root element.")
        require_js("MenuBar")
        self.config = config or MenuBarConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for MenuBar.")
        self.bar = js.wapyt.MenuBar.new(root_element, js.JSON.parse(json.dumps(self.config.to_dict())))

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        target = container
        if target is not None:
            if hasattr(target, "getContainer"):
                return target.getContainer()
            if hasattr(target, "element"):
                return target.element
            return target
        if isinstance(root, str):
            element = js.document.querySelector(root)
            if not element:
                element = js.document.getElementById(root)
            return element
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda *args, **kwargs: handler(*[to_plain(arg) for arg in args], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.bar.on(event_name, proxy)

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item was chosen: ``{"id", "menu"}`` (``menu`` is the title's
        id, or None for a plain command on the bar), plus ``checked`` for a
        checkable or group item."""
        self._bind_event("select", handler)

    def on_open(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A menu opened: ``{"id"}`` of its title, e.g. to refresh what it
        enables before it is seen."""
        self._bind_event("open", handler)

    def open(self, menu_id: str) -> None:
        self.bar.open(menu_id)

    def close(self) -> None:
        self.bar.close()

    def is_open(self) -> bool:
        return bool(self.bar.isOpen())

    def set_disabled(self, ids: Union[str, Iterable[str]], disabled: bool = True) -> None:
        """Grey out titles or items anywhere in the bar (``disabled=False``
        enables them again)."""
        self.bar.setDisabled(js.JSON.parse(json.dumps(_id_list(ids))), bool(disabled))

    def set_hidden(self, ids: Union[str, Iterable[str]], hidden: bool = True) -> None:
        self.bar.setHidden(js.JSON.parse(json.dumps(_id_list(ids))), bool(hidden))

    def is_disabled(self, item_id: str) -> bool:
        return bool(self.bar.isDisabled(item_id))

    def is_hidden(self, item_id: str) -> bool:
        return bool(self.bar.isHidden(item_id))

    def set_checked(self, item_id: str, checked: bool = True) -> None:
        """Tick or untick a checkable item (a group item unchecks the rest of
        its group). Does not fire ``on_select``."""
        self.bar.setChecked(item_id, bool(checked))

    def is_checked(self, item_id: str) -> bool:
        return bool(self.bar.isChecked(item_id))

    def set_items(self, items: List[MenuItem]) -> None:
        payload = MenuBarConfig(items=list(items)).to_dict()["items"]
        self.bar.setItems(js.JSON.parse(json.dumps(payload)))

    def destroy(self) -> None:
        self.bar.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["MenuBar", "MenuBarConfig", "MenuItem"]
