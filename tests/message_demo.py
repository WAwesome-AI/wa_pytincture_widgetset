import asyncio
import sys
import traceback

import js
from pyodide.ffi import create_proxy

from wapyt import CellConfig, LayoutConfig, MainWindow, message

BUTTONS = [
    ("toast-info", "Info toast"),
    ("toast-success", "Success toast"),
    ("toast-warning", "Warning toast"),
    ("toast-error", "Error toast (sticky)"),
    ("alert", "Alert"),
    ("confirm", "Confirm"),
    ("confirm-danger", "Destructive confirm"),
    ("prompt", "Prompt"),
    ("prompt-password", "Password prompt"),
    ("theme", "Toggle theme"),
]


class message_demo(MainWindow):
    layout_config = LayoutConfig(
        rows=[CellConfig(id="main", header="wapyt.message", grow=1)]
    )

    def load_ui(self):
        self.set_theme("light")
        self._proxies = []
        buttons = "".join(
            f'<button type="button" id="{key}" style="margin:4px">{label}</button>'
            for key, label in BUTTONS
        )
        self.attach_html(
            "main",
            f'<div style="padding:16px">{buttons}'
            '<p>Last result: <code id="result">-</code></p></div>',
        )
        for key, _label in BUTTONS:
            proxy = create_proxy(lambda _event, key=key: self._run(key))
            self._proxies.append(proxy)
            js.document.getElementById(key).addEventListener("click", proxy)

    def _result(self, value):
        js.document.getElementById("result").textContent = repr(value)

    def _run(self, key):
        if key.startswith("toast-"):
            kind = key.split("-", 1)[1]
            message.toast(
                f"A {kind} message.\n<b>Markup stays text.</b>",
                kind=kind,
                timeout_ms=0 if kind == "error" else 4000,
            )
            return
        if key == "theme":
            current = js.document.documentElement.getAttribute("data-wapyt-theme")
            self.set_theme("light" if current == "dark" else "dark")
            return

        async def dialog():
            try:
                if key == "alert":
                    self._result(await message.alert("The import finished.", title="Done"))
                elif key == "confirm":
                    self._result(await message.confirm("Save the changes?", title="Unsaved changes"))
                elif key == "confirm-danger":
                    self._result(
                        await message.confirm(
                            "Drop demo.users and all its documents and indexes?\n\n"
                            "This cannot be undone.",
                            title="Drop collection",
                            ok_text="Drop",
                            danger=True,
                        )
                    )
                elif key == "prompt-password":
                    self._result(
                        await message.prompt(
                            "New password for ada (min 8 chars)", title="Reset password",
                            ok_text="Reset", password=True,
                        )
                    )
                elif key == "prompt":
                    self._result(
                        await message.prompt(
                            "New name for the collection", title="Rename",
                            value="users", placeholder="name",
                        )
                    )
            except Exception:
                js.console.error(traceback.format_exc())

        asyncio.ensure_future(dialog())


if __name__ == "__main__" and sys.platform != "emscripten":
    from pytincture import launch_service

    launch_service(modules_folder=".")
