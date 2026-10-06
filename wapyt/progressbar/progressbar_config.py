from __future__ import annotations

import html
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union

STATES = ("active", "done", "error", "paused")
Number = Union[int, float]


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


def _check_state(state: str) -> str:
    if state not in STATES:
        raise ValueError(f"state must be one of {', '.join(STATES)}; got {state!r}")
    return state


@dataclass
class ProgressBarConfig:
    """
    Initial value and look of a :class:`ProgressBar`.

    Args:
        value / max: Progress as ``value`` out of ``max`` (default 100); values
            are clamped to ``0..max``.
        label: Text before the bar, such as a file name.
        show_value: Show the percentage when no ``value_text`` is given.
        value_text: Replaces the percentage readout, e.g. ``"42%  1.2 MB"``.
        state: ``active`` (blue), ``done`` (green), ``error`` (red) or
            ``paused`` (amber).
        indeterminate: Total unknown: an animated bar and no percentage.
        compact: One line -- label, bar, value -- for rows, queues and tiles.
        label_width / value_width: Fixed widths (px or any CSS size) for the
            label and value, so the bars of a stacked list line up.
        extra: Additional properties forwarded to JS verbatim.
    """

    value: Number = 0
    max: Number = 100
    label: Optional[str] = None
    show_value: bool = True
    value_text: Optional[str] = None
    state: str = "active"
    indeterminate: bool = False
    compact: bool = False
    label_width: Optional[Union[int, str]] = None
    value_width: Optional[Union[int, str]] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        _check_state(self.state)
        if self.max < 0:
            raise ValueError("max must not be negative")
        payload = {
            "value": self.value,
            "max": self.max,
            "label": self.label,
            "showValue": self.show_value,
            "valueText": self.value_text,
            "state": self.state,
            "indeterminate": self.indeterminate,
            "compact": self.compact,
            "labelWidth": self.label_width,
            "valueWidth": self.value_width,
        }
        payload.update(self.extra or {})
        return _clean(payload)


def progress_html(
    value: Number,
    max: Number = 100,
    *,
    label: Optional[str] = None,
    text: Optional[str] = None,
    state: str = "active",
    compact: bool = True,
    show_value: bool = True,
) -> str:
    """
    Static progress-bar markup for UIs built from HTML strings (dashboard
    tiles, ``attach_html``). Same classes and look as :class:`ProgressBar`,
    no JS; every string is HTML-escaped. Pass ``value`` as a fraction with
    ``max=1``, or as a count with its ``max``.
    """
    _check_state(state)
    total = max if max and max > 0 else 100
    clamped = min(total, value if value > 0 else 0)
    pct = clamped / total * 100
    readout = text if text not in (None, "") else (f"{round(pct)}%" if show_value else "")
    attrs = [
        'class="wapyt-progress"',
        'role="progressbar"',
        'aria-valuemin="0"',
        f'aria-valuemax="{total:g}"',
        f'aria-valuenow="{clamped:g}"',
        f'data-state="{state}"',
    ]
    if compact:
        attrs.append('data-compact="true"')
    if readout:
        attrs.append(f'aria-valuetext="{html.escape(readout, quote=True)}"')
    if label:
        attrs.append(f'aria-label="{html.escape(label, quote=True)}"')
    label_html = (
        f'<span class="wapyt-progress-label">{html.escape(label)}</span>' if label
        else '<span class="wapyt-progress-label" hidden></span>'
    )
    value_html = (
        f'<span class="wapyt-progress-value">{html.escape(readout)}</span>' if readout
        else '<span class="wapyt-progress-value" hidden></span>'
    )
    return (
        f'<div {" ".join(attrs)}>'
        f'<div class="wapyt-progress-head">{label_html}{value_html}</div>'
        f'<div class="wapyt-progress-track"><div class="wapyt-progress-fill" style="width:{pct:.2f}%"></div></div>'
        "</div>"
    )
