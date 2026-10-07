import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, ColumnConfig, DataTable, DataTableConfig, LayoutConfig, MainWindow

ROWS = [
    {"id": "1", "task": "Invoice", "owner": "ana", "secret": "s1", "due": "2026-10-01", "status_class": "overdue",
     "due_class": "late"},
    {"id": "2", "task": "Report", "owner": "bo", "secret": "s2", "due": "2026-10-20", "status_class": "",
     "due_class": None},
    {"id": "3", "task": "Audit", "owner": "cy", "secret": "findme", "due": "2026-10-09",
     "status_class": "warn bad\"attr <x> 9nope", "_class": "legacy"},
]


class datatable_classes_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Row classes and hidden columns", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<style>.overdue td{color:#b91c1c}.late{font-weight:700}.num{text-align:right}</style>'
                         '<div style="padding:12px;display:grid;gap:10px"><div style="display:flex;gap:8px">'
                         '<button id="hide">hide_column(owner)</button><button id="show">show_column(owner)</button>'
                         '<button id="showsecret">show secret</button></div>'
                         '<div id="table" style="height:200px"></div></div>')
        self.table = DataTable(DataTableConfig(columns=[
            ColumnConfig(id="task", header="Task", editable=True),
            ColumnConfig(id="owner", header="Owner", css="col-owner"),
            ColumnConfig(id="secret", header="Secret", hidden=True),
            ColumnConfig(id="due", header="Due", css="num", cell_class_by="due_class"),
        ], rows=ROWS, row_class_by="status_class", filterable=True, resizable_columns=True,
            reorderable_columns=True), root="#table")
        self.log = []
        self.table.on_columns(lambda p: self._record(p))
        self._proxies = [create_proxy(lambda _e: self.table.hide_column("owner")),
                         create_proxy(lambda _e: self.table.show_column("owner")),
                         create_proxy(lambda _e: self.table.show_column("secret"))]
        for button, proxy in zip(("hide", "show", "showsecret"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.colState = create_proxy(lambda: json.dumps(
            {"state": self.table.get_column_state(), "owner_hidden": self.table.is_column_hidden("owner"),
             "csv": self.table.to_csv()}))
        js.document.body.dataset.ready = "true"

    def _record(self, payload):
        self.log.append(payload)
        js.window.colLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
