"""
Form widget: declarative inputs with validation and error slots.
"""
from __future__ import annotations

import json
import traceback
from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from .form_config import (FieldConfig, FormButton, FormConfig, FormFieldset, FormSpacer, SelectOption,
                          json_default)

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


class Form:
    """
    A set of labelled controls with a submit action.

    Quick start::

        form = Form(
            FormConfig(
                fields=[
                    FieldConfig(id="host", label="Host", required=True),
                    FieldConfig(id="port", label="Port", type="number", value=22),
                ],
                submit_text="Connect",
                cancel_text="Cancel",
            ),
            container=modal.body,
        )
        form.on_submit(lambda values: print(values))

    ``on_submit`` only fires once client-side validation passes. That validation
    is a convenience for the person typing, never a security control — the BFF
    revalidates everything it is sent.
    """

    def __init__(
        self,
        config: Optional[FormConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Form requires a container or a root element.")

        require_js("Form")
        self.config = config or FormConfig()
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Form.")

        self.form = js.wapyt.Form.new(
            root_element,
            js.JSON.parse(json.dumps(self.config.to_dict())),
        )

        # Validators are Python functions, so they cannot travel in the JSON
        # config; each one is handed to the JS as a proxy instead.
        self._validator_proxies: Dict[str, Any] = {}
        for item in _iter_fields(self.config.fields):
            if getattr(item, "validate", None) is not None:
                self.set_validator(item.id, item.validate)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        target = container
        if target is not None:
            if hasattr(target, "getContainer"):
                return target.getContainer()
            if hasattr(target, "element"):
                return target.element
            return target
        if isinstance(root, str):
            element = js.document.querySelector(root)
            if not element:
                element = js.document.getElementById(root)
            return element
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda *args, **kwargs: handler(*[
            to_plain(arg) for arg in args
        ], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.form.on(event_name, proxy)

    # ------------------------------------------------------------------
    # Event bindings
    # ------------------------------------------------------------------

    def on_submit(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires with the values dict once validation passes."""
        self._bind_event("submit", handler)

    def on_cancel(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("cancel", handler)

    def on_change(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires per edit with ``{"id": ..., "value": ...}``. Selects, combos,
        checkboxes, toggles and groups fire when a choice is made; every other
        field fires as you type, pick or drag."""
        self._bind_event("change", handler)

    def on_invalid(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires with ``{"errors": {...}}`` when a submit is rejected locally;
        from a ``FormButton(submit=True)`` it also carries that button's ``id``."""
        self._bind_event("invalid", handler)

    def on_focus(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Focus moved into a field: ``{"id"}``. Moving between the parts
        of one field (radio options, a range's two thumbs, a combo's chips)
        does not fire it again."""
        self._bind_event("focus", handler)

    def on_blur(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Focus left a field: ``{"id", "value"}``. To check a field as the
        person leaves it::

            form.on_blur(lambda p: form.validate_field(p["id"]))
        """
        self._bind_event("blur", handler)

    def on_click(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        A :class:`FormButton` was clicked: ``{"id"}``. A ``submit=True``
        button fires only once validation passes, with ``{"id", "values"}``.
        The built-in Submit and Cancel buttons keep ``on_submit`` /
        ``on_cancel``.
        """
        self._bind_event("click", handler)

    # ------------------------------------------------------------------
    # Values
    # ------------------------------------------------------------------

    def get_values(self) -> Dict[str, Any]:
        result = self.form.getValues()
        return to_plain(result) or {}

    def set_values(self, values: Dict[str, Any]) -> None:
        """Set any subset of fields; date/time fields also take date objects,
        and a two-thumb range takes ``[low, high]`` (a tuple works too)."""
        self.form.setValues(js.JSON.parse(json.dumps(values, default=json_default)))

    def clear(self, *, values: bool = True, errors: bool = True) -> None:
        """
        Empty every field (``values``) and/or remove error messages
        (``errors``), without firing ``on_change``. Checkboxes and toggles
        uncheck, groups and combos empty, a select ends with nothing chosen.
        Native range and colour inputs cannot be blank, so a range goes to its
        ``min`` (or 0), a two-thumb range to ``[min, max]`` and a colour to
        ``#000000``. To go back to the values
        the form was built with instead, use :meth:`reset`.
        """
        self.form.clear(js.JSON.parse(json.dumps({"values": bool(values), "errors": bool(errors)})))

    def reset(self) -> None:
        """
        Put back each field's configured ``value`` (or, for a field without
        one, how a fresh form shows it: a range at its midpoint, a two-thumb
        range across all of it, a select with nothing chosen) and remove error messages, without firing
        ``on_change``.
        """
        self.form.reset()

    def set_field_options(
        self, field_id: str, options: List[Union[str, SelectOption]]
    ) -> None:
        """Replace a select, combo, radio or checkbox_group field's choices;
        selected values that are still offered stay selected."""
        payload = [
            option.to_dict() if hasattr(option, "to_dict") else option
            for option in options
        ]
        self.form.setFieldOptions(field_id, js.JSON.parse(json.dumps(payload)))

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    def show_field(self, field_id: str) -> None:
        """Show a field, a :class:`FormButton`, a :class:`FormFieldset` (and
        everything in it) or a :class:`FormSpacer` with an id."""
        self.form.showField(field_id)

    def hide_field(self, field_id: str) -> None:
        """Hide a field, button, fieldset or spacer. Hidden fields (and every
        field in a hidden fieldset) are skipped by validation but still appear
        in ``get_values``."""
        self.form.hideField(field_id)

    def set_field_disabled(self, field_id: str, disabled: bool = True) -> None:
        """Disable a field, a :class:`FormButton`, or a :class:`FormFieldset`
        and everything in it. Disabled fields are skipped by validation, like
        the browser's own forms skip disabled controls."""
        self.form.setFieldDisabled(field_id, disabled)

    def set_busy(self, busy: bool = True) -> None:
        """Disable Submit, Cancel and every ``submit=True`` button while an
        async submit is in flight."""
        self.form.setBusy(busy)

    def set_button_text(self, button_id: str, text: str) -> None:
        self.form.setButtonText(button_id, "" if text is None else str(text))

    def set_button_loading(self, button_id: str, loading: bool = True) -> None:
        """Show a spinner on a :class:`FormButton` and disable it, for an
        action in flight (a "Test connection" button, say)."""
        self.form.setButtonLoading(button_id, bool(loading))

    def focus_first(self) -> None:
        """Focus the first field that is shown and enabled."""
        self.form.focusFirst()

    def set_focus(self, field_id: str) -> bool:
        """
        Focus a field (a radio group's checked option, a range's low thumb)
        or a :class:`FormButton`. Returns False, and does nothing, when it is
        hidden, disabled or a static field.
        """
        return bool(self.form.setFocus(field_id))

    def get_focused(self) -> Optional[str]:
        """The id of the field or button that has focus, or None."""
        value = to_plain(self.form.getFocused())
        return str(value) if value else None

    def submit(self) -> None:
        """Trigger validation and, if it passes, the submit event."""
        self.form.submit()

    # ------------------------------------------------------------------
    # Errors
    # ------------------------------------------------------------------

    def set_error(self, field_id: Optional[str], message: str) -> None:
        """Show an error under a field, or form-wide when ``field_id`` is None."""
        # The JS side treats a nullish id as "form-wide"; js.undefined survives
        # the FFI unambiguously where a bare None does not.
        self.form.setError(field_id if field_id is not None else js.undefined, message)

    def set_validator(
        self, field_id: str, validator: Optional[Callable[[Any, Dict[str, Any]], Any]]
    ) -> None:
        """
        Set or replace a field's validator (``None`` removes it); the same
        contract as ``FieldConfig(validate=...)``: ``validator(value,
        values)`` returns ``None`` when fine, else the message.
        """
        if validator is not None and not callable(validator):
            raise ValueError("validator must be callable or None")
        previous = self._validator_proxies.pop(field_id, None)
        if validator is None:
            self.form.setValidator(field_id, None)
        else:
            def call(value: Any, values: Any) -> Any:
                try:
                    return validator(to_plain(value), to_plain(values) or {})
                except Exception:
                    traceback.print_exc()
                    return "Invalid value"

            proxy = create_proxy(call)
            self._validator_proxies[field_id] = proxy
            self.form.setValidator(field_id, proxy)
        if previous is not None and hasattr(previous, "destroy"):
            previous.destroy()

    def set_errors(self, errors: Dict[str, str]) -> None:
        self.form.setErrors(js.JSON.parse(json.dumps(errors)))

    def clear_errors(self) -> None:
        self.form.clearErrors()

    def validate_field(self, field_id: str) -> Optional[str]:
        """
        Run one field's checks (required, built-ins, its validator) and show
        the result under it, leaving other fields' messages alone. Returns the
        error message, or None when it passes, is empty, or is hidden or
        disabled.
        """
        value = to_plain(self.form.validateField(field_id))
        return str(value) if value else None

    def validate(self) -> Dict[str, str]:
        result = self.form.validate()
        return to_plain(result) or {}


def _iter_fields(items: Iterable[Any]) -> Iterable[Any]:
    """Every field config, looking inside fieldsets."""
    for item in items:
        if isinstance(item, FormFieldset):
            yield from _iter_fields(item.fields)
        else:
            yield item


__all__ = ["Form", "FormConfig", "FieldConfig", "FormButton", "FormFieldset", "FormSpacer", "SelectOption"]
