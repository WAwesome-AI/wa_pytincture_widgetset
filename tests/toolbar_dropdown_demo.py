import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, LayoutConfig, MainWindow, MenuItem, ToolbarButton, ToolbarConfig,
                   ToolbarSeparator, ToolbarSpacer, ToolbarText)


class toolbar_dropdown_demo(MainWindow):
    layout_config = LayoutConfig(rows=[
        CellConfig(id="bar", height="auto"),
        CellConfig(id="main", header="Toolbar dropdowns", grow=1),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.toolbar = self.add_toolbar("bar", ToolbarConfig(label="Main", items=[
            ToolbarButton("new", "New", "mdi-plus", variant="primary"),
            ToolbarButton("run", "Run", "mdi-play", split=True, items=[
                MenuItem("run_debug", "Run with debugger", "mdi-bug", shortcut="F5"),
                MenuItem("run_profile", "Profile", "mdi-speedometer"),
                MenuItem(separator=True),
                MenuItem("run_config", "Configurations…"),
            ]),
            ToolbarSeparator(),
            ToolbarButton("export", "Export <b>", "mdi-export", items=[
                MenuItem("csv", "CSV <i>"),
                MenuItem("json", "JSON"),
                MenuItem("more", "More formats", items=[MenuItem("xml", "XML"), MenuItem("yaml", "YAML")]),
            ]),
            ToolbarButton("view", "View", "mdi-eye", items=[
                MenuItem("wrap", "Word wrap", checkable=True, checked=True),
                MenuItem(separator=True),
                MenuItem("dense", "Dense", group="density"),
                MenuItem("comfy", "Comfortable", group="density", checked=True),
            ]),
            ToolbarButton("recent", "Recent", "mdi-history", items=[]),
            ToolbarSpacer(),
            ToolbarText("user", "ada"),
            ToolbarButton("account", icon="mdi-account-circle", tooltip="Account", show_label=False, items=[
                MenuItem("profile", "Profile"),
                MenuItem("logout", "Log out", danger=True),
            ]),
        ]))
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:8px;max-width:640px">'
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="theme">Toggle theme</button>'
            '<button id="recentfill">set_menu_items(recent)</button><button id="dis">disable csv</button>'
            '<button id="hide">hide run</button><button id="narrow">narrow</button></div>'
            '<pre id="out" style="font-size:11px;white-space:pre-wrap"></pre></div>',
        )
        self.log = []
        for name in ("click", "select", "open"):
            getattr(self.toolbar, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self.toggles = {"dis": False, "hide": False}
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.toolbar.set_menu_items("recent", [
                MenuItem("r1", "report.csv"), MenuItem("r2", "notes <script>.md")])),
            create_proxy(lambda _e: self._toggle("dis", lambda v: self.toolbar.set_disabled("csv", v))),
            create_proxy(lambda _e: self._toggle("hide", lambda v: self.toolbar.set_hidden("run", v))),
            create_proxy(lambda _e: setattr(js.document.querySelector(".wapyt-layout").style, "width", "420px")),
        ]
        for button, proxy in zip(("theme", "recentfill", "dis", "hide", "narrow"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.wapytToolbarState = create_proxy(lambda: json.dumps({
            "wrap": self.toolbar.is_checked("wrap"), "dense": self.toolbar.is_checked("dense"),
            "csv_disabled": self.toolbar.is_disabled("csv"), "run_hidden": self.toolbar.is_hidden("run"),
            "open": self.toolbar.is_menu_open(), "open_view": self.toolbar.is_menu_open("view"),
        }))
        js.window.wapytToolbarOpen = create_proxy(lambda i: self.toolbar.open_menu(i))
        js.window.wapytToolbarCheck = create_proxy(lambda i, v: self.toolbar.set_checked(i, v))
        js.document.body.dataset.ready = "true"

    def _toggle(self, key, apply):
        self.toggles[key] = not self.toggles[key]
        apply(self.toggles[key])

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.document.getElementById("out").textContent = json.dumps(self.log[-6:], indent=1)
        js.window.wapytToolbarLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
