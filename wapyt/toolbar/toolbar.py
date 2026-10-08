"""
Toolbar widget: buttons, toggles, one-of-several groups, dropdown and split
buttons, text, separators and spacers, dropping to icons when space runs out.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from ..contextmenu.contextmenu_config import MenuItem, check_unique_ids
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
            ToolbarButton("export", "Export", "mdi-export", items=[
                MenuItem("csv", "CSV"), MenuItem("json", "JSON"),
            ]),
            ToolbarSpacer(),
            ToolbarButton("update", "Update", "mdi-arrow-up-circle",
                          variant="accent", hidden=True),
            ToolbarText("user"),
            ToolbarButton("logout", "Logout", "mdi-logout"),
        ]))
        toolbar.on_click(lambda p: self.on_toolbar(p["id"]))
        toolbar.on_select(lambda p: self.export(p["id"]))   # dropdown picks
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
        proxy = create_proxy(lambda *args, **kwargs: handler(*[to_plain(arg) for arg in args], **kwargs))
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

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        A dropdown item was chosen: ``{"id", "menu"}``, where ``menu`` is the
        toolbar button's id, plus ``checked`` for checkable and group items.
        """
        self._bind_event("select", handler)

    def on_open(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A dropdown opened: ``{"id"}`` (the button's id). Use it to refresh
        the menu with :meth:`set_menu_items` or :meth:`set_disabled` first."""
        self._bind_event("open", handler)

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
        """Disable a button (both parts of a split one) or a dropdown item."""
        self.toolbar.setDisabled(item_id, bool(disabled))

    def set_hidden(self, item_id: str, hidden: bool = True) -> None:
        """Hide a button or a dropdown item."""
        self.toolbar.setHidden(item_id, bool(hidden))

    def is_disabled(self, item_id: str) -> bool:
        return bool(self.toolbar.isDisabled(item_id))

    def is_hidden(self, item_id: str) -> bool:
        return bool(self.toolbar.isHidden(item_id))

    # ------------------------------------------------------------------
    # Dropdowns
    # ------------------------------------------------------------------

    def set_menu_items(self, item_id: str, items: List[MenuItem]) -> None:
        """Replace a dropdown button's menu (for example, recent files)."""
        payload = [item.to_dict() if hasattr(item, "to_dict") else item for item in items]
        check_unique_ids(payload)
        self.toolbar.setMenuItems(item_id, js.JSON.parse(json.dumps(payload)))

    def set_checked(self, item_id: str, checked: bool = True) -> None:
        """Tick a checkable dropdown item, or pick a group item; no event."""
        self.toolbar.setChecked(item_id, bool(checked))

    def is_checked(self, item_id: str) -> bool:
        return bool(self.toolbar.isChecked(item_id))

    def open_menu(self, item_id: str) -> None:
        """Open a dropdown button's menu, focusing its first item."""
        self.toolbar.openMenu(item_id)

    def close_menu(self) -> None:
        self.toolbar.closeMenu()

    def is_menu_open(self, item_id: Optional[str] = None) -> bool:
        """Whether that button's menu (or, without an id, any) is open."""
        return bool(self.toolbar.isMenuOpen(js.undefined if item_id is None else item_id))

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
    "MenuItem",
    "ToolbarConfig",
    "ToolbarButton",
    "ToolbarText",
    "ToolbarSeparator",
    "ToolbarSpacer",
]
