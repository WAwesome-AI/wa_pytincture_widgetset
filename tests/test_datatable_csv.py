"""CPython tests for DataTable CSV export options (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt.datatable.datatable import DataTable


def test_wrapper_has_csv_api():
    assert hasattr(DataTable, "to_csv") and hasattr(DataTable, "export_csv")


def test_csv_options_payload():
    opts = DataTable._csv_opts(True, ["a", "b"], True, False, False, ";")
    assert opts == {"selectedOnly": True, "columns": ["a", "b"], "raw": True, "header": False,
                    "safe": False, "delimiter": ";"}
    assert DataTable._csv_opts(False, None, False, True, True, ",")["columns"] is None


@pytest.mark.parametrize("bad", ["", ";;", '"', "\n"])
def test_bad_delimiters(bad):
    with pytest.raises(ValueError, match="delimiter"):
        DataTable._csv_opts(False, None, False, True, True, bad)
