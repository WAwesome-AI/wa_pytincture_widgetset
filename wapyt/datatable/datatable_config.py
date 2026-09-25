from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class ColumnConfig:
    """
    One table column.

    Args:
        id: Row key whose value this column displays.
        header: Header text; defaults to ``id``.
        width: Pixel width (int) or any CSS width (str).
        align: ``left`` · ``center`` · ``right``.
        sortable: Allow click-to-sort on this column.
        sort_by: Row key to sort on instead of ``id``. Use it when ``id`` holds
            a display string — sort a "1.2 MB" column by its byte count, or a
            formatted date by its epoch, so pre-formatting in Python does not
            break ordering.
        type: ``text`` (default) or ``icon``. An ``icon`` column takes an MDI
            class name as its value and renders it as a glyph.
        ellipsis: Truncate with an ellipsis and set a title tooltip
            (default True for text columns).
    """

    id: str
    header: Optional[str] = None
    width: Optional[Union[int, str]] = None
    align: Optional[str] = None
    sortable: bool = True
    sort_by: Optional[str] = None
    type: str = "text"
    ellipsis: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return _clean(
            {
                "id": self.id,
                "header": self.header if self.header is not None else self.id,
                "width": self.width,
                "align": self.align,
                "sortable": self.sortable,
                "sortBy": self.sort_by,
                "type": self.type,
                "ellipsis": self.ellipsis,
            }
        )


@dataclass
class TableAction:
    """
    One entry in the right-click menu.

    Args:
        id: Emitted as ``action`` by ``on_action``.
        label: Visible text.
        icon: MDI class name (``mdi-download``) or a Material Symbols ligature
            name, which ``wapyt.icons`` maps onto MDI.
        danger: Render in the destructive style.
        separator: When True, renders a divider and ignores every other field.
    """

    id: str = ""
    label: Optional[str] = None
    icon: Optional[str] = None
    danger: bool = False
    separator: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if self.separator:
            return {"separator": True}
        return _clean(
            {
                "id": self.id,
                "label": self.label or self.id,
                "icon": self.icon,
                "danger": self.danger or None,
            }
        )


@dataclass
class DataTableConfig:
    """
    Layout and behaviour for :class:`DataTable`.

    Args:
        columns: Column definitions in render order.
        rows: Initial rows (list of dicts).
        id_field: Row key holding the stable row id.
        selection: ``none`` · ``single`` · ``multi``. ``multi`` adds a checkbox
            column and supports ctrl/cmd and shift range clicks.
        sortable: Master switch for click-to-sort.
        sort_by / sort_dir: Initial sort column and direction.
        filterable: Show a filter box that matches across every column.
        filter_placeholder: Placeholder for that box.
        empty_text: Shown when there are no rows.
        loading_text: Shown while ``set_busy(True)``.
        drop_upload: Accept dropped files and emit ``on_drop``.
        context_actions: Right-click menu entries.
        group_dirs_first: Row key (typically ``is_dir``) whose truthy rows are
            kept above the rest whatever the active sort is.
        resizable_columns: Drag a header's right edge to resize its column.
            Once any column is resized every column gets a pixel width, and
            the table takes their sum (scrolling sideways when wider than
            its panel) instead of stretching them to fill it.
        reorderable_columns: Drag a header onto another to move its column.
        min_column_width: Narrowest a resize may make a column, in pixels.
        extra: Additional properties forwarded to JS verbatim.
    """

    columns: List[ColumnConfig] = field(default_factory=list)
    rows: List[Dict[str, Any]] = field(default_factory=list)
    id_field: str = "id"
    selection: str = "single"
    sortable: bool = True
    sort_by: Optional[str] = None
    sort_dir: str = "asc"
    filterable: bool = False
    filter_placeholder: Optional[str] = None
    empty_text: Optional[str] = None
    loading_text: Optional[str] = None
    drop_upload: bool = False
    context_actions: List[TableAction] = field(default_factory=list)
    group_dirs_first: Optional[str] = None
    resizable_columns: bool = False
    reorderable_columns: bool = False
    min_column_width: int = 48
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "columns": [
                item.to_dict() if hasattr(item, "to_dict") else item
                for item in self.columns
            ],
            "rows": list(self.rows or []),
            "idField": self.id_field,
            "selection": self.selection,
            "sortable": self.sortable,
            "sortBy": self.sort_by,
            "sortDir": self.sort_dir,
            "filterable": self.filterable,
            "filterPlaceholder": self.filter_placeholder,
            "emptyText": self.empty_text,
            "loadingText": self.loading_text,
            "dropUpload": self.drop_upload,
            "contextActions": [
                item.to_dict() if hasattr(item, "to_dict") else item
                for item in self.context_actions
            ],
            "groupDirsFirst": self.group_dirs_first,
            "resizableColumns": self.resizable_columns,
            "reorderableColumns": self.reorderable_columns,
            "minColumnWidth": self.min_column_width,
        }
        payload.update(self.extra or {})
        return _clean(payload)
