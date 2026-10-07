import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow


class form_clear_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form.clear / reset", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:12px;display:grid;gap:10px;max-width:560px">'
                         '<div style="display:flex;gap:8px"><button id="clear">clear()</button>'
                         '<button id="errors">clear(values=False)</button><button id="reset">reset()</button></div>'
                         '<div id="form"></div></div>')
        self.form = Form(FormConfig(columns=2, fields=[
            FieldConfig(id="name", label="Name", value="Ada", required=True),
            FieldConfig(id="age", label="Age", type="number", value=36),
            FieldConfig(id="note", label="Note", type="textarea"),
            FieldConfig(id="kind", label="Kind", type="select", options=["a", "b", "c"], value="b"),
            FieldConfig(id="plain", label="Plain select", type="select", options=["x", "y"]),
            FieldConfig(id="ok", label="OK", type="checkbox", value=True),
            FieldConfig(id="on", label="On", type="toggle", value=True),
            FieldConfig(id="plan", label="Plan", type="radio", options=["free", "pro"], value="pro"),
            FieldConfig(id="tags", label="Tags", type="checkbox_group", options=["t1", "t2"], value=["t2"]),
            FieldConfig(id="day", label="Day", type="date", value="2026-10-06"),
            FieldConfig(id="colour", label="Colour", type="color", value="#10b981"),
            FieldConfig(id="vol", label="Volume", type="range", min=0, max=10, value=7),
            FieldConfig(id="mid", label="Unset range", type="range", min=0, max=20),
            FieldConfig(id="pick", label="Pick", type="combo", options=["p1", "p2"], value="p2"),
            FieldConfig(id="many", label="Many", type="combo", multiple=True, options=["m1", "m2"], value=["m1"]),
            FieldConfig(id="token", type="hidden", value="abc"),
        ]), root="#form")
        self.changes = []
        self.form.on_change(lambda v: self.changes.append(v["id"]))
        self._proxies = [create_proxy(lambda _e: self.form.clear()),
                         create_proxy(lambda _e: self.form.clear(values=False)),
                         create_proxy(lambda _e: self.form.reset())]
        for button, proxy in zip(("clear", "errors", "reset"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.formValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.window.formChanges = create_proxy(lambda: json.dumps(self.changes))
        js.window.formValidate = create_proxy(lambda: json.dumps(self.form.validate()))
        js.document.body.dataset.ready = "true"


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
