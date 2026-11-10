from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Set, Union

from wapyt._base import WidgetBase
from wapyt._runtime import js, require_js
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


class ResourceBoard(WidgetBase):
    """
    Master/detail browser for resources with select/add/action events.

    Quick start::

        board = layout.add_resourceboard("resources", ResourceBoardConfig(items=[...]))
        board.on_select(lambda item: print("Row selected:", item["id"]))
        board.on_action(lambda payload: handle(payload["action"], payload["id"]))
    """

    _js_attr = "board"
    def __init__(
        self,
        config: Optional[ResourceBoardConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        require_js("ResourceBoard")
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

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("select", handler)

    def on_add(self, handler: Callable[[], Any]) -> None:
        self._bind_event("add", lambda *_: handler())

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("action", handler)
