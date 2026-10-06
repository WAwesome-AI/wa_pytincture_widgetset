import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, ColumnConfig, DataTable, DataTableConfig, LayoutConfig, MainWindow

ROWS = [
    {"id": "1", "icon": "mdi-file", "name": "Zoë, \"the\" first", "qty": -5, "status": "done", "ok": True, "note": "line one\nline two"},
    {"id": "2", "icon": "mdi-file", "name": "=HYPERLINK(\"http://x\",\"click\")", "qty": 3.5, "status": "open", "ok": False, "note": " padded "},
    {"id": "3", "icon": "mdi-file", "name": "@SUM(A1)", "qty": None, "status": "open", "ok": None, "note": "-2+3"},
    {"id": "4", "icon": "mdi-folder", "name": "Plain", "qty": 10, "status": "done", "ok": True, "note": "+cmd"},
]


class datatable_csv_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="CSV export", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:12px;display:grid;gap:10px">'
                         '<div style="display:flex;gap:8px"><button id="all">Export CSV</button>'
                         '<button id="sel">Export selected</button></div>'
                         '<div id="table" style="height:220px"></div></div>')
        self.table = DataTable(DataTableConfig(columns=[
            ColumnConfig(id="icon", header="", type="icon", width=40),
            ColumnConfig(id="name", header="Name"),
            ColumnConfig(id="qty", header="Qty", align="right"),
            ColumnConfig(id="status", header="Status", editable=True, editor="select",
                         options=["open", {"value": "done", "label": "Done ✓"}]),
            ColumnConfig(id="ok", header="OK"),
            ColumnConfig(id="note", header="Note"),
        ], rows=ROWS, selection="multi", filterable=True, sort_by="qty", sort_dir="desc",
            reorderable_columns=True), root="#table")
        self.exported = []
        self._proxies = [
            create_proxy(lambda _e: self.exported.append(self.table.export_csv("items.csv"))),
            create_proxy(lambda _e: self.exported.append(self.table.export_csv("selected.csv", selected_only=True))),
        ]
        for button, proxy in zip(("all", "sel"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.csv = create_proxy(lambda opts: self.table.to_csv(**json.loads(opts)))
        js.window.exported = create_proxy(lambda: json.dumps(self.exported))
        js.document.body.dataset.ready = "true"


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
