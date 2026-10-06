"""CPython tests for DataTable row/cell classes and hidden columns (no browser needed)."""
from __future__ import annotations

from wapyt import ColumnConfig, DataTableConfig
from wapyt.datatable.datatable import DataTable


def test_new_keys_only_sent_when_set():
    assert not {"hidden", "css", "cellClassBy"} & set(ColumnConfig(id="a").to_dict())
    assert "rowClassBy" not in DataTableConfig().to_dict()


def test_payloads():
    column = ColumnConfig(id="due", hidden=True, css="num col-due", cell_class_by="due_class").to_dict()
    assert column["hidden"] is True and column["css"] == "num col-due" and column["cellClassBy"] == "due_class"
    assert DataTableConfig(row_class_by="status_class").to_dict()["rowClassBy"] == "status_class"


def test_wrapper_has_hidden_column_api():
    assert all(hasattr(DataTable, n) for n in ("hide_column", "show_column", "set_column_hidden", "is_column_hidden"))
