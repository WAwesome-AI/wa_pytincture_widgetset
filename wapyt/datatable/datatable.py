"""
DataTable widget: sortable, filterable, selectable rows with a context menu.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Union

from .._runtime import create_proxy, require_js, to_plain
from .datatable_config import ColumnConfig, DataTableConfig, TableAction

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


class DataTable:
    """
    A tabular list of dict rows.

    Quick start::

        table = DataTable(
            DataTableConfig(
                columns=[
                    ColumnConfig(id="name", header="Name"),
                    ColumnConfig(id="size", header="Size", align="right",
                                 sort_by="size_bytes"),
                ],
                selection="multi",
                group_dirs_first="is_dir",
                context_actions=[TableAction("download", "Download", "mdi-download")],
            ),
            container=tabs.get_cell("files"),
        )
        table.set_rows(entries)
        table.on_activate(lambda payload: navigate(payload["row"]))

    Sorting and filtering run entirely in the browser against the rows already
    loaded — no round trip. Pre-format values in Python (``size`` as "1.2 MB")
    and point ``sort_by`` at the raw field so ordering stays correct.
    """

    def __init__(
        self,
        config: Optional[DataTableConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("DataTable requires a container or a root element.")

        require_js("DataTable")
        self.config = config or DataTableConfig()
        self._event_proxies: Dict[str, List[Any]] = {}

        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for DataTable.")

        self.datatable = js.wapyt.DataTable.new(
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
            to_plain(arg) for arg in args
        ], **kwargs))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.datatable.on(event_name, proxy)

    @staticmethod
    def _to_py(value: Any) -> Any:
        return to_plain(value)

    # ------------------------------------------------------------------
    # Event bindings
    # ------------------------------------------------------------------

    def on_select(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Selection changed: ``{"ids": [...], "id": ..., "rows": [...]}``."""
        self._bind_event("select", handler)

    def on_activate(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Row double-clicked: ``{"id": ..., "row": {...}}``. A double-click
        on an editable cell edits it instead."""
        self._bind_event("activate", handler)

    def on_edit(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        A cell was edited and saved locally: ``{"id", "column", "value",
        "old_value", "row"}``. ``value`` is typed by the editor: a number for
        ``number`` (``None`` when emptied), a bool for ``checkbox``, otherwise
        a string (``date`` as ``YYYY-MM-DD``). Persist it; if the server
        refuses, put the old value back with :meth:`set_cell` and say why with
        :meth:`set_cell_error`.
        """
        self._bind_event("edit", handler)

    def on_action(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """Context-menu entry chosen: ``{"action", "id", "row", "selected"}``."""
        self._bind_event("action", handler)

    def on_sort(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("sort", handler)

    def on_filter(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._bind_event("filter", handler)

    def on_columns(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        A column was resized or moved (``resizable_columns`` /
        ``reorderable_columns``). Payload: ``{reason: "resize"|"reorder",
        column, columns: [{id, width}]}`` in display order; ``width`` is None
        for a column that has no pixel width yet.
        """
        self._bind_event("columns", handler)

    def on_drop(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """
        Files dropped onto the table: ``{"files": [{"name", "size", "type"}]}``.

        The payload carries metadata only. A ``File`` object cannot usefully
        cross the Pyodide FFI, so read the handles back with
        :meth:`get_dropped_files` and hand them to a plain upload endpoint
        rather than trying to move the bytes through Python.
        """
        self._bind_event("drop", handler)

    # ------------------------------------------------------------------
    # Data
    # ------------------------------------------------------------------

    def set_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.datatable.setRows(js.JSON.parse(json.dumps(rows)))

    def get_rows(self) -> List[Dict[str, Any]]:
        return self._to_py(self.datatable.getRows())

    def get_row(self, row_id: str) -> Optional[Dict[str, Any]]:
        return self._to_py(self.datatable.getRow(row_id))

    def set_cell(self, row_id: str, column_id: str, value: Any) -> None:
        """Set one cell's value and redraw just that cell; does not fire
        ``on_edit``."""
        self.datatable.setCell(str(row_id), column_id, js.JSON.parse(json.dumps(value)))

    def set_cell_error(self, row_id: str, column_id: str, message: Optional[str]) -> None:
        """Mark a cell invalid with ``message`` as its tooltip; ``None`` clears
        it. The mark survives re-renders and clears when the cell is edited."""
        self.datatable.setCellError(str(row_id), column_id, js.JSON.parse(json.dumps(message)))

    def edit_cell(self, row_id: str, column_id: str) -> bool:
        """Open the editor on a cell, e.g. the name of a row just added."""
        return bool(self.datatable.editCell(str(row_id), column_id))

    def cancel_edit(self) -> None:
        """Close an open editor without saving."""
        self.datatable.cancelEdit()

    def set_columns(self, columns: List[ColumnConfig]) -> None:
        payload = [
            column.to_dict() if hasattr(column, "to_dict") else column
            for column in columns
        ]
        self.datatable.setColumns(js.JSON.parse(json.dumps(payload)))

    def get_column_state(self) -> List[Dict[str, Any]]:
        """``[{id, width}]`` in display order (see :meth:`on_columns`)."""
        return list(self._to_py(self.datatable.getColumnState()) or [])

    def move_column(self, column_id: str, target_id: str, after: bool = False) -> None:
        """Move a column before (or ``after``) another. Emits ``columns``."""
        self.datatable.moveColumn(column_id, target_id, after)

    def get_dropped_files(self) -> Any:
        """The raw JS ``File`` handles from the most recent drop."""
        return self.datatable.getDroppedFiles()

    # ------------------------------------------------------------------
    # Selection
    # ------------------------------------------------------------------

    def get_selected_ids(self) -> List[str]:
        return list(self._to_py(self.datatable.getSelectedIds()) or [])

    def get_selected_rows(self) -> List[Dict[str, Any]]:
        return list(self._to_py(self.datatable.getSelectedRows()) or [])

    def select(self, ids: Union[str, List[str]]) -> None:
        payload = ids if isinstance(ids, list) else [ids]
        self.datatable.select(js.JSON.parse(json.dumps(payload)))

    def clear_selection(self) -> None:
        self.datatable.clearSelection()

    # ------------------------------------------------------------------
    # View state
    # ------------------------------------------------------------------

    def sort(self, column_id: str, direction: Optional[str] = None) -> None:
        self.datatable.sort(column_id, direction if direction else js.undefined)

    def set_filter(self, value: str) -> None:
        self.datatable.setFilter(value)

    def set_busy(self, busy: bool = True) -> None:
        self.datatable.setBusy(busy)

    def set_empty_text(self, text: str) -> None:
        self.datatable.setEmptyText(text)

    def destroy(self) -> None:
        """Tear down the context menu and its document-level listeners."""
        self.datatable.destroy()


__all__ = ["DataTable", "DataTableConfig", "ColumnConfig", "TableAction"]
