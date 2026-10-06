import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import (CellConfig, ColumnConfig, DataTable, DataTableConfig, FieldConfig, Form, FormConfig,
                   LayoutConfig, MainWindow, ModalConfig, ModalWindow, Popup, PopupConfig, ToolbarButton,
                   ToolbarConfig, tooltip, tooltip_attr)


class popup_demo(MainWindow):
    layout_config = LayoutConfig(rows=[
        CellConfig(id="mainwindow_header", height="auto"),
        CellConfig(id="main", grow=1),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.toolbar = self.add_toolbar("mainwindow_header", ToolbarConfig(items=[
            ToolbarButton("filter", "Filter", "mdi-filter-variant", tooltip="Filter the rows"),
            ToolbarButton("refresh", "Refresh", "mdi-refresh", show_label=False),
            ToolbarButton("help", "Help", "mdi-help-circle-outline", show_label=False, tooltip='Help for "<this>" page'),
        ], label="Main"))
        self.toolbar.on_click(self._clicked)
        self.attach_html(
            "main",
            '<div style="padding:16px;display:grid;gap:12px;max-width:720px">'
            '<div style="display:flex;gap:8px;align-items:center">'
            '<button id="theme">Toggle theme</button><button id="assign">Py tooltip()</button>'
            f'<button id="markup" {tooltip_attr("From <tooltip_attr>", "right")}>Markup</button>'
            '<button id="native" title="Native title">App title</button>'
            '<button id="point">Popup at a point</button><button id="modal">Popup in a modal</button></div>'
            '<div id="table" style="height:150px"></div>'
            '<div style="position:fixed;right:12px;bottom:12px"><button id="corner">Corner</button></div></div>',
        )
        long = "A very long description that will certainly not fit in a narrow column of this table"
        self.table = DataTable(DataTableConfig(columns=[
            ColumnConfig(id="name", header="Name", width=120), ColumnConfig(id="desc", header="Description", width=180),
        ], rows=[{"id": 1, "name": "short", "desc": "fits"}, {"id": 2, "name": "long", "desc": long}]), root="#table")
        tooltip("#assign", "Set from Python", "bottom")

        self.filter_popup = Popup(PopupConfig(placement="bottom-start", label="Filter", width=280))
        self.form = Form(FormConfig(submit_text="Apply", fields=[
            FieldConfig(id="q", label="Contains"),
            FieldConfig(id="kind", label="Kind", type="combo", options=["alpha", "beta", "gamma"]),
        ]), container=self.filter_popup.body)
        self.form.on_submit(lambda v: (self._record("submit", v), self.filter_popup.hide()))
        self.filter_popup.on_show(lambda _p: self._record("show", "filter"))
        self.filter_popup.on_hide(lambda _p: self._record("hide", "filter"))

        self.text_popup = Popup(PopupConfig(placement="top", label="Note", max_width=220))
        self.text_popup.set_text("Plain <b>text</b> only, placed where there is room.")
        self.log = []
        self._proxies = [
            create_proxy(lambda _e: self.set_theme(
                "light" if js.document.documentElement.getAttribute("data-wapyt-theme") == "dark" else "dark")),
            create_proxy(lambda e: self.text_popup.show((e.clientX, e.clientY))),
            create_proxy(lambda _e: self.text_popup.toggle("#corner")),
            create_proxy(lambda _e: self._modal()),
        ]
        for button, proxy in zip(("theme", "point", "corner", "modal"), self._proxies):
            js.document.getElementById(button).addEventListener("click", proxy)
        js.document.body.dataset.ready = "true"

    def _clicked(self, payload):
        if payload["id"] == "filter":
            self.filter_popup.toggle('.wapyt-toolbar-btn[data-id="filter"]')

    def _modal(self):
        self.modal = ModalWindow(ModalConfig(title="Modal", width=360, height=200, dispose_on_close=True))
        self.modal.body.innerHTML = '<div style="padding:12px"><button id="inmodal">Open popup</button></div>'
        self.modal_popup = Popup(PopupConfig(label="In modal"))
        self.modal_popup.set_text("Escape closes me, not the modal.")
        self._proxies.append(create_proxy(lambda _e: self.modal_popup.show("#inmodal")))
        js.document.getElementById("inmodal").addEventListener("click", self._proxies[-1])
        self.modal.show()

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.popupLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
