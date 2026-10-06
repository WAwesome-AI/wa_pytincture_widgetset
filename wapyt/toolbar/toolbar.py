"""
Toolbar widget: buttons, toggles, one-of-several groups, text, separators and
spacers, dropping to icons when space runs out.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js
from .toolbar_config import (
    ToolbarButton,
    ToolbarConfig,
    ToolbarSeparator,
    ToolbarSpacer,
    ToolbarText,
)

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


def _plain(value: Any) -> Any:
    """
    Convert an event payload to plain Python. ``to_py()`` turns JS ``null``
    into ``JsNull``, which is not ``None``; map it so ``payload["group"] is
    None`` works as documented.
    """
    if hasattr(value, "to_py"):
        value = value.to_py()
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if type(value).__name__ == "JsNull":
        return None
    return value


class Toolbar:
    """
    A row of buttons.

    Quick start::

        toolbar = self.add_toolbar("header", ToolbarConfig(items=[
            ToolbarButton("new", "New connection", "mdi-plus"),
            ToolbarButton("refresh", "Refresh", "mdi-refresh"),
            ToolbarSeparator(),
            ToolbarButton("tabbed", icon="mdi-table-row", tooltip="Tabs",
                          group="layout", active=True, show_label=False),
            ToolbarButton("tiled", icon="mdi-view-grid", tooltip="Tiles",
                          group="layout", show_label=False),
            ToolbarSpacer(),
            ToolbarButton("update", "Update", "mdi-arrow-up-circle",
                          variant="accent", hidden=True),
            ToolbarText("user"),
            ToolbarButton("logout", "Logout", "mdi-logout"),
        ]))
        toolbar.on_click(lambda p: self.on_toolbar(p["id"]))
        toolbar.set_text("user", me["username"])

    Labels, tooltips, badges and text are set as text, never markup.
    """

    def __init__(
        self,
        config: Optional[ToolbarConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Toolbar requires a container or a root element.")

        require_js("Toolbar")
        self.config = config or ToolbarConfig()
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Toolbar.")

        self.toolbar = js.wapyt.Toolbar.new(
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
        proxy = create_proxy(lambda *args, **kwargs: handler(*[_plain(arg) for arg in args], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.toolbar.on(event_name, proxy)

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def on_click(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        A button was clicked: ``{"id", "group", "active"}``. ``active`` is the
        new pressed state for toggle and group buttons, else None.
        """
        self._bind_event("click", handler)

    # ------------------------------------------------------------------
    # Items
    # ------------------------------------------------------------------

    def set_items(self, items: List[Any]) -> None:
        """Replace every item (validated like ``ToolbarConfig.items``)."""
        payload = ToolbarConfig(items=list(items)).to_dict()["items"]
        self.toolbar.setItems(js.JSON.parse(json.dumps(payload)))

    def set_text(self, item_id: str, text: str) -> None:
        """Change a button's label or a text item's text."""
        self.toolbar.setText(item_id, "" if text is None else str(text))

    def set_tooltip(self, item_id: str, tooltip: str) -> None:
        self.toolbar.setTooltip(item_id, tooltip)

    def set_icon(self, item_id: str, icon: str) -> None:
        self.toolbar.setIcon(item_id, icon)

    def set_badge(self, item_id: str, badge: Optional[Union[int, str]]) -> None:
        """Show a badge on a button; ``None`` or ``""`` removes it."""
        self.toolbar.setBadge(item_id, js.undefined if badge is None else badge)

    def set_disabled(self, item_id: str, disabled: bool = True) -> None:
        self.toolbar.setDisabled(item_id, bool(disabled))

    def set_hidden(self, item_id: str, hidden: bool = True) -> None:
        self.toolbar.setHidden(item_id, bool(hidden))

    # ------------------------------------------------------------------
    # Pressed state
    # ------------------------------------------------------------------

    def set_active(self, item_id: str, active: bool = True) -> None:
        """Press or release a toggle; pressing a group button releases the rest."""
        self.toolbar.setActive(item_id, bool(active))

    def is_active(self, item_id: str) -> bool:
        return bool(self.toolbar.isActive(item_id))

    def get_active(self, group: str) -> Optional[str]:
        """The pressed button's id in a group, or None."""
        value = self.toolbar.getActive(group)
        return str(value) if value else None

    def destroy(self) -> None:
        self.toolbar.destroy()


__all__ = [
    "Toolbar",
    "ToolbarConfig",
    "ToolbarButton",
    "ToolbarText",
    "ToolbarSeparator",
    "ToolbarSpacer",
]
