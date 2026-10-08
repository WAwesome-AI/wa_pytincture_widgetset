"""CPython tests for the Scheduler config and iCal export (no browser needed)."""
from __future__ import annotations

import datetime as dt

import pytest

import wapyt
from wapyt import ScheduleItem, SchedulerConfig
from wapyt.scheduler import to_ics
from wapyt.scheduler.scheduler import _dates


def test_exported_with_a_layout_helper():
    from wapyt.layout.layout import Layout
    assert {"Scheduler", "SchedulerConfig", "ScheduleItem"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_scheduler")


def test_item_payload_and_iso_times():
    payload = ScheduleItem("a", "Stand-up <b>", dt.datetime(2026, 10, 8, 9, 30), dt.datetime(2026, 10, 8, 9, 45),
                           color="aqua", description="Daily", series_id="s1", data={"room": 4}).to_dict()
    assert payload == {"id": "a", "title": "Stand-up <b>", "start": "2026-10-08T09:30", "end": "2026-10-08T09:45",
                       "color": "aqua", "description": "Daily", "seriesId": "s1", "data": {"room": 4}}
    assert ScheduleItem("b", start=dt.datetime(2026, 10, 8, 9, 0, 5)).to_dict()["start"] == "2026-10-08T09:00:05"


def test_all_day_items_use_dates():
    payload = ScheduleItem("c", "Trip", dt.date(2026, 10, 8), dt.date(2026, 10, 11), all_day=True, editable=False).to_dict()
    assert (payload["start"], payload["end"], payload["allDay"], payload["editable"]) == ("2026-10-08", "2026-10-11", True, False)
    assert ScheduleItem("d", start=dt.datetime(2026, 10, 8, 14), all_day=True).to_dict()["start"] == "2026-10-08"


@pytest.mark.parametrize("item,match", [
    (ScheduleItem("x"), "needs a start"),
    (ScheduleItem("x", start=dt.datetime(2026, 10, 8, 10), end=dt.datetime(2026, 10, 8, 9)), "ends before"),
    (ScheduleItem("x", start=dt.datetime(2026, 10, 8, 10, tzinfo=dt.timezone.utc)), "naive"),
])
def test_bad_items(item, match):
    with pytest.raises(ValueError, match=match):
        item.to_dict()


def test_config_defaults_and_validation():
    payload = SchedulerConfig().to_dict()
    assert payload["view"] == "week" and payload["weekStart"] == 1 and payload["slotMinutes"] == 30
    for bad, match in [(dict(view="year"), "unknown view"), (dict(views=["day"], view="week"), "not in views"),
                       (dict(week_start=7), "week_start"), (dict(day_start=9, day_end=8), "day_start"),
                       (dict(slot_minutes=7), "slot_minutes"), (dict(time_format="13"), "time_format")]:
        with pytest.raises(ValueError, match=match):
            SchedulerConfig(**bad).to_dict()
    with pytest.raises(ValueError, match="duplicate scheduler item ids: a"):
        SchedulerConfig(items=[ScheduleItem("a", start="2026-10-08T09:00"), ScheduleItem("a", start="2026-10-09T09:00")]).to_dict()


def test_event_payload_dates():
    out = _dates({"id": "a", "start": "2026-10-08T09:30", "end": "2026-10-08T10:00",
                  "old": {"start": "2026-10-07T09:30", "end": "2026-10-07T10:00"},
                  "item": {"start": "2026-10-08", "end": "2026-10-09"}})
    assert out["start"] == dt.datetime(2026, 10, 8, 9, 30) and out["old"]["start"] == dt.datetime(2026, 10, 7, 9, 30)
    assert out["item"]["start"] == dt.date(2026, 10, 8)


def test_ics_export():
    stamp = dt.datetime(2026, 10, 8, 12, 0, tzinfo=dt.timezone.utc)
    text = to_ics([
        ScheduleItem("a", "Review; plan, ship\\now", dt.datetime(2026, 10, 8, 9, 30), dt.datetime(2026, 10, 8, 10),
                     description="Line one\nLine two"),
        ScheduleItem("b", "Offsite", dt.date(2026, 10, 12), dt.date(2026, 10, 14), all_day=True),
        ScheduleItem("c", "x" * 120, dt.datetime(2026, 10, 9, 8)),
    ], name="Team", stamp=stamp)
    assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") and text.endswith("END:VCALENDAR\r\n")
    lines = text.split("\r\n")
    assert "X-WR-CALNAME:Team" in lines and "DTSTAMP:20261008T120000Z" in lines
    assert "DTSTART:20261008T093000" in lines and "DTEND:20261008T100000" in lines
    assert "SUMMARY:Review\; plan\\, ship\\\\now" in lines
    assert "DESCRIPTION:Line one\\nLine two" in lines
    assert "DTSTART;VALUE=DATE:20261012" in lines and "DTEND;VALUE=DATE:20261014" in lines
    assert "UID:a@wapyt" in lines
    assert all(len(line.encode()) <= 75 for line in lines)
    summary = [i for i, line in enumerate(lines) if line.startswith("SUMMARY:xxx")][0]
    assert lines[summary + 1].startswith(" x") and (lines[summary] + lines[summary + 1][1:]).count("x") == 120


def test_ics_folding_keeps_utf8_characters_whole():
    text = to_ics([ScheduleItem("u", "é" * 60, dt.datetime(2026, 10, 8, 9))], stamp=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
    for line in text.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75
        line.encode("utf-8").decode("utf-8")
