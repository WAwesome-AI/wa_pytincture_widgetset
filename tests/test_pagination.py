"""CPython tests for Pagination config and page_slice (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import PaginationConfig, page_slice


def test_exported_with_add_helper():
    import wapyt
    from wapyt.layout.layout import Layout

    assert {"Pagination", "PaginationConfig", "page_slice"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_pagination")


def test_config_defaults_leave_total_unknown():
    payload = PaginationConfig().to_dict()
    assert "total" not in payload
    assert payload["page"] == 1 and payload["pageSize"] == 50 and payload["pageSizes"] == []
    assert payload["showJump"] is True and payload["numbers"] is False


def test_config_camel_cases_options():
    payload = PaginationConfig(total=1234, page=3, page_size=20, page_sizes=[20, 50], exact=False,
                               has_more=False, numbers=True, siblings=2, empty_text="Nothing").to_dict()
    assert payload["total"] == 1234 and payload["exact"] is False and payload["hasMore"] is False
    assert payload["pageSizes"] == [20, 50] and payload["siblings"] == 2 and payload["emptyText"] == "Nothing"


@pytest.mark.parametrize("kwargs, message", [
    ({"page_size": 0}, "page_size must be at least 1"),
    ({"page": 0}, "page is 1-based"),
    ({"total": -1}, "total must not be negative"),
    ({"page_sizes": [20, 0]}, "page_size must be at least 1"),
])
def test_config_rejects_bad_values(kwargs, message):
    with pytest.raises(ValueError, match=message):
        PaginationConfig(**kwargs).to_dict()


def test_page_slice():
    rows = list(range(1, 106))
    assert page_slice(rows, 1, 50) == list(range(1, 51))
    assert page_slice(rows, 3, 50) == list(range(101, 106))
    assert page_slice(rows, 4, 50) == []
    assert page_slice(rows, 0, 50) == list(range(1, 51))
    with pytest.raises(ValueError):
        page_slice(rows, 1, 0)
