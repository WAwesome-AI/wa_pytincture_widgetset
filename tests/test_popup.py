"""CPython tests for Popup config and tooltip_attr (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import PopupConfig, tooltip_attr


def test_exported():
    import wapyt

    assert {"Popup", "PopupConfig", "tooltip", "tooltip_attr", "set_tooltips_enabled"} <= set(wapyt.__all__)


def test_config_defaults_and_camel_case():
    assert PopupConfig().to_dict() == {"placement": "bottom", "offset": 6, "closeOnOutside": True,
                                       "closeOnEscape": True, "focus": True}
    payload = PopupConfig(placement="top-end", width=320, max_height="50vh", label="Filter",
                          close_on_outside=False, focus=False).to_dict()
    assert payload["placement"] == "top-end" and payload["width"] == 320 and payload["maxHeight"] == "50vh"
    assert payload["closeOnOutside"] is False and payload["focus"] is False and payload["label"] == "Filter"


def test_config_rejects_bad_placement():
    with pytest.raises(ValueError, match="placement must be one of"):
        PopupConfig(placement="above").to_dict()


def test_tooltip_attr_escapes():
    assert tooltip_attr('Delete "all" <now> & go') == 'data-wapyt-tooltip="Delete &quot;all&quot; &lt;now&gt; &amp; go"'
    assert tooltip_attr("Hi", "right") == 'data-wapyt-tooltip="Hi" data-wapyt-tooltip-placement="right"'
    assert tooltip_attr("") == "" and tooltip_attr(None) == ""
    with pytest.raises(ValueError):
        tooltip_attr("Hi", "top-start")
