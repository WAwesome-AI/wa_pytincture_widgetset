"""
Listbox: rich items (text fields or an escaped template), live widgets inside
items, actions, selection, a filter, and drag-and-drop within and between lists.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from .listbox_config import ListAction, ListboxConfig

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


class Listbox:
    """
    A list of rich items, and the column type of a Kanban board.

    Quick start::

        todo = Listbox(ListboxConfig(
            label="To do", list_id="todo", group="board", draggable=True,
            items=[{"id": "t1", "title": "Write spec", "subtitle": "Due Friday", "badge": 2}],
            actions=[ListAction("edit", "Edit", "mdi-pencil")],
        ), container=cell)
        ProgressBar(ProgressBarConfig(value=40, compact=True), container=todo.item_body("t1"))

        def moved(e):                       # fires on the list the item lands in
            if not api.move(e["id"], e["to_list"], e["to_index"]):
                todo.move_item(e["id"], e["from_index"])   # put it back

        todo.on_move(moved)

    Widgets mounted in ``item_body(id)`` stay alive through updates and
    drags, including into another list. Buttons, inputs and links inside an
    item stay usable: a drag starts only from the item itself (or its grip
    with ``drag_handle=True``) and only after a small movement.

    Keyboard: one tab stop; Up / Down / Home / End move; Enter activates;
    Space selects, or with ``draggable`` picks the item up (Ctrl+Space then
    selects). While picked up, Up / Down move it, Left / Right move it to the
    neighbouring list of its group, Space drops, Escape cancels.
    """

    def __init__(
        self,
        config: Optional[ListboxConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Listbox requires a container or a root element.")
        require_js("Listbox")
        self.config = config or ListboxConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Listbox.")
        self.listbox = js.wapyt.Listbox.new(root_element, js.JSON.parse(json.dumps(self.config.to_dict())))

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
        self.listbox.on(event_name, proxy)

    # Events ---------------------------------------------------------------

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """``{"ids", "id", "items"}``; ``id`` is None unless exactly one."""
        self._bind_event("select", handler)

    def on_activate(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Double-click or Enter: ``{"id", "item"}``."""
        self._bind_event("activate", handler)

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A :class:`ListAction` button: ``{"action", "id", "item"}``."""
        self._bind_event("action", handler)

    def on_move(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        An item was dropped somewhere new (by pointer or keyboard). Fires on
        the list it lands in: ``{"id", "item", "from_list", "to_list",
        "from_index", "to_index", "copy"}``. The move has already happened;
        if the server refuses, put it back with :meth:`move_item`.
        """
        self._bind_event("move", handler)

    def on_drag_start(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("drag_start", handler)

    # Items ----------------------------------------------------------------

    def set_items(self, items: List[Dict[str, Any]]) -> None:
        """Replace every item (widgets mounted in item bodies are dropped)."""
        self.listbox.setItems(js.JSON.parse(json.dumps(items)))

    def get_items(self) -> List[Dict[str, Any]]:
        """The items in their current order."""
        return list(to_plain(self.listbox.getItems()) or [])

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        return to_plain(self.listbox.getItem(str(item_id)))

    def add_item(self, item: Dict[str, Any], index: Optional[int] = None) -> None:
        self.listbox.addItem(js.JSON.parse(json.dumps(item)), js.undefined if index is None else int(index))

    def update_item(self, item_id: str, fields: Dict[str, Any]) -> None:
        """Change some of an item's fields and redraw its content; widgets in
        its body are kept."""
        self.listbox.updateItem(str(item_id), js.JSON.parse(json.dumps(fields)))

    def remove_item(self, item_id: str) -> None:
        self.listbox.removeItem(str(item_id))

    def item_body(self, item_id: str) -> Any:
        """The element inside an item to mount widgets into (``container=``)."""
        return self.listbox.itemBody(str(item_id))

    def move_item(self, item_id: str, index: Optional[int] = None, to: Optional["Listbox"] = None) -> bool:
        """
        Move an item to ``index`` (end when None) in this list or in ``to``,
        without firing ``on_move``: how to put back a refused drop.
        """
        target = to.listbox if to is not None else js.undefined
        return bool(self.listbox.move(str(item_id), js.undefined if index is None else int(index), target))

    # Selection and filter ---------------------------------------------------

    def get_selected_ids(self) -> List[str]:
        return list(to_plain(self.listbox.getSelectedIds()) or [])

    def select(self, ids: Union[str, List[str]]) -> None:
        self.listbox.select(js.JSON.parse(json.dumps([ids] if isinstance(ids, str) else list(ids))))

    def clear_selection(self) -> None:
        self.listbox.clearSelection()

    def set_filter(self, text: str) -> None:
        self.listbox.setFilter(str(text or ""))

    def destroy(self) -> None:
        self.listbox.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["Listbox", "ListboxConfig", "ListAction"]
