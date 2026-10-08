import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow, SelectOption


class form_toggle_group_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Toggle groups", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;max-width:620px;display:grid;gap:10px">'
                                 '<button id="theme" style="justify-self:start">Toggle theme</button><div id="form"></div></div>')
        self.form = Form(FormConfig(
            label_position="left",
            fields=[
                FieldConfig(id="view", label="View", type="toggle_group", value="list", options=[
                    SelectOption("list", "List", icon="mdi-format-list-bulleted"),
                    SelectOption("grid", "Grid", icon="mdi-view-grid"),
                    SelectOption("map", "Map <b>", disabled=True),
                    SelectOption("table", "Table"),
                ]),
                FieldConfig(id="days", label="Days", type="toggle_group", multiple=True, required=True,
                            options=["Mon", "Tue", "Wed", "Thu", "Fri"], value=["Tue"]),
                FieldConfig(id="size", label="Size", type="toggle_group", required=True, options=["S", "M", "L"]),
                FieldConfig(id="after", label="After"),
            ],
        ), root="#form")
        self.log = []
        for name in ("change", "submit", "invalid"):
            getattr(self.form, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self._p = create_proxy(lambda _e: self.set_theme(
            "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark"))
        js.document.getElementById("theme").addEventListener("click", self._p)
        js.window.wapytValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.window.wapytSet = create_proxy(lambda v: self.form.set_values(json.loads(v)))
        js.window.wapytOptions = create_proxy(lambda i, v: self.form.set_field_options(i, json.loads(v)))
        js.window.wapytDisable = create_proxy(lambda i, v: self.form.set_field_disabled(i, v))
        js.window.wapytFocus = create_proxy(lambda i: self.form.set_focus(i))
        js.window.wapytClear = create_proxy(lambda: self.form.clear())
        js.document.body.dataset.ready = "true"

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
