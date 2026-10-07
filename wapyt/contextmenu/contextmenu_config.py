from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class MenuItem:
    """
    One menu entry.

    Args:
        id: Emitted as ``id`` by ``on_select``; used by ``show_at(hide=...,
            disable=...)``. Must be unique across the whole menu, submenus
            included.
        label: Visible text; defaults to the id.
        icon: MDI class (``mdi-pencil``) or a Material Symbols name.
        shortcut: A hint shown on the right ("Ctrl+C"). Display only: the
            menu does not bind it.
        danger: Destructive styling.
        disabled: Shown but not choosable.
        items: A submenu. An item with ``items`` opens it instead of being
            selected.
        separator: A divider; every other field is ignored. Separators that
            would lead, trail or double up after hiding items are dropped.
        checkable: A toggle (``role="menuitemcheckbox"``): choosing it flips
            a tick, and ``on_select`` carries the new ``checked``.
        group: Makes it one of a radio group (``role="menuitemradio"``):
            choosing it checks it and unchecks the rest of the group.
        checked: Initial state of a checkable or group item.
    """

    id: str = ""
    label: Optional[str] = None
    icon: Optional[str] = None
    shortcut: Optional[str] = None
    danger: bool = False
    disabled: bool = False
    items: List["MenuItem"] = field(default_factory=list)
    separator: bool = False
    checkable: bool = False
    group: Optional[str] = None
    checked: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if self.separator:
            return {"separator": True}
        if not self.id:
            raise ValueError("a MenuItem needs an id unless it is a separator")
        return _clean(
            {
                "id": self.id,
                "label": self.label,
                "icon": self.icon,
                "shortcut": self.shortcut,
                "danger": self.danger or None,
                "disabled": self.disabled or None,
                "items": [
                    item.to_dict() if hasattr(item, "to_dict") else item for item in self.items
                ] or None,
                "checkable": self.checkable or None,
                "group": self.group,
                "checked": self.checked or None,
            }
        )


def check_unique_ids(items: List[Dict[str, Any]]) -> None:
    """Raise if an id repeats anywhere in the tree (submenus included)."""
    ids: List[str] = []
    _collect_ids(items, ids)
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ValueError(f"duplicate menu item ids: {', '.join(duplicates)}")


def _collect_ids(items: List[Dict[str, Any]], into: List[str]) -> None:
    for item in items:
        if item.get("separator"):
            continue
        into.append(str(item.get("id")))
        _collect_ids(item.get("items") or [], into)


@dataclass
class ContextMenuConfig:
    """
    Items and labelling for :class:`ContextMenu`.

    Args:
        items: Entries in order; ``MenuItem(separator=True)`` for dividers.
        label: Accessible name of the menu.
        extra: Additional properties forwarded to JS verbatim.
    """

    items: List[MenuItem] = field(default_factory=list)
    label: str = "Context menu"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        items = [item.to_dict() if hasattr(item, "to_dict") else item for item in self.items]
        check_unique_ids(items)
        payload = {"items": items, "label": self.label}
        payload.update(self.extra or {})
        return _clean(payload)
