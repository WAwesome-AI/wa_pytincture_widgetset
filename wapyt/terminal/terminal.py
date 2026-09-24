"""
Terminal widget: an xterm.js surface wired to a WebSocket shell relay.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js
from .terminal_config import TerminalConfig, TerminalTheme

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


class Terminal:
    """
    A connected terminal pane.

    Quick start::

        term = Terminal(
            TerminalConfig(ws_url=f"/ws/terminal/{session_id}"),
            container=tabs.get_cell("term_1"),
        )
        term.on_disconnect(lambda payload: print("closed", payload))

    **Terminal bytes never cross into Python.** Keystrokes go from xterm
    straight to the socket, and output goes straight to the screen, entirely
    inside ``assets/terminal.js``. Pyodide is single-threaded on the main
    thread, so an FFI hop per keypress and per output frame is exactly what
    makes a browser terminal feel laggy. This wrapper drives lifecycle only:
    connect, resize, search, focus, tear down.
    """

    def __init__(
        self,
        config: Optional[TerminalConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Terminal requires a container or a root element.")

        require_js("Terminal")
        self.config = config or TerminalConfig()
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Terminal.")

        self.terminal = js.wapyt.Terminal.new(
            root_element,
            js.JSON.parse(json.dumps(self.config.to_dict())),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        target = container
        if target is not None:
            if hasattr(target, "getContainer"):
                return target.getContainer()
            if hasattr(target, "element"):
                return target.element
            return target
        if isinstance(root, str):
            element = js.document.querySelector(root)
            if not element:
                element = js.document.getElementById(root)
            return element
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda *args, **kwargs: handler(*[
            arg.to_py() if hasattr(arg, "to_py") else arg for arg in args
        ], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.terminal.on(event_name, proxy)

    # ------------------------------------------------------------------
    # Event bindings
    # ------------------------------------------------------------------

    def on_ready(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Terminal constructed and xterm assets loaded."""
        self._bind_event("ready", handler)

    def on_connect(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Relay reported a live shell; payload carries ``host``."""
        self._bind_event("connect", handler)

    def on_disconnect(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Socket closed; payload carries ``code`` and ``clean``."""
        self._bind_event("disconnect", handler)

    def on_error(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("error", handler)

    def on_reconnecting(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Backoff started; payload carries ``attempt`` and ``delay``."""
        self._bind_event("reconnecting", handler)

    def on_reconnect_failed(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("reconnect_failed", handler)

    def on_title(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Remote set the window title (OSC 0/2); payload carries ``title``."""
        self._bind_event("title", handler)

    def on_copy(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Selection copied to the clipboard; payload carries ``chars``."""
        self._bind_event("copy", handler)

    def on_clipboard_error(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """The browser refused a copy or paste; payload carries ``action`` and
        a human-readable ``message``."""
        self._bind_event("clipboard_error", handler)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def connect(self) -> None:
        self.terminal.connect()

    def disconnect(self) -> None:
        self.terminal.disconnect()

    def reconnect(self) -> None:
        self.terminal.reconnect()

    def fit(self) -> None:
        """
        Re-measure and push the new size to the relay.

        Call this when the pane becomes visible again — an inactive keep-alive
        tab has no dimensions, and the widget deliberately skips fitting while
        it is hidden.
        """
        self.terminal.fit()

    def focus(self) -> None:
        self.terminal.focus()

    def copy_selection(self) -> None:
        """Copy the current selection (as Ctrl+Shift+C does)."""
        self.terminal.copySelection()

    def paste_clipboard(self) -> None:
        """Paste from the clipboard. The browser may ask the user first."""
        self.terminal.pasteClipboard()

    def write(self, text: str) -> None:
        """Write directly to the screen (local notices, not remote input)."""
        self.terminal.write(text)

    def clear(self) -> None:
        self.terminal.clear()

    def show_search(self) -> None:
        self.terminal.showSearch()

    def hide_search(self) -> None:
        self.terminal.hideSearch()

    def toggle_search(self) -> None:
        self.terminal.toggleSearch()

    def destroy(self) -> None:
        """Close the socket, drop observers and empty the host element."""
        self.terminal.destroy()


__all__ = ["Terminal", "TerminalConfig", "TerminalTheme"]
