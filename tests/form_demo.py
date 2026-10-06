import datetime as dt
import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow, ModalConfig,
                   ModalWindow, SelectOption)

REGIONS = [SelectOption(f"r{i}", f"Region {i}") for i in range(1, 31)] + [SelectOption("x", "<script>x</script>")]


class form_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form field types", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;max-width:620px;display:grid;gap:12px">'
            '<div style="display:flex;gap:8px"><button id="theme">Toggle theme</button>'
            '<button id="fill">set_values</button><button id="opts">set_field_options</button>'
            '<button id="modal">Modal combo</button></div>'
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
                FieldConfig(id="region", label="Region", type="combo", options=REGIONS, value="r2",
                            placeholder="Search regions"),
                FieldConfig(id="labels", label="Labels", type="combo", multiple=True, allow_custom=True,
                            options=["bug", "feature", "docs"], value=["docs"], required=True),
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
                "region": "r30", "labels": ["bug", "urgent"],
            })),
            create_proxy(lambda _e: (self.form.set_field_options("tags", ["gamma", "delta"]),
                                     self.form.set_field_options("region", REGIONS[25:]))),
            create_proxy(lambda _e: self._open_modal()),
        ]
        for button, proxy in zip(("theme", "fill", "opts", "modal"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytFormValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.document.body.dataset.ready = "true"

    def _open_modal(self):
        self.modal = ModalWindow(ModalConfig(title="Pick a region", width=360, height=180))
        self.modal_form = Form(FormConfig(submit_text=None, fields=[
            FieldConfig(id="region", label="Region", type="combo", options=REGIONS),
            FieldConfig(id="pin", label="Pin it", type="toggle"),
        ]), container=self.modal.body)
        self.modal_form.on_change(lambda v: self._record("modal", v))
        self.modal.show()

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-6:], indent=1)
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
