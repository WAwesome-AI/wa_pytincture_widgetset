from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Set, Union

from wapyt._runtime import js, create_proxy, require_js
from wapyt.resourceboard.resourceboard_config import ResourceBoardConfig


def _sanitize_for_json(value: Any, _stack: Optional[Set[int]] = None) -> Any:
    if _stack is None:
        _stack = set()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    obj_id = id(value)
    if obj_id in _stack:
        return None
    _stack.add(obj_id)
    try:
        if isinstance(value, dict):
            return {key: _sanitize_for_json(val, _stack) for key, val in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [_sanitize_for_json(item, _stack) for item in value]
        if hasattr(value, "to_dict"):
            return _sanitize_for_json(value.to_dict(), _stack)
        return str(value)
    finally:
        _stack.remove(obj_id)


class ResourceBoard:
    def __init__(
        self,
        config: Optional[ResourceBoardConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        #require_js("ResourceBoard")
        if container is None and root is None:
            raise ValueError("ResourceBoard requires either a container or a root element.")

        self.config = config or ResourceBoardConfig()
        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for ResourceBoard.")

        config_payload = self.config.to_dict()
        self.board = js.wapyt.ResourceBoard.new(
            root_element,
            js.JSON.parse(json.dumps(config_payload)),
        )
        self._event_proxies: Dict[str, Any] = {}

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

    def set_items(self, items: List[Any]) -> None:
        payload = []
        for item in items:
            if hasattr(item, "to_dict"):
                payload.append(item.to_dict())
            elif isinstance(item, dict):
                payload.append(item)
            else:
                raise TypeError(f"Unsupported resource item type: {type(item)!r}")
        sanitized = _sanitize_for_json(payload)
        self.board.setItems(js.JSON.parse(json.dumps(sanitized)))

    def select(self, item_id: Optional[str]) -> None:
        self.board.select(item_id)

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda payload=None: handler(payload.to_py() if payload and hasattr(payload, "to_py") else payload))
        self._event_proxies[event_name] = proxy
        self.board.on(event_name, proxy)

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("select", handler)

    def on_add(self, handler: Callable[[], Any]) -> None:
        self._bind_event("add", lambda *_: handler())

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("action", handler)
