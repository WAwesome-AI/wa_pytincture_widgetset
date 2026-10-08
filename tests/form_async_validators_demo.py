import asyncio
import json
import sys

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, FieldConfig, Form, FormButton, FormConfig, LayoutConfig, MainWindow

DELAY = {"s": 0.4}


async def username_free(value, values):
    await asyncio.sleep(DELAY["s"])        # stands in for a BFF call
    if value == "boom":
        raise RuntimeError("backend down")
    return "That name is taken" if value in ("ada", "admin") else None


class form_async_validators_demo(MainWindow):
    layout_config = LayoutConfig(rows=[CellConfig(id="main", header="Async validators", grow=1)])

    def load_ui(self):
        self.set_theme("light")
        self.attach_html("main", '<div style="padding:16px;max-width:560px"><div id="form"></div></div>')
        self.form = Form(FormConfig(
            submit_text="Create",
            fields=[
                FieldConfig(id="user", label="Username", required=True, validate=username_free,
                            success_message="Available"),
                FieldConfig(id="email", label="Email", validate=lambda v, vals: None if "@" in v else "Enter an email"),
                FormButton("create_open", "Create and open", submit=True),
            ],
        ), root="#form")
        self.log = []
        for name in ("submit", "invalid", "click"):
            getattr(self.form, f"on_{name}")(lambda p, n=name: self._record(n, p))
        self.form.on_blur(lambda p: self.form.validate_field(p["id"]))
        js.window.wapytDelay = create_proxy(lambda s: DELAY.__setitem__("s", s))
        js.window.wapytValidate = create_proxy(lambda: json.dumps(self.form.validate()))
        js.window.wapytValidateAsync = create_proxy(lambda: asyncio.ensure_future(self._run_async()))
        js.window.wapytFieldAsync = create_proxy(lambda i: asyncio.ensure_future(self._run_field(i)))
        js.document.body.dataset.ready = "true"

    async def _run_async(self):
        js.window.wapytAsyncResult = json.dumps(await self.form.validate_async())

    async def _run_field(self, field_id):
        js.window.wapytFieldResult = json.dumps(await self.form.validate_field_async(field_id))

    def _record(self, kind, payload):
        self.log.append([kind, payload])
        js.window.wapytFormLog = json.dumps(self.log)


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
