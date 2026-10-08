import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, FieldConfig, Form, FormButton, FormConfig, LayoutConfig, MainWindow,
                   ModalConfig, ModalWindow)


def settings_fields():
    return [
        FieldConfig(id="q", label="Search", type="search", placeholder="Search settings", hidden_label=True),
        FieldConfig(id="host", label="Host <b>", required=True, help="Name or IP address"),
        FieldConfig(id="port", label="Port", type="number", value=22, min=1, max=65535),
        FieldConfig(id="auth", label="Authentication", type="select", options=["password", "key"]),
        FieldConfig(id="note", label="A much longer label that wraps", type="textarea", rows=2),
        FieldConfig(id="keepalive", label="Keep alive", type="checkbox", value=True),
        FieldConfig(id="compress", label="Compression", type="toggle"),
        FieldConfig(id="proto", label="Protocol", type="radio", inline=True, options=["ssh", "sftp"], value="ssh"),
        FieldConfig(id="tags", label="Tags", type="combo", multiple=True, options=["prod", "dev"]),
        FieldConfig(id="timeout", label="Timeout", type="range", min=0, max=60, value=30, ticks=10, major_ticks=30),
        FieldConfig(id="window", label="Window", type="range", range=True, min=0, max=24, value=[9, 17]),
        FieldConfig(id="top", label="Label on top here", label_position="top", placeholder="per-field override"),
        FormButton("test", "Test connection", "mdi-lan-connect"),
        FormButton("wide", "Full width", full=True, variant="primary"),
    ]


class form_buttons_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Form buttons and label position", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:12px;max-width:640px">'
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="theme">Toggle theme</button>'
            '<button id="modal">Narrow modal</button><button id="busy">set_busy</button>'
            '<button id="toggle">hide/disable buttons</button></div>'
            '<div id="form"></div><pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.form = Form(FormConfig(
            label_position="left", label_width=150, cancel_text="Cancel", submit_text="Save",
            fields=settings_fields(),
            buttons=[
                FormButton("reset", "Reset <i>", variant="link"),
                FormButton("delete", "Delete", "mdi-delete", variant="danger", tooltip="Delete this host"),
                FormButton("save_close", "Save and close", submit=True),
            ],
        ), root="#form")
        self.log = []
        for name in ("click", "submit", "invalid", "cancel"):
            getattr(self.form, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self.form.on_click(self._on_click)
        self.busy = False
        self.toggled = False
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self._open_modal()),
            create_proxy(lambda _e: self._toggle_busy()),
            create_proxy(lambda _e: self._toggle_buttons()),
        ]
        for button, proxy in zip(("theme", "modal", "busy", "toggle"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytFormLoading = create_proxy(lambda i, v: self.form.set_button_loading(i, v))
        js.window.wapytFormText = create_proxy(lambda i, t: self.form.set_button_text(i, t))
        js.window.wapytFormValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.document.body.dataset.ready = "true"

    def _on_click(self, payload):
        if payload["id"] == "test":
            self.form.set_button_loading("test", True)

    def _toggle_busy(self):
        self.busy = not self.busy
        self.form.set_busy(self.busy)

    def _toggle_buttons(self):
        self.toggled = not self.toggled
        self.form.set_field_disabled("test", self.toggled)
        (self.form.hide_field if self.toggled else self.form.show_field)("delete")
        (self.form.hide_field if self.toggled else self.form.show_field)("wide")

    def _open_modal(self):
        self.modal = ModalWindow(ModalConfig(title="Narrow", width=340, height=520))
        self.modal_form = Form(FormConfig(label_position="left", label_width=150, fields=settings_fields()[1:4]),
                               container=self.modal.body)
        self.modal.show()

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-4:], indent=1)
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
