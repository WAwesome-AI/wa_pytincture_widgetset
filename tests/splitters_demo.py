import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow

APP_ENTRYPOINT = "splitters_demo"


class splitters_demo(MainWindow):
    layout_config = LayoutConfig(gap=6, cols=[
        CellConfig(id="side", header="Sidebar", width=240, resizable=True, min_size=160, max_size=400),
        CellConfig(id="main", header="Main", rows=[
            CellConfig(id="editor", header="Editor"),
            CellConfig(id="console", header="Console", height=160, resizable=True),
        ]),
        CellConfig(id="left", header="Left half"),
        CellConfig(id="right", header="Right half", resizable=True),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("side", '<div style="padding:8px;display:grid;gap:6px">'
                         '<button id="theme">Toggle theme</button><button id="hide">Hide console</button>'
                         '<button id="restore">set_size(side, 300)</button></div>')
        self.attach_html("editor", '<iframe id="frame" srcdoc="<p>iframe</p>" style="width:100%;height:100%;border:0"></iframe>')
        self.attach_html("console", '<pre id="out" style="margin:0;padding:8px;font-size:11px"></pre>')
        self.log = []
        self.on_resize(self._record)
        self.console_hidden = False
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self._toggle_console()),
            create_proxy(lambda _e: self.set_size("side", 300)),
        ]
        for button, proxy in zip(("theme", "hide", "restore"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.cellSize = create_proxy(lambda cid: self.get_size(cid))
        js.document.body.dataset.ready = "true"

    def _toggle_console(self):
        self.console_hidden = not self.console_hidden
        (self.hide if self.console_hidden else self.show)("console")

    def _record(self, payload):
        self.log.append(payload)
        js.window.resizeLog = json.dumps(self.log)
        js.document.getElementById("out").textContent = json.dumps(payload)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
