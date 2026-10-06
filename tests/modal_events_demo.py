import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, ModalConfig, ModalWindow


class modal_events_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="ModalWindow events", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;display:flex;gap:8px">'
                         '<button id="openA">Open A (reused)</button><button id="openB">Open B over A (disposable)</button>'
                         '<button id="codeHide">A.hide() from code</button></div>')
        self.log = []
        self.a = ModalWindow(ModalConfig(title="A: reused", width=420, height=220))
        self.a.body.innerHTML = '<p style="padding:12px">Modal A <button id="inA">Open B</button></p>'
        for name in ("show", "hide", "close"):
            getattr(self.a, f"on_{name}")(lambda e, name=name: self._record("A", name, e))
        self._proxies = [
            create_proxy(lambda _e: self.a.show()),
            create_proxy(lambda _e: self._open_b()),
            create_proxy(lambda _e: self.a.hide()),
            create_proxy(lambda _e: self._open_b()),
        ]
        for button, proxy in zip(("openA", "openB", "codeHide"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.document.getElementById("inA").addEventListener("click", self._proxies[3])
        js.window.modalState = create_proxy(lambda: json.dumps({"a": self.a.is_visible()}))
        js.document.body.dataset.ready = "true"

    def _open_b(self):
        self.b = ModalWindow(ModalConfig(title="B: disposable", width=320, height=160, dispose_on_close=True))
        for name in ("show", "hide", "close"):
            getattr(self.b, f"on_{name}")(lambda e, name=name: self._record("B", name, e))
        self.b.show()

    def _record(self, who, name, payload):
        self.log.append([who, name, (payload or {}).get("reason")])
        js.window.modalLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
