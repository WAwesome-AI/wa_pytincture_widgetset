import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, FormFieldset, LayoutConfig, MainWindow


def email_ok(value, values):
    return None if "@" in value else "Enter an email address"


def end_after_start(value, values):
    start = values.get("start")
    if start and value <= start:
        return f"Must be after {start}"
    return None


def port_check(value, values):
    if value == 13:
        raise ValueError("unlucky")
    return None


class form_validators_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form validators", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:12px;max-width:620px">'
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="theme">Toggle theme</button>'
            '<button id="swap">set_validator(port)</button><button id="drop">set_validator(port, None)</button></div>'
            '<div id="form"></div><pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.form = Form(FormConfig(
            columns=2, submit_text="Submit",
            fields=[
                FieldConfig(id="email", label="Email", validate=email_ok, success_message="Looks good <ok>"),
                FieldConfig(id="user", label="User", validate=lambda v, vals: v != "admin"),
                FieldConfig(id="start", label="Start", type="date"),
                FieldConfig(id="end", label="End", type="date", validate=end_after_start),
                FieldConfig(id="port", label="Port", type="number", validate=port_check),
                FieldConfig(id="tags", label="Tags", type="combo", multiple=True, options=["a", "b", "c"],
                            validate=lambda v, vals: None if len(v) <= 2 else "Pick at most two"),
                FieldConfig(id="hours", label="Hours", type="range", range=True, min=0, max=24, value=[9, 11],
                            validate=lambda v, vals: None if v[1] - v[0] >= 4 else "At least 4 hours", span=2),
                FieldConfig(id="agree", label="I agree", type="toggle",
                            validate=lambda v, vals: None if v else "Please agree", span=2),
                FormFieldset("hidden_set", "Hidden", hidden=True, span=2, fields=[
                    FieldConfig(id="never", label="Never checked", validate=lambda v, vals: "should not run"),
                ]),
            ],
        ), root="#form")
        self.log = []
        for name in ("submit", "invalid"):
            getattr(self.form, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.form.set_validator("port", lambda v, vals: None if v < 1024 else "Use a port below 1024")),
            create_proxy(lambda _e: self.form.set_validator("port", None)),
        ]
        for button, proxy in zip(("theme", "swap", "drop"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytFormValidate = create_proxy(lambda: json.dumps(self.form.validate()))
        js.window.wapytFormSet = create_proxy(lambda v: self.form.set_values(json.loads(v)))
        js.document.body.dataset.ready = "true"

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-3:], indent=1)
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
