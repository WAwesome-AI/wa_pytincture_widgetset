import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, MenuBarConfig, MenuItem


def menus():
    return [
        MenuItem("file", "File", items=[
            MenuItem("new", "New", "mdi-file-outline", shortcut="Ctrl+N"),
            MenuItem("open", "Open…", "mdi-folder-open-outline", shortcut="Ctrl+O"),
            MenuItem("recent", "Open recent", items=[MenuItem("r1", "notes <1>.md"), MenuItem("r2", "todo.md")]),
            MenuItem(separator=True),
            MenuItem("save", "Save", "mdi-content-save-outline", disabled=True),
            MenuItem("quit", "Quit", danger=True),
        ]),
        MenuItem("edit", "Edit", items=[MenuItem("undo", "Undo"), MenuItem("redo", "Redo")]),
        MenuItem("view", "View", items=[
            MenuItem("wrap", "Word wrap", checkable=True, checked=True),
            MenuItem(separator=True),
            MenuItem("light", "Light", group="theme", checked=True),
            MenuItem("dark", "Dark", group="theme"),
        ]),
        MenuItem("help", "Help", "mdi-help-circle-outline"),
    ]


class menubar_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="mainwindow_header", height="auto"),
                                       CellConfig(id="main", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.bar = self.add_menubar("mainwindow_header", MenuBarConfig(items=menus(), label="Main menu"))
        self.attach_html("main", '<div style="padding:16px;display:flex;gap:8px">'
                         '<button id="enable">enable Save</button><button id="hideedit">hide Edit</button>'
                         '<button id="showedit">show Edit</button><button id="checkdark">set_checked(dark)</button></div>')
        self.log = []
        self.bar.on_select(lambda p: self._record(p))
        self._proxies = [create_proxy(lambda _e: self.bar.set_disabled("save", False)),
                         create_proxy(lambda _e: self.bar.set_hidden("edit")),
                         create_proxy(lambda _e: self.bar.set_hidden("edit", False)),
                         create_proxy(lambda _e: self.bar.set_checked("dark"))]
        for button, proxy in zip(("enable", "hideedit", "showedit", "checkdark"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.barState = create_proxy(lambda: json.dumps({
            "wrap": self.bar.is_checked("wrap"), "light": self.bar.is_checked("light"), "dark": self.bar.is_checked("dark"),
            "save_disabled": self.bar.is_disabled("save"), "edit_hidden": self.bar.is_hidden("edit")}))
        js.document.body.dataset.ready = "true"

    def _record(self, payload):
        self.log.append({k: payload.get(k) for k in ("id", "menu", "checked")})
        js.window.barLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
