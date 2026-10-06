"""CPython tests for the Toolbar config (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import (
    ToolbarButton,
    ToolbarConfig,
    ToolbarSeparator,
    ToolbarSpacer,
    ToolbarText,
)


def test_toolbar_is_exported_and_has_an_add_helper():
    import wapyt
    from wapyt.layout.layout import Layout

    assert "Toolbar" in wapyt.__all__
    assert hasattr(Layout, "add_toolbar")


def test_button_defaults_are_minimal():
    assert ToolbarButton("new").to_dict() == {"type": "button", "id": "new"}


def test_button_options_are_camel_cased():
    payload = ToolbarButton(
        "tiled", "Tiles", "mdi-view-grid", tooltip="Tile panes", variant="accent",
        group="layout", active=True, badge=3, disabled=True, hidden=True,
        show_label=False, keep_label=True,
    ).to_dict()
    assert payload == {
        "type": "button", "id": "tiled", "label": "Tiles", "icon": "mdi-view-grid",
        "tooltip": "Tile panes", "variant": "accent", "group": "layout", "active": True,
        "badge": 3, "disabled": True, "hidden": True, "showLabel": False, "keepLabel": True,
    }


def test_badge_zero_survives():
    assert ToolbarButton("inbox", badge=0).to_dict()["badge"] == 0


def test_unknown_variant_is_rejected():
    with pytest.raises(ValueError, match="variant must be one of"):
        ToolbarButton("x", variant="warning").to_dict()


def test_other_item_types():
    assert ToolbarText("user", "ada").to_dict() == {"type": "text", "id": "user", "text": "ada"}
    assert ToolbarSeparator().to_dict() == {"type": "separator"}
    assert ToolbarSpacer().to_dict() == {"type": "spacer"}


def test_config_serialises_items_in_order():
    payload = ToolbarConfig(
        items=[ToolbarButton("a"), ToolbarSeparator(), ToolbarSpacer(), ToolbarText("u")],
        label="Main",
    ).to_dict()
    assert [item["type"] for item in payload["items"]] == ["button", "separator", "spacer", "text"]
    assert payload["label"] == "Main" and payload["compact"] == "auto"


def test_duplicate_ids_are_rejected():
    with pytest.raises(ValueError, match="duplicate toolbar item ids: a"):
        ToolbarConfig(items=[ToolbarButton("a"), ToolbarText("a")]).to_dict()


def test_compact_mode_is_validated():
    assert ToolbarConfig(compact="never").to_dict()["compact"] == "never"
    with pytest.raises(ValueError, match="compact must be"):
        ToolbarConfig(compact="sometimes").to_dict()


def test_event_payload_maps_jsnull_to_none():
    from wapyt._runtime import to_plain as _plain

    class JsNull:  # stands in for pyodide.ffi.JsNull
        pass

    assert _plain({"id": "new", "group": JsNull(), "nested": [JsNull()]}) == {
        "id": "new", "group": None, "nested": [None],
    }
