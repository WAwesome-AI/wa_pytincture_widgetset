"""
ThemeEditor demo: the editor on the left, widgets on the tokens on the right.

    ./scripts/dev_wheel.sh tests && cd tests && uv run layout_demo.py
    open http://localhost:8070/themeeditor_demo/
"""
import sys

from wapyt import (
    CellConfig, ColumnConfig, DataTableConfig, FieldConfig, FormConfig, LayoutConfig,
    SelectOption, ThemeEditorConfig, ThemePalette, ToolbarButton, ToolbarConfig,
    progress_html, restore_theme,
)
from wapyt.toolbar.toolbar_config import ToolbarSeparator
from wapyt.layout import MainWindow

STORAGE_KEY = "wapyt-demo:theme"
BRAND = ThemePalette("brand", "Brand", light={"accent": "#0f766e", "focus": "#0d9488"},
                     dark={"accent": "#0f766e", "accent-strong": "#2dd4bf", "accent-text": "#99f6e4"})


class themeeditor_demo(MainWindow):
    layout_config = LayoutConfig(cols=[
        CellConfig(id="editor", width="460px", resizable=True),
        CellConfig(id="preview", rows=[
            CellConfig(id="mainwindow_header", height="auto"),
            CellConfig(id="body", cols=[
                CellConfig(id="form", header="Form", width="45%"),
                CellConfig(id="side", rows=[
                    CellConfig(id="table", header="Table"),
                    CellConfig(id="bars", header="Progress", height="190px"),
                ]),
            ]),
        ]),
    ])

    def load_ui(self):
        import js

        restore_theme(STORAGE_KEY, palettes=[BRAND])
        self.editor = self.add_themeeditor("editor", ThemeEditorConfig(
            palettes=["default", "ocean", "forest", "sunset", "grape", "rose", "graphite", "paper", "contrast", BRAND],
            storage_key=STORAGE_KEY,
        ))
        log = js.document.createElement("pre")
        log.id = "change-log"
        log.hidden = True
        js.document.body.appendChild(log)

        def changed(event):
            log.textContent = f"{event['source']} {event.get('key') or ''} {event['theme']['palette']}"

        self.editor.on_change(changed)

        self.add_toolbar("mainwindow_header", ToolbarConfig(items=[
            ToolbarButton("new", "New", icon="mdi-plus", variant="primary"),
            ToolbarButton("edit", "Edit", icon="mdi-pencil"),
            ToolbarButton("delete", "Delete", icon="mdi-delete", variant="danger"),
            ToolbarSeparator(),
            ToolbarButton("list", icon="mdi-view-list", group="view", active=True, tooltip="List"),
            ToolbarButton("grid", icon="mdi-view-grid", group="view", tooltip="Grid"),
            ToolbarButton("sync", "Sync", icon="mdi-sync", badge=3),
        ]))
        self.add_form("form", FormConfig(fields=[
            FieldConfig("name", "Name", value="Ada Lovelace", required=True),
            FieldConfig("email", "Email", type="email", placeholder="you@example.com", help="We never share it."),
            FieldConfig("plan", "Plan", type="radio", value="pro", inline=True,
                        options=[SelectOption("free", "Free"), SelectOption("pro", "Pro"), SelectOption("team", "Team")]),
            FieldConfig("notify", "Notifications", type="toggle", value=True),
            FieldConfig("volume", "Volume", type="range", value=60, min=0, max=100),
            FieldConfig("tags", "Tags", type="combo", multiple=True, value=["ui", "docs"],
                        options=[SelectOption("ui", "UI"), SelectOption("docs", "Docs"), SelectOption("api", "API")]),
        ], cancel_text="Cancel"))
        table = self.add_datatable("table", DataTableConfig(
            columns=[ColumnConfig("name", "Name"), ColumnConfig("role", "Role"), ColumnConfig("status", "Status")],
            rows=[
                {"id": "1", "name": "Ada", "role": "Engineer", "status": "Active"},
                {"id": "2", "name": "Grace", "role": "Admiral", "status": "Away"},
                {"id": "3", "name": "Katherine", "role": "Mathematician", "status": "Active"},
                {"id": "4", "name": "Margaret", "role": "Director", "status": "Busy"},
            ],
        ))
        table.select("2")
        self.attach_html("bars", "".join([
            '<div style="padding:12px;display:grid;gap:10px">',
            progress_html(62, label="Uploading", state="active"),
            progress_html(100, label="Backup", state="done"),
            progress_html(35, label="Sync", state="error"),
            progress_html(80, label="Import", state="paused"),
            "</div>",
        ]))


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
