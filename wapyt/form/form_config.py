from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

FIELD_TYPES = frozenset({
    "text", "password", "email", "number", "url", "search", "tel", "textarea",
    "select", "checkbox", "hidden",
    "date", "time", "datetime-local", "color", "range",
    "radio", "toggle", "checkbox_group", "combo",
})


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


def iso_value(value: Any) -> Any:
    """
    Render a ``date`` / ``time`` / ``datetime`` the way the native pickers
    expect it (``2026-10-06``, ``14:30``, ``2026-10-06T14:30``); anything else
    passes through. Seconds are kept only when set, since a value with seconds
    makes the time picker show a seconds column.
    """
    if isinstance(value, (_dt.datetime, _dt.time)):
        if value.tzinfo is not None:
            raise ValueError("form date/time values must be naive (the pickers have no time zone)")
        spec = "minutes" if not value.second and not value.microsecond else "seconds"
        return value.isoformat(timespec=spec)
    if isinstance(value, _dt.date):
        return value.isoformat()
    return value


def json_default(value: Any) -> Any:
    """``json.dumps(default=...)`` hook so set_values accepts date objects."""
    converted = iso_value(value)
    if converted is value:
        raise TypeError(f"{type(value).__name__} is not JSON serializable")
    return converted


@dataclass
class SelectOption:
    """One entry in a ``select``, ``combo``, ``radio`` or ``checkbox_group`` field."""

    value: str
    label: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"value": self.value, "label": self.label or self.value}


@dataclass
class FieldConfig:
    """
    One form control.

    Args:
        id: Key this field contributes to the submitted values dict.
        label: Visible label text.
        type: ``text`` · ``password`` · ``email`` · ``number`` · ``url``
            · ``search`` · ``tel`` · ``textarea`` · ``select`` · ``checkbox``
            · ``hidden``; the native pickers ``date`` · ``time`` ·
            ``datetime-local`` · ``color`` · ``range``; and ``radio`` ·
            ``toggle`` (a switch) · ``checkbox_group``; and ``combo``, a
            searchable select.
        value: Initial value. ``checkbox`` and ``toggle`` coerce it to a
            bool; ``checkbox_group`` takes a list of option values; ``date``,
            ``time`` and ``datetime-local`` take an ISO string or a
            ``datetime.date`` / ``time`` / ``datetime``. Values read back as
            ISO strings (``None`` when empty), numbers for ``number`` and
            ``range``, and a list for ``checkbox_group`` and a ``multiple``
            combo.
        placeholder: Placeholder text for textual controls.
        help: Hint rendered under the control.
        required: Fails validation when empty.
        min_length: Minimum string length once non-empty.
        pattern: JavaScript regular expression source the value must match.
        matches: Another field's id whose value this one must equal — for
            "confirm password" pairs.
        options: Choices for ``select``, ``combo``, ``radio`` and
            ``checkbox_group``; strings or :class:`SelectOption`.
        multiple: Let a ``combo`` pick several values, shown as chips.
        allow_custom: Let a ``combo`` keep typed text that is not an option.
        inline: Lay ``radio`` / ``checkbox_group`` options out in a row.
        show_value: Show a ``range`` field's current value beside it.
        range: Give a ``range`` field two thumbs. It then reads back as
            ``[low, high]`` and takes a two-item list or tuple as its value
            (``None`` for either end means that bound); unset, it spans the
            whole range. Keyboard: arrows step, Page Up / Down move a tenth,
            Home / End go to the limit.
        ticks / major_ticks: Draw a tick every ``ticks`` units and a longer
            one every ``major_ticks`` units under a ``range`` field (one or
            two thumbs), counted from ``min``.
        tick_labels: Label the major ticks with their values (default on).
        rows: Row count for ``textarea``.
        min / max / step: Bounds for ``number``, ``range``, ``date``,
            ``time`` and ``datetime-local`` (dates as ISO strings or date
            objects). Out-of-range values fail validation.
        span: Column span when the form is laid out in more than one column.
        disabled / readonly: Control state.
        autocomplete: Forwarded to the control's ``autocomplete`` attribute.
        required_message / min_length_message / pattern_message /
        matches_message / range_message: Override the default validation copy.

    Client-side validation is a convenience, never a control: the BFF revalidates.
    """

    id: str
    label: Optional[str] = None
    type: str = "text"
    value: Any = None
    placeholder: Optional[str] = None
    help: Optional[str] = None
    required: bool = False
    min_length: Optional[int] = None
    pattern: Optional[str] = None
    matches: Optional[str] = None
    options: Optional[List[Union[str, SelectOption]]] = None
    inline: bool = False
    show_value: bool = True
    range: bool = False
    ticks: Optional[Union[int, float]] = None
    major_ticks: Optional[Union[int, float]] = None
    tick_labels: bool = True
    multiple: bool = False
    allow_custom: bool = False
    rows: Optional[int] = None
    min: Optional[Union[int, float, str, _dt.date, _dt.time]] = None
    max: Optional[Union[int, float, str, _dt.date, _dt.time]] = None
    step: Optional[Union[int, float]] = None
    span: Optional[int] = None
    disabled: bool = False
    readonly: bool = False
    autocomplete: Optional[str] = None
    required_message: Optional[str] = None
    min_length_message: Optional[str] = None
    pattern_message: Optional[str] = None
    matches_message: Optional[str] = None
    range_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        if self.type not in FIELD_TYPES:
            raise ValueError(
                f"FieldConfig {self.id!r}: unknown type {self.type!r}; "
                f"expected one of {', '.join(sorted(FIELD_TYPES))}"
            )
        if self.type != "range" and (self.range or self.ticks or self.major_ticks):
            raise ValueError(
                f"FieldConfig {self.id!r}: range, ticks and major_ticks need type='range'"
            )
        for name in ("ticks", "major_ticks"):
            interval = getattr(self, name)
            if interval is not None and not interval > 0:
                raise ValueError(f"FieldConfig {self.id!r}: {name} must be greater than 0")
        value = self.value
        if self.range and value is not None:
            if isinstance(value, (str, bytes)) or not hasattr(value, "__len__") or len(value) != 2:
                raise ValueError(
                    f"FieldConfig {self.id!r}: a two-thumb range takes [low, high] as its value"
                )
            value = list(value)
        options: Optional[List[Any]] = None
        if self.options is not None:
            options = [
                option.to_dict() if hasattr(option, "to_dict") else option
                for option in self.options
            ]
        payload = {
            "id": self.id,
            "label": self.label,
            "type": self.type,
            "value": iso_value(value),
            "placeholder": self.placeholder,
            "help": self.help,
            "required": self.required or None,
            "minLength": self.min_length,
            "pattern": self.pattern,
            "matches": self.matches,
            "options": options,
            "inline": self.inline or None,
            "showValue": None if self.show_value else False,
            "range": self.range or None,
            "ticks": self.ticks,
            "majorTicks": self.major_ticks,
            "tickLabels": None if self.tick_labels else False,
            "multiple": self.multiple or None,
            "allowCustom": self.allow_custom or None,
            "rows": self.rows,
            "min": iso_value(self.min),
            "max": iso_value(self.max),
            "step": self.step,
            "span": self.span,
            "disabled": self.disabled or None,
            "readonly": self.readonly or None,
            "autocomplete": self.autocomplete,
            "requiredMessage": self.required_message,
            "minLengthMessage": self.min_length_message,
            "patternMessage": self.pattern_message,
            "matchesMessage": self.matches_message,
            "rangeMessage": self.range_message,
        }
        return _clean(payload)


@dataclass
class FormConfig:
    """
    Layout and chrome for :class:`Form`.

    Args:
        fields: Controls in render order.
        submit_text: Label for the submit button; ``None`` hides it.
        cancel_text: Label for the cancel button; ``None`` hides it.
        columns: Grid column count (1 stacks the fields).
        busy: Start with the buttons disabled.
        autocomplete: Form-level ``autocomplete`` attribute.
        extra: Additional properties forwarded to JS verbatim.
    """

    fields: List[FieldConfig] = field(default_factory=list)
    submit_text: Optional[str] = "Save"
    cancel_text: Optional[str] = None
    columns: int = 1
    busy: bool = False
    autocomplete: str = "off"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "fields": [
                item.to_dict() if hasattr(item, "to_dict") else item
                for item in self.fields
            ],
            "submitText": self.submit_text,
            "cancelText": self.cancel_text,
            "columns": self.columns,
            "busy": self.busy,
            "autocomplete": self.autocomplete,
        }
        payload.update(self.extra or {})
        cleaned = _clean(payload)
        # None hides a button, so it has to reach JS as null: a dropped key
        # lets the JS default ("Save") back in.
        for key in ("submitText", "cancelText"):
            cleaned.setdefault(key, payload[key])
        return cleaned
