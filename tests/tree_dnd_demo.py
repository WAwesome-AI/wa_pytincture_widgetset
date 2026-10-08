import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, Tree, TreeAction, TreeConfig, TreeItem


def servers():
    return [
        TreeItem("prod", "Production <b>", items=[
            TreeItem("web1", "web-01"), TreeItem("web2", "web-02", checked=True),
            TreeItem("dbs", "Databases", items=[TreeItem("db1", "db-01"), TreeItem("db2", "db-02")]),
        ]),
        TreeItem("staging", "Staging", items=[TreeItem("stg1", "stg-01")]),
        TreeItem("inbox", "Inbox (no drops)", droppable=False, items=[TreeItem("new1", "new-01")]),
        TreeItem("pinned", "Pinned", draggable=False, checkbox=False),
        TreeItem("spare", "spare-01"),
    ]


class tree_dnd_demo(MainWindow):
    layout_config = LayoutConfig(cols=[
        CellConfig(id="a", header="Cascade + drag", width="340px"),
        CellConfig(id="b", header="Independent checks", width="300px"),
        CellConfig(id="log", header="Log", grow=1),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("a", '<div id="ta" style="height:100%"></div>')
        self.attach_html("b", '<div id="tb" style="height:100%"></div>')
        self.attach_html("log", '<div style="padding:8px"><button id="theme">Toggle theme</button>'
                                '<pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>')
        self.ta = Tree(TreeConfig(items=servers(), checkboxes=True, draggable=True, filterable=True, label="Servers",
                                  expand_all=True, context_actions=[TreeAction("edit", "Edit", "mdi-pencil")]), root="#ta")
        self.tb = Tree(TreeConfig(items=[TreeItem("x", "X", items=[TreeItem("x1", "x-1"), TreeItem("x2", "x-2")])],
                                  checkboxes=True, check_cascade=False, expand_all=True), root="#tb")
        self.log = []
        for name in ("select", "activate", "toggle", "check", "move", "action"):
            getattr(self.ta, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self.tb.on_check(lambda p: self._record("check_b", p))
        self.refuse = False
        self.ta.on_move(self._maybe_refuse)
        self._p = create_proxy(lambda _e: self.set_theme(
            "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark"))
        js.document.getElementById("theme").addEventListener("click", self._p)
        api = {
            "checked": lambda leaves=False: self.ta.get_checked(bool(leaves)),
            "checked_b": lambda: self.tb.get_checked(),
            "is_checked": lambda i: self.ta.is_checked(i),
            "check": lambda i, v: self.ta.check(i, bool(v)),
            "set_checked": lambda ids: self.ta.set_checked(json.loads(ids)),
            "items": lambda: self.ta.get_items(),
            "parent": lambda i: self.ta.get_parent_id(i),
            "move": lambda i, p, x: self.ta.move(i, p or None, int(x)),
            "refuse": lambda v: setattr(self, "refuse", bool(v)),
            "focus": lambda i: self.ta.focus(i),
            "set_items": lambda: self.ta.set_items(servers()),
        }
        self._api = create_proxy(lambda name, *args: json.dumps(api[name](*args)))
        js.window.wapytTree = self._api
        js.document.body.dataset.ready = "true"

    def _maybe_refuse(self, p):
        if self.refuse:
            self.ta.move(p["id"], p["from_parent"], p["from_index"])
            self._record("reverted", p["id"])

    def _record(self, kind, payload):
        if isinstance(payload, dict):
            payload = {k: v for k, v in payload.items() if k != "node"}
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-8:], indent=1)
        js.window.wapytTreeLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
