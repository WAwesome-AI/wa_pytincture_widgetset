import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, ColumnConfig, DataTable, DataTableConfig, LayoutConfig, MainWindow

COLS = [ColumnConfig(id="name", header="Name", width=140, editable=True),
        ColumnConfig(id="kind", header="Kind", width=110)] + [
    ColumnConfig(id=f"m{i}", header=f"Metric {i}", width=130, align="right") for i in range(1, 11)]
ROWS = [{"id": str(r), "name": f"Item {r}", "kind": "even" if r % 2 == 0 else "odd",
         **{f"m{i}": r * i for i in range(1, 11)}} for r in range(1, 31)]


class datatable_frozen_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Frozen columns", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:12px;display:grid;gap:10px">'
                         '<div style="display:flex;gap:8px"><button id="theme">Toggle theme</button>'
                         '<button id="f0">Freeze 0</button><button id="f3">Freeze 3</button></div>'
                         '<div id="table" style="height:300px;width:720px"></div></div>')
        self.table = DataTable(DataTableConfig(columns=COLS, rows=ROWS, selection="multi", frozen_columns=2,
                                               resizable_columns=True), root="#table")
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.table.set_frozen_columns(0)),
            create_proxy(lambda _e: self.table.set_frozen_columns(3)),
        ]
        for button, proxy in zip(("theme", "f0", "f3"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.document.body.dataset.ready = "true"


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
