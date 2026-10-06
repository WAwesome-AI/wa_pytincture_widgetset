"""CPython tests for DataTable frozen columns (no browser needed)."""
from __future__ import annotations


def test_frozen_columns_payload():
    from wapyt import DataTableConfig
    from wapyt.datatable.datatable import DataTable

    assert "frozenColumns" not in DataTableConfig().to_dict()
    assert DataTableConfig(frozen_columns=2).to_dict()["frozenColumns"] == 2
    assert hasattr(DataTable, "set_frozen_columns")
