import sys

import js

from wapyt import (
    CellConfig,
    LayoutConfig,
    MainWindow,
    ToolbarButton,
    ToolbarConfig,
    ToolbarSeparator,
    ToolbarSpacer,
    ToolbarText,
)


class toolbar_demo(MainWindow):
    # The same toolbar IguanaXterm builds by hand, as a Toolbar.
    layout_config = LayoutConfig(
        rows=[
            CellConfig(id="mainwindow_header", height="auto"),
            CellConfig(id="narrow", height="auto", width="320px"),
            CellConfig(id="main", grow=1),
        ]
    )

    def load_ui(self):
        self.set_theme("light")
        items = [
            ToolbarButton("new", "New", "mdi-plus"),
            ToolbarButton("edit", "Edit", "mdi-pencil"),
            ToolbarButton("delete", "Delete", "mdi-delete", variant="danger"),
            ToolbarSeparator(),
            ToolbarButton("refresh", "Refresh", "mdi-refresh", badge=2),
            ToolbarButton("pin", "Pin", "mdi-pin", toggle=True),
            ToolbarSpacer(),
            ToolbarButton("reconnect_all", "Reconnect all", "mdi-connection",
                          variant="primary", hidden=True),
            ToolbarButton("tabbed", "Tabs", "mdi-table-row", group="layout",
                          active=True, show_label=False),
            ToolbarButton("tiled", "Tiles", "mdi-view-grid", group="layout", show_label=False),
            ToolbarButton("update", "Update 2.4.0", "mdi-arrow-up-circle", variant="accent"),
            ToolbarText("user", "ada"),
            ToolbarButton("logout", "Logout", "mdi-logout"),
        ]
        self.toolbar = self.add_toolbar("mainwindow_header", ToolbarConfig(items=items, label="Main"))
        self.narrow = self.add_toolbar("narrow", ToolbarConfig(items=list(items), label="Narrow"))
        self.attach_html(
            "main",
            '<div style="padding:16px">Last click: <code id="result">-</code> '
            '<button id="theme">Toggle theme</button> '
            '<button id="show">Show reconnect</button></div>',
        )
        from pyodide.ffi import create_proxy

        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: (self.toolbar.set_hidden("reconnect_all", False),
                                     self.toolbar.set_text("reconnect_all", "Reconnect 3"),
                                     self.toolbar.set_badge("refresh", None),
                                     self.toolbar.set_text("user", "ada <admin>"))),
        ]
        js.document.getElementById("theme").addEventListener("click", self._proxies[0])
        js.document.getElementById("show").addEventListener("click", self._proxies[1])

        def clicked(payload):
            js.document.getElementById("result").textContent = repr(payload)

        self.toolbar.on_click(clicked)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
