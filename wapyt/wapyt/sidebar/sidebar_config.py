from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class SidebarItem:
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
