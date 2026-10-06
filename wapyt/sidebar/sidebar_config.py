from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


@dataclass
class SidebarItem:
    """
    A clickable entry in the Sidebar, or a group when it has ``items``.

    Args:
        id: Identifier emitted by ``Sidebar.on_select`` (and ``on_toggle`` for
            a group).
        label: Visible text.
        icon: MDI class (``mdi-home``) or a Material Symbols name mapped onto
            MDI. Top-level items without one show their label's first letter
            on the collapsed rail.
        badge: A small count or tag after the label; ``0`` is shown.
        data: Arbitrary metadata forwarded to ``on_select``.
        items: Child entries; makes this a group that expands and collapses
            instead of being selected. Groups nest.
        expanded: A group's initial state.
        disabled: Shown but not clickable.
        tooltip: Hover text; defaults to the label.
    """

    id: str
    label: str
    icon: Optional[str] = None
    badge: Optional[Union[str, int]] = None
    data: Dict[str, Any] = field(default_factory=dict)
    items: Optional[List[Any]] = None
    expanded: bool = False
    disabled: bool = False
    tooltip: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "id": self.id,
            "label": self.label,
            "icon": self.icon,
            "badge": self.badge,
            "data": self.data or {},
            "items": [_entry(child) for child in self.items] if self.items is not None else None,
            "expanded": self.expanded or None,
            "disabled": self.disabled or None,
            "tooltip": self.tooltip,
        }
        return {key: value for key, value in payload.items() if value is not None}


@dataclass
class SidebarSeparator:
    """A thin divider line."""

    def to_dict(self) -> Dict[str, Any]:
        return {"type": "separator"}


@dataclass
class SidebarSpacer:
    """Takes the free space, pushing the entries after it to the bottom (a
    Settings or Sign out item)."""

    def to_dict(self) -> Dict[str, Any]:
        return {"type": "spacer"}


@dataclass
class SidebarHeading:
    """A small section title between entries; hidden on the collapsed rail."""

    label: str

    def to_dict(self) -> Dict[str, Any]:
        return {"type": "heading", "label": self.label}


def _entry(item: Any) -> Any:
    return item.to_dict() if hasattr(item, "to_dict") else item


@dataclass
class SidebarConfig:
    """
    Controls Sidebar rendering/behavior.

    Args:
        title: Optional heading rendered above the list.
        collapse_button: Whether the built-in collapse toggle is shown.
        collapsed: Initial collapsed state (icons only).
        items: :class:`SidebarItem` entries (groups via their ``items``),
            :class:`SidebarHeading`, :class:`SidebarSeparator` and
            :class:`SidebarSpacer`.
        active: ID to mark as selected when the widget mounts; groups above
            it open.
        expanded: Group ids to open at mount, overriding each group's own
            ``expanded``, e.g. restored from ``Sidebar.get_expanded()``.
    """

    title: Optional[str] = None
    collapse_button: bool = True
    collapsed: bool = False
    items: List[Any] = field(default_factory=list)
    active: Optional[str] = None
    expanded: Optional[List[str]] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "title": self.title,
            "collapseButton": self.collapse_button,
            "collapsed": self.collapsed,
            "items": [_entry(item) for item in self.items],
            "active": self.active,
        }
        if self.expanded is not None:
            payload["expanded"] = list(self.expanded)
        return payload
