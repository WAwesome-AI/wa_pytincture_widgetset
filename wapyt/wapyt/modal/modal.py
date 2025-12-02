from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional, Union

from wapyt._runtime import js, require_js


@dataclass
class ModalConfig:
    title: str = ""
    width: Union[int, str] = 520
    height: Union[int, str] = 360
    closable: bool = True

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "width": self.width,
            "height": self.height,
            "closable": self.closable,
        }


class ModalWindow:
    def __init__(self, config: Optional[ModalConfig] = None) -> None:
        require_js("ModalWindow")
        config_payload = (config or ModalConfig()).to_dict()
        self.modal = js.wapyt.ModalWindow.new(js.JSON.parse(json.dumps(config_payload)))

    def set_content(self, component: Any) -> None:
        self.modal.setContent(component)

    def set_title(self, title: str) -> None:
        self.modal.setTitle(title)

    def show(self) -> None:
        self.modal.show()

    def hide(self) -> None:
        self.modal.hide()

    def close(self) -> None:
        self.modal.close()
