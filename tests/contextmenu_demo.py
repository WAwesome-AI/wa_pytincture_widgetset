import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, ContextMenu, ContextMenuConfig, LayoutConfig, MainWindow, MenuItem

ROWS = [("r1", "report.pdf", False), ("r2", "locked.txt", True), ("r3", "photo.png", False)]


class contextmenu_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="ContextMenu", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        rows = "".join(
            f'<li data-context="{rid}" style="padding:8px;border-bottom:1px solid #e2e8f0">{name}</li>'
            for rid, name, _locked in ROWS
        )
        self.attach_html(
            "main",
            '<div style="padding:16px">'
            f'<ul id="files" tabindex="0" style="list-style:none;margin:0;padding:0;width:320px">{rows}</ul>'
            '<p>Last: <code id="result">-</code> <button id="theme">Toggle theme</button></p>'
            '<div id="free" style="height:120px;border:1px dashed #94a3b8;margin-top:8px">'
            'right-click here: per-row menu via show_at</div></div>',
        )
        items = [
            MenuItem("open", "Open", "mdi-open-in-new", shortcut="Enter"),
            MenuItem("rename", "Rename", "mdi-pencil", shortcut="F2"),
            MenuItem("share", "Share", "mdi-share-variant", items=[
                MenuItem("copy_link", "Copy link", "mdi-link"),
                MenuItem("email", "Email <someone>", "mdi-email-outline"),
            ]),
            MenuItem("archive", "Archive", "mdi-archive", disabled=True),
            MenuItem(separator=True),
            MenuItem("delete", "Delete", "mdi-delete", danger=True, shortcut="Del"),
        ]
        self.menu = ContextMenu(ContextMenuConfig(items=items, label="File"))
        self.menu.attach("#files", context="files")
        self.menu.on_select(lambda p: self._result(p))

        self.rowmenu = ContextMenu(ContextMenuConfig(items=items, label="Row"))
        self.rowmenu.on_select(lambda p: self._result(p))

        def free_menu(event):
            event.preventDefault()
            # Per-target filtering: hide Share, grey out Delete, for this opening only.
            self.rowmenu.show_at(event.clientX, event.clientY, context={"row": "r2"},
                                 hide=["share", "rename"], disable=["delete"])

        self._proxies = [
            create_proxy(free_menu),
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
        ]
        js.document.getElementById("free").addEventListener("contextmenu", self._proxies[0])
        js.document.getElementById("theme").addEventListener("click", self._proxies[1])

    def _result(self, payload):
        js.document.getElementById("result").textContent = repr(payload)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
