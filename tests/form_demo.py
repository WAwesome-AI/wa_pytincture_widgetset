import datetime as dt
import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow, SelectOption


class form_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form field types", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;max-width:620px;display:grid;gap:12px">'
            '<div style="display:flex;gap:8px"><button id="theme">Toggle theme</button>'
            '<button id="fill">set_values</button><button id="opts">set_field_options</button></div>'
            '<div id="form"></div><pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.form = Form(FormConfig(
            columns=2,
            submit_text="Submit",
            fields=[
                FieldConfig(id="day", label="Day", type="date", value=dt.date(2026, 10, 6),
                            min="2026-01-01", max=dt.date(2026, 12, 31)),
                FieldConfig(id="at", label="Time", type="time", value=dt.time(9, 30)),
                FieldConfig(id="when", label="Starts", type="datetime-local", span=2),
                FieldConfig(id="colour", label="Colour", type="color", value="#10b981"),
                FieldConfig(id="volume", label="Volume", type="range", min=0, max=10, step=1, value=4),
                FieldConfig(id="plan", label="Plan <b>", type="radio", required=True, inline=True,
                            options=["free", SelectOption("pro", "Pro <i>"), "team"]),
                FieldConfig(id="notify", label="Notifications", type="toggle", value=True),
                FieldConfig(id="tags", label="Tags", type="checkbox_group", required=True, span=2,
                            options=["alpha", "beta", "gamma"], value=["beta"]),
                FieldConfig(id="qty", label="Quantity", type="number", min=1, max=5),
            ],
        ), root="#form")
        self.log = []
        self.form.on_submit(lambda v: self._record("submit", v))
        self.form.on_invalid(lambda v: self._record("invalid", v))
        self.form.on_change(lambda v: self._record("change", v))
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.form.set_values({
                "day": dt.date(2026, 3, 1), "at": "18:45", "when": dt.datetime(2026, 10, 6, 14, 0),
                "colour": "#2563eb", "volume": 9, "plan": "pro", "notify": False, "tags": ["alpha", "gamma"],
            })),
            create_proxy(lambda _e: self.form.set_field_options("tags", ["gamma", "delta"])),
        ]
        for button, proxy in zip(("theme", "fill", "opts"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytFormValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.document.body.dataset.ready = "true"

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-6:], indent=1)
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
