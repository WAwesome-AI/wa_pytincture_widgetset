import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, FieldConfig, Form, FormButton, FormConfig, FormFieldset, FormSpacer, LayoutConfig,
                   MainWindow)


class form_fieldsets_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Fieldsets, spacers and static fields", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:12px;max-width:760px">'
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="theme">Toggle theme</button>'
            '<button id="fill">set_values</button><button id="clear">clear()</button><button id="reset">reset()</button>'
            '<button id="hidegap">toggle spacer</button></div>'
            '<div id="form"></div><pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.form = Form(FormConfig(
            columns=2, label_position="left", label_width=110, cancel_text="Cancel",
            fields=[
                FieldConfig(id="created", label="Created", type="static", value="2026-10-08 09:30"),
                FieldConfig(id="uid", label="ID <b>", type="static", value=4711),
                FieldConfig(id="last_seen", label="Last seen", type="static", placeholder="never"),
                FormSpacer("gap"),
                FormFieldset("conn", "Connection <i>", span=2, columns=2, fields=[
                    FieldConfig(id="host", label="Host", required=True),
                    FieldConfig(id="port", label="Port", type="number", value=22, min=1, max=65535),
                    FieldConfig(id="auth", label="Auth", type="radio", inline=True, options=["password", "key"],
                                value="password"),
                    FormSpacer(),
                    FieldConfig(id="password", label="Password", type="password", required=True),
                ]),
                FormFieldset("keyset", "SSH key", span=2, hidden=True, fields=[
                    FieldConfig(id="key_path", label="Key file", required=True),
                    FieldConfig(id="passphrase", label="Passphrase", type="password"),
                ]),
                FieldConfig(id="use_proxy", label="Use a proxy", type="toggle", span=2),
                FormFieldset("proxy", "Proxy", span=2, disabled=True, label_position="top", fields=[
                    FieldConfig(id="proxy_host", label="Proxy host", required=True),
                    FieldConfig(id="proxy_hours", label="Active hours", type="range", range=True, min=0, max=24,
                                value=[8, 18]),
                    FieldConfig(id="proxy_tags", label="Tags", type="combo", multiple=True, options=["eu", "us"]),
                    FormFieldset("proxy_auth", "Proxy login", columns=2, fields=[
                        FieldConfig(id="proxy_user", label="User", required=True),
                        FieldConfig(id="proxy_pass", label="Password", type="password"),
                    ]),
                    FormButton("proxy_test", "Test proxy", "mdi-lan-connect"),
                ]),
                FormSpacer(span=2, height=8),
            ],
        ), root="#form")
        self.log = []
        for name in ("submit", "invalid", "click"):
            getattr(self.form, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self.form.on_change(self._on_change)
        self.gap_hidden = False
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.form.set_values({"last_seen": "today <script>", "uid": 99})),
            create_proxy(lambda _e: self.form.clear()),
            create_proxy(lambda _e: self.form.reset()),
            create_proxy(lambda _e: self._toggle_gap()),
        ]
        for button, proxy in zip(("theme", "fill", "clear", "reset", "hidegap"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytFormValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.window.wapytFormValidate = create_proxy(lambda: json.dumps(self.form.validate()))
        js.window.wapytFormDisable = create_proxy(lambda i, v: self.form.set_field_disabled(i, v))
        js.document.body.dataset.ready = "true"

    def _on_change(self, payload):
        self._record("change", payload)
        if payload["id"] == "use_proxy":
            self.form.set_field_disabled("proxy", not payload["value"])
        elif payload["id"] == "auth":
            key = payload["value"] == "key"
            (self.form.show_field if key else self.form.hide_field)("keyset")
            (self.form.hide_field if key else self.form.show_field)("password")

    def _toggle_gap(self):
        self.gap_hidden = not self.gap_hidden
        (self.form.hide_field if self.gap_hidden else self.form.show_field)("gap")

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-4:], indent=1)
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
