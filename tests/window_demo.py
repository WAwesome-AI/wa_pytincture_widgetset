import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, FieldConfig, Form, FormConfig, LayoutConfig, MainWindow, Window, WindowConfig)


class window_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Windows", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;display:flex;gap:8px;flex-wrap:wrap">'
                                 '<button id="openA">Open A</button><button id="openB">Open B</button>'
                                 '<button id="openM">Open modal</button><button id="theme">Toggle theme</button>'
                                 '<input id="page_input" placeholder="page input"></div>')
        self.a = Window(WindowConfig(title="Query <b>", width=420, height=300, left=40, top=120, footer=True,
                                     min_width=260, min_height=180, max_width=700))
        self.form = Form(FormConfig(submit_text=None, fields=[FieldConfig(id="q", label="Query"),
                                                             FieldConfig(id="n", label="Limit", type="number")]),
                         container=self.a.body)
        self.a.footer.innerHTML = '<button id="a_ok">OK</button>'
        self.b = Window(WindowConfig(title="Preview", width=360, height=240, left=300, top=200))
        self.b.body.innerHTML = '<iframe id="b_frame" srcdoc="<p>frame</p>" style="width:100%;height:120px;border:0"></iframe>'
        self.m = Window(WindowConfig(title="Confirm", width=320, height=180, modal=True, maximizable=False,
                                     dispose_on_close=True))
        self.m.set_content("<b>not html</b>")
        self.log = []
        for name, win in (("a", self.a), ("b", self.b), ("m", self.m)):
            for ev in ("show", "hide", "close", "move", "resize", "focus"):
                getattr(win, f"on_{ev}")(lambda p, n=name, e=ev: self._record(n, e, p))
        self._p = [
            create_proxy(lambda _e: self.a.show()), create_proxy(lambda _e: self.b.show()),
            create_proxy(lambda _e: self.m.show()),
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
        ]
        for bid, proxy in zip(("openA", "openB", "openM", "theme"), self._p):
            js.document.getElementById(bid).addEventListener("click", proxy)
        wins = {"a": self.a, "b": self.b, "m": self.m}
        api = {
            "pos": lambda w: wins[w].get_position(), "size": lambda w: wins[w].get_size(),
            "set_pos": lambda w, l, t: wins[w].set_position(l, t), "set_size": lambda w, x, y: wins[w].set_size(x, y),
            "center": lambda w: wins[w].center(), "max": lambda w: wins[w].maximize(), "restore": lambda w: wins[w].restore(),
            "is_max": lambda w: wins[w].is_maximized(), "visible": lambda w: wins[w].is_visible(),
            "hide": lambda w: wins[w].hide(), "close": lambda w: wins[w].close(), "front": lambda w: wins[w].bring_to_front(),
            "footer_none": lambda: self.b.footer is None,
        }
        js.window.wapytWin = create_proxy(lambda name, *args: json.dumps(api[name](*args)))
        js.document.body.dataset.ready = "true"

    def _record(self, win, event, payload):
        self.log.append([win, event, payload])
        js.window.wapytWinLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
