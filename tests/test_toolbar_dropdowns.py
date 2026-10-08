"""CPython tests for Toolbar dropdown and split buttons (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import MenuItem, ToolbarButton, ToolbarConfig, ToolbarSeparator


def test_plain_button_sends_no_menu_keys():
    payload = ToolbarButton("new", "New").to_dict()
    assert "items" not in payload and "split" not in payload


def test_dropdown_items_are_serialised():
    payload = ToolbarButton("export", "Export", "mdi-export", items=[
        MenuItem("csv", "CSV", shortcut="Ctrl+E"),
        MenuItem(separator=True),
        MenuItem("more", "More", items=[MenuItem("xml", "XML")]),
    ]).to_dict()
    assert payload["items"][0] == {"id": "csv", "label": "CSV", "shortcut": "Ctrl+E"}
    assert payload["items"][1] == {"separator": True}
    assert payload["items"][2]["items"] == [{"id": "xml", "label": "XML"}]


def test_empty_menu_is_still_a_dropdown():
    # Filled later with set_menu_items (recent files, say).
    assert ToolbarButton("recent", "Recent", items=[]).to_dict()["items"] == []


def test_split_needs_items():
    with pytest.raises(ValueError, match="split needs items"):
        ToolbarButton("run", "Run", split=True).to_dict()
    assert ToolbarButton("run", "Run", split=True, items=[MenuItem("debug")]).to_dict()["split"] is True


@pytest.mark.parametrize("state", [{"toggle": True}, {"group": "view"}])
def test_dropdown_cannot_be_a_toggle_unless_split(state):
    with pytest.raises(ValueError, match="cannot be a toggle"):
        ToolbarButton("x", items=[MenuItem("a")], **state).to_dict()
    ToolbarButton("x", items=[MenuItem("a")], split=True, **state).to_dict()


def test_ids_are_unique_across_buttons_and_menus():
    with pytest.raises(ValueError, match="duplicate toolbar item ids: csv"):
        ToolbarConfig(items=[
            ToolbarButton("csv", "CSV"),
            ToolbarSeparator(),
            ToolbarButton("export", items=[MenuItem("csv")]),
        ]).to_dict()
    with pytest.raises(ValueError, match="duplicate toolbar item ids: a"):
        ToolbarConfig(items=[
            ToolbarButton("m1", items=[MenuItem("a")]),
            ToolbarButton("m2", items=[MenuItem("sub", items=[MenuItem("a")])]),
        ]).to_dict()
