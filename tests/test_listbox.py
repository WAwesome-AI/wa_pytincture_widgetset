"""CPython tests for Listbox config (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import ListAction, ListboxConfig


def test_exports_and_layout_helper():
    import wapyt
    from wapyt.layout.layout import Layout

    assert {"Listbox", "ListboxConfig", "ListAction"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_listbox")


def test_payload_camel_cases_and_cleans():
    payload = ListboxConfig(items=[{"id": "a", "title": "A"}], group="board", list_id="todo", draggable=True,
                            drag_handle=True, copy=True, actions=[ListAction("edit", "Edit", "mdi-pencil")],
                            filterable=True, empty_text="Nothing").to_dict()
    assert payload["listId"] == "todo" and payload["dragHandle"] is True and payload["copy"] is True
    assert payload["actions"] == [{"id": "edit", "label": "Edit", "icon": "mdi-pencil"}]
    assert "template" not in payload and payload["emptyText"] == "Nothing"


def test_validation():
    with pytest.raises(ValueError, match="selection"):
        ListboxConfig(selection="many").to_dict()
    with pytest.raises(ValueError, match="duplicate Listbox item ids: a"):
        ListboxConfig(items=[{"id": "a"}, {"id": "a"}]).to_dict()
    with pytest.raises(ValueError, match="needs an 'key'"):
        ListboxConfig(items=[{"title": "x"}], id_field="key").to_dict()


def test_wrapper_api():
    from wapyt.listbox.listbox import Listbox

    assert all(hasattr(Listbox, n) for n in ("on_move", "on_action", "item_body", "move_item", "add_item",
                                             "update_item", "remove_item", "get_items", "set_filter"))
