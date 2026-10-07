import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, Kanban, KanbanColumn, KanbanConfig, LayoutConfig, ListAction, MainWindow, ProgressBar,
                   ProgressBarConfig)


class kanban_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Board", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.board = Kanban(KanbanConfig(columns=[
            KanbanColumn("backlog", "Backlog <b>", items=[{"id": "b1", "title": "Idea one"}, {"id": "b2", "title": "Idea two"}],
                         collapsed=True),
            KanbanColumn("todo", "To do", items=[{"id": "t1", "title": "Write spec", "badge": 3},
                                                  {"id": "t2", "title": "Locked", "subtitle": "server refuses moves"}]),
            KanbanColumn("doing", "Doing", wip_limit=2, color="#f59e0b",
                         items=[{"id": "d1", "title": "Build Kanban"}, {"id": "d2", "title": "Review"}]),
            KanbanColumn("done", "Done", color="#10b981"),
        ], actions=[ListAction("edit", "Edit", "mdi-pencil")], wip_strict=True, filterable=True,
            label="Team board"), container=self.layout.getCell("main"))
        ProgressBar(ProgressBarConfig(value=60, compact=True), container=self.board.card_body("d1"))
        self.log = []
        self.n = 0
        self.board.on_move(self._moved)
        self.board.on_add_card(self._add)
        for name in ("select", "activate", "action", "column_move", "column_toggle"):
            getattr(self.board, f"on_{name}")(lambda e, name=name: self._record(name, e))
        js.window.boardState = create_proxy(lambda: json.dumps({
            "board": {k: [c["id"] for c in v] for k, v in self.board.get_board().items()},
            "columns": self.board.get_column_ids(), "selected": self.board.get_selected()}))
        js.document.body.dataset.ready = "true"

    def _moved(self, e):
        self._record("move", {k: e[k] for k in ("id", "from_column", "to_column", "from_index", "to_index")})
        if e["id"] == "t2":
            self.board.move_card("t2", e["from_column"], e["from_index"])
            self._record("reverted", "t2")

    def _add(self, e):
        self.n += 1
        self.board.add_card(e["column"], {"id": f"new{self.n}", "title": f"New card {self.n}"})
        self._record("add_card", e)

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.kbLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
