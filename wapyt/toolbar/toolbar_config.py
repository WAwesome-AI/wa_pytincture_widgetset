from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from ..contextmenu.contextmenu_config import MenuItem, _collect_ids


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


VARIANTS = ("default", "primary", "accent", "danger")


@dataclass
class ToolbarButton:
    """
    A button.

    Args:
        id: Emitted as ``id`` by ``on_click``; addresses the button in every
            ``set_*`` method.
        label: Visible text. In compact mode it hides behind the icon and stays
            as the tooltip and accessible name.
        icon: MDI class (``mdi-plus``) or a Material Symbols name.
        tooltip: Hover text; defaults to the label.
        variant: ``default``, ``primary``, ``accent`` (a highlighted call to
            action, such as an update notice) or ``danger``.
        toggle: A button that stays pressed until clicked again.
        group: Buttons sharing a group are one-of-several choices: pressing one
            releases the others. Implies a pressed state.
        active: Initial pressed state, for ``toggle`` and ``group`` buttons.
        badge: Small count or tag after the label.
        disabled / hidden: Initial state; change with ``set_disabled`` /
            ``set_hidden``.
        show_label: False for an icon-only button (the label becomes its name).
        keep_label: Keep the label visible in compact mode.
        items: Make it a dropdown: :class:`MenuItem` entries shown in a menu
            under the button (submenus, separators, shortcuts, checkable and
            group items work as in :class:`ContextMenu`). The button then
            opens the menu instead of firing ``on_click``; a pick fires
            ``on_select``. Ids must be unique across the whole toolbar.
        split: With ``items``, keep the button as a command (``on_click``)
            and add an arrow beside it that opens the menu.
    """

    id: str
    label: Optional[str] = None
    icon: Optional[str] = None
    tooltip: Optional[str] = None
    variant: str = "default"
    toggle: bool = False
    group: Optional[str] = None
    active: bool = False
    badge: Optional[Union[int, str]] = None
    disabled: bool = False
    hidden: bool = False
    show_label: bool = True
    keep_label: bool = False
    items: Optional[List[MenuItem]] = None
    split: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if self.variant not in VARIANTS:
            raise ValueError(f"variant must be one of {', '.join(VARIANTS)}; got {self.variant!r}")
        if self.split and self.items is None:
            raise ValueError(f"toolbar button {self.id!r}: split needs items")
        if self.items is not None and (self.toggle or self.group) and not self.split:
            raise ValueError(
                f"toolbar button {self.id!r}: a dropdown cannot be a toggle or group button "
                "(use split=True to keep the button's own state)"
            )
        return _clean(
            {
                "type": "button",
                "id": self.id,
                "label": self.label,
                "icon": self.icon,
                "tooltip": self.tooltip,
                "variant": self.variant if self.variant != "default" else None,
                "toggle": self.toggle or None,
                "group": self.group,
                "active": self.active or None,
                "badge": self.badge,
                "disabled": self.disabled or None,
                "hidden": self.hidden or None,
                "showLabel": False if not self.show_label else None,
                "keepLabel": self.keep_label or None,
                "items": None if self.items is None else [
                    item.to_dict() if hasattr(item, "to_dict") else item for item in self.items
                ],
                "split": self.split or None,
            }
        )


@dataclass
class ToolbarText:
    """Plain text, such as the signed-in user's name. ``set_text`` changes it."""

    id: str
    text: str = ""
    hidden: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return _clean({"type": "text", "id": self.id, "text": self.text, "hidden": self.hidden or None})


@dataclass
class ToolbarSeparator:
    """A thin vertical divider."""

    def to_dict(self) -> Dict[str, Any]:
        return {"type": "separator"}


@dataclass
class ToolbarSpacer:
    """Takes the free space, pushing what follows to the right."""

    def to_dict(self) -> Dict[str, Any]:
        return {"type": "spacer"}


ToolbarItem = Union[ToolbarButton, ToolbarText, ToolbarSeparator, ToolbarSpacer]


@dataclass
class ToolbarConfig:
    """
    Layout and behaviour for :class:`Toolbar`.

    Args:
        items: Buttons, text, separators and spacers in order.
        label: Accessible name of the toolbar (``aria-label``).
        compact: ``auto`` (default) drops button labels to icons when the
            labelled toolbar no longer fits; ``always`` or ``never`` force it.
        extra: Additional properties forwarded to JS verbatim.
    """

    items: List[Any] = field(default_factory=list)
    label: str = "Toolbar"
    compact: str = "auto"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        if self.compact not in ("auto", "always", "never"):
            raise ValueError(f"compact must be auto, always or never; got {self.compact!r}")
        items = [item.to_dict() if hasattr(item, "to_dict") else item for item in self.items]
        # Button ids and dropdown item ids share one namespace: set_disabled,
        # set_hidden and the events address both.
        ids: List[str] = []
        for item in items:
            if item.get("id"):
                ids.append(str(item["id"]))
            _collect_ids(item.get("items") or [], ids)
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate toolbar item ids: {', '.join(duplicates)}")
        payload = {
            "items": items,
            "label": self.label,
            "compact": self.compact,
        }
        payload.update(self.extra or {})
        return _clean(payload)
