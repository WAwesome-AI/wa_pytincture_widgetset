"""CPython tests for FormButton and label positions (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import FieldConfig, FormButton, FormConfig


def test_defaults_add_no_keys():
    assert FormConfig().to_dict() == {
        "fields": [], "submitText": "Save", "cancelText": None, "columns": 1,
        "busy": False, "autocomplete": "off",
    }
    assert FormButton("test").to_dict() == {"type": "button", "id": "test"}


def test_button_options():
    payload = FormButton("save_close", "Save and close", "mdi-content-save", variant="primary",
                         submit=True, full=True, tooltip="Saves", span=2, disabled=True,
                         hidden=True, label_position="left").to_dict()
    assert payload == {
        "type": "button", "id": "save_close", "text": "Save and close", "icon": "mdi-content-save",
        "variant": "primary", "submit": True, "full": True, "tooltip": "Saves", "span": 2,
        "disabled": True, "hidden": True, "labelPosition": "left",
    }


@pytest.mark.parametrize("variant", ["default", "primary", "danger", "link"])
def test_button_variants(variant):
    FormButton("b", variant=variant).to_dict()


def test_bad_button_variant():
    with pytest.raises(ValueError, match="variant must be one of"):
        FormButton("b", variant="ghost").to_dict()


def test_buttons_in_fields_and_action_row():
    payload = FormConfig(
        fields=[FieldConfig(id="host"), FormButton("test", "Test connection")],
        buttons=[FormButton("reset", "Reset", variant="link")],
    ).to_dict()
    assert payload["fields"][1] == {"type": "button", "id": "test", "text": "Test connection"}
    assert payload["buttons"] == [{"type": "button", "id": "reset", "text": "Reset", "variant": "link"}]


def test_ids_unique_across_fields_and_buttons():
    with pytest.raises(ValueError, match="duplicate form field or button ids: host"):
        FormConfig(fields=[FieldConfig(id="host")], buttons=[FormButton("host")]).to_dict()


def test_label_position_and_width():
    payload = FormConfig(label_position="left", label_width=140).to_dict()
    assert (payload["labelPosition"], payload["labelWidth"]) == ("left", 140)
    assert FormConfig(label_width="30%").to_dict()["labelWidth"] == "30%"
    field = FieldConfig(id="q", label_position="top", label_width="8rem", hidden_label=True).to_dict()
    assert (field["labelPosition"], field["labelWidth"], field["hiddenLabel"]) == ("top", "8rem", True)


@pytest.mark.parametrize("build", [
    lambda: FormConfig(label_position="right").to_dict(),
    lambda: FieldConfig(id="q", label_position="inline").to_dict(),
    lambda: FormButton("b", label_position="bottom").to_dict(),
])
def test_bad_label_position(build):
    with pytest.raises(ValueError, match="label_position"):
        build()


def test_bad_label_width():
    with pytest.raises(ValueError, match="label_width"):
        FormConfig(label_width=[140]).to_dict()
