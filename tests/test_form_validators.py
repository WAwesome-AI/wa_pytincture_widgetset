"""CPython tests for Form validators (no browser needed)."""
from __future__ import annotations

import pytest

import wapyt.form.form as form_module
from wapyt import FieldConfig, Form, FormFieldset


class FakeJsForm:
    def __init__(self):
        self.validators = {}

    def setValidator(self, field_id, fn):
        self.validators[field_id] = fn


class FakeProxy:
    def __init__(self, fn):
        self.fn = fn
        self.destroyed = False

    def __call__(self, *args):
        return self.fn(*args)

    def destroy(self):
        self.destroyed = True


@pytest.fixture
def bare_form(monkeypatch):
    monkeypatch.setattr(form_module, "create_proxy", FakeProxy)
    form = object.__new__(Form)
    form.form = FakeJsForm()
    form._validator_proxies = {}
    return form


def test_validate_is_not_sent_to_js():
    payload = FieldConfig(id="port", validate=lambda v, vals: None, success_message="Looks good").to_dict()
    assert "validate" not in payload and payload["successMessage"] == "Looks good"


def test_validate_must_be_callable():
    with pytest.raises(ValueError, match="validate must be callable"):
        FieldConfig(id="port", validate="not a function").to_dict()


def test_iter_fields_looks_inside_fieldsets():
    inner = FieldConfig(id="b", validate=lambda v, vals: None)
    items = [FieldConfig(id="a"), FormFieldset("g", fields=[FormFieldset(fields=[inner])])]
    assert [f.id for f in form_module._iter_fields(items)] == ["a", "b"]


def test_validator_gets_value_and_values(bare_form):
    seen = []
    bare_form.set_validator("end", lambda v, vals: seen.append((v, vals)) or (None if v > vals["start"] else "Must be after start"))
    call = bare_form.form.validators["end"]
    assert call(5, {"start": 3}) is None
    assert call(2, {"start": 3}) == "Must be after start"
    assert seen == [(5, {"start": 3}), (2, {"start": 3})]


def test_values_default_to_empty_dict(bare_form):
    bare_form.set_validator("x", lambda v, vals: vals)
    assert bare_form.form.validators["x"]("a", None) == {}


def test_exception_becomes_invalid_value(bare_form, capsys):
    bare_form.set_validator("x", lambda v, vals: 1 / 0)
    assert bare_form.form.validators["x"]("a", {}) == "Invalid value"
    assert "ZeroDivisionError" in capsys.readouterr().err


def test_replacing_and_removing_destroys_old_proxy(bare_form):
    bare_form.set_validator("x", lambda v, vals: None)
    first = bare_form._validator_proxies["x"]
    bare_form.set_validator("x", lambda v, vals: "no")
    assert first.destroyed and bare_form.form.validators["x"]("a", {}) == "no"
    second = bare_form._validator_proxies["x"]
    bare_form.set_validator("x", None)
    assert second.destroyed and bare_form.form.validators["x"] is None and "x" not in bare_form._validator_proxies


def test_set_validator_rejects_non_callables(bare_form):
    with pytest.raises(ValueError, match="callable or None"):
        bare_form.set_validator("x", 42)


def test_async_validator_returns_an_awaitable(bare_form):
    import asyncio
    import inspect

    async def taken(value, values):
        await asyncio.sleep(0)
        return "Taken" if value == "ada" else None

    bare_form.set_validator("user", taken)
    pending = bare_form.form.validators["user"]("ada", {})
    assert inspect.isawaitable(pending)
    assert asyncio.run(pending) == "Taken"
    assert asyncio.run(bare_form.form.validators["user"]("bob", {})) is None


def test_async_validator_exception_becomes_invalid_value(bare_form, capsys):
    import asyncio

    async def broken(value, values):
        raise RuntimeError("backend down")

    bare_form.set_validator("user", broken)
    assert asyncio.run(bare_form.form.validators["user"]("x", {})) == "Invalid value"
    assert "backend down" in capsys.readouterr().err
