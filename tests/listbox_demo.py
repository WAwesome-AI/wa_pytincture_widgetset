import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, LayoutConfig, ListAction, Listbox, ListboxConfig, MainWindow, ProgressBar,
                   ProgressBarConfig)

TODO = [{"id": "t1", "title": "Write spec", "subtitle": "Due Friday", "badge": 2},
        {"id": "t2", "title": "Review <PR>", "subtitle": "from ana", "meta": "#45"},
        {"id": "t3", "title": "Locked task", "subtitle": "server refuses Done"},
        {"id": "t4", "title": "Disabled", "disabled": True}]
DOING = [{"id": "d1", "title": "Build Listbox", "subtitle": "with widgets inside"}]
DONE = [{"id": "x1", "title": "MenuBar <b>", "notesHtml": "<em>shipped</em> in #44"}]
LIB = [{"id": "lib1", "title": "Template: bug report"}]


class listbox_demo(MainWindow):
    layout_config = LayoutConfig(cols=[CellConfig(id=c, header=h) for c, h in
                                       (("todo", "To do"), ("doing", "Doing"), ("done", "Done"), ("lib", "Library"))])

    def load_ui(self):
        self.set_theme("light")
        self.log = []
        mk = lambda cell, **kw: self._list(cell, Listbox(ListboxConfig(group="board", draggable=True, **kw),
                                                         container=self.layout.getCell(cell)))
        self.todo = mk("todo", label="To do", list_id="todo", items=TODO, filterable=True, selection="multi",
                       actions=[ListAction("edit", "Edit", "mdi-pencil"), ListAction("del", "Delete", "mdi-delete", danger=True)])
        self.doing = mk("doing", label="Doing", list_id="doing", items=DOING)
        self.done = mk("done", label="Done", list_id="done", items=DONE, template='<b class="t">{title}</b> <span class="n">{notesHtml}</span>')
        self.lib = mk("lib", label="Library", list_id="lib", items=LIB, copy=True, accept=False)
        self.bar = ProgressBar(ProgressBarConfig(label="progress", value=40, compact=True), container=self.doing.item_body("d1"))
        btn = js.document.createElement("button"); btn.id = "inner"; btn.textContent = "Inner button"
        self._click = create_proxy(lambda _e: self._record("inner_click", None))
        btn.addEventListener("click", self._click)
        self.doing.item_body("d1").appendChild(btn)
        js.window.lists = create_proxy(lambda: json.dumps({n: [i["id"] for i in getattr(self, n).get_items()]
                                                           for n in ("todo", "doing", "done", "lib")}))
        js.document.body.dataset.ready = "true"

    def _list(self, name, lb):
        lb.on_move(lambda e: self._moved(lb, e))
        lb.on_action(lambda e: self._record("action", [e["action"], e["id"]]))
        lb.on_select(lambda e: self._record("select", [name, e["ids"]]))
        lb.on_activate(lambda e: self._record("activate", [name, e["id"]]))
        return lb

    def _moved(self, lb, e):
        self._record("move", {k: e[k] for k in ("id", "from_list", "to_list", "from_index", "to_index", "copy")})
        if e["id"] == "t3" and e["to_list"] == "done":       # the server refuses
            lb.move_item("t3", e["from_index"], to=self.todo)
            self._record("reverted", "t3")

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.lbLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
