import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormButton, FormConfig, FormFieldset, LayoutConfig, MainWindow


class form_focus_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form focus events", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:12px;max-width:620px">'
            '<input id="outside" placeholder="outside the form">'
            '<div id="form"></div><pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.form = Form(FormConfig(
            fields=[
                FieldConfig(id="email", label="Email", required=True,
                            validate=lambda v, vals: None if "@" in v else "Enter an email address",
                            success_message="Looks good"),
                FieldConfig(id="name", label="Name", required=True),
                FieldConfig(id="plan", label="Plan", type="radio", inline=True, options=["free", "pro", "team"],
                            value="pro"),
                FieldConfig(id="hours", label="Hours", type="range", range=True, min=0, max=24, value=[9, 17]),
                FieldConfig(id="tags", label="Tags", type="combo", multiple=True, options=["a", "b"], value=["a", "b"]),
                FieldConfig(id="ok", label="OK", type="checkbox"),
                FieldConfig(id="created", label="Created", type="static", value="today"),
                FieldConfig(id="locked", label="Locked", disabled=True),
                FormFieldset("hid", "Hidden", hidden=True, fields=[FieldConfig(id="secret", label="Secret")]),
                FormButton("check", "Check"),
            ],
        ), root="#form")
        self.events = []
        self.form.on_focus(lambda p: self._record("focus", p))
        self.form.on_blur(self._on_blur)
        js.window.wapytFocus = create_proxy(lambda i: self.form.set_focus(i))
        js.window.wapytFocused = create_proxy(lambda: self.form.get_focused())
        js.window.wapytValidateField = create_proxy(lambda i: self.form.validate_field(i))
        js.window.wapytResetLog = create_proxy(lambda: self.events.clear())
        js.document.body.dataset.ready = "true"

    def _on_blur(self, payload):
        self._record("blur", payload)
        if payload["id"] in ("email", "name"):
            self.form.validate_field(payload["id"])

    def _record(self, kind, payload):
        self.events.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.events[-6:])
        js.window.wapytFormLog = json.dumps(self.events)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
