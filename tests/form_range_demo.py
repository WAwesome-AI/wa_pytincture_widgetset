import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow


class form_range_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Range sliders and ticks", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;max-width:560px;display:grid;gap:12px">'
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="theme">Toggle theme</button>'
            '<button id="fill">set_values</button><button id="clear">clear()</button>'
            '<button id="reset">reset()</button><button id="disable">Disable price</button></div>'
            '<div id="form"></div><pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.form = Form(FormConfig(
            submit_text="Search",
            fields=[
                FieldConfig(id="price", label="Price <b>", type="range", range=True, min=0, max=500,
                            step=10, value=(50, 200), ticks=50, major_ticks=100),
                FieldConfig(id="years", label="Years", type="range", range=True, min=1990, max=2030,
                            help="Unset: spans the whole range"),
                FieldConfig(id="ratio", label="Ratio", type="range", range=True, min=0, max=1, step=0.1,
                            value=[0.2, 0.3], ticks=0.1, major_ticks=0.5),
                FieldConfig(id="volume", label="Volume", type="range", min=0, max=10, step=1, value=4,
                            ticks=1, major_ticks=5),
                FieldConfig(id="quiet", label="Quiet scale", type="range", min=0, max=100, ticks=10,
                            major_ticks=50, tick_labels=False),
            ],
        ), root="#form")
        self.log = []
        self.form.on_submit(lambda v: self._record("submit", v))
        self.form.on_change(lambda v: self._record("change", v))
        self.disabled = False
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.form.set_values({"price": (300, 120), "years": [None, 2000],
                                                          "ratio": [0.44, 0.71], "volume": 9})),
            create_proxy(lambda _e: self.form.clear()),
            create_proxy(lambda _e: self.form.reset()),
            create_proxy(lambda _e: self._toggle_disabled()),
        ]
        for button, proxy in zip(("theme", "fill", "clear", "reset", "disable"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytFormValues = create_proxy(lambda: json.dumps(self.form.get_values()))
        js.document.body.dataset.ready = "true"

    def _toggle_disabled(self):
        self.disabled = not self.disabled
        self.form.set_field_disabled("price", self.disabled)

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-6:], indent=1)
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
