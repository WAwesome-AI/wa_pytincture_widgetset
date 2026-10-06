"""CPython tests for the Form field types (no browser needed)."""
from __future__ import annotations

import datetime as dt
import json

import pytest

from wapyt import FieldConfig, FormConfig, SelectOption
from wapyt.form.form_config import FIELD_TYPES, json_default


@pytest.mark.parametrize("kind", ["date", "time", "datetime-local", "color", "range",
                                  "radio", "toggle", "checkbox_group", "combo"])
def test_new_types_are_accepted(kind):
    assert kind in FIELD_TYPES
    assert FieldConfig(id="f", type=kind).to_dict()["type"] == kind


def test_unknown_type_is_rejected():
    with pytest.raises(ValueError, match="unknown type 'datetime'"):
        FieldConfig(id="when", type="datetime").to_dict()


def test_defaults_add_no_keys():
    assert FieldConfig(id="f").to_dict() == {"id": "f", "type": "text"}


def test_group_options_inline_and_list_value():
    payload = FieldConfig(id="tags", type="checkbox_group", inline=True, value=["a"],
                          options=["a", SelectOption("b", "Bee")]).to_dict()
    assert payload["inline"] is True and payload["value"] == ["a"]
    assert payload["options"] == ["a", {"value": "b", "label": "Bee"}]


def test_range_show_value_only_sent_when_off():
    assert "showValue" not in FieldConfig(id="v", type="range").to_dict()
    payload = FieldConfig(id="v", type="range", show_value=False, min=0, max=10, step=2).to_dict()
    assert payload["showValue"] is False and (payload["min"], payload["max"], payload["step"]) == (0, 10, 2)


def test_date_objects_become_iso_strings():
    payload = FieldConfig(id="d", type="date", value=dt.date(2026, 10, 6),
                          min=dt.date(2026, 1, 1), max="2026-12-31").to_dict()
    assert (payload["value"], payload["min"], payload["max"]) == ("2026-10-06", "2026-01-01", "2026-12-31")
    assert FieldConfig(id="t", type="time", value=dt.time(14, 30)).to_dict()["value"] == "14:30"
    assert FieldConfig(id="t", type="time", value=dt.time(14, 30, 5)).to_dict()["value"] == "14:30:05"
    stamp = FieldConfig(id="w", type="datetime-local", value=dt.datetime(2026, 10, 6, 9, 5)).to_dict()
    assert stamp["value"] == "2026-10-06T09:05"


def test_aware_datetimes_are_rejected():
    aware = dt.datetime(2026, 10, 6, 9, 5, tzinfo=dt.timezone.utc)
    with pytest.raises(ValueError, match="naive"):
        FieldConfig(id="w", type="datetime-local", value=aware).to_dict()


def test_set_values_serializer_handles_dates_only():
    assert json.dumps({"d": dt.date(2026, 10, 6)}, default=json_default) == '{"d": "2026-10-06"}'
    with pytest.raises(TypeError):
        json.dumps({"x": object()}, default=json_default)


def test_range_message_is_forwarded():
    assert FieldConfig(id="n", type="number", range_message="1-5").to_dict()["rangeMessage"] == "1-5"


def test_form_with_every_type_serializes():
    config = FormConfig(fields=[FieldConfig(id=kind, type=kind) for kind in sorted(FIELD_TYPES)])
    assert len(json.loads(json.dumps(config.to_dict()))["fields"]) == len(FIELD_TYPES)


def test_combo_flags_only_sent_when_on():
    assert FieldConfig(id="c", type="combo").to_dict() == {"id": "c", "type": "combo"}
    payload = FieldConfig(id="c", type="combo", multiple=True, allow_custom=True, value=["a"],
                          options=[SelectOption("a", "A")]).to_dict()
    assert payload["multiple"] is True and payload["allowCustom"] is True and payload["value"] == ["a"]
