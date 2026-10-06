from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from wapyt._runtime import js, create_proxy, require_js, to_plain
from wapyt.sidebar.sidebar_config import SidebarConfig, _entry


class Sidebar:
    """
    Collapsible navigation rail that emits `select` events.

    Quick start::

        sidebar = layout.add_sidebar("nav", SidebarConfig(items=[...]))
        sidebar.on_select(lambda item: print("Selected", item["id"]))
        sidebar.set_active("home")

    Groups are items with ``items``: they expand in place, or open as a flyout
    when the sidebar is collapsed to icons. Arrow keys move between visible
    items; Right / Left open and close a group or step to its parent.
    """
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
        proxy = create_proxy(lambda payload=None: handler(to_plain(payload)))
        # A list per event: a second handler used to replace the first proxy
        # in this dict while both stayed registered in JS.
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.sidebar.on(event_name, proxy)

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """An item (not a group) was clicked: ``{"id", "data"}``."""
        self._bind_event("select", handler)

    def on_toggle(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A group was opened or closed by the person: ``{"id", "expanded",
        "expanded_ids"}``; save ``expanded_ids`` to restore the tree."""
        self._bind_event("toggle", handler)

    def on_collapse(self, handler: Callable[..., Any]) -> None:
        self._bind_event("collapse", handler)

    def on_expand(self, handler: Callable[..., Any]) -> None:
        self._bind_event("expand", handler)

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
        return to_plain(value)

    def expand_group(self, group_id: str) -> None:
        self.sidebar.expandGroup(group_id)

    def collapse_group(self, group_id: str) -> None:
        self.sidebar.collapseGroup(group_id)

    def get_expanded(self) -> List[str]:
        """Ids of the open groups."""
        return list(to_plain(self.sidebar.getExpanded()) or [])

    def set_expanded(self, group_ids: List[str]) -> None:
        """Open exactly these groups (and close the rest)."""
        self.sidebar.setExpanded(js.JSON.parse(json.dumps(list(group_ids))))

    def set_badge(self, item_id: str, badge: Optional[Union[str, int]]) -> None:
        """Set or (with ``None`` / ``""``) clear an item's badge."""
        self.sidebar.setBadge(item_id, js.JSON.parse(json.dumps(badge)))

    def set_items(self, items: List[Any]) -> None:
        """Replace the entries, keeping open groups and the active item."""
        self.sidebar.setItems(js.JSON.parse(json.dumps([_entry(item) for item in items])))

    def destroy(self) -> None:
        self.sidebar.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()
