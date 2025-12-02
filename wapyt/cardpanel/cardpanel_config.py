from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


@dataclass
class CardPanelCardConfig:
    """
    Represents an individual card shown inside the CardPanel widget.

    Args:
        id: Stable identifier emitted with callbacks.
        title: Primary text rendered in the card header.
        subtitle: Secondary text below the title (optional).
        pill: Optional badge rendered next to the subtitle.
        icon: Optional class name or URL consumed by templates.
        extra: Arbitrary metadata accessible via placeholders.
    """
    id: str
    title: str
    subtitle: Optional[str] = None
    pill: Optional[str] = None
    icon: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "id": self.id,
            "title": self.title,
            "subtitle": self.subtitle,
            "pill": self.pill,
            "icon": self.icon,
        }
        data.update(self.extra or {})
        return {key: value for key, value in data.items() if value is not None}


@dataclass
class CardPanelConfig:
    """
    High-level configuration for the CardPanel widget.

    The ``card_template`` option may be:

    * the name of a registered template (string)
    * a callable/JS function handle
    * a nested dictionary describing DOM structure. The descriptor supports keys:
        - ``tag``: element tag name (default ``div``)
        - ``class``/``className``/``classes``: string or list of classes
        - ``text`` or ``html``: content strings. Placeholders like ``{title}``
          or ``{card.subtitle}`` are interpolated from the card/context.
        - ``attrs``/``dataset``/``style``: mapping of attributes with placeholders
        - ``children``: list of nested descriptor nodes

    Additional convenience properties:

    * ``card_columns`` – integer column count translated into CSS grid template.
    * ``viewport_height`` – constrains the grid height and enables scrolling.
    * ``card_gap`` / ``card_min_height`` / ``card_height`` – tune card spacing.
    * ``add_button_text`` / ``search_placeholder`` – copy for built-in chrome.
    """
    title: str = "Data Sources"
    description: str = "Manage and connect to various data sources with intelligent profiling and lineage tracking."
    searchable: bool = True
    auto_filter: bool = True
    cards: List[Any] = field(default_factory=list)
    add_button_text: Optional[str] = None
    search_button_text: Optional[str] = None
    search_placeholder: Optional[str] = None
    search_aria_label: Optional[str] = None
    show_search: Optional[bool] = None
    view_button_text: Optional[str] = None
    card_min_width: Optional[Union[int, float, str]] = None
    card_min_height: Optional[Union[int, float, str]] = None
    card_height: Optional[Union[int, float, str]] = None
    card_gap: Optional[Union[int, float, str]] = None
    card_columns: Optional[int] = None
    card_icon_size: Optional[Union[int, float, str]] = None
    viewport_height: Optional[Union[int, float, str]] = None
    card_template: Optional[Any] = None  # accepts string name, callable, or descriptor dict

    def to_dict(self) -> Dict[str, Any]:
        cards_payload: List[Dict[str, Any]] = []
        for card in self.cards:
            if hasattr(card, "to_dict"):
                cards_payload.append(card.to_dict())
            elif isinstance(card, dict):
                cards_payload.append(card)
            else:
                raise TypeError(f"Unsupported card configuration type: {type(card)!r}")

        config_dict = {
            "title": self.title,
            "description": self.description,
            "searchable": self.searchable,
            "autoFilter": self.auto_filter,
            "cards": cards_payload,
        }

        if self.add_button_text is not None:
            config_dict["addButtonText"] = self.add_button_text
        if self.search_button_text is not None:
            config_dict["searchButtonText"] = self.search_button_text
        if self.search_placeholder is not None:
            config_dict["searchPlaceholder"] = self.search_placeholder
        if self.search_aria_label is not None:
            config_dict["searchAriaLabel"] = self.search_aria_label
        if self.show_search is not None:
            config_dict["showSearch"] = self.show_search
        if self.view_button_text is not None:
            config_dict["viewButtonText"] = self.view_button_text
        if self.add_button_text is not None:
            config_dict["addButtonText"] = self.add_button_text
        if self.card_min_width is not None:
            config_dict["cardMinWidth"] = self.card_min_width
        if self.card_min_height is not None:
            config_dict["cardMinHeight"] = self.card_min_height
        if self.card_height is not None:
            config_dict["cardHeight"] = self.card_height
        if self.card_gap is not None:
            config_dict["cardGap"] = self.card_gap
        if self.card_columns is not None:
            config_dict["cardColumns"] = self.card_columns
        if self.card_icon_size is not None:
            config_dict["cardIconSize"] = self.card_icon_size
        if self.card_template is not None:
            config_dict["cardTemplate"] = self.card_template
        if self.viewport_height is not None:
            config_dict["viewportHeight"] = self.viewport_height

        return config_dict
