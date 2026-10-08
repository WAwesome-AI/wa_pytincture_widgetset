"""CPython tests for max_length, field icons and disabled options (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import FieldConfig, SelectOption


def test_disabled_option_payload():
    assert SelectOption("a").to_dict() == {"value": "a", "label": "a"}
    assert SelectOption("b", "Bee", disabled=True).to_dict() == {"value": "b", "label": "Bee", "disabled": True}


def test_max_length_and_message():
    payload = FieldConfig(id="code", max_length=6, max_length_message="Six at most").to_dict()
    assert (payload["maxLength"], payload["maxLengthMessage"]) == (6, "Six at most")
    assert FieldConfig(id="n", type="textarea", max_length=200).to_dict()["maxLength"] == 200


@pytest.mark.parametrize("kind", ["number", "select", "checkbox", "range"])
def test_max_length_only_on_text(kind):
    with pytest.raises(ValueError, match="max_length applies to text fields"):
        FieldConfig(id="x", type=kind, max_length=3).to_dict()


@pytest.mark.parametrize("kind", ["text", "search", "email", "date", "select", "combo"])
def test_icon_kinds(kind):
    assert FieldConfig(id="x", type=kind, icon="mdi-magnify").to_dict()["icon"] == "mdi-magnify"


@pytest.mark.parametrize("kind", ["textarea", "checkbox", "toggle", "radio", "range", "color", "static"])
def test_icon_refused_elsewhere(kind):
    with pytest.raises(ValueError, match="cannot show an icon"):
        FieldConfig(id="x", type=kind, icon="mdi-magnify").to_dict()
