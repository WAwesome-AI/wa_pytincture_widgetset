import sys

from wapyt.cardpanel import CardPanelConfig, CardPanelCardConfig
from wapyt.layout import Layout, MainWindow, LayoutConfig, CellConfig
from wapyt.modal import ModalWindow, ModalConfig


class cardpanel_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="cards", grow=1)])

    def load_ui(self):
        self._modal = ModalWindow(ModalConfig(title="Add Provider", width=520, height=380))
        self._modal_layout = Layout(LayoutConfig(rows=[CellConfig(id="form", grow=1)]))
        self._modal.set_content(self._modal_layout.layout)
        self._render_modal_form()

        config = CardPanelConfig(
            title="Data Sources",
            description="A minimal card panel rendered without DHTMLX.",
            search_placeholder="Search connectors…",
            add_button_text="New Source",
            card_columns=3,
            card_height=200,
            card_template={
                "class": "card-card",
                "children": [
                    {
                        "class": "card-head",
                        "children": [
                            {"class": "card-icon", "text": "{extra.initial}"},
                            {
                                "children": [
                                    {"tag": "h3", "class": "card-title", "text": "{title}"},
                                    {"tag": "p", "class": "card-sub", "text": "{subtitle}"},
                                    {"tag": "span", "class": "card-pill", "text": "{pill}"},
                                ]
                            },
                        ],
                    },
                    {"class": "card-content", "text": "Status: {extra.status}"},
                    {
                        "class": "card-foot",
                        "children": [
                            {
                                "tag": "button",
                                "class": "card-action",
                                "text": "View",
                                "attrs": {"data-card-action": "view"},
                            },
                            {
                                "tag": "button",
                                "class": "card-action",
                                "text": "Sync",
                                "attrs": {"data-card-action": "sync"},
                            },
                        ],
                    },
                ],
            },
            cards=[
                CardPanelCardConfig(
                    id="duckdb",
                    title="DuckDB",
                    subtitle="Fast OLAP engine",
                    pill="Warehouse",
                    extra={"status": "Healthy", "initial": "D"},
                ),
                CardPanelCardConfig(
                    id="snowflake",
                    title="Snowflake",
                    subtitle="Elastic cloud analytics",
                    pill="Warehouse",
                    extra={"status": "Syncing", "initial": "S"},
                ),
                CardPanelCardConfig(
                    id="lakehouse",
                    title="Lakehouse",
                    subtitle="S3 compatible store",
                    pill="Lake",
                    extra={"status": "Healthy", "initial": "L"},
                ),
            ],
        )
        panel = self.add_cardpanel("cards", config)
        panel.on_card_click(lambda payload: print("Card clicked:", payload))
        panel.on_add(lambda: self._show_modal())
        panel.on_action(lambda payload: self._show_modal(payload.get("cardId")))

    def _render_modal_form(self, provider_id: str = "", status: str = ""):
        form_html = f"""
        <form style="display:flex;flex-direction:column;gap:12px;">
            <label>Provider ID
                <input type="text" value="{provider_id}" style="width:100%;padding:8px;" />
            </label>
            <label>Status
                <input type="text" value="{status}" style="width:100%;padding:8px;" />
            </label>
            <label>Models<br/>
                <textarea style="width:100%;height:120px;padding:8px;">gpt-4o-mini</textarea>
            </label>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button type="button" style="padding:8px 12px;">Cancel</button>
                <button type="submit" style="padding:8px 12px;background:#2563eb;color:#fff;border:none;border-radius:8px;">Save</button>
            </div>
        </form>
        """
        self._modal_layout.attach_html("form", form_html)

    def _show_modal(self, provider_id: str = None):
        title = "Add Provider" if not provider_id else f"Configure {provider_id}"
        self._modal.set_title(title)
        self._render_modal_form(provider_id or "", "Healthy")
        self._modal.show()


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
