"""
Tree widget: nested, collapsible nodes with selection and a context menu.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js
from .tree_config import TreeAction, TreeConfig, TreeItem

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


class Tree:
    """
    A nested list of nodes.

    Quick start::

        tree = Tree(
            TreeConfig(
                items=[TreeItem(id="prod", label="Production", items=[
                    TreeItem(id="sess_1", label="web-01", icon="mdi-server"),
                ])],
                filterable=True,
                context_actions=[TreeAction("edit", "Edit", "mdi-pencil", scope="leaf")],
            ),
            container=layout.get_cell("sidebar"),
        )
        tree.on_activate(lambda payload: connect(payload["node"]))

    Expansion state is keyed by node id and survives :meth:`set_items`, so
    reloading the list does not collapse what the user opened. Use
    :meth:`get_expanded` / :meth:`set_expanded` to persist it across sessions.
    """

    def __init__(
        self,
        config: Optional[TreeConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Tree requires a container or a root element.")

        require_js("Tree")
        self.config = config or TreeConfig()
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for Tree.")

        self.tree = js.wapyt.Tree.new(
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
        self.tree.on(event_name, proxy)

    @staticmethod
    def _to_py(value: Any) -> Any:
        return value.to_py() if hasattr(value, "to_py") else value

    # ------------------------------------------------------------------
    # Event bindings
    # ------------------------------------------------------------------

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Node clicked: ``{"id": ..., "node": {...}}``."""
        self._bind_event("select", handler)

    def on_activate(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Leaf double-clicked: ``{"id": ..., "node": {...}}``."""
        self._bind_event("activate", handler)

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Context-menu entry chosen: ``{"action", "id", "node"}``."""
        self._bind_event("action", handler)

    def on_toggle(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Branch opened or closed: ``{"id": ..., "expanded": bool}``."""
        self._bind_event("toggle", handler)

    def on_filter(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("filter", handler)

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    def set_items(self, items: List[TreeItem]) -> None:
        payload = [
            item.to_dict() if hasattr(item, "to_dict") else item for item in items
        ]
        self.tree.setItems(js.JSON.parse(json.dumps(payload)))

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        return self._to_py(self.tree.getNode(node_id))

    def get_parent_id(self, node_id: str) -> Optional[str]:
        return self._to_py(self.tree.getParentId(node_id))

    # ------------------------------------------------------------------
    # Selection and expansion
    # ------------------------------------------------------------------

    def select(self, node_id: Optional[str]) -> None:
        self.tree.select(node_id if node_id is not None else js.undefined)

    def get_selected(self) -> Optional[str]:
        return self._to_py(self.tree.getSelected())

    def expand(self, node_id: str) -> None:
        self.tree.expand(node_id)

    def collapse(self, node_id: str) -> None:
        self.tree.collapse(node_id)

    def toggle(self, node_id: str) -> None:
        self.tree.toggle(node_id)

    def expand_all(self) -> None:
        self.tree.expandAll()

    def collapse_all(self) -> None:
        self.tree.collapseAll()

    def get_expanded(self) -> List[str]:
        return list(self._to_py(self.tree.getExpanded()) or [])

    def set_expanded(self, node_ids: List[str]) -> None:
        self.tree.setExpanded(js.JSON.parse(json.dumps(list(node_ids))))

    # ------------------------------------------------------------------
    # View state
    # ------------------------------------------------------------------

    def set_filter(self, value: str) -> None:
        self.tree.setFilter(value)

    def set_empty_text(self, text: str) -> None:
        self.tree.setEmptyText(text)

    def destroy(self) -> None:
        """Tear down the context menu and its document-level listeners."""
        self.tree.destroy()


__all__ = ["Tree", "TreeConfig", "TreeItem", "TreeAction"]
