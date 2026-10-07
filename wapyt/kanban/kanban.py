"""
Kanban: columns of draggable cards, built from Listbox columns.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from ..listbox.listbox_config import ListAction
from .kanban_config import KanbanColumn, KanbanConfig

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


class Kanban:
    """
    A board of columns whose cards drag between them.

    Quick start::

        board = layout.add_kanban("main", KanbanConfig(columns=[
            KanbanColumn("todo", "To do", items=[{"id": "c1", "title": "Write spec"}]),
            KanbanColumn("doing", "Doing", wip_limit=3),
            KanbanColumn("done", "Done", color="#10b981"),
        ], actions=[ListAction("edit", "Edit", "mdi-pencil")], filterable=True))

        def moved(e):
            if not api.move_card(e["id"], e["to_column"], e["to_index"]):
                board.move_card(e["id"], e["from_column"], e["from_index"])  # put it back

        board.on_move(moved)
        board.on_add_card(lambda e: board.add_card(e["column"], new_card()))

    Every column is a :class:`Listbox`, so cards support the same templates,
    live widgets (``card_body(id)``), actions and keyboard moves: Space picks
    a card up, arrows move it, Left / Right to the next column, Space drops.
    """

    def __init__(
        self,
        config: Optional[KanbanConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Kanban requires a container or a root element.")
        require_js("Kanban")
        self.config = config or KanbanConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Kanban.")
        self.board = js.wapyt.Kanban.new(root_element, js.JSON.parse(json.dumps(self.config.to_dict())))

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
        self.board.on(event_name, proxy)

    # Events ---------------------------------------------------------------

    def on_move(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A card was dropped somewhere new: ``{"id", "card", "from_column",
        "to_column", "from_index", "to_index"}``. It has already moved; put a
        refused move back with :meth:`move_card`."""
        self._bind_event("move", handler)

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """``{"id", "card", "column"}``; all None when nothing is selected.
        One card is selected across the whole board."""
        self._bind_event("select", handler)

    def on_activate(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Double-click or Enter on a card: ``{"id", "card", "column"}``."""
        self._bind_event("activate", handler)

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A card's :class:`ListAction`: ``{"action", "id", "card", "column"}``."""
        self._bind_event("action", handler)

    def on_add_card(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A column's add button: ``{"column"}``. Add the card with
        :meth:`add_card` once you have it."""
        self._bind_event("add_card", handler)

    def on_column_move(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A column was dragged (or Alt+arrowed) to a new place: ``{"id",
        "from_index", "to_index", "columns"}`` (the new order)."""
        self._bind_event("column_move", handler)

    def on_column_toggle(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A column was collapsed or expanded: ``{"id", "collapsed"}``."""
        self._bind_event("column_toggle", handler)

    # Cards ----------------------------------------------------------------

    def get_board(self) -> Dict[str, List[Dict[str, Any]]]:
        """``{column_id: [cards in order]}``."""
        return dict(to_plain(self.board.getBoard()) or {})

    def get_cards(self, column_id: str) -> List[Dict[str, Any]]:
        return list(to_plain(self.board.getCards(column_id)) or [])

    def get_card(self, card_id: str) -> Optional[Dict[str, Any]]:
        return to_plain(self.board.getCard(str(card_id)))

    def column_of(self, card_id: str) -> Optional[str]:
        return to_plain(self.board.columnOf(str(card_id)))

    def add_card(self, column_id: str, card: Dict[str, Any], index: Optional[int] = None) -> None:
        self.board.addCard(column_id, js.JSON.parse(json.dumps(card)), js.undefined if index is None else int(index))

    def update_card(self, card_id: str, fields: Dict[str, Any]) -> None:
        """Change some fields and redraw the card; widgets in its body stay."""
        self.board.updateCard(str(card_id), js.JSON.parse(json.dumps(fields)))

    def remove_card(self, card_id: str) -> None:
        self.board.removeCard(str(card_id))

    def card_body(self, card_id: str) -> Any:
        """The element inside a card to mount widgets into."""
        return self.board.cardBody(str(card_id))

    def move_card(self, card_id: str, column_id: str, index: Optional[int] = None) -> bool:
        """Move a card without firing ``on_move``: how to put back a refused
        move."""
        return bool(self.board.moveCard(str(card_id), column_id, js.undefined if index is None else int(index)))

    def select(self, card_id: str) -> None:
        self.board.select(str(card_id))

    def get_selected(self) -> Optional[str]:
        return to_plain(self.board.getSelected())

    # Columns --------------------------------------------------------------

    def get_column_ids(self) -> List[str]:
        return list(to_plain(self.board.getColumnIds()) or [])

    def move_column(self, column_id: str, index: int) -> None:
        """Reorder a column without firing ``on_column_move`` (to restore a
        saved order)."""
        self.board.moveColumn(column_id, int(index))

    def set_wip_limit(self, column_id: str, limit: Optional[int]) -> None:
        self.board.setWipLimit(column_id, js.undefined if limit is None else int(limit))

    def set_collapsed(self, column_id: str, collapsed: bool = True) -> None:
        self.board.setCollapsed(column_id, bool(collapsed))

    def is_collapsed(self, column_id: str) -> bool:
        return bool(self.board.isCollapsed(column_id))

    def set_filter(self, text: str) -> None:
        self.board.setFilter(str(text or ""))

    def destroy(self) -> None:
        self.board.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["Kanban", "KanbanConfig", "KanbanColumn", "ListAction"]
