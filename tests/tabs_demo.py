import sys

from wapyt.layout import MainWindow, LayoutConfig, CellConfig
from wapyt.tabwidget import TabWidgetConfig, TabConfig


class tabs_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="tabs", grow=1)])

    def load_ui(self):
        tabs = self.add_tabwidget(
            "tabs",
            TabWidgetConfig(
                tabs=[
                    TabConfig(id="status", title="Status", badge=3),
                    TabConfig(id="logs", title="Logs"),
                    TabConfig(id="settings", title="Settings", closable=True),
                ],
                active="status",
            ),
        )
        tabs.attach_html("status", "<p>Everything looks good 🌈</p>")
        tabs.attach_html("logs", "<pre>No log entries yet.</pre>")
        tabs.attach_html("settings", "<p>Try closing me.</p>")


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
