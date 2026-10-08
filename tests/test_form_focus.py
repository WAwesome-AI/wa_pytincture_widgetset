"""CPython tests for the Form focus wrappers (no browser needed)."""
from __future__ import annotations

from wapyt import Form


class FakeJsForm:
    def __init__(self, focused=None, field_error=None, focus_ok=True):
        self.focused, self.field_error, self.focus_ok = focused, field_error, focus_ok
        self.calls = []

    def setFocus(self, field_id):
        self.calls.append(("setFocus", field_id))
        return self.focus_ok

    def getFocused(self):
        return self.focused

    def validateField(self, field_id):
        self.calls.append(("validateField", field_id))
        return self.field_error


def make(**kwargs):
    form = object.__new__(Form)
    form.form = FakeJsForm(**kwargs)
    return form


def test_set_focus_returns_a_bool():
    assert make().set_focus("host") is True
    assert make(focus_ok=False).set_focus("host") is False


def test_get_focused_maps_empty_to_none():
    assert make().get_focused() is None
    assert make(focused="").get_focused() is None
    assert make(focused="port").get_focused() == "port"


def test_validate_field():
    form = make(field_error="Host is required")
    assert form.validate_field("host") == "Host is required"
    assert form.form.calls == [("validateField", "host")]
    assert make(field_error=None).validate_field("host") is None
