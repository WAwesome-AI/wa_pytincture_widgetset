from __future__ import annotations

import json
from typing import Any, Callable, Dict, Optional, Union

from wapyt._runtime import js, create_proxy, require_js
from wapyt.sidebar.sidebar_config import SidebarConfig


class Sidebar:
    def __init__(
        self,
        config: Optional[SidebarConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        require_js("Sidebar")
        if container is None and root is None:
            raise ValueError("Sidebar requires either a container or a root element.")

        self.config = config or SidebarConfig()
        self._event_proxies: Dict[str, Any] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Sidebar.")

        config_payload = self.config.to_dict()
        self.sidebar = js.wapyt.Sidebar.new(
            root_element,
            js.JSON.parse(json.dumps(config_payload)),
        )

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
        proxy = create_proxy(lambda payload=None: handler(payload.to_py() if payload and hasattr(payload, "to_py") else payload))
        self._event_proxies[event_name] = proxy
        self.sidebar.on(event_name, proxy)

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("select", handler)

    def collapse(self) -> None:
        self.sidebar.collapse()

    def expand(self) -> None:
        self.sidebar.expand()

    def toggle(self) -> None:
        self.sidebar.toggle()

    def set_active(self, item_id: str) -> None:
        self.sidebar.setActive(item_id)

    def get_active(self) -> Optional[str]:
        value = self.sidebar.getActive()
        return value if isinstance(value, str) else (value.to_py() if hasattr(value, "to_py") else value)
