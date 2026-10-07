from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from ..listbox.listbox_config import ListAction


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class KanbanColumn:
    """
    One column of a :class:`Kanban` board.

    Args:
        id: Reported as ``from_column`` / ``to_column`` in ``on_move``.
        title: Header text; defaults to the id.
        items: The column's cards (dicts; see :class:`Kanban`).
        wip_limit: Work-in-progress limit shown as "3 / 5"; the column is
            marked when over it, and with ``KanbanConfig(wip_strict=True)``
            takes no more cards once full.
        color: Accent colour of the column's top edge (any CSS colour).
        collapsed: Start collapsed to a narrow strip.
        width: Column width in px (default ``KanbanConfig.column_width``).
    """

    id: str
    title: Optional[str] = None
    items: List[Dict[str, Any]] = field(default_factory=list)
    wip_limit: Optional[int] = None
    color: Optional[str] = None
    collapsed: bool = False
    width: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        if self.wip_limit is not None and self.wip_limit < 0:
            raise ValueError(f"KanbanColumn {self.id!r}: wip_limit must not be negative")
        return _clean({
            "id": self.id,
            "title": self.title,
            "items": list(self.items),
            "wipLimit": self.wip_limit,
            "color": self.color,
            "collapsed": self.collapsed or None,
            "width": self.width,
        })


@dataclass
class KanbanConfig:
    """
    Columns and behaviour of a :class:`Kanban` board.

    Args:
        columns: :class:`KanbanColumn` entries, left to right.
        id_field: Key holding each card's id; ids are unique across the board.
        template: Card HTML with ``{key}`` placeholders, escaped (a key ending
            in ``Html`` is inserted as markup). Without it, cards draw
            ``title`` / ``subtitle`` / ``meta`` / ``icon`` / ``badge``.
        actions: :class:`ListAction` buttons on every card.
        add_card: An add button in each column header (fires
            ``on_add_card``).
        add_card_label: Its accessible name ("Add card to <column>").
        wip_strict: A column at its WIP limit takes no more cards.
        filterable: One filter box for the whole board.
        filter_placeholder, empty_text, label: Copy.
        column_width: Default column width in px.
        reorderable_columns: Drag a column by its header (or Alt+Left /
            Alt+Right on a focused header) to reorder.
        extra: Additional properties forwarded to JS verbatim.
    """

    columns: List[KanbanColumn] = field(default_factory=list)
    id_field: str = "id"
    template: Optional[str] = None
    actions: List[ListAction] = field(default_factory=list)
    add_card: bool = True
    add_card_label: Optional[str] = None
    wip_strict: bool = False
    filterable: bool = False
    filter_placeholder: Optional[str] = None
    empty_text: Optional[str] = None
    label: str = "Board"
    column_width: int = 280
    reorderable_columns: bool = True
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        columns = [c.to_dict() if hasattr(c, "to_dict") else c for c in self.columns]
        column_ids = [str(c["id"]) for c in columns]
        dup_cols = sorted({i for i in column_ids if column_ids.count(i) > 1})
        if dup_cols:
            raise ValueError(f"duplicate Kanban column ids: {', '.join(dup_cols)}")
        card_ids = [str(card.get(self.id_field)) for c in columns for card in c.get("items", [])]
        if any(card.get(self.id_field) is None for c in columns for card in c.get("items", [])):
            raise ValueError(f"every Kanban card needs an {self.id_field!r}")
        dup_cards = sorted({i for i in card_ids if card_ids.count(i) > 1})
        if dup_cards:
            raise ValueError(f"duplicate Kanban card ids: {', '.join(dup_cards)}")
        payload = {
            "columns": columns,
            "idField": self.id_field,
            "template": self.template,
            "actions": [a.to_dict() if hasattr(a, "to_dict") else a for a in self.actions],
            "addCard": self.add_card,
            "addCardLabel": self.add_card_label,
            "wipStrict": self.wip_strict,
            "filterable": self.filterable,
            "filterPlaceholder": self.filter_placeholder,
            "emptyText": self.empty_text,
            "label": self.label,
            "columnWidth": self.column_width,
            "reorderableColumns": self.reorderable_columns,
        }
        payload.update(self.extra or {})
        return _clean(payload)
