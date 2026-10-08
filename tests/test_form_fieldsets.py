"""CPython tests for FormFieldset, FormSpacer and static fields (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import FieldConfig, FormButton, FormConfig, FormFieldset, FormSpacer


def test_fieldset_payload_nests():
    payload = FormFieldset("proxy", "Proxy <b>", columns=2, span=2, label_position="left", label_width=120,
                           disabled=True, hidden=True, fields=[
                               FieldConfig(id="proxy_host"),
                               FormSpacer(),
                               FormFieldset(label="Auth", fields=[FieldConfig(id="proxy_user")]),
                               FormButton("proxy_test", "Test"),
                           ]).to_dict()
    assert payload["type"] == "fieldset" and payload["label"] == "Proxy <b>"
    assert (payload["columns"], payload["span"], payload["labelPosition"], payload["labelWidth"]) == (2, 2, "left", 120)
    assert payload["disabled"] is True and payload["hidden"] is True
    assert [f.get("type") for f in payload["fields"]] == ["text", "spacer", "fieldset", "button"]
    assert payload["fields"][2]["fields"] == [{"id": "proxy_user", "type": "text"}]


def test_fieldset_defaults_are_minimal():
    assert FormFieldset().to_dict() == {"type": "fieldset", "fields": []}


def test_fieldset_columns_bounded():
    with pytest.raises(ValueError, match="columns must be 1, 2 or 3"):
        FormFieldset(columns=4).to_dict()


def test_spacer_payload():
    assert FormSpacer().to_dict() == {"type": "spacer"}
    assert FormSpacer("gap", span=2, height=24, hidden=True).to_dict() == {
        "type": "spacer", "id": "gap", "span": 2, "height": 24, "hidden": True}


def test_ids_are_unique_inside_fieldsets():
    with pytest.raises(ValueError, match="duplicate form field or button ids: host"):
        FormConfig(fields=[FieldConfig(id="host"),
                           FormFieldset("g", fields=[FormFieldset(fields=[FieldConfig(id="host")])])]).to_dict()
    with pytest.raises(ValueError, match="duplicate form field or button ids: g"):
        FormConfig(fields=[FormFieldset("g"), FormButton("g")]).to_dict()


def test_static_field():
    payload = FieldConfig(id="created", label="Created", type="static", value=42, placeholder="never").to_dict()
    assert (payload["type"], payload["value"], payload["placeholder"]) == ("static", 42, "never")
    with pytest.raises(ValueError, match="cannot be required"):
        FieldConfig(id="created", type="static", required=True).to_dict()
