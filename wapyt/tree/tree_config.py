from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class TreeItem:
    """
    One node. A node with ``items`` renders as a branch, otherwise a leaf.

    Args:
        id: Unique identifier, emitted by every event.
        label: Visible text.
        icon: MDI class (``mdi-server``) or a Material Symbols ligature name,
            which ``wapyt.icons`` maps onto MDI. Branches default to
            ``mdi-folder``, leaves to ``mdi-file-outline``.
        open_icon: Icon used while a branch is expanded (default
            ``mdi-folder-open``).
        badge: Small pill after the label — a child count, say.
        tooltip: Title attribute; defaults to the label.
        items: Child nodes.
        data: Arbitrary metadata carried along in event payloads.
    """

    id: str
    label: Optional[str] = None
    icon: Optional[str] = None
    open_icon: Optional[str] = None
    badge: Optional[Any] = None
    tooltip: Optional[str] = None
    items: List["TreeItem"] = field(default_factory=list)
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return _clean(
            {
                "id": self.id,
                "label": self.label if self.label is not None else self.id,
                "icon": self.icon,
                "open_icon": self.open_icon,
                "badge": self.badge,
                "tooltip": self.tooltip,
                "items": [
                    item.to_dict() if hasattr(item, "to_dict") else item
                    for item in self.items
                ]
                or None,
                "data": self.data or None,
            }
        )


@dataclass
class TreeAction:
    """
    One entry in the right-click menu.

    Args:
        id: Emitted as ``action`` by ``on_action``.
        label: Visible text.
        icon: MDI class or ligature name.
        scope: ``any`` (default), ``branch`` (folders only) or ``leaf``.
        kinds: Show only on nodes whose ``data["kind"]`` is one of these —
            for trees whose branches are different things (a server, a
            database) that need different menus. Combines with ``scope``.
        danger: Render in the destructive style.
        separator: When True, renders a divider and ignores every other field.
    """

    id: str = ""
    label: Optional[str] = None
    icon: Optional[str] = None
    scope: str = "any"
    kinds: Optional[List[str]] = None
    danger: bool = False
    separator: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if self.separator:
            return {"separator": True}
        return _clean(
            {
                "id": self.id,
                "label": self.label or self.id,
                "icon": self.icon,
                "scope": self.scope,
                "kinds": list(self.kinds) if self.kinds else None,
                "danger": self.danger or None,
            }
        )


@dataclass
class TreeConfig:
    """
    Layout and behaviour for :class:`Tree`.

    Args:
        items: Root nodes.
        selected: Node id selected on mount.
        expand_all: Expand every branch the first time it is indexed.
        filterable: Show a filter box. A match keeps its ancestors visible and
            forces them open while the filter is active.
        filter_placeholder: Placeholder for that box.
        empty_text: Shown when nothing matches.
        context_actions: Right-click menu entries.
        indent: Pixels of indent per depth level.
        extra: Additional properties forwarded to JS verbatim.
    """

    items: List[TreeItem] = field(default_factory=list)
    selected: Optional[str] = None
    expand_all: bool = False
    filterable: bool = False
    filter_placeholder: Optional[str] = None
    empty_text: Optional[str] = None
    context_actions: List[TreeAction] = field(default_factory=list)
    indent: int = 14
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "items": [
                item.to_dict() if hasattr(item, "to_dict") else item
                for item in self.items
            ],
            "selected": self.selected,
            "expandAll": self.expand_all,
            "filterable": self.filterable,
            "filterPlaceholder": self.filter_placeholder,
            "emptyText": self.empty_text,
            "contextActions": [
                item.to_dict() if hasattr(item, "to_dict") else item
                for item in self.context_actions
            ],
            "indent": self.indent,
        }
        payload.update(self.extra or {})
        return _clean(payload)
