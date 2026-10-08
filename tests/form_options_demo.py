import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow, SelectOption

PLANS = ["free", SelectOption("legacy", "Legacy (retired)", disabled=True), "pro"]


class form_options_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="max_length, icons, disabled options", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;max-width:640px;display:grid;gap:10px">'
                                 '<button id="theme" style="justify-self:start">Toggle theme</button><div id="form"></div></div>')
        self.form = Form(FormConfig(
            label_position="left",
            fields=[
                FieldConfig(id="q", label="Search", type="search", icon="mdi-magnify", placeholder="Search"),
                FieldConfig(id="code", label="Code", max_length=6, icon="mdi-pound"),
                FieldConfig(id="bio", label="Bio", type="textarea", max_length=20, max_length_message="Keep it short"),
                FieldConfig(id="when", label="When", type="date", icon="mdi-calendar"),
                FieldConfig(id="plan_s", label="Plan (select)", type="select", options=PLANS, icon="mdi-tag"),
                FieldConfig(id="plan_r", label="Plan (radio)", type="radio", inline=True, options=PLANS),
                FieldConfig(id="plan_g", label="Plans (group)", type="checkbox_group", inline=True, options=PLANS),
                FieldConfig(id="plan_c", label="Plan (combo)", type="combo", options=PLANS, icon="mdi-tag"),
                FieldConfig(id="plain", label="Plain"),
            ],
        ), root="#form")
        self._p = create_proxy(lambda _e: self.set_theme(
            "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark"))
        js.document.getElementById("theme").addEventListener("click", self._p)
        js.window.wapytSetProps = create_proxy(lambda i, props: self.form.set_properties(i, **json.loads(props)))
        js.window.wapytSet = create_proxy(lambda v: self.form.set_values(json.loads(v)))
        js.window.wapytValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.window.wapytValidate = create_proxy(lambda: json.dumps(self.form.validate()))
        js.document.body.dataset.ready = "true"


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
