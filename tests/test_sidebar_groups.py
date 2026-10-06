"""CPython tests for Sidebar groups and entries (no browser needed)."""
from __future__ import annotations

import json

from wapyt import SidebarConfig, SidebarHeading, SidebarItem, SidebarSeparator, SidebarSpacer


def test_entries_and_nested_groups_serialize():
    config = SidebarConfig(items=[
        SidebarHeading("Data"),
        SidebarItem("dbs", "Databases", "mdi-database", expanded=True, items=[
            SidebarItem("prod", "prod", badge=0),
            SidebarItem("archive", "Archive", items=[SidebarItem("old", "2019")]),
        ]),
        SidebarSeparator(),
        SidebarSpacer(),
        SidebarItem("settings", "Settings", "mdi-cog", disabled=True, tooltip="Admins only"),
    ], expanded=["dbs"])
    payload = json.loads(json.dumps(config.to_dict()))
    items = payload["items"]
    assert items[0] == {"type": "heading", "label": "Data"}
    assert items[1]["expanded"] is True and items[1]["items"][0]["badge"] == 0
    assert items[1]["items"][1]["items"][0] == {"id": "old", "label": "2019", "data": {}}
    assert items[2] == {"type": "separator"} and items[3] == {"type": "spacer"}
    assert items[4]["disabled"] is True and items[4]["tooltip"] == "Admins only"
    assert payload["expanded"] == ["dbs"]


def test_plain_item_unchanged():
    assert SidebarItem("home", "Home", "mdi-home").to_dict() == {
        "id": "home", "label": "Home", "icon": "mdi-home", "data": {}}
    assert "expanded" not in SidebarConfig().to_dict()


def test_wrapper_has_group_api():
    from wapyt.sidebar.sidebar import Sidebar

    assert all(hasattr(Sidebar, n) for n in ("on_toggle", "expand_group", "collapse_group", "get_expanded",
                                              "set_expanded", "set_badge", "set_items", "destroy"))
