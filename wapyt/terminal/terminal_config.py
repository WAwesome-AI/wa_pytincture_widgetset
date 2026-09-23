from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class TerminalTheme:
    """
    xterm colour theme. Every field is optional; unset entries fall back to
    xterm's own defaults.
    """

    background: Optional[str] = None
    foreground: Optional[str] = None
    cursor: Optional[str] = None
    cursor_accent: Optional[str] = None
    selection_background: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return _clean(
            {
                "background": self.background,
                "foreground": self.foreground,
                "cursor": self.cursor,
                "cursorAccent": self.cursor_accent,
                "selectionBackground": self.selection_background,
            }
        )


@dataclass
class TerminalConfig:
    """
    Controls :class:`Terminal` rendering and its WebSocket transport.

    Args:
        ws_url: WebSocket endpoint for the shell relay. A path such as
            ``"/ws/terminal/7"`` is resolved against the current origin, so it
            follows http/https to ws/wss automatically. When omitted the
            terminal renders but does not connect; call ``connect()`` later.
        asset_base: Origin-relative directory serving ``xterm.js``,
            ``xterm.css``, ``addon-fit.js`` and (optionally)
            ``addon-search.js``. xterm is deliberately *not* bundled into the
            widgetset — see the note in ``assets/terminal.js``.
        font_family: CSS font stack for the terminal grid.
        font_size: Font size in pixels.
        scrollback: Lines of scrollback retained.
        theme: Optional :class:`TerminalTheme`.
        search: Load the search addon and bind Ctrl+F to the search bar.
        reconnect: Reconnect automatically when the socket drops.
        reconnect_max_attempts: Give up after this many consecutive failures.
        reconnect_base_ms: First backoff delay; doubles per attempt.
        cursor_blink: Whether the cursor blinks.
        extra: Additional properties forwarded to JS verbatim.
    """

    ws_url: Optional[str] = None
    asset_base: str = "/xterm"
    font_family: Optional[str] = None
    font_size: Optional[int] = None
    scrollback: Optional[int] = None
    theme: Optional[TerminalTheme] = None
    search: bool = True
    reconnect: bool = True
    reconnect_max_attempts: int = 5
    reconnect_base_ms: int = 1000
    cursor_blink: bool = True
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "wsUrl": self.ws_url,
            "assetBase": self.asset_base,
            "fontFamily": self.font_family,
            "fontSize": self.font_size,
            "scrollback": self.scrollback,
            "theme": self.theme.to_dict() if self.theme is not None else None,
            "search": self.search,
            "reconnect": self.reconnect,
            "reconnectMaxAttempts": self.reconnect_max_attempts,
            "reconnectBaseMs": self.reconnect_base_ms,
            "cursorBlink": self.cursor_blink,
        }
        payload.update(self.extra or {})
        return _clean(payload)
