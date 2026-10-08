import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormButton, FormConfig, FormFieldset, LayoutConfig, MainWindow


class form_disable_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Whole-form disable and hide", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;max-width:640px;display:grid;gap:10px">'
                                 '<div><button id="toggle">disable / enable</button> <button id="vis">hide / show</button></div>'
                                 '<div id="form"></div><pre id="out"></pre></div>')
        self.form = Form(FormConfig(
            columns=2, cancel_text="Cancel", disabled=True,
            fields=[
                FieldConfig(id="host", label="Host", required=True, value="db1"),
                FieldConfig(id="tags", label="Tags", type="combo", multiple=True, options=["a", "b"]),
                FieldConfig(id="hours", label="Hours", type="range", range=True, min=0, max=24, value=[8, 16]),
                FieldConfig(id="plan", label="Plan", type="radio", inline=True, options=["free", "pro"], value="free"),
                FieldConfig(id="locked", label="Locked", disabled=True, value="x"),
                FormFieldset("extra", "Extra", disabled=True, span=2, fields=[FieldConfig(id="note", label="Note")]),
                FormButton("check", "Check"),
            ],
        ), root="#form")
        self.log = []
        self.form.on_submit(lambda v: self._record("submit", v))
        self.form.on_click(lambda v: self._record("click", v))
        self._proxies = [
            create_proxy(lambda _e: self.form.enable() if self.form.is_disabled() else self.form.disable()),
            create_proxy(lambda _e: self.form.show() if not self.form.is_visible() else self.form.hide()),
        ]
        js.document.getElementById("toggle").addEventListener("click", self._proxies[0])
        js.document.getElementById("vis").addEventListener("click", self._proxies[1])
        js.window.wapytState = create_proxy(lambda: json.dumps({
            "disabled": self.form.is_disabled(), "visible": self.form.is_visible(), "values": self.form.get_values()}))
        js.window.wapytSubmit = create_proxy(lambda: self.form.submit())
        js.document.body.dataset.ready = "true"

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
