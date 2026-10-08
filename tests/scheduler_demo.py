import datetime as dt
import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, ScheduleItem, SchedulerConfig

D = dt.date(2026, 10, 7)  # a Wednesday


def at(day_offset, hour, minute=0):
    return dt.datetime.combine(D + dt.timedelta(days=day_offset), dt.time(hour, minute))


def items():
    return [
        ScheduleItem("standup", "Stand-up <b>", at(0, 9, 30), at(0, 9, 45), color="aqua", description="Daily"),
        ScheduleItem("review", "Design review", at(0, 10), at(0, 11, 30), color="violet"),
        ScheduleItem("pair", "Pairing", at(0, 10, 30), at(0, 12)),
        ScheduleItem("lunch", "Lunch", at(0, 12, 30), at(0, 13, 30), color="orange", editable=False),
        ScheduleItem("deploy", "Night deploy", at(1, 22), at(2, 2), color="red"),
        ScheduleItem("trip", "Offsite", D + dt.timedelta(days=-1), D + dt.timedelta(days=2), all_day=True, color="green"),
        ScheduleItem("1on1", "1:1", at(-2, 15), at(-2, 15, 30), color="magenta"),
    ] + [ScheduleItem(f"busy{i}", f"Call {i}", at(3, 8 + i), at(3, 8 + i, 30), color="yellow") for i in range(6)]


class scheduler_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Scheduler", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.sched = self.add_scheduler("main", SchedulerConfig(date=D, items=items(), time_format="24",
                                                                locale="en-GB", scroll_to=8, title="Team calendar"))
        self.log = []
        self.refuse = False
        self.next_id = 1
        self.sched.on_create(self._create)
        self.sched.on_move(lambda p: self._change("move", p))
        self.sched.on_resize(lambda p: self._change("resize", p))
        self.sched.on_open(lambda p: self._record("open", {"id": p["id"]}))
        self.sched.on_delete(lambda p: (self._record("delete", {"id": p["id"]}), self.sched.remove_item(p["id"])))
        self.sched.on_range_change(lambda p: self._record("range", {k: str(v) for k, v in p.items()}))
        api = {
            "items": lambda: [{k: str(v) if isinstance(v, (dt.date, dt.datetime)) else v for k, v in i.items()} for i in self.sched.get_items()],
            "item": lambda i: {k: str(v) if isinstance(v, (dt.date, dt.datetime)) else v for k, v in (self.sched.get_item(i) or {}).items()},
            "view": lambda v: self.sched.set_view(v),
            "date": lambda d: self.sched.set_date(d),
            "range": lambda: {k: str(v) for k, v in self.sched.get_range().items()},
            "refuse": lambda v: setattr(self, "refuse", bool(v)),
            "theme": lambda t: self.set_theme(t),
            "ics": lambda: self.sched.export_ics("team.ics"),
            "update": lambda i, title: self.sched.update_item(i, title=title),
            "reset": lambda: self.sched.set_items(items()),
            "print": lambda: self.sched.print(),
        }
        js.window.wapytSched = create_proxy(lambda name, *a: json.dumps(api[name](*a)))
        js.document.body.dataset.ready = "true"

    def _create(self, p):
        self._record("create", {k: str(v) for k, v in p.items()})
        new_id = f"new{self.next_id}"
        self.next_id += 1
        self.sched.add_item(ScheduleItem(new_id, "New item", p["start"], p["end"], all_day=p["all_day"]))

    def _change(self, kind, p):
        self._record(kind, {"id": p["id"], "start": str(p["start"]), "end": str(p["end"]),
                            "old_start": str(p["old"]["start"]), "old_end": str(p["old"]["end"])})
        if self.refuse:
            self.sched.revert(p["id"])
            self.sched.set_item_error(p["id"], "Room is booked")

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.wapytSchedLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
