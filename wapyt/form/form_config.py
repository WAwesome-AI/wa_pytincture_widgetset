from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class SelectOption:
    """One entry in a ``select`` field."""

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
            · ``textarea`` · ``select`` · ``checkbox`` · ``hidden``.
        value: Initial value. For ``checkbox`` it is coerced to a bool.
        placeholder: Placeholder text for textual controls.
        help: Hint rendered under the control.
        required: Fails validation when empty.
        min_length: Minimum string length once non-empty.
        pattern: JavaScript regular expression source the value must match.
        matches: Another field's id whose value this one must equal — for
            "confirm password" pairs.
        options: Choices for ``select``; strings or :class:`SelectOption`.
        rows: Row count for ``textarea``.
        min / max / step: Bounds for ``number``.
        span: Column span when the form is laid out in more than one column.
        disabled / readonly: Control state.
        autocomplete: Forwarded to the control's ``autocomplete`` attribute.
        required_message / min_length_message / pattern_message /
        matches_message: Override the default validation copy.

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
    rows: Optional[int] = None
    min: Optional[Union[int, float]] = None
    max: Optional[Union[int, float]] = None
    step: Optional[Union[int, float]] = None
    span: Optional[int] = None
    disabled: bool = False
    readonly: bool = False
    autocomplete: Optional[str] = None
    required_message: Optional[str] = None
    min_length_message: Optional[str] = None
    pattern_message: Optional[str] = None
    matches_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
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
            "value": self.value,
            "placeholder": self.placeholder,
            "help": self.help,
            "required": self.required or None,
            "minLength": self.min_length,
            "pattern": self.pattern,
            "matches": self.matches,
            "options": options,
            "rows": self.rows,
            "min": self.min,
            "max": self.max,
            "step": self.step,
            "span": self.span,
            "disabled": self.disabled or None,
            "readonly": self.readonly or None,
            "autocomplete": self.autocomplete,
            "requiredMessage": self.required_message,
            "minLengthMessage": self.min_length_message,
            "patternMessage": self.pattern_message,
            "matchesMessage": self.matches_message,
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
        return _clean(payload)
