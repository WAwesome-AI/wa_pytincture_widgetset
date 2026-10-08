"""CPython tests for the two-thumb range and tick marks (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import FieldConfig


def test_defaults_send_no_range_keys():
    payload = FieldConfig(id="v", type="range").to_dict()
    assert not {"range", "ticks", "majorTicks", "tickLabels"} & payload.keys()


def test_two_thumb_value_becomes_a_list():
    payload = FieldConfig(id="price", type="range", range=True, min=0, max=500, step=10,
                          value=(50, 200)).to_dict()
    assert payload["range"] is True
    assert payload["value"] == [50, 200]


def test_two_thumb_value_may_leave_an_end_open():
    assert FieldConfig(id="p", type="range", range=True, value=[None, 40]).to_dict()["value"] == [None, 40]
    assert "value" not in FieldConfig(id="p", type="range", range=True).to_dict()


@pytest.mark.parametrize("bad", [5, "10-20", [1], [1, 2, 3]])
def test_two_thumb_value_must_be_a_pair(bad):
    with pytest.raises(ValueError, match=r"\[low, high\]"):
        FieldConfig(id="p", type="range", range=True, value=bad).to_dict()


def test_ticks_and_labels():
    payload = FieldConfig(id="v", type="range", ticks=5, major_ticks=25, tick_labels=False).to_dict()
    assert (payload["ticks"], payload["majorTicks"], payload["tickLabels"]) == (5, 25, False)


@pytest.mark.parametrize("option", [{"range": True}, {"ticks": 5}, {"major_ticks": 10}])
def test_range_options_need_a_range_field(option):
    with pytest.raises(ValueError, match="type='range'"):
        FieldConfig(id="n", type="number", **option).to_dict()


@pytest.mark.parametrize("interval", [0, -5])
def test_tick_intervals_must_be_positive(interval):
    with pytest.raises(ValueError, match="greater than 0"):
        FieldConfig(id="v", type="range", ticks=interval).to_dict()
