from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

from wapyt._runtime import js, create_proxy, require_js


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class TabConfig:
    """
    Describes a single tab strip entry.

    Args:
        id: Unique identifier for the tab.
        title: Visible label.
        icon: Optional CSS class name for leading icon.
        closable: Whether the close icon should appear.
        badge: Optional numeric or string badge.
        disabled: Prevents interaction when True.
        html: Static markup injected when the tab renders.
    """
    id: str
    title: str
    icon: Optional[str] = None
    closable: bool = False
    badge: Optional[Union[int, str]] = None
    disabled: bool = False
    html: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return _clean(
            {
                "id": self.id,
                "title": self.title,
                "icon": self.icon,
                "closable": self.closable,
                "badge": self.badge,
                "disabled": self.disabled,
                "html": self.html,
            }
        )


@dataclass
class TabWidgetConfig:
    """
    Layout/behavior options for :class:`TabWidget`.

    Args:
        tabs: Initial list of :class:`TabConfig`.
        active: Tab ID that should start active.
        orientation: ``"top"`` or ``"left"`` (defaults to ``"top"``).
        fill_height: Stretch panel to consume vertical space.
        keep_alive: Whether hidden tabs stay mounted.
        extra: Additional properties forwarded to JS (feature flags).
    """
    tabs: List[TabConfig] = field(default_factory=list)
    active: Optional[str] = None
    orientation: str = "top"
    fill_height: bool = True
    keep_alive: bool = True
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "tabs": [tab.to_dict() if hasattr(tab, "to_dict") else tab for tab in self.tabs],
            "active": self.active,
            "orientation": self.orientation,
            "fillHeight": self.fill_height,
            "keepAlive": self.keep_alive,
        }
        payload.update(self.extra or {})
        return _clean(payload)


class TabWidget:
    """
    Minimal tab system.

    Quick start::

        tabs = layout.add_tabwidget("body", TabWidgetConfig(
            tabs=[TabConfig(id="chat", title="Chat")]
        ))
        tabs.attach_html("chat", "<h1>Hello</h1>")
        tabs.on_change(lambda tab_id: print("Active tab:", tab_id))
    """

    def __init__(
        self,
        config: Optional[TabWidgetConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("TabWidget requires a container or a root element.")

        require_js("TabWidget")
        self.config = config or TabWidgetConfig()
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for TabWidget.")

        config_payload = self.config.to_dict()
        self.tabwidget = js.wapyt.TabWidget.new(
            root_element,
            js.JSON.parse(json.dumps(config_payload)),
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
        self.tabwidget.on(event_name, proxy)

    # ------------------------------------------------------------------
    # Event bindings
    # ------------------------------------------------------------------

    def on_change(self, handler: Callable[[str], Any]) -> None:
        self._bind_event("change", handler)

    def on_close(self, handler: Callable[[str], Any]) -> None:
        self._bind_event("close", handler)

    def on_ready(self, handler: Callable[[], Any]) -> None:
        self._bind_event("ready", handler)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_tab(self, tab: Union[TabConfig, Dict[str, Any]], index: Optional[int] = None) -> None:
        payload = tab.to_dict() if hasattr(tab, "to_dict") else tab
        self.tabwidget.addTab(js.JSON.parse(json.dumps(payload)), index if index is not None else js.undefined)

    def remove_tab(self, tab_id: str) -> None:
        self.tabwidget.removeTab(tab_id)

    def set_active(self, tab_id: str) -> None:
        self.tabwidget.setActive(tab_id)

    def get_active(self) -> Optional[str]:
        result = self.tabwidget.getActive()
        return result if isinstance(result, str) else (result.to_py() if hasattr(result, "to_py") else result)

    def attach_html(self, tab_id: str, html: str) -> None:
        self.tabwidget.attachHTML(tab_id, html)

    def attach(self, tab_id: str, component: Any) -> None:
        self.tabwidget.attach(tab_id, component)

    def set_badge(self, tab_id: str, badge: Optional[Union[int, str]]) -> None:
        self.tabwidget.setBadge(tab_id, badge)

    def disable_tab(self, tab_id: str) -> None:
        self.tabwidget.disableTab(tab_id)

    def enable_tab(self, tab_id: str) -> None:
        self.tabwidget.enableTab(tab_id)

    def get_cell(self, tab_id: str) -> Any:
        return self.tabwidget.getCell(tab_id)
