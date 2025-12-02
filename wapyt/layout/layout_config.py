from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Union


def _ensure_dict(item: Any) -> Any:
    if item is None:
        return None
    if hasattr(item, "to_dict"):
        return item.to_dict()
    if isinstance(item, dict):
        return item
    raise TypeError(f"Unsupported layout configuration entry: {type(item)!r}")


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in mapping.items() if value is not None}


Size = Union[int, float, str]


@dataclass
class CellConfig:
    """
    Declarative configuration for a single layout cell.
    """

    id: Optional[str] = None
    header: Optional[str] = None
    width: Optional[Size] = None
    height: Optional[Size] = None
    css: Optional[str] = None
    collapsible: bool = False
    collapsed: bool = False
    hidden: bool = False
    html: Optional[str] = None
    rows: Optional[Sequence["CellConfig"]] = None
    cols: Optional[Sequence["CellConfig"]] = None
    grow: Optional[float] = None
    shrink: Optional[float] = None
    min_size: Optional[Size] = None

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "header": self.header,
            "width": self.width,
            "height": self.height,
            "css": self.css,
            "collapsible": self.collapsible,
            "collapsed": self.collapsed,
            "hidden": self.hidden,
            "html": self.html,
            "grow": self.grow,
            "shrink": self.shrink,
            "minSize": self.min_size,
        }

        if self.rows is not None:
            data["rows"] = [_ensure_dict(child) for child in self.rows]
        if self.cols is not None:
            data["cols"] = [_ensure_dict(child) for child in self.cols]

        return _clean(data)


@dataclass
class LayoutConfig:
    """
    Top-level layout definition supporting nested rows/columns.
    """

    type: str = "line"
    rows: Optional[Sequence[CellConfig]] = field(default=None)
    cols: Optional[Sequence[CellConfig]] = field(default=None)
    css: Optional[str] = None
    gap: Optional[Size] = None
    borderless: bool = False

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "type": self.type,
            "css": self.css,
            "gap": self.gap,
            "borderless": self.borderless,
        }
        if self.rows is not None:
            payload["rows"] = [_ensure_dict(cell) for cell in self.rows]
        if self.cols is not None:
            payload["cols"] = [_ensure_dict(cell) for cell in self.cols]
        return _clean(payload)
