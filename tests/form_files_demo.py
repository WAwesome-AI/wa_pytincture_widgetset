import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow

# A 1x1 PNG as a data URL stands in for an existing avatar (the CSP allows
# data: and same-origin images).
EXISTING = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9"
            "awAAAABJRU5ErkJggg==")


class form_files_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="File and avatar fields", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;max-width:620px;display:grid;gap:10px">'
                                 '<button id="theme" style="justify-self:start">Toggle theme</button><div id="form"></div></div>')
        self.form = Form(FormConfig(
            label_position="left",
            fields=[
                FieldConfig(id="docs", label="Attachments", type="file", multiple=True, accept=".csv,.txt",
                            max_size=1024, max_files=3, required=True),
                FieldConfig(id="one", label="Single file", type="file"),
                FieldConfig(id="pic", label="Avatar", type="avatar", value=EXISTING, max_size=200_000),
                FieldConfig(id="new_pic", label="New avatar", type="avatar"),
            ],
        ), root="#form")
        self.log = []
        for name in ("change", "submit", "invalid"):
            getattr(self.form, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self._p = create_proxy(lambda _e: self.set_theme(
            "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark"))
        js.document.getElementById("theme").addEventListener("click", self._p)
        js.window.wapytValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.window.wapytFiles = create_proxy(lambda i: json.dumps([str(f.name) for f in self.form.get_files(i)]))
        js.window.wapytAdopt = create_proxy(lambda i: json.dumps(self.form.adopt_files(i)))
        js.window.wapytSet = create_proxy(lambda v: self.form.set_values(json.loads(v)))
        js.window.wapytClear = create_proxy(lambda: self.form.clear())
        js.window.wapytReset = create_proxy(lambda: self.form.reset())
        js.window.wapytDisable = create_proxy(lambda i, v: self.form.set_field_disabled(i, v))
        js.document.body.dataset.ready = "true"

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
