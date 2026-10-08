"""
Scheduler widget: appointments on day / week / month / agenda views.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from .scheduler_config import ScheduleItem, SchedulerConfig, When, iso, parse_when, to_ics

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore

_ITEM_KEYS = {"title": "title", "start": "start", "end": "end", "all_day": "allDay", "color": "color",
              "editable": "editable", "description": "description", "series_id": "seriesId", "data": "data"}


def _dates(payload: Any) -> Any:
    """Turn the ISO strings in an event payload (top level, ``old`` and
    ``item``) into ``date`` / ``datetime``."""
    if not isinstance(payload, dict):
        return payload
    out = dict(payload)
    for key in ("start", "end"):
        if key in out:
            out[key] = parse_when(out[key])
    for nested in ("old", "item"):
        if isinstance(out.get(nested), dict):
            out[nested] = _dates(out[nested])
    return out


class Scheduler:
    """
    A calendar of appointments people can create, move and resize.

    Quick start::

        sched = self.add_scheduler("main", SchedulerConfig(view="week", items=items))
        sched.on_range_change(lambda r: load(r["start"], r["end"]))  # navigation
        sched.on_move(lambda p: save(p) or sched.revert(p["id"]))     # refused? put it back
        sched.on_create(lambda p: open_new_item_form(p["start"], p["end"]))
        sched.on_open(lambda p: open_item_form(p["item"]))

    The app is the source of truth: a move or resize applies at once and
    fires its event; if the server refuses, call :meth:`revert` (and
    :meth:`set_item_error` to say why). Creating fires ``on_create`` with the
    chosen slot; the app adds the item with :meth:`add_item` once it exists.
    Times are naive local times; events carry ``datetime`` (``date`` for
    all-day items, whose ``end`` is exclusive).
    """

    def __init__(self, config: Optional[SchedulerConfig] = None, *, container: Any = None,
                 root: Optional[Union[str, Any]] = None) -> None:
        if container is None and root is None:
            raise ValueError("Scheduler requires a container or a root element.")
        require_js("Scheduler")
        self.config = config or SchedulerConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        target = self._resolve_root(container=container, root=root)
        if target is None:
            raise RuntimeError("Unable to resolve root element for Scheduler.")
        self.scheduler = js.wapyt.Scheduler.new(target, js.JSON.parse(json.dumps(self.config.to_dict())))

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        if container is not None:
            if hasattr(container, "getContainer"):
                return container.getContainer()
            if hasattr(container, "element"):
                return container.element
            return container
        if isinstance(root, str):
            return js.document.querySelector(root) or js.document.getElementById(root)
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda payload=None: handler(_dates(to_plain(payload))))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.scheduler.on(event_name, proxy)

    # Events ------------------------------------------------------------

    def on_create(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Someone chose a slot to create an item in (a drag across empty
        slots, a double-click, or Enter on a slot): ``{"start", "end",
        "all_day"}``. Add the item with :meth:`add_item` once it exists."""
        self._bind_event("create", handler)

    def on_move(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item was moved (dragged, or arrows then Enter):
        ``{"id", "start", "end", "all_day", "old", "item"}``; ``old`` holds
        the previous ``start`` / ``end``. Already applied: call
        :meth:`revert` if the server refuses."""
        self._bind_event("move", handler)

    def on_resize(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item's end was dragged (or Shift+arrows then Enter); same
        payload as :meth:`on_move`."""
        self._bind_event("resize", handler)

    def on_open(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item was clicked (or Enter): ``{"id", "item"}``."""
        self._bind_event("open", handler)

    def on_delete(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Delete was pressed on an item: ``{"id", "item"}``. The scheduler
        does not remove it; call :meth:`remove_item` once it is gone."""
        self._bind_event("delete", handler)

    def on_range_change(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The visible range changed (navigation or a view switch):
        ``{"start", "end", "view"}`` (dates, ``end`` exclusive). Load the
        items for it. For the first load use :meth:`get_range`."""
        self._bind_event("range", handler)

    # Items -------------------------------------------------------------

    @staticmethod
    def _payload(items: List[Union[ScheduleItem, Dict[str, Any]]]) -> Any:
        return js.JSON.parse(json.dumps([i.to_dict() if hasattr(i, "to_dict") else i for i in items]))

    def set_items(self, items: List[Union[ScheduleItem, Dict[str, Any]]]) -> None:
        """Replace every item (after loading a new range, say)."""
        self.scheduler.setItems(self._payload(items))

    def add_item(self, item: Union[ScheduleItem, Dict[str, Any]]) -> None:
        """Add an item, or replace the one with the same id."""
        payload = item.to_dict() if hasattr(item, "to_dict") else item
        self.scheduler.addItem(js.JSON.parse(json.dumps(payload)))

    def update_item(self, item_id: str, **changes: Any) -> None:
        """Change some of an item's fields: ``title``, ``start``, ``end``,
        ``all_day``, ``color``, ``editable``, ``description``, ``series_id``,
        ``data``."""
        unknown = sorted(set(changes) - set(_ITEM_KEYS))
        if unknown:
            raise ValueError(f"cannot update {', '.join(unknown)} on a scheduler item")
        all_day = changes.get("all_day")
        payload = {}
        for name, value in changes.items():
            if name in ("start", "end"):
                value = iso(value, all_day=bool(all_day))
            payload[_ITEM_KEYS[name]] = value
        self.scheduler.updateItem(item_id, js.JSON.parse(json.dumps(payload)))

    def remove_item(self, item_id: str) -> None:
        self.scheduler.removeItem(item_id)

    def get_items(self) -> List[Dict[str, Any]]:
        """Every loaded item, by start time, with ``datetime`` / ``date``."""
        return [_dates(i) for i in (to_plain(self.scheduler.getItems()) or [])]

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        value = to_plain(self.scheduler.getItem(item_id))
        return _dates(value) if value else None

    def revert(self, item_id: str) -> bool:
        """Put an item back where it was before its last move or resize."""
        return bool(self.scheduler.revert(item_id))

    def set_item_error(self, item_id: str, message: Optional[str]) -> None:
        """Mark an item with an error (a red outline; the message is its
        tooltip and is read out); ``None`` clears it."""
        self.scheduler.setItemError(item_id, js.undefined if message is None else message)

    # Navigation --------------------------------------------------------

    def set_view(self, view: str) -> None:
        self.scheduler.setView(view)

    def get_view(self) -> str:
        return str(self.scheduler.getView())

    def set_date(self, date: When) -> None:
        self.scheduler.setDate(iso(date, all_day=True))

    def get_date(self) -> Any:
        return parse_when(str(self.scheduler.getDate()))

    def get_range(self) -> Dict[str, Any]:
        """The visible range: ``{"start", "end", "view"}``, ``end`` exclusive."""
        return _dates(to_plain(self.scheduler.getRange()))

    def today(self) -> None:
        self.scheduler.today()

    def next(self) -> None:
        self.scheduler.next()

    def prev(self) -> None:
        self.scheduler.prev()

    # Output ------------------------------------------------------------

    def export_ics(self, filename: str = "schedule.ics", *, name: Optional[str] = None) -> int:
        """Download the loaded items as an iCalendar file; returns how many."""
        items = to_plain(self.scheduler.getItems()) or []
        text = to_ics(items, name=name or self.config.title)
        self.scheduler.download(filename, text, "text/calendar")
        return len(items)

    def print(self) -> None:
        """Print the current view alone (the rest of the page is hidden for
        the print; the day grid is printed whole, not scrolled)."""
        self.scheduler.print()

    def refresh(self) -> None:
        self.scheduler.refresh()

    def destroy(self) -> None:
        self.scheduler.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["Scheduler", "SchedulerConfig", "ScheduleItem", "to_ics"]
