import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, Pagination, PaginationConfig

ROWS = [f"row {n}" for n in range(1, 48)]


class pagination_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Pagination", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:18px;max-width:760px">'
            '<div style="display:flex;gap:8px"><button id="theme">Toggle theme</button>'
            '<button id="shrink">Server total → 60</button></div>'
            '<div id="server"></div><div id="numbers"></div><div id="unknown"></div>'
            '<div><div id="memory"></div><div id="rows" style="font-size:12px"></div></div></div>',
        )
        self.log = []
        self.server = Pagination(PaginationConfig(total=1234, page_size=50, page_sizes=[20, 50, 100]), root="#server")
        self.server.on_change(lambda s: self._load("server", s))
        self.numbers = Pagination(PaginationConfig(total=200, page_size=10, numbers=True, label="Numbered"), root="#numbers")
        self.numbers.on_change(lambda s: self._record("numbers", s))
        self.unknown = Pagination(PaginationConfig(page_size=20, exact=False, label="Unknown total"), root="#unknown")
        self.unknown.on_change(lambda s: self._load_unknown(s))
        self.memory = Pagination(PaginationConfig(total=len(ROWS), page_size=10, show_summary=True, label="In memory"),
                                 root="#memory")
        self.memory.on_change(lambda s: self._show_rows())
        self._show_rows()
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda _e: self.server.set_total(60)),
        ]
        for button, proxy in zip(("theme", "shrink"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.window.pagerState = create_proxy(lambda name: json.dumps(getattr(self, name).get_state()))
        js.document.body.dataset.ready = "true"

    def _record(self, kind, state):
        self.log.append([kind, state])
        js.window.pagerLog = json.dumps(self.log)

    def _load(self, kind, state):
        self._record(kind, state)
        self.server.set_busy(True)
        done = create_proxy(lambda: (self.server.set_busy(False), setattr(js.document.body.dataset, "loaded", str(len(self.log)))))
        js.window.setTimeout(done, 150)

    def _load_unknown(self, state):
        self._record("unknown", state)
        page = state["page"]
        # Pretend the server returns full pages until page 3, which has 17 rows.
        self.unknown.set_total(None, exact=False, has_more=page < 3, shown=20 if page < 3 else 17)

    def _show_rows(self):
        js.document.getElementById("rows").textContent = ", ".join(self.memory.page_rows(ROWS))


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
