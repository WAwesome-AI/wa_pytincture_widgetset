from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

SELECTION = ("none", "single", "multi")


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class ListAction:
    """An icon button on every item; fires ``Listbox.on_action``."""

    id: str
    label: Optional[str] = None
    icon: Optional[str] = None
    danger: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return _clean({"id": self.id, "label": self.label, "icon": self.icon, "danger": self.danger or None})


@dataclass
class ListboxConfig:
    """
    Items and behaviour of a :class:`Listbox`.

    Items are dicts with an id (``id_field``) and, without a ``template``,
    any of ``title``, ``subtitle``, ``meta``, ``icon`` (MDI class), ``badge``
    and ``disabled``. Every other key is kept and comes back in events.

    Args:
        items: The items, in order.
        id_field: Key holding each item's unique id.
        template: HTML for each item's content, with ``{key}`` placeholders.
            Values are escaped; a key ending in ``Html`` (``{notesHtml}``) is
            inserted as markup, for HTML the app built itself.
        selection: ``none``, ``single`` (default) or ``multi``.
        draggable: Items can be dragged to reorder, and to other lists in
            the same ``group``.
        drag_handle: Drag only by a grip on each item.
        group: Lists sharing a group can drag items between each other
            (Kanban columns).
        list_id: This list's name in ``on_move`` payloads (``from_list`` /
            ``to_list``); defaults to ``label``.
        accept: Take drops from other lists in the group.
        copy: Dragging out copies the item and leaves it here.
        actions: :class:`ListAction` buttons shown on each item.
        filterable: A filter box above the list (dragging pauses while it
            filters).
        filter_placeholder, empty_text: Copy.
        label: Accessible name of the list.
        extra: Additional properties forwarded to JS verbatim.
    """

    items: List[Dict[str, Any]] = field(default_factory=list)
    id_field: str = "id"
    template: Optional[str] = None
    selection: str = "single"
    draggable: bool = False
    drag_handle: bool = False
    group: Optional[str] = None
    list_id: Optional[str] = None
    accept: bool = True
    copy: bool = False
    actions: List[ListAction] = field(default_factory=list)
    filterable: bool = False
    filter_placeholder: Optional[str] = None
    empty_text: Optional[str] = None
    label: str = "List"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        if self.selection not in SELECTION:
            raise ValueError(f"selection must be one of {', '.join(SELECTION)}; got {self.selection!r}")
        ids = [str(item.get(self.id_field)) for item in self.items]
        if any(item.get(self.id_field) is None for item in self.items):
            raise ValueError(f"every Listbox item needs an {self.id_field!r}")
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate Listbox item ids: {', '.join(duplicates)}")
        payload = {
            "items": list(self.items),
            "idField": self.id_field,
            "template": self.template,
            "selection": self.selection,
            "draggable": self.draggable,
            "dragHandle": self.drag_handle,
            "group": self.group,
            "listId": self.list_id,
            "accept": self.accept,
            "copy": self.copy,
            "actions": [a.to_dict() if hasattr(a, "to_dict") else a for a in self.actions],
            "filterable": self.filterable,
            "filterPlaceholder": self.filter_placeholder,
            "emptyText": self.empty_text,
            "label": self.label,
        }
        payload.update(self.extra or {})
        return _clean(payload)
