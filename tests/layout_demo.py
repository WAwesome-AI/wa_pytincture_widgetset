import sys

from wapyt.cardpanel import CardPanelConfig, CardPanelCardConfig
from wapyt.layout import MainWindow, LayoutConfig, CellConfig
from wapyt.sidebar import SidebarConfig, SidebarItem
from wapyt.tabwidget import TabWidgetConfig, TabConfig


class layout_demo(MainWindow):
    layout_config = LayoutConfig(
        rows=[
            CellConfig(id="banner", height="64px"),
            CellConfig(
                id="body",
                cols=[
                    CellConfig(id="nav", width="220px", header="Navigation"),
                    CellConfig(
                        id="main",
                        rows=[
                            CellConfig(id="insights", height="48%", header="Pipeline insights"),
                            CellConfig(id="sources", header="Connected sources", grow=1),
                        ],
                    ),
                ],
            ),
        ]
    )

    def load_ui(self):
        self.attach_html(
            "banner",
            """
            <div style="display:flex;align-items:center;justify-content:space-between;height:100%;padding:0 1rem;">
                <strong>wA Layout Demo</strong>
                <span style="opacity:0.6;">Drop Python-driven widgets anywhere</span>
            </div>
            """,
        )
        self.add_sidebar(
            "nav",
            SidebarConfig(
                title="Dashboards",
                items=[
                    SidebarItem(id="overview", label="Overview", icon="dashboard"),
                    SidebarItem(id="pipelines", label="Pipelines", badge="4", icon="tune"),
                    SidebarItem(id="lineage", label="Lineage", icon="mdi mdi-source-branch"),
                    SidebarItem(id="alerts", label="Alerts", badge="1", icon="notifications"),
                ],
                active="overview",
            ),
        )
        tabs = self.add_tabwidget(
            "insights",
            TabWidgetConfig(
                tabs=[
                    TabConfig(id="overview", title="Overview"),
                    TabConfig(id="activity", title="Activity"),
                    TabConfig(id="settings", title="Settings", closable=True),
                ],
                active="overview",
            ),
        )
        tabs.attach_html(
            "overview",
            """
            <div>
                <h2>Daily throughput</h2>
                <p>24 production pipelines completed in the past 24 hours.</p>
                <p style="opacity:.65;">No SLA breaches detected.</p>
            </div>
            """,
        )
        tabs.attach_html(
            "activity",
            "<h2>Activity</h2><p>Use `add_tabwidget`, `add_cardpanel`, etc. to compose complex layouts.</p>",
        )
        tabs.attach_html(
            "settings",
            "<h2>Settings</h2><p>Closable tabs work as well.</p>",
        )
        self.add_cardpanel(
            "sources",
            CardPanelConfig(
                title="Data sources",
                description="Curated connections with profiling, monitoring, and health checks.",
                card_columns=3,
                card_min_height=180,
                card_height=220,
                cards=[
                    CardPanelCardConfig(id="duckdb", title="DuckDB Lake", subtitle="Columnar analytics", pill="Warehouse"),
                    CardPanelCardConfig(id="snowflake", title="Snowflake", subtitle="Customer 360 zone", pill="Warehouse"),
                    CardPanelCardConfig(id="s3", title="S3 Bronze", subtitle="Raw sensor data", pill="Lake"),
                    CardPanelCardConfig(id="postgres", title="Postgres ERP", subtitle="Operational DB", pill="OLTP"),
                    CardPanelCardConfig(id="kafka", title="Kafka", subtitle="Real-time streams", pill="Streaming"),
                ],
            ),
        )


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
