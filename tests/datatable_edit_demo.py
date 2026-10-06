import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, ColumnConfig, DataTable, DataTableConfig, LayoutConfig, MainWindow, ModalConfig,
                   ModalWindow)

STATUS = ["open", {"value": "wip", "label": "In progress"}, {"value": "done", "label": "Done"}]
ROWS = [
    {"id": "1", "name": "Alpha", "qty": 3, "status": "open", "done": False, "due": "2026-10-10", "note": "first"},
    {"id": "2", "name": "Bravo <b>", "qty": 10, "status": "wip", "done": True, "due": None, "note": "second"},
    {"id": "3", "name": "Charlie", "qty": 7, "status": "done", "done": False, "due": "2026-11-01", "note": "third"},
]


def columns():
    return [
        ColumnConfig(id="name", header="Name", width=150, editable=True, required=True),
        ColumnConfig(id="qty", header="Qty", width=80, align="right", editable=True, editor="number"),
        ColumnConfig(id="status", header="Status", width=130, editable=True, editor="select", options=STATUS),
        ColumnConfig(id="done", header="Done", width=70, editable=True, editor="checkbox"),
        ColumnConfig(id="due", header="Due", width=150, editable=True, editor="date"),
        ColumnConfig(id="note", header="Note (read-only)"),
    ]


class datatable_edit_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="DataTable editing", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:12px;display:grid;gap:10px">'
                         '<div style="display:flex;gap:8px"><button id="theme">Toggle theme</button>'
                         '<button id="add">Add row</button><button id="modal">Table in a modal</button></div>'
                         '<div id="table" style="height:220px"></div></div>')
        self.table = DataTable(DataTableConfig(columns=columns(), rows=[dict(r) for r in ROWS], selection="multi",
                                               sort_by="name"), root="#table")
        self.log = []
        self.table.on_edit(self._edited)
        self.table.on_activate(lambda p: self._record("activate", p["id"]))
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self._add()),
            create_proxy(lambda _e: self._modal()),
        ]
        for button, proxy in zip(("theme", "add", "modal"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.tableRows = create_proxy(lambda: json.dumps(self.table.get_rows()))
        js.document.body.dataset.ready = "true"

    def _edited(self, payload):
        self._record("edit", {k: payload[k] for k in ("id", "column", "value", "old_value")})
        # Pretend the server refuses negative quantities.
        if payload["column"] == "qty" and isinstance(payload["value"], (int, float)) and payload["value"] < 0:
            self.table.set_cell(payload["id"], "qty", payload["old_value"])
            self.table.set_cell_error(payload["id"], "qty", "Server: quantity cannot be negative")

    def _add(self):
        rows = self.table.get_rows()
        new_id = str(len(rows) + 1)
        self.table.set_rows(rows + [{"id": new_id, "name": "", "qty": None, "status": "open", "done": False,
                                     "due": None, "note": "new"}])
        self.table.edit_cell(new_id, "name")

    def _modal(self):
        modal = ModalWindow(ModalConfig(title="Modal table", width=520, height=260, dispose_on_close=True))
        self.modal_table = DataTable(DataTableConfig(columns=columns()[:2], rows=[dict(r) for r in ROWS]),
                                     container=modal.body)
        self.modal_table.on_edit(lambda p: self._record("modal-edit", p["value"]))
        modal.show()

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.editLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
