from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ResourceItem:
    """
    Item descriptor rendered inside the ResourceBoard list.

    Args:
        id: Identifier returned by ``on_select`` / ``on_action`` callbacks.
        title: Primary label for the item.
        subtitle: Secondary label/supporting text.
        status: Textual status token (e.g., ``"active"``).
        badge: Small pill rendered next to the title.
        extra: Arbitrary metadata forwarded to the detail template context.
    """

    id: str
    title: str
    subtitle: Optional[str] = None
    status: Optional[str] = None
    badge: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "id": self.id,
            "title": self.title,
            "subtitle": self.subtitle,
            "status": self.status,
            "badge": self.badge,
            "extra": self.extra or {},
        }
        return {key: value for key, value in data.items() if value is not None}


@dataclass
class ResourceBoardConfig:
    """
    Configuration for the master/detail resource browser.

    Args:
        items: Initial collection of :class:`ResourceItem` or dicts.
        selected_id: ID that should be selected on load.
        list_width: Constrains the list column (px).
        add_button_text: Label for the built-in add button.
        detail_template: HTML template populated with item placeholders.
        empty_state: Text or markup rendered when no selection is active.
        title: Optional heading above the board.
    """

    items: List[Any] = field(default_factory=list)
    selected_id: Optional[str] = None
    list_width: Optional[int] = None
    add_button_text: Optional[str] = None
    detail_template: Optional[str] = None
    empty_state: Optional[str] = None
    title: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload_items: List[Dict[str, Any]] = []
        for item in self.items:
            if hasattr(item, "to_dict"):
                payload_items.append(item.to_dict())
            elif isinstance(item, dict):
                payload_items.append(item)
            else:
                raise TypeError(f"Unsupported resource item type: {type(item)!r}")
        config = {
            "items": payload_items,
            "selected": self.selected_id,
            "listWidth": self.list_width,
            "addButtonText": self.add_button_text,
            "detailTemplate": self.detail_template,
            "emptyState": self.empty_state,
            "title": self.title,
        }
        return {key: value for key, value in config.items() if value is not None}
