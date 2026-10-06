"""CPython tests for the ContextMenu config (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import ContextMenuConfig, MenuItem


def test_exported():
    import wapyt

    assert {"ContextMenu", "ContextMenuConfig", "MenuItem"} <= set(wapyt.__all__)


def test_item_defaults_are_minimal():
    assert MenuItem("open").to_dict() == {"id": "open"}


def test_item_options_are_serialised():
    assert MenuItem("del", "Delete", "mdi-delete", shortcut="Del", danger=True, disabled=True).to_dict() == {
        "id": "del", "label": "Delete", "icon": "mdi-delete", "shortcut": "Del",
        "danger": True, "disabled": True,
    }


def test_separator_ignores_everything_else():
    assert MenuItem("x", "X", separator=True).to_dict() == {"separator": True}
    assert MenuItem(separator=True).to_dict() == {"separator": True}


def test_item_needs_an_id():
    with pytest.raises(ValueError, match="needs an id"):
        MenuItem(label="Nameless").to_dict()


def test_submenus_nest():
    payload = MenuItem("share", "Share", items=[MenuItem("link"), MenuItem("email")]).to_dict()
    assert payload["items"] == [{"id": "link"}, {"id": "email"}]


def test_duplicate_ids_are_rejected_across_submenus():
    config = ContextMenuConfig(items=[
        MenuItem("copy"),
        MenuItem("share", items=[MenuItem("copy")]),
        MenuItem(separator=True),
    ])
    with pytest.raises(ValueError, match="duplicate menu item ids: copy"):
        config.to_dict()


def test_config_payload():
    payload = ContextMenuConfig(items=[MenuItem("a"), MenuItem(separator=True)], label="Rows").to_dict()
    assert payload == {"items": [{"id": "a"}, {"separator": True}], "label": "Rows"}


def test_payload_jsnull_becomes_none():
    from wapyt.contextmenu.contextmenu import _plain

    class JsNull:
        pass

    assert _plain({"id": "a", "context": JsNull(), "target": "row-1"}) == {
        "id": "a", "context": None, "target": "row-1",
    }
