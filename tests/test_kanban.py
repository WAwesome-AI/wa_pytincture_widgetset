"""CPython tests for Kanban config (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import KanbanColumn, KanbanConfig, ListAction


def test_exports_and_layout_helper():
    import wapyt
    from wapyt.layout.layout import Layout

    assert {"Kanban", "KanbanConfig", "KanbanColumn"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_kanban")


def test_payload():
    payload = KanbanConfig(columns=[
        KanbanColumn("todo", "To do", items=[{"id": "c1", "title": "A"}]),
        KanbanColumn("doing", "Doing", wip_limit=2, color="#f59e0b", collapsed=True),
    ], actions=[ListAction("edit", "Edit", "mdi-pencil")], wip_strict=True, filterable=True).to_dict()
    assert payload["columns"][1] == {"id": "doing", "title": "Doing", "items": [], "wipLimit": 2,
                                     "color": "#f59e0b", "collapsed": True}
    assert payload["wipStrict"] is True and payload["filterable"] is True and payload["actions"][0]["id"] == "edit"


def test_card_and_column_ids_unique_across_the_board():
    with pytest.raises(ValueError, match="duplicate Kanban card ids: c1"):
        KanbanConfig(columns=[KanbanColumn("a", items=[{"id": "c1"}]), KanbanColumn("b", items=[{"id": "c1"}])]).to_dict()
    with pytest.raises(ValueError, match="duplicate Kanban column ids: a"):
        KanbanConfig(columns=[KanbanColumn("a"), KanbanColumn("a")]).to_dict()
    with pytest.raises(ValueError, match="wip_limit"):
        KanbanColumn("a", wip_limit=-1).to_dict()


def test_wrapper_api():
    from wapyt.kanban.kanban import Kanban

    assert all(hasattr(Kanban, n) for n in ("on_move", "on_add_card", "on_column_move", "move_card", "card_body",
                                            "add_card", "set_wip_limit", "set_collapsed", "get_board"))
