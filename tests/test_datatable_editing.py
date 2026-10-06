"""CPython tests for editable DataTable columns (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import ColumnConfig


def test_editing_keys_only_sent_when_set():
    payload = ColumnConfig(id="name").to_dict()
    assert not {"editable", "editor", "options", "required"} & set(payload)


def test_editable_column_payload():
    payload = ColumnConfig(id="status", editable=True, editor="select", required=True,
                           options=["open", {"value": "done", "label": "Done"}]).to_dict()
    assert payload["editable"] is True and payload["editor"] == "select" and payload["required"] is True
    assert payload["options"] == ["open", {"value": "done", "label": "Done"}]


@pytest.mark.parametrize("editor", ["text", "number", "checkbox", "date"])
def test_editors_accepted(editor):
    assert ColumnConfig(id="c", editable=True, editor=editor).to_dict()["editor"] == editor


def test_bad_editor_and_select_without_options():
    with pytest.raises(ValueError, match="editor must be one of"):
        ColumnConfig(id="c", editable=True, editor="textarea").to_dict()
    with pytest.raises(ValueError, match="needs options"):
        ColumnConfig(id="c", editable=True, editor="select").to_dict()


def test_wrapper_has_editing_api():
    from wapyt.datatable.datatable import DataTable

    assert all(hasattr(DataTable, n) for n in ("on_edit", "set_cell", "set_cell_error", "edit_cell", "cancel_edit"))
