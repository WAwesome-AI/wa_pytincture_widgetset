"""
Form widget: declarative inputs with validation and error slots.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js
from .form_config import FieldConfig, FormConfig, SelectOption

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
            arg.to_py() if hasattr(arg, "to_py") else arg for arg in args
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
        """Fires per edit with ``{"id": ..., "value": ...}``."""
        self._bind_event("change", handler)

    def on_invalid(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires with ``{"errors": {...}}`` when a submit is rejected locally."""
        self._bind_event("invalid", handler)

    # ------------------------------------------------------------------
    # Values
    # ------------------------------------------------------------------

    def get_values(self) -> Dict[str, Any]:
        result = self.form.getValues()
        return result.to_py() if hasattr(result, "to_py") else dict(result)

    def set_values(self, values: Dict[str, Any]) -> None:
        self.form.setValues(js.JSON.parse(json.dumps(values)))

    def set_field_options(
        self, field_id: str, options: List[Union[str, SelectOption]]
    ) -> None:
        payload = [
            option.to_dict() if hasattr(option, "to_dict") else option
            for option in options
        ]
        self.form.setFieldOptions(field_id, js.JSON.parse(json.dumps(payload)))

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    def show_field(self, field_id: str) -> None:
        self.form.showField(field_id)

    def hide_field(self, field_id: str) -> None:
        self.form.hideField(field_id)

    def set_field_disabled(self, field_id: str, disabled: bool = True) -> None:
        self.form.setFieldDisabled(field_id, disabled)

    def set_busy(self, busy: bool = True) -> None:
        """Disable the buttons while an async submit is in flight."""
        self.form.setBusy(busy)

    def focus_first(self) -> None:
        self.form.focusFirst()

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

    def set_errors(self, errors: Dict[str, str]) -> None:
        self.form.setErrors(js.JSON.parse(json.dumps(errors)))

    def clear_errors(self) -> None:
        self.form.clearErrors()

    def validate(self) -> Dict[str, str]:
        result = self.form.validate()
        return result.to_py() if hasattr(result, "to_py") else dict(result)


__all__ = ["Form", "FormConfig", "FieldConfig", "SelectOption"]
