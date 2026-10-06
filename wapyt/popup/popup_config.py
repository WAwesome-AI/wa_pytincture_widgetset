from __future__ import annotations

import html
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union

PLACEMENTS = tuple(
    f"{side}{suffix}" for side in ("bottom", "top", "right", "left") for suffix in ("", "-start", "-end")
)
TOOLTIP_PLACEMENTS = ("top", "bottom", "left", "right")

Size = Union[int, str]


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


def _check_placement(placement: str, allowed: tuple) -> str:
    if placement not in allowed:
        raise ValueError(f"placement must be one of {', '.join(allowed)}; got {placement!r}")
    return placement


@dataclass
class PopupConfig:
    """
    Behaviour and size of a :class:`Popup`.

    Args:
        placement: Side of the anchor: ``bottom``, ``top``, ``right`` or
            ``left``, optionally ``-start`` / ``-end`` to line up an edge
            instead of centring. It flips when that side has no room.
        offset: Gap between anchor and popup, px.
        width / max_width / max_height: Size (px or any CSS size); the body
            scrolls past ``max_height``.
        label: ``aria-label`` of the popup (``role="dialog"``).
        close_on_outside: A press outside the popup and its anchor closes it.
        close_on_escape: Escape closes it and returns focus to the anchor.
        focus: Move focus to the first control inside when shown.
        css: Extra classes on the popup element.
        extra: Additional properties forwarded to JS verbatim.
    """

    placement: str = "bottom"
    offset: int = 6
    width: Optional[Size] = None
    max_width: Optional[Size] = None
    max_height: Optional[Size] = None
    label: Optional[str] = None
    close_on_outside: bool = True
    close_on_escape: bool = True
    focus: bool = True
    css: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        _check_placement(self.placement, PLACEMENTS)
        payload = {
            "placement": self.placement,
            "offset": self.offset,
            "width": self.width,
            "maxWidth": self.max_width,
            "maxHeight": self.max_height,
            "label": self.label,
            "closeOnOutside": self.close_on_outside,
            "closeOnEscape": self.close_on_escape,
            "focus": self.focus,
            "css": self.css,
        }
        payload.update(self.extra or {})
        return _clean(payload)


def tooltip_attr(text: Optional[str], placement: Optional[str] = None) -> str:
    """
    The attribute(s) that give string-built markup a wapyt tooltip, escaped:
    ``f'<button {tooltip_attr("Delete <all>")}>'``. Empty text gives ``""``.
    """
    if not text:
        return ""
    attr = f'data-wapyt-tooltip="{html.escape(str(text), quote=True)}"'
    if placement:
        attr += f' data-wapyt-tooltip-placement="{_check_placement(placement, TOOLTIP_PLACEMENTS)}"'
    return attr
