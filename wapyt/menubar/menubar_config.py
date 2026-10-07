from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from ..contextmenu.contextmenu_config import MenuItem, check_unique_ids


@dataclass
class MenuBarConfig:
    """
    Titles and menus for :class:`MenuBar`.

    Args:
        items: Top-level :class:`MenuItem` entries, left to right. One with
            ``items`` is a menu title that opens a dropdown (submenus,
            separators, shortcuts, checkable and group items all work as in
            :class:`ContextMenu`); one without is a plain command on the bar.
            Ids must be unique across the whole bar.
        label: Accessible name of the menu bar.
        extra: Additional properties forwarded to JS verbatim.
    """

    items: List[MenuItem] = field(default_factory=list)
    label: str = "Menu"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        items = [item.to_dict() if hasattr(item, "to_dict") else item for item in self.items]
        if any(item.get("separator") for item in items):
            raise ValueError("a MenuBar's top level cannot hold separators")
        check_unique_ids(items)
        payload = {"items": items, "label": self.label}
        payload.update(self.extra or {})
        return payload
