from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

FIELD_TYPES = frozenset({
    "text", "password", "email", "number", "url", "search", "tel", "textarea",
    "select", "checkbox", "hidden",
    "date", "time", "datetime-local", "color", "range",
    "radio", "toggle", "checkbox_group", "combo", "static", "file", "avatar",
})
FILE_TYPES = frozenset({"file", "avatar"})


LABEL_POSITIONS = ("top", "left")
# Kinds that can show an icon inside the field.
ICON_TYPES = frozenset({
    "text", "password", "email", "number", "url", "search", "tel",
    "date", "time", "datetime-local", "select", "combo",
})
# Kinds max_length applies to.
LENGTH_TYPES = frozenset({"text", "password", "email", "url", "search", "tel", "textarea"})
BUTTON_VARIANTS = ("default", "primary", "danger", "link")


def _label_width(value: Any) -> Any:
    """Numbers are pixels; strings are any CSS length (``"30%"``, ``"12rem"``)."""
    if value is None or isinstance(value, (int, float, str)):
        return value
    raise ValueError(f"label_width must be a number of pixels or a CSS length; got {value!r}")


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
    """
    One entry in a ``select``, ``combo``, ``radio`` or ``checkbox_group``
    field. ``disabled`` shows it but stops it being picked (a value set by
    the app still shows).
    """

    value: str
    label: Optional[str] = None
    disabled: bool = False

    def to_dict(self) -> Dict[str, Any]:
        payload = {"value": self.value, "label": self.label or self.value}
        if self.disabled:
            payload["disabled"] = True
        return payload


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
            searchable select; and ``static``, a read-only value shown as
            text (``get_values`` returns it as given, ``set_values`` changes
            it; ``placeholder`` shows while it is empty); ``file``, a drop
            zone and Choose button (value: a list of ``{"name", "size",
            "type"}``; the files themselves via ``Form.get_files`` /
            ``Form.adopt_files``); and ``avatar``, a round picture picker
            (value: the picture's URL as set, ``{"name", "size", "type"}``
            once a new one is chosen, ``None`` when removed).
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
        max_length: Maximum string length: typing stops there, and a longer
            value set with ``set_values`` fails validation. Text-like fields
            and ``textarea``.
        icon: MDI class (``mdi-magnify``) shown inside the field, on the
            left. Text-like inputs, date / time pickers, ``select`` and
            ``combo``.
        pattern: JavaScript regular expression source the value must match.
        matches: Another field's id whose value this one must equal — for
            "confirm password" pairs.
        options: Choices for ``select``, ``combo``, ``radio`` and
            ``checkbox_group``; strings or :class:`SelectOption`.
        multiple: Let a ``combo`` pick several values, shown as chips, or a
            ``file`` field hold several files.
        accept: ``file`` / ``avatar``: accepted types, as for the native
            attribute (``".csv,.tsv"``, ``"image/*"``); avatar defaults to
            images.
        max_size: ``file`` / ``avatar``: largest file in bytes.
        max_files: ``file`` with ``multiple``: most files it holds.
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
        matches_message / range_message / max_length_message: Override the
            default validation copy.
        validate: A function ``validate(value, values)`` run after the
            built-in checks pass, for a non-empty value of a field that is
            shown and enabled. ``values`` is the whole form. Return ``None``
            (or ``""`` / ``True``) when the value is fine, or the error
            message; ``False`` shows "Invalid value", as does an exception
            (its traceback goes to the console). It may be an ``async def``
            that asks the BFF: the field shows "Checking…" until it answers,
            and submitting waits for it. It runs in the browser under
            Pyodide, so the BFF must still check. Not sent to JS: the
            :class:`Form` registers it (see ``Form.set_validator``).
        success_message: Shown under the field, in place of an error, once
            it passes validation; cleared when the field is edited.
        label_position: ``"top"`` or ``"left"`` for this field; defaults to
            the form's ``label_position``.
        label_width: This field's label column width when labels are on the
            left (pixels, or a CSS length such as ``"30%"``).
        hidden_label: Hide the label from sight but keep it as the field's
            accessible name (for a search box with a placeholder, say).

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
    max_length: Optional[int] = None
    icon: Optional[str] = None
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
    accept: Optional[str] = None
    max_size: Optional[int] = None
    max_files: Optional[int] = None
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
    max_length_message: Optional[str] = None
    label_position: Optional[str] = None
    label_width: Optional[Union[int, float, str]] = None
    hidden_label: bool = False
    validate: Optional[Callable[[Any, Dict[str, Any]], Any]] = field(default=None, repr=False, compare=False)
    success_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        if self.validate is not None and not callable(self.validate):
            raise ValueError(f"FieldConfig {self.id!r}: validate must be callable")
        if self.label_position is not None and self.label_position not in LABEL_POSITIONS:
            raise ValueError(
                f"FieldConfig {self.id!r}: label_position must be 'top' or 'left'; got {self.label_position!r}"
            )
        if self.icon and self.type not in ICON_TYPES:
            raise ValueError(f"FieldConfig {self.id!r}: a {self.type} field cannot show an icon")
        if self.max_length is not None and self.type not in LENGTH_TYPES:
            raise ValueError(f"FieldConfig {self.id!r}: max_length applies to text fields, not {self.type}")
        if self.type not in FILE_TYPES and (self.accept or self.max_size or self.max_files):
            raise ValueError(f"FieldConfig {self.id!r}: accept, max_size and max_files need type 'file' or 'avatar'")
        if self.max_files is not None and not (self.type == "file" and self.multiple):
            raise ValueError(f"FieldConfig {self.id!r}: max_files needs type='file' with multiple=True")
        if self.type in FILE_TYPES and self.value not in (None, [], ()) and not (
            self.type == "avatar" and isinstance(self.value, str)
        ):
            raise ValueError(
                f"FieldConfig {self.id!r}: a {self.type} field cannot start with files "
                "(an avatar may start with the URL of an existing picture)"
            )
        if self.type == "static" and self.required:
            raise ValueError(f"FieldConfig {self.id!r}: a static field cannot be required")
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
            "maxLength": self.max_length,
            "icon": self.icon,
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
            "accept": self.accept,
            "maxSize": self.max_size,
            "maxFiles": self.max_files,
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
            "maxLengthMessage": self.max_length_message,
            "labelPosition": self.label_position,
            "labelWidth": _label_width(self.label_width),
            "hiddenLabel": self.hidden_label or None,
            "successMessage": self.success_message,
        }
        return _clean(payload)


@dataclass
class FormFieldset:
    """
    A titled, bordered group of fields with its own grid. Put it in
    ``FormConfig.fields`` (or inside another fieldset).

    Its fields stay flat in ``get_values`` (ids are unique across the whole
    form). ``show_field`` / ``hide_field`` / ``set_field_disabled`` with the
    fieldset's id act on everything inside, and fields that are hidden or
    disabled are not validated.

    Args:
        id: Addresses the group in ``show_field`` / ``hide_field`` /
            ``set_field_disabled``. Optional if it never changes.
        label: Title shown in the border (``<legend>``).
        fields: :class:`FieldConfig`, :class:`FormButton`,
            :class:`FormSpacer` or nested :class:`FormFieldset` entries.
        columns: Grid columns inside the group.
        span: Columns of the parent grid to span.
        label_position / label_width: Defaults for the fields inside.
        disabled / hidden: Initial state.
    """

    id: Optional[str] = None
    label: Optional[str] = None
    fields: List[Any] = field(default_factory=list)
    columns: int = 1
    span: Optional[int] = None
    label_position: Optional[str] = None
    label_width: Optional[Union[int, float, str]] = None
    disabled: bool = False
    hidden: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if self.label_position is not None and self.label_position not in LABEL_POSITIONS:
            raise ValueError(f"FormFieldset {self.id!r}: label_position must be 'top' or 'left'")
        if self.columns not in (1, 2, 3):
            raise ValueError(f"FormFieldset {self.id!r}: columns must be 1, 2 or 3")
        return _clean({
            "type": "fieldset",
            "id": self.id,
            "label": self.label,
            "fields": [item.to_dict() if hasattr(item, "to_dict") else item for item in self.fields],
            "columns": self.columns if self.columns != 1 else None,
            "span": self.span,
            "labelPosition": self.label_position,
            "labelWidth": _label_width(self.label_width),
            "disabled": self.disabled or None,
            "hidden": self.hidden or None,
        })


@dataclass
class FormSpacer:
    """
    Empty space in the form grid: an empty cell that pushes the next item to
    the next column (``span`` cells wide), or with ``height`` a fixed gap.

    Args:
        id: Only needed to show or hide it later.
        span: Columns to take.
        height: Pixels or a CSS length.
        hidden: Initial state.
    """

    id: Optional[str] = None
    span: Optional[int] = None
    height: Optional[Union[int, float, str]] = None
    hidden: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return _clean({
            "type": "spacer",
            "id": self.id,
            "span": self.span,
            "height": _label_width(self.height),
            "hidden": self.hidden or None,
        })


def _collect_form_ids(items: List[Dict[str, Any]], into: List[str]) -> None:
    for item in items:
        if item.get("id"):
            into.append(str(item["id"]))
        if item.get("type") == "fieldset":
            _collect_form_ids(item.get("fields") or [], into)


@dataclass
class FormButton:
    """
    A button inside a form: put it in ``FormConfig.fields`` to place it among
    the fields (it takes a grid cell, so ``span`` works), or in
    ``FormConfig.buttons`` to add it to the action row before Cancel and
    Submit.

    Args:
        id: Emitted as ``id`` by ``on_click``; also addresses it in
            ``show_field`` / ``hide_field`` / ``set_field_disabled``,
            ``set_button_text`` and ``set_button_loading``. Unique across the
            form's fields and buttons.
        text: Visible text; defaults to the id.
        icon: MDI class (``mdi-content-save``) or a Material Symbols name.
        variant: ``default`` (outlined), ``primary``, ``danger`` or ``link``.
        submit: Validate the form first. ``on_click`` then fires with
            ``{"id", "values"}`` only when validation passes; otherwise
            ``on_invalid`` fires (with this ``id``). Use it for a second
            submit action ("Save and close") beside the main Submit button.
        full: Stretch to the full width of its cell.
        tooltip: Hover text.
        span: Columns to span when the button sits among the fields.
        disabled / hidden: Initial state.
        label_position: Among the fields, ``"left"`` lines the button up with
            the controls (not the labels); defaults to the form's.
    """

    id: str
    text: Optional[str] = None
    icon: Optional[str] = None
    variant: str = "default"
    submit: bool = False
    full: bool = False
    tooltip: Optional[str] = None
    span: Optional[int] = None
    disabled: bool = False
    hidden: bool = False
    label_position: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        if not self.id:
            raise ValueError("a FormButton needs an id")
        if self.variant not in BUTTON_VARIANTS:
            raise ValueError(
                f"FormButton {self.id!r}: variant must be one of {', '.join(BUTTON_VARIANTS)}; got {self.variant!r}"
            )
        if self.label_position is not None and self.label_position not in LABEL_POSITIONS:
            raise ValueError(f"FormButton {self.id!r}: label_position must be 'top' or 'left'")
        return _clean({
            "type": "button",
            "id": self.id,
            "text": self.text,
            "icon": self.icon,
            "variant": self.variant if self.variant != "default" else None,
            "submit": self.submit or None,
            "full": self.full or None,
            "tooltip": self.tooltip,
            "span": self.span,
            "disabled": self.disabled or None,
            "hidden": self.hidden or None,
            "labelPosition": self.label_position,
        })


@dataclass
class FormConfig:
    """
    Layout and chrome for :class:`Form`.

    Args:
        fields: Controls in render order; :class:`FormButton`,
            :class:`FormFieldset` and :class:`FormSpacer` entries place
            buttons, titled groups and empty space among them.
        submit_text: Label for the submit button; ``None`` hides it.
        cancel_text: Label for the cancel button; ``None`` hides it.
        buttons: More :class:`FormButton` entries for the action row, before
            Cancel and Submit.
        label_position: ``"top"`` (default) or ``"left"``: labels in a column
            beside the controls. A row whose control would be narrower than
            160px puts its label back on top.
        label_width: Width of that label column (pixels, or a CSS length
            such as ``"30%"``); default 160px.
        columns: Grid column count (1 stacks the fields).
        busy: Start with the buttons disabled.
        disabled: Start with the whole form disabled (``Form.enable()``).
        hidden: Start with the form hidden (``Form.show()``).
        autocomplete: Form-level ``autocomplete`` attribute.
        extra: Additional properties forwarded to JS verbatim.
    """

    fields: List[Any] = field(default_factory=list)
    submit_text: Optional[str] = "Save"
    cancel_text: Optional[str] = None
    buttons: List["FormButton"] = field(default_factory=list)
    label_position: str = "top"
    label_width: Optional[Union[int, float, str]] = None
    columns: int = 1
    busy: bool = False
    disabled: bool = False
    hidden: bool = False
    autocomplete: str = "off"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        if self.label_position not in LABEL_POSITIONS:
            raise ValueError(f"label_position must be 'top' or 'left'; got {self.label_position!r}")
        fields = [item.to_dict() if hasattr(item, "to_dict") else item for item in self.fields]
        buttons = [item.to_dict() if hasattr(item, "to_dict") else item for item in self.buttons]
        ids: List[str] = []
        _collect_form_ids(fields + buttons, ids)
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate form field or button ids: {', '.join(duplicates)}")
        payload = {
            "fields": fields,
            "buttons": buttons or None,
            "labelPosition": self.label_position if self.label_position != "top" else None,
            "labelWidth": _label_width(self.label_width),
            "submitText": self.submit_text,
            "cancelText": self.cancel_text,
            "columns": self.columns,
            "busy": self.busy,
            "disabled": self.disabled or None,
            "hidden": self.hidden or None,
            "autocomplete": self.autocomplete,
        }
        payload.update(self.extra or {})
        cleaned = _clean(payload)
        # None hides a button, so it has to reach JS as null: a dropped key
        # lets the JS default ("Save") back in.
        for key in ("submitText", "cancelText"):
            cleaned.setdefault(key, payload[key])
        return cleaned
