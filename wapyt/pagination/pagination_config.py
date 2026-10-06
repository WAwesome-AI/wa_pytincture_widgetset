from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


def _check_size(page_size: int) -> int:
    if int(page_size) < 1:
        raise ValueError(f"page_size must be at least 1; got {page_size!r}")
    return int(page_size)


@dataclass
class PaginationConfig:
    """
    Initial state and look of a :class:`Pagination`.

    Args:
        total: Item count, or ``None`` when the server could not count them;
            then Next stays enabled while ``has_more`` and there is no Last.
        page: 1-based current page.
        page_size: Items per page.
        page_sizes: Choices for the page-size selector; empty hides it.
        exact: ``False`` marks ``total`` as an estimate ("of ≈1,200").
        has_more: With an unknown ``total``, whether a next page exists.
        numbers: Numbered page buttons (``1 … 4 5 6 … 20``) instead of the
            page box. Needs a known ``total``; falls back to the box without.
        siblings: Numbered buttons either side of the current page.
        show_jump: The "page N of M" box (ignored when ``numbers``).
        show_summary: The "1–50 of 1,234" text.
        empty_text: Summary when there is nothing to show.
        label: ``aria-label`` of the ``<nav>``.
        extra: Additional properties forwarded to JS verbatim.
    """

    total: Optional[int] = None
    page: int = 1
    page_size: int = 50
    page_sizes: List[int] = field(default_factory=list)
    exact: bool = True
    has_more: bool = True
    numbers: bool = False
    siblings: int = 1
    show_jump: bool = True
    show_summary: bool = True
    empty_text: str = "No items"
    label: str = "Pagination"
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        _check_size(self.page_size)
        if self.page < 1:
            raise ValueError(f"page is 1-based; got {self.page!r}")
        if self.total is not None and self.total < 0:
            raise ValueError("total must not be negative")
        sizes = [_check_size(size) for size in self.page_sizes]
        payload = {
            "total": self.total,
            "page": int(self.page),
            "pageSize": int(self.page_size),
            "pageSizes": sizes,
            "exact": self.exact,
            "hasMore": self.has_more,
            "numbers": self.numbers,
            "siblings": max(0, int(self.siblings)),
            "showJump": self.show_jump,
            "showSummary": self.show_summary,
            "emptyText": self.empty_text,
            "label": self.label,
        }
        payload.update(self.extra or {})
        return _clean(payload)
