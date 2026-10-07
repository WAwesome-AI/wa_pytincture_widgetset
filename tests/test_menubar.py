"""CPython tests for MenuBar config and ContextMenu item state (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import MenuBarConfig, MenuItem


def test_exports_and_layout_helper():
    import wapyt
    from wapyt.layout.layout import Layout

    assert {"MenuBar", "MenuBarConfig"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_menubar")


def test_checkable_and_group_items():
    assert MenuItem("wrap", "Wrap", checkable=True, checked=True).to_dict() == {
        "id": "wrap", "label": "Wrap", "checkable": True, "checked": True}
    assert MenuItem("dark", "Dark", group="theme").to_dict()["group"] == "theme"
    assert "checkable" not in MenuItem("plain").to_dict()


def test_menubar_payload():
    payload = MenuBarConfig(items=[
        MenuItem("file", "File", items=[MenuItem("new", "New"), MenuItem(separator=True), MenuItem("quit", "Quit")]),
        MenuItem("help", "Help"),
    ], label="Main menu").to_dict()
    assert payload["label"] == "Main menu"
    assert payload["items"][0]["items"][1] == {"separator": True}
    assert payload["items"][1] == {"id": "help", "label": "Help"}


def test_menubar_rejects_duplicates_and_top_level_separators():
    with pytest.raises(ValueError, match="duplicate menu item ids: new"):
        MenuBarConfig(items=[MenuItem("file", items=[MenuItem("new")]), MenuItem("edit", items=[MenuItem("new")])]).to_dict()
    with pytest.raises(ValueError, match="separators"):
        MenuBarConfig(items=[MenuItem("file"), MenuItem(separator=True)]).to_dict()


def test_state_api_on_both():
    from wapyt.contextmenu.contextmenu import ContextMenu
    from wapyt.menubar.menubar import MenuBar

    for cls in (ContextMenu, MenuBar):
        assert all(hasattr(cls, n) for n in ("set_disabled", "set_hidden", "is_disabled", "is_hidden",
                                             "set_checked", "is_checked"))
