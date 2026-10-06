"""
Pagination widget: first / previous / next / last, a page box or numbered
buttons, a page-size selector and a "1–50 of 1,234" summary.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from .._runtime import create_proxy, require_js, to_plain
from .pagination_config import PaginationConfig, _check_size

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


def page_slice(rows: Sequence[Any], page: int, page_size: int) -> List[Any]:
    """The rows on ``page`` (1-based) when paging a list held in memory."""
    start = (max(1, int(page)) - 1) * _check_size(page_size)
    return list(rows[start:start + int(page_size)])


class Pagination:
    """
    Page controls for a list the server (or the app) pages.

    Quick start::

        pager = Pagination(PaginationConfig(page_size=50, page_sizes=[20, 50, 100]),
                           container=footer)

        async def load(state):
            pager.set_busy(True)
            result = await api.find(page=state["page"], page_size=state["page_size"])
            table.set_rows(result["docs"])
            pager.set_total(result["total"], exact=result["exact"])
            pager.set_busy(False)

        pager.on_change(lambda state: spawn(load(state), "page"))

    ``on_change`` fires only when the person changes page or page size, or
    when ``set_total`` shrinks the list under the current page; the setters
    never fire it, so a load handler can call them freely.
    """

    def __init__(
        self,
        config: Optional[PaginationConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Pagination requires a container or a root element.")
        require_js("Pagination")
        self.config = config or PaginationConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Pagination.")
        self.pager = js.wapyt.Pagination.new(root_element, js.JSON.parse(json.dumps(self.config.to_dict())))

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        target = container
        if target is not None:
            if hasattr(target, "getContainer"):
                return target.getContainer()
            if hasattr(target, "element"):
                return target.element
            return target
        if isinstance(root, str):
            element = js.document.querySelector(root)
            if not element:
                element = js.document.getElementById(root)
            return element
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda *args, **kwargs: handler(*[to_plain(arg) for arg in args], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.pager.on(event_name, proxy)

    def on_change(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Fires with ``{page, page_size, offset}``."""
        self._bind_event("change", handler)

    def get_state(self) -> Dict[str, Any]:
        """``{page, page_size, offset, total, page_count}``; ``total`` and
        ``page_count`` are ``None`` when the total is unknown."""
        return to_plain(self.pager.getState()) or {}

    def set_total(
        self,
        total: Optional[int],
        *,
        exact: bool = True,
        has_more: bool = True,
        shown: Optional[int] = None,
    ) -> None:
        """
        Report the item count after a load. ``total=None`` means unknown:
        ``has_more`` then says whether Next is possible, and ``shown`` (the
        rows on this page) keeps the summary honest on a short last page.
        """
        # js.undefined survives the FFI as "nothing" where a bare None may not.
        self.pager.setTotal(
            js.undefined if total is None else int(total),
            js.JSON.parse(json.dumps({
                "exact": bool(exact),
                "hasMore": bool(has_more),
                "shown": None if shown is None else int(shown),
            })),
        )

    def set_page(self, page: int) -> None:
        """Move to ``page`` without firing ``on_change``."""
        self.pager.setPage(int(page))

    def set_page_size(self, page_size: int) -> None:
        """Change the page size (back to page 1) without firing ``on_change``."""
        self.pager.setPageSize(_check_size(page_size))

    def set_busy(self, busy: bool = True) -> None:
        """Disable the controls while a page loads."""
        self.pager.setBusy(bool(busy))

    def page_rows(self, rows: Sequence[Any]) -> List[Any]:
        """The current page of an in-memory list."""
        state = self.get_state()
        return page_slice(rows, state.get("page", 1), state.get("page_size", self.config.page_size))

    def destroy(self) -> None:
        self.pager.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["Pagination", "PaginationConfig", "page_slice"]
