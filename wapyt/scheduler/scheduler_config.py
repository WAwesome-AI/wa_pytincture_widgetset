from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Union

VIEWS = ("day", "week", "work_week", "month", "agenda")
ITEM_COLORS = ("blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red")
When = Union[str, _dt.date, _dt.datetime]


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


def iso(value: Optional[When], *, all_day: bool = False) -> Optional[str]:
    """
    A naive ISO string: ``2026-10-08`` for dates (and all-day items),
    ``2026-10-08T09:30`` for datetimes (seconds only when set). Aware
    datetimes are refused: the scheduler has no time zones; convert to the
    viewer's local time first.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value[:10] if all_day else value
    if isinstance(value, _dt.datetime):
        if value.tzinfo is not None:
            raise ValueError("scheduler times must be naive (convert to local time first)")
        if all_day:
            return value.date().isoformat()
        spec = "minutes" if not value.second and not value.microsecond else "seconds"
        return value.isoformat(timespec=spec)
    if isinstance(value, _dt.date):
        return value.isoformat()
    raise TypeError(f"expected a date, datetime or ISO string, got {type(value).__name__}")


def parse_when(value: Any) -> Any:
    """ISO strings from the page back to ``date`` / ``datetime``."""
    if not isinstance(value, str):
        return value
    if len(value) == 10:
        return _dt.date.fromisoformat(value)
    return _dt.datetime.fromisoformat(value)


@dataclass
class ScheduleItem:
    """
    One appointment.

    Args:
        id: Unique id, carried by every event.
        title: Shown on the item (as text).
        start / end: Naive ``datetime`` (or ISO string). For ``all_day``
            items, dates; ``end`` is exclusive (a one-day item ends the next
            day) and defaults to the day after ``start``. A timed item
            without ``end`` lasts one slot.
        all_day: An all-day item: the all-day row in day / week views.
        color: A palette name (``blue``, ``orange``, ``aqua``, ``yellow``,
            ``magenta``, ``green``, ``violet``, ``red``; light and dark
            steps) or a hex colour.
        editable: False pins it (no move, resize or delete).
        description: Shown in the agenda and the iCal export.
        series_id: Groups occurrences of a recurring series (they arrive
            already expanded; the scheduler computes no recurrence rules).
        data: Anything else the app wants back in event payloads.
    """

    id: str
    title: str = ""
    start: Optional[When] = None
    end: Optional[When] = None
    all_day: bool = False
    color: Optional[str] = None
    editable: bool = True
    description: Optional[str] = None
    series_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        if self.start is None:
            raise ValueError(f"ScheduleItem {self.id!r} needs a start")
        start = iso(self.start, all_day=self.all_day)
        end = iso(self.end, all_day=self.all_day)
        if end is not None and end < start:
            raise ValueError(f"ScheduleItem {self.id!r} ends before it starts")
        return _clean({
            "id": str(self.id),
            "title": self.title,
            "start": start,
            "end": end,
            "allDay": self.all_day or None,
            "color": self.color,
            "editable": None if self.editable else False,
            "description": self.description,
            "seriesId": self.series_id,
            "data": self.data,
        })


@dataclass
class SchedulerConfig:
    """
    Layout and behaviour for :class:`Scheduler`.

    Args:
        view: ``day``, ``week`` (default), ``work_week`` (Monday to Friday),
            ``month`` or ``agenda``.
        views: The views offered in the switcher (all five by default).
        date: The date to show (default today).
        items: :class:`ScheduleItem` entries to start with.
        week_start: First day of the week, 0 Sunday to 6 Saturday (default
            1, Monday).
        day_start / day_end: Hours shown in day / week views (0 and 24).
        scroll_to: Hour scrolled into view on first show (8).
        slot_minutes: Grid step for creating, moving and resizing (30).
        slot_height: Pixels per slot (22).
        time_format: ``"12"`` or ``"24"``; by default the locale decides.
        locale: A BCP 47 tag (``"de-DE"``) for day, month and time names;
            the browser's by default.
        now_indicator: A line at the current time in today's column.
        min_item_minutes: Shortest an item can be resized to (one slot).
        read_only: No creating, moving, resizing or deleting.
        mini_calendar: A small month picker beside the views (hidden when
            the scheduler is narrower than 640px).
        agenda_days: Days the agenda view covers (14).
        height: A fixed height, if the container has none of its own.
        title: Accessible name of the scheduler.
    """

    view: str = "week"
    views: List[str] = field(default_factory=lambda: list(VIEWS))
    date: Optional[When] = None
    items: List[ScheduleItem] = field(default_factory=list)
    week_start: int = 1
    day_start: int = 0
    day_end: int = 24
    scroll_to: int = 8
    slot_minutes: int = 30
    slot_height: int = 22
    time_format: Optional[str] = None
    locale: Optional[str] = None
    now_indicator: bool = True
    min_item_minutes: Optional[int] = None
    read_only: bool = False
    mini_calendar: bool = True
    agenda_days: int = 14
    height: Optional[Union[int, str]] = None
    title: str = "Schedule"

    def to_dict(self) -> Dict[str, Any]:
        if self.view not in VIEWS:
            raise ValueError(f"unknown view {self.view!r}; expected one of {', '.join(VIEWS)}")
        unknown = [v for v in self.views if v not in VIEWS]
        if unknown:
            raise ValueError(f"unknown views: {', '.join(unknown)}")
        if self.view not in self.views:
            raise ValueError(f"view {self.view!r} is not in views")
        if not 0 <= self.week_start <= 6:
            raise ValueError("week_start is 0 (Sunday) to 6 (Saturday)")
        if not 0 <= self.day_start < self.day_end <= 24:
            raise ValueError("need 0 <= day_start < day_end <= 24")
        if self.slot_minutes not in (5, 10, 15, 20, 30, 60):
            raise ValueError("slot_minutes must be 5, 10, 15, 20, 30 or 60")
        if self.time_format not in (None, "12", "24"):
            raise ValueError("time_format must be '12' or '24'")
        items = [i.to_dict() if hasattr(i, "to_dict") else i for i in self.items]
        ids = [str(i["id"]) for i in items]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate scheduler item ids: {', '.join(duplicates)}")
        return _clean({
            "view": self.view,
            "views": list(self.views),
            "date": iso(self.date, all_day=True),
            "items": items,
            "weekStart": self.week_start,
            "dayStart": self.day_start,
            "dayEnd": self.day_end,
            "scrollTo": self.scroll_to,
            "slotMinutes": self.slot_minutes,
            "slotHeight": self.slot_height,
            "timeFormat": self.time_format,
            "locale": self.locale,
            "nowIndicator": None if self.now_indicator else False,
            "minItemMinutes": self.min_item_minutes,
            "readOnly": self.read_only or None,
            "miniCalendar": None if self.mini_calendar else False,
            "agendaDays": self.agenda_days,
            "height": self.height,
            "title": self.title,
        })


# ── iCal ────────────────────────────────────────────────────────────────────

def _ics_text(value: str) -> str:
    return (value.replace("\\", "\\\\").replace(";", "\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n"))


def _fold(line: str) -> List[str]:
    """RFC 5545: lines over 75 octets continue on lines starting with a space,
    never splitting a UTF-8 character."""
    out: List[str] = []
    current = ""
    size = 0
    for ch in line:
        width = len(ch.encode("utf-8"))
        limit = 75 if not out else 74  # continuation lines lose one to the space
        if size + width > limit:
            out.append(current)
            current, size = "", 0
        current += ch
        size += width
    out.append(current)
    return [out[0]] + [" " + part for part in out[1:]]


def to_ics(items: Iterable[Union[ScheduleItem, Dict[str, Any]]], *, name: Optional[str] = None,
           stamp: Optional[_dt.datetime] = None) -> str:
    """
    The items as an iCalendar (RFC 5545) document. Times are floating local
    times (no time zone), as the scheduler shows them; all-day items are
    ``VALUE=DATE`` with an exclusive end. ``stamp`` (UTC) is the DTSTAMP,
    now by default.
    """
    stamp = (stamp or _dt.datetime.now(_dt.timezone.utc)).astimezone(_dt.timezone.utc)
    dtstamp = stamp.strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//wapyt//Scheduler//EN", "CALSCALE:GREGORIAN"]
    if name:
        lines.append(f"X-WR-CALNAME:{_ics_text(name)}")
    for raw in items:
        item = raw.to_dict() if hasattr(raw, "to_dict") else dict(raw)
        all_day = bool(item.get("allDay", item.get("all_day")))
        start = parse_when(item["start"])
        end = parse_when(item.get("end")) if item.get("end") else None
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{_ics_text(str(item['id']))}@wapyt")
        lines.append(f"DTSTAMP:{dtstamp}")
        if all_day:
            first = start if not isinstance(start, _dt.datetime) else start.date()
            last = end if end is not None else first + _dt.timedelta(days=1)
            last = last if not isinstance(last, _dt.datetime) else last.date()
            lines.append(f"DTSTART;VALUE=DATE:{first.strftime('%Y%m%d')}")
            lines.append(f"DTEND;VALUE=DATE:{last.strftime('%Y%m%d')}")
        else:
            if not isinstance(start, _dt.datetime):
                start = _dt.datetime.combine(start, _dt.time())
            lines.append(f"DTSTART:{start.strftime('%Y%m%dT%H%M%S')}")
            if end is not None:
                if not isinstance(end, _dt.datetime):
                    end = _dt.datetime.combine(end, _dt.time())
                lines.append(f"DTEND:{end.strftime('%Y%m%dT%H%M%S')}")
        lines.append(f"SUMMARY:{_ics_text(str(item.get('title') or ''))}")
        if item.get("description"):
            lines.append(f"DESCRIPTION:{_ics_text(str(item['description']))}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    folded: List[str] = []
    for line in lines:
        folded.extend(_fold(line))
    return "\r\n".join(folded) + "\r\n"
