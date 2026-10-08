import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormButton, FormConfig, LayoutConfig, MainWindow


class form_properties_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form set_properties", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;max-width:620px"><div id="form"></div></div>')
        self.form = Form(FormConfig(
            label_position="left",
            fields=[
                FieldConfig(id="host", label="Host", placeholder="db.example.com"),
                FieldConfig(id="port", label="Port", type="number", min=1, max=10, value=5),
                FieldConfig(id="hours", label="Hours", type="range", range=True, min=0, max=24, value=[8, 16],
                            ticks=4, major_ticks=12),
                FieldConfig(id="volume", label="Volume", type="range", min=0, max=10, value=4, ticks=1, major_ticks=5),
                FieldConfig(id="kind", label="Kind", type="select", options=["a", "b"], value="b"),
                FieldConfig(id="plan", label="Plan", type="radio", inline=True, options=["free", "pro"]),
                FieldConfig(id="created", label="Created", type="static"),
                FormButton("save", "Save draft"),
            ],
        ), root="#form")
        js.window.wapytSetProps = create_proxy(
            lambda i, props: self._call(lambda: self.form.set_properties(i, **json.loads(props))))
        js.window.wapytGetProps = create_proxy(lambda i: json.dumps(self.form.get_properties(i)))
        js.window.wapytValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.window.wapytValidate = create_proxy(lambda: json.dumps(self.form.validate()))
        js.document.body.dataset.ready = "true"

    def _call(self, fn):
        try:
            fn()
            return "ok"
        except Exception as error:  # surfaced to the test
            return f"{type(error).__name__}: {error}"


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
