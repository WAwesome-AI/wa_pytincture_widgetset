"""CPython tests for Form.set_properties / get_properties (no browser needed)."""
from __future__ import annotations

import datetime as dt
import json

import pytest

import wapyt.form.form as form_module
from wapyt import Form, SelectOption


class FakeJs:
    class JSON:
        @staticmethod
        def parse(text):
            return json.loads(text)


class FakeJsForm:
    def __init__(self, props=None):
        self.calls, self.props = [], props or {}

    def setProperties(self, field_id, payload):
        self.calls.append((field_id, payload))

    def getProperties(self, field_id):
        return self.props


@pytest.fixture
def form(monkeypatch):
    monkeypatch.setattr(form_module, "js", FakeJs)
    f = object.__new__(Form)
    f.form = FakeJsForm({"label": "Host", "minLength": 3, "successMessage": None, "required": True})
    f._button_ids = {"save"}
    return f


def test_field_properties_are_camel_cased(form):
    form.set_properties("host", label="Server", min_length=3, success_message="ok", required=True)
    assert form.form.calls == [("host", {"label": "Server", "minLength": 3, "successMessage": "ok", "required": True})]


def test_options_and_dates_serialise(form):
    form.set_properties("kind", options=["a", SelectOption("b", "Bee")])
    form.set_properties("day", min=dt.date(2026, 1, 1), max=None)
    assert form.form.calls[0][1] == {"options": ["a", {"value": "b", "label": "Bee"}]}
    assert form.form.calls[1][1] == {"min": "2026-01-01", "max": None}


def test_unknown_field_property(form):
    with pytest.raises(ValueError, match="cannot set colour on form field 'host'"):
        form.set_properties("host", colour="red")
    with pytest.raises(ValueError, match="cannot set label on form button 'save'"):
        form.set_properties("save", label="x")


def test_button_properties(form):
    form.set_properties("save", text="Saving", variant="primary", icon=None)
    assert form.form.calls == [("save", {"text": "Saving", "variant": "primary", "icon": None})]


def test_get_properties_uses_python_names(form):
    assert form.get_properties("host") == {"label": "Host", "min_length": 3, "success_message": None, "required": True}


def test_form_disabled_and_hidden_flags():
    from wapyt import FormConfig
    assert "disabled" not in FormConfig().to_dict() and "hidden" not in FormConfig().to_dict()
    payload = FormConfig(disabled=True, hidden=True).to_dict()
    assert payload["disabled"] is True and payload["hidden"] is True
