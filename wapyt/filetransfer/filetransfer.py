"""
File transfer helpers: native save/open dialogs and streaming transfers.

Not a widget — there is no DOM of its own. It is the Python face of
``assets/filetransfer.js``, which owns the File System Access pickers and moves
the bytes.

**Bytes never cross the FFI.** A download is piped from the network stream
straight into a file handle, and an upload goes from a ``File`` object to
``XMLHttpRequest``. Python decides *what* to transfer and renders progress;
JavaScript does the moving. Routing file contents through Pyodide would mean
base64 in JSON — a third larger, and the whole payload resident in the heap.

Transient user activation
-------------------------
Every picker needs it, and the first ``await`` consumes it. Call
:func:`pick_save_file`, :func:`pick_folder` or :func:`pick_files` as the **first
thing** in a click handler — before fetching a listing, before any BFF call —
or the browser raises ``SecurityError`` on a perfectly valid setup::

    async def on_download_click(_event):
        chosen = await pick_save_file("app.log")   # first, while activation holds
        if not chosen.ok:
            return
        await save_file(chosen.id, url)            # now the slow part
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .._runtime import create_proxy, require_js

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


@dataclass
class Capabilities:
    """What the current browser will allow."""

    save_file: bool = False
    directory: bool = False
    open_file: bool = False
    secure_context: bool = False

    @property
    def pickers(self) -> bool:
        """True when a destination can be chosen rather than assumed."""
        return self.save_file and self.directory and self.secure_context


@dataclass
class PickedFile:
    """One file chosen for upload."""

    id: str
    name: str
    size: int
    path: str  # folder-relative for a directory pick, otherwise just the name


@dataclass
class TransferResult:
    """Outcome of a pick or a transfer."""

    ok: bool
    cancelled: bool = False
    error: str = ""
    id: str = ""
    name: str = ""
    bytes: int = 0
    via_anchor: bool = False
    files: List[PickedFile] = field(default_factory=list)
    # A download that lost its connection more times than it retries: the
    # bytes so far are kept, and resume(id) carries on from them.
    resumable: bool = False
    # How many times the connection dropped and the download picked back up.
    retries: int = 0
    # The file changed on the server mid-download, so it started over rather
    # than splicing two versions together.
    restarted: bool = False


def _to_result(raw: Any) -> TransferResult:
    data: Dict[str, Any] = raw.to_py() if hasattr(raw, "to_py") else dict(raw)
    return TransferResult(
        ok=bool(data.get("ok")),
        cancelled=bool(data.get("cancelled")),
        error=str(data.get("error") or ""),
        id=str(data.get("id") or ""),
        name=str(data.get("name") or ""),
        bytes=int(data.get("bytes") or 0),
        via_anchor=bool(data.get("viaAnchor")),
        resumable=bool(data.get("resumable")),
        retries=int(data.get("retries") or 0),
        restarted=bool(data.get("restarted")),
        files=[
            PickedFile(
                id=str(item.get("id")),
                name=str(item.get("name")),
                size=int(item.get("size") or 0),
                path=str(item.get("path") or item.get("name")),
            )
            for item in (data.get("files") or [])
        ],
    )


def _api():
    require_js("files")
    return js.wapyt.files


def _progress_proxy(handler: Optional[Callable[[int, int], Any]]):
    """Wrap a progress callback, or hand JS undefined when there is none."""
    if handler is None:
        return js.undefined
    return create_proxy(lambda seen, total: handler(int(seen), int(total or 0)))


# ── Capability ────────────────────────────────────────────────────────────────


def capabilities() -> Capabilities:
    """
    What this browser supports.

    The pickers are Chromium-only; Firefox has none of them. Check this and
    tell the user, rather than falling back silently — a Save-As prompt per file
    is worse than not offering a destination choice at all.
    """
    data = _api().supported().to_py()
    return Capabilities(
        save_file=bool(data.get("saveFile")),
        directory=bool(data.get("directory")),
        open_file=bool(data.get("openFile")),
        secure_context=bool(data.get("secureContext")),
    )


# ── Pickers (call first in a click handler) ───────────────────────────────────


async def pick_save_file(suggested_name: str = "") -> TransferResult:
    """
    Native Save dialog: folder navigation and a pre-filled filename field.

    Returns a result whose ``id`` addresses the chosen file. ``cancelled`` is
    True when the user dismissed the dialog, which is not an error.
    """
    return _to_result(await _api().pickSaveFile(suggested_name or js.undefined))


async def pick_folder() -> TransferResult:
    """Native folder picker, for writing several files into one destination."""
    return _to_result(await _api().pickFolder())


async def pick_files(multiple: bool = True, directory: bool = False) -> TransferResult:
    """
    Native file picker for upload.

    With ``directory=True`` the whole folder is selected and each file's
    ``path`` carries its position inside it, so the tree can be recreated
    remotely.
    """
    options = js.JSON.parse(json.dumps({"multiple": multiple, "directory": directory}))
    return _to_result(await _api().pickFiles(options))


def adopt(file_object: Any) -> str:
    """
    Register a ``File`` the page already holds — a drop, typically — so it can
    be uploaded through the same path as a picked one. Returns its handle id.
    """
    return str(_api().registerExternal(file_object) or "")


# ── Transfers ─────────────────────────────────────────────────────────────────


async def save_file(
    handle_id: str,
    url: str,
    transfer_id: str = "",
    on_progress: Optional[Callable[[int, int], Any]] = None,
) -> TransferResult:
    """Stream ``url`` into a file chosen by :func:`pick_save_file`."""
    return _to_result(
        await _api().saveFile(
            handle_id, url, transfer_id or js.undefined, _progress_proxy(on_progress)
        )
    )


async def save_into(
    folder_id: str,
    relative_path: str,
    url: str,
    transfer_id: str = "",
    on_progress: Optional[Callable[[int, int], Any]] = None,
) -> TransferResult:
    """
    Stream ``url`` into a folder chosen by :func:`pick_folder`.

    Intermediate directories in ``relative_path`` are created as needed, so a
    remote tree can be mirrored as its listing streams in.
    """
    return _to_result(
        await _api().saveInto(
            folder_id,
            relative_path,
            url,
            transfer_id or js.undefined,
            _progress_proxy(on_progress),
        )
    )


def download_via_anchor(url: str, suggested_name: str = "") -> TransferResult:
    """
    Fallback download straight to the browser's download directory.

    No destination choice and no progress. Use only when
    :func:`capabilities` reports no pickers, and say so in the UI.
    """
    return _to_result(_api().downloadViaAnchor(url, suggested_name or js.undefined))


async def upload(
    url: str,
    file_id: str,
    fields: Optional[Dict[str, Any]] = None,
    transfer_id: str = "",
    on_progress: Optional[Callable[[int, int], Any]] = None,
) -> TransferResult:
    """
    POST a picked file as multipart form data, with progress.

    ``fields`` are sent alongside it — the destination path, typically. The
    pytincture CSRF token is attached automatically.
    """
    return _to_result(
        await _api().upload(
            url,
            file_id,
            js.JSON.parse(json.dumps(fields or {})),
            transfer_id or js.undefined,
            _progress_proxy(on_progress),
        )
    )


async def exists(folder_id: str, name: str) -> bool:
    """
    Whether ``name`` is already taken, by a file or a folder, directly inside
    a folder chosen with :func:`pick_folder`.

    :func:`save_into` creates what it writes, and an existing file of the
    same name is silently overwritten -- check here first to pick a free name.
    """
    return bool(await _api().exists(folder_id, name))


async def resume(
    transfer_id: str,
    on_progress: Optional[Callable[[int, int], Any]] = None,
) -> TransferResult:
    """
    Carry on a download that paused after losing its connection.

    It asks the server for the rest of the file (``Range``) and checks the
    file has not changed since (``If-Range``); a changed file starts over
    from the beginning rather than being spliced. ``cancel(transfer_id)``
    discards a paused download instead.
    """
    return _to_result(await _api().resume(transfer_id, _progress_proxy(on_progress)))


# ── Control ───────────────────────────────────────────────────────────────────


def cancel(transfer_id: str) -> bool:
    """Abort an in-flight transfer by the id it was started with."""
    return bool(_api().cancel(transfer_id))


def release(handle_id: str) -> bool:
    """Drop a handle once its transfer is done."""
    return bool(_api().release(handle_id))


def release_all() -> None:
    """Drop every retained handle — on tab close, say."""
    _api().releaseAll()


__all__ = [
    "Capabilities",
    "PickedFile",
    "TransferResult",
    "capabilities",
    "pick_save_file",
    "pick_folder",
    "pick_files",
    "adopt",
    "save_file",
    "save_into",
    "download_via_anchor",
    "upload",
    "cancel",
    "release",
    "release_all",
]
