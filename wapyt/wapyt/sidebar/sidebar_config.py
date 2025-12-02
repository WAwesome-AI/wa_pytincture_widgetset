from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class SidebarItem:
    """
    Represents a clickable entry in the Sidebar widget.

    Args:
        id: Identifier emitted by `Sidebar.on_select`.
        label: Visible text.
        icon: Optional CSS class (e.g., Material icon).
        badge: Optional pill rendered to the right of the label.
        data: Arbitrary metadata forwarded to event handlers.
    """

    id: str
    label: str
    icon: Optional[str] = None
    badge: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "id": self.id,
            "label": self.label,
            "icon": self.icon,
            "badge": self.badge,
            "data": self.data or {},
        }
        return {key: value for key, value in payload.items() if value is not None}


@dataclass
class SidebarConfig:
    """
    Controls Sidebar rendering/behavior.

    Args:
        title: Optional heading rendered above the list.
        collapse_button: Whether the built-in collapse toggle is shown.
        collapsed: Initial collapsed state.
        items: List of :class:`SidebarItem` entries.
        active: ID to mark as selected when the widget mounts.
    """

    title: Optional[str] = None
    collapse_button: bool = True
    collapsed: bool = False
    items: List[SidebarItem] = field(default_factory=list)
    active: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "collapseButton": self.collapse_button,
            "collapsed": self.collapsed,
            "items": [
                item.to_dict() if hasattr(item, "to_dict") else item for item in self.items
            ],
            "active": self.active,
        }
