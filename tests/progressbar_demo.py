import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, ProgressBar, ProgressBarConfig, progress_html

FILES = [("report.pdf", 4_200_000, "done"), ("photos.zip", 9_800_000, "error"), ("backup.tar", 6_000_000, "paused")]


def size(n):
    return f"{n / 1_000_000:.1f} MB"


class progressbar_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="ProgressBar", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:14px;max-width:560px">'
            '<div id="queue" style="display:grid;gap:8px"></div>'
            '<div id="unknown"></div><div id="big"></div>'
            '<div id="tiles" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"></div>'
            '<button id="theme">Toggle theme</button></div>',
        )
        self.bars = []
        queue = js.document.getElementById("queue")
        for name, total, _end in FILES:
            slot = js.document.createElement("div"); queue.appendChild(slot)
            self.bars.append(ProgressBar(ProgressBarConfig(label=name, max=total, compact=True,
                                                             label_width=110, value_width="7.5em"), container=slot))
        self.unknown = ProgressBar(ProgressBarConfig(label="Streaming log <tail>", indeterminate=True, compact=True),
                                   root="#unknown")
        self.big = ProgressBar(ProgressBarConfig(label="Import", value=30), root="#big")
        js.document.getElementById("tiles").innerHTML = (
            progress_html(0.73, 1, label="CPU") + progress_html(31, label="Disk", state="error")
        )
        self.seen = [0, 0, 0]
        self.ticks = 0
        self._proxies = [create_proxy(self._tick), create_proxy(lambda _e: self.set_theme(
            "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark"))]
        js.document.getElementById("theme").addEventListener("click", self._proxies[1])
        self._timer = js.window.setInterval(self._proxies[0], 100)

    def _tick(self, *_):
        self.ticks += 1
        for i, (name, total, end) in enumerate(FILES):
            self.seen[i] = min(total, self.seen[i] + total // 12)
            pct = self.seen[i] * 100 // total
            self.bars[i].set_value(self.seen[i], text=f"{pct}%  {size(self.seen[i])}")
        self.unknown.set_value(0, text=f"{size(self.ticks * 150_000)} received")
        if all(s >= t for s, (_n, t, _e) in zip(self.seen, FILES)):
            js.window.clearInterval(self._timer)
            for bar, (_n, _t, end) in zip(self.bars, FILES):
                bar.set_state(end)
            self.big.set_value(100, text="Finished")
            self.big.set_state("done")
            js.document.body.dataset.finished = "true"


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
