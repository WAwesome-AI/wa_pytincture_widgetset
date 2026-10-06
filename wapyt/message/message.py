"""
Messages: toasts, plus alert / confirm / prompt dialogs.

Not a widget you mount -- toasts and dialogs live on ``<body>``, outside any
layout. Use these instead of a hand-rolled toast or the browser's
``window.confirm()``, which cannot be styled, blocks the whole page, and is
suppressed in some embedded browsers.

Dialogs are coroutines. Await them from an async handler::

    async def drop_collection(self, db, coll):
        if not await message.confirm(
            f"Drop {db}.{coll} and all its documents?\\n\\nThis cannot be undone.",
            title="Drop collection", ok_text="Drop", danger=True,
        ):
            return
        await Store().drop_async(db, coll)
        message.toast(f"Dropped {coll}.", kind="success")

Every string is rendered as text, never markup, so server and model output can
be passed straight in. A blank line (``\\n\\n``) starts a new paragraph.
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from .._runtime import require_js

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore

KINDS = ("info", "success", "warning", "error")


def _api():
    require_js("Message")
    return js.wapyt.Message


def _payload(options: Dict[str, Any]) -> Any:
    return js.JSON.parse(json.dumps(options))


def _to_py(value: Any) -> Any:
    return value.to_py() if hasattr(value, "to_py") else value


# ── Option builders (pure, so they can be tested without a browser) ───────────


def toast_options(kind: str = "info", timeout_ms: int = 4000) -> Dict[str, Any]:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}; got {kind!r}")
    if timeout_ms < 0:
        raise ValueError("timeout_ms must be 0 (stay until dismissed) or positive")
    return {"kind": kind, "timeoutMs": int(timeout_ms)}


def dialog_options(
    kind: str,
    text: str,
    *,
    title: Optional[str] = None,
    ok_text: Optional[str] = None,
    cancel_text: Optional[str] = None,
    danger: bool = False,
    value: Optional[str] = None,
    placeholder: Optional[str] = None,
    password: bool = False,
) -> Dict[str, Any]:
    if kind not in ("alert", "confirm", "prompt"):
        raise ValueError(f"unknown dialog kind {kind!r}")
    options: Dict[str, Any] = {"kind": kind, "text": "" if text is None else str(text)}
    if title:
        options["title"] = str(title)
    if ok_text:
        options["okText"] = str(ok_text)
    if cancel_text:
        options["cancelText"] = str(cancel_text)
    if danger:
        options["danger"] = True
    if value is not None:
        options["value"] = str(value)
    if placeholder:
        options["placeholder"] = str(placeholder)
    if password:
        if kind != "prompt":
            raise ValueError("password applies only to prompt dialogs")
        options["password"] = True
    return options


# ── Toasts ────────────────────────────────────────────────────────────────────


def toast(text: str, kind: str = "info", timeout_ms: int = 4000) -> str:
    """
    Show a toast at the bottom of the page and return its id.

    ``kind`` is ``info``, ``success``, ``warning`` or ``error``; errors are
    announced to screen readers immediately. ``timeout_ms=0`` keeps the toast
    until it is dismissed. Hovering pauses the timer. At most four show at
    once; the oldest makes way.
    """
    options = toast_options(kind, timeout_ms)
    return str(_api().toast("" if text is None else str(text), _payload(options)))


def dismiss(toast_id: str) -> bool:
    """Remove one toast early. False when it has already gone."""
    return bool(_api().dismiss(toast_id))


def dismiss_all() -> None:
    """Remove every toast -- on sign-out, say."""
    _api().dismissAll()


# ── Dialogs ───────────────────────────────────────────────────────────────────


async def alert(text: str, *, title: Optional[str] = None, ok_text: str = "OK") -> None:
    """Show a message with one button; returns once it is acknowledged."""
    await _api().dialog(_payload(dialog_options("alert", text, title=title, ok_text=ok_text)))


async def confirm(
    text: str,
    *,
    title: Optional[str] = None,
    ok_text: str = "OK",
    cancel_text: str = "Cancel",
    danger: bool = False,
) -> bool:
    """
    Ask a yes/no question. True only for the OK button.

    Cancel, Escape and a click outside the dialog all return False.
    ``danger=True`` styles OK as destructive and puts the initial focus on
    Cancel, so pressing Enter does not destroy anything.
    """
    result = _to_py(
        await _api().dialog(
            _payload(
                dialog_options(
                    "confirm", text, title=title, ok_text=ok_text,
                    cancel_text=cancel_text, danger=danger,
                )
            )
        )
    )
    return bool(result.get("ok"))


async def prompt(
    text: str,
    *,
    title: Optional[str] = None,
    value: str = "",
    placeholder: Optional[str] = None,
    ok_text: str = "OK",
    cancel_text: str = "Cancel",
    password: bool = False,
) -> Optional[str]:
    """
    Ask for one line of text. Returns it, or None when cancelled.

    Enter submits. An empty submission returns ``""``, which is distinct from
    cancelling. Validate the answer yourself -- and on the server, if it matters.

    ``password=True`` masks the input and asks the browser not to fill in a
    saved password (``autocomplete="new-password"``), for setting or resetting
    one. The answer still travels as plain text to whatever you send it to.
    """
    result = _to_py(
        await _api().dialog(
            _payload(
                dialog_options(
                    "prompt", text, title=title, ok_text=ok_text,
                    cancel_text=cancel_text, value=value, placeholder=placeholder,
                    password=password,
                )
            )
        )
    )
    if not result.get("ok"):
        return None
    answer = result.get("value")
    return "" if answer is None else str(answer)


__all__ = [
    "KINDS",
    "toast",
    "dismiss",
    "dismiss_all",
    "alert",
    "confirm",
    "prompt",
    "toast_options",
    "dialog_options",
]
