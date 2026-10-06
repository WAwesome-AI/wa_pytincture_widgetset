import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, LayoutConfig, MainWindow, SidebarConfig, SidebarHeading, SidebarItem,
                   SidebarSeparator, SidebarSpacer)


def items(extra=False):
    dbs = [SidebarItem("prod", "prod", "mdi-database", badge=3),
           SidebarItem("staging", "staging <test>", "mdi-database"),
           SidebarItem("archive", "Archive", "mdi-archive", items=[
               SidebarItem("y2019", "2019"), SidebarItem("y2020", "2020")])]
    if extra:
        dbs.append(SidebarItem("dev", "dev", "mdi-database"))
    return [
        SidebarHeading("Workspace"),
        SidebarItem("home", "Home", "mdi-home"),
        SidebarItem("dbs", "Databases", "mdi-database-outline", items=dbs),
        SidebarItem("reports", "Reports", "mdi-chart-box-outline", expanded=True, items=[
            SidebarItem("daily", "Daily"), SidebarItem("weekly", "Weekly")]),
        SidebarItem("locked", "Locked", "mdi-lock", disabled=True),
        SidebarSeparator(),
        SidebarItem("plain", "Plain item"),
        SidebarSpacer(),
        SidebarItem("settings", "Settings", "mdi-cog"),
    ]


class sidebar_demo(MainWindow):
    layout_config = LayoutConfig(cols=[CellConfig(id="nav", width="auto"), CellConfig(id="main")])

    def load_ui(self):
        self.set_theme("light")
        self.sidebar = self.add_sidebar("nav", SidebarConfig(title="Monguana", items=items(), active="weekly"))
        self.attach_html("main", '<div style="padding:16px;display:flex;gap:8px">'
                         '<button id="theme">Toggle theme</button><button id="badge">Badge prod 12</button>'
                         '<button id="clear">Clear badge</button><button id="reload">set_items (+dev)</button></div>')
        self.log = []
        self.sidebar.on_select(lambda p: self._record("select", p["id"]))
        self.sidebar.on_toggle(lambda p: self._record("toggle", [p["id"], p["expanded"], p["expanded_ids"]]))
        self.sidebar.on_collapse(lambda *_: self._record("collapse", True))
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.sidebar.set_badge("prod", 12)),
            create_proxy(lambda _e: self.sidebar.set_badge("prod", None)),
            create_proxy(lambda _e: self.sidebar.set_items(items(extra=True))),
        ]
        for button, proxy in zip(("theme", "badge", "clear", "reload"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.sideState = create_proxy(lambda: json.dumps(
            {"active": self.sidebar.get_active(), "expanded": sorted(self.sidebar.get_expanded())}))
        js.document.body.dataset.ready = "true"

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.sideLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
