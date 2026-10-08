"""CPython tests for Tree checkboxes and drag-and-drop config (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import TreeConfig, TreeItem


def test_defaults_add_no_keys():
    payload = TreeConfig().to_dict()
    assert not {"checkboxes", "checkCascade", "draggable", "dropIntoLeaves"} & payload.keys()
    assert TreeItem("a").to_dict() == {"id": "a", "label": "a"}


def test_tree_options():
    payload = TreeConfig(checkboxes=True, check_cascade=False, draggable=True, drop_into_leaves=True,
                         label="Servers").to_dict()
    assert (payload["checkboxes"], payload["checkCascade"], payload["draggable"], payload["dropIntoLeaves"],
            payload["label"]) == (True, False, True, True, "Servers")


def test_item_flags():
    payload = TreeItem("a", checked=True, checkbox=False, draggable=False, droppable=False).to_dict()
    assert (payload["checked"], payload["checkbox"], payload["draggable"], payload["droppable"]) == (True, False, False, False)

