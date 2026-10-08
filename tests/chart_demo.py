import json
import math
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, Chart, ChartConfig, ChartDataset, LayoutConfig, MainWindow

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def configs():
    return {
        "line": ChartConfig(type="line", labels=MONTHS, title="Sessions <b>", y_label="Sessions", compact=True,
                            datasets=[ChartDataset("Web", [120, 180, 150, 210, 260, 240, 300, 320, 280, 350, 390, 420]),
                                      ChartDataset("Mobile", [80, 95, 130, 160, 150, 190, 230, 260, 270, 300, 310, 360]),
                                      ChartDataset("Target", [200] * 12, dashed=True, point_radius=0)]),
        "stacked": ChartConfig(type="bar", labels=["Q1", "Q2", "Q3", "Q4"], title="Revenue", stacked=True,
                               value_prefix="$", compact=True, table_toggle=True,
                               datasets=[ChartDataset("EU", [1200, 1500, 1700, 2100]),
                                         ChartDataset("US", [2200, 2100, 2600, 3000]),
                                         ChartDataset("APAC", [600, 900, 1100, 1500])]),
        "hbar": ChartConfig(type="bar", horizontal=True, labels=["Chrome", "Firefox", "Safari", "Edge"],
                            title="Browsers", value_suffix="%", datasets=[ChartDataset("Share", [64, 12, 18, 6])]),
        "doughnut": ChartConfig(type="doughnut", labels=["Free", "Pro", "Team"], title="Plans",
                                datasets=[ChartDataset("Accounts", [540, 210, 90])]),
        "scatter": ChartConfig(type="scatter", title="Latency vs size", x_label="KB", y_label="ms", begin_at_zero=False,
                               datasets=[ChartDataset("GET", [{"x": i * 3, "y": 20 + i * 1.5 + (i % 4) * 3} for i in range(20)]),
                                         ChartDataset("POST", [{"x": i * 3 + 1, "y": 40 + i * 2 - (i % 3) * 4} for i in range(20)])]),
        "live": ChartConfig(type="area", title="Live CPU", value_suffix="%", y_max=100, animation=False,
                            labels=[str(i) for i in range(20)],
                            datasets=[ChartDataset("cpu", [50 + 20 * math.sin(i / 3) for i in range(20)])]),
        "mixed": ChartConfig(type="bar", labels=MONTHS[:6], title="Orders and average",
                             datasets=[ChartDataset("Orders", [30, 42, 38, 51, 47, 60]),
                                       ChartDataset("Average", [30, 36, 37, 40, 42, 45], type="line")]),
    }


class chart_demo(MainWindow):
    layout_config = LayoutConfig(cols=[
        CellConfig(id="solo", header="In a layout cell", width="380px", resizable=True),
        CellConfig(id="dash", header="Dashboard", grow=1),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.solo = self.add_chart("solo", configs()["line"])
        self.attach_html("dash", '<div id="dash_wrap" style="height:100%;overflow:auto;padding:6px">'
                                 '<div class="grid-stack" id="grid"></div></div>'
                                 '<div id="scratch"></div>')
        self.charts = {"solo": self.solo}
        self.clicks = []
        self.solo.on_click(lambda p: self._click("solo", p))
        self.tick = 20

        def mount(element_id, kind, key):
            chart = Chart(configs()[kind], root=js.document.getElementById(element_id))
            chart.on_click(lambda p: self._click(key, p))
            self.charts[key] = chart
            return "ok"

        api = {
            "mount": mount,
            "theme": lambda name: self.set_theme(name),
            "append": lambda key, n: [self._stream(key) for _ in range(int(n))] and None,
            "filter": lambda key, labels: self.charts[key].set_data(
                datasets=[d for d in configs()["line"].datasets if d.label in json.loads(labels)]),
            "set_type": lambda key, t: self.charts[key].set_type(t),
            "image": lambda key: self.charts[key].to_image()[:22],
            "table": lambda key, v: self.charts[key].show_table(bool(v)),
            "resize": lambda key: self.charts[key].resize(),
            "destroy": lambda key: self.charts.pop(key).destroy(),
            "clicks": lambda: self.clicks,
            "update": lambda key, ds, data: self.charts[key].update_dataset(ds, json.loads(data)),
        }
        js.window.wapytChart = create_proxy(lambda name, *a: json.dumps(api[name](*a)))
        js.document.body.dataset.ready = "true"

    def _stream(self, key):
        self.tick += 1
        self.charts[key].append(str(self.tick), [50 + 30 * math.sin(self.tick / 3)], max_points=20)

    def _click(self, key, payload):
        self.clicks.append([key, payload])


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
