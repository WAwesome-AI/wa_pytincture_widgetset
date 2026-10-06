"""
ProgressBar widget: determinate or indeterminate, with a label, a value text
and active / done / error / paused states.
"""
from __future__ import annotations

import json
from typing import Any, Optional, Union

from .._runtime import require_js
from .progressbar_config import STATES, ProgressBarConfig, _check_state, progress_html

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore

Number = Union[int, float]


class ProgressBar:
    """
    A progress bar.

    Quick start::

        bar = ProgressBar(ProgressBarConfig(label="report.pdf", compact=True),
                          container=row_element)
        bar.set_value(seen, total, text=f"{seen * 100 // total}%  {format_size(seen)}")
        bar.set_state("done")

    Updates only touch the bar's width and two text nodes, so calling
    ``set_value`` from a transfer's progress callback several times a second
    is fine. The total unknown? ``set_indeterminate(True)`` and pass the bytes
    moved as ``text``. For static HTML (a dashboard tile built as a string)
    use :func:`progress_html` instead.
    """

    def __init__(
        self,
        config: Optional[ProgressBarConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("ProgressBar requires a container or a root element.")
        require_js("ProgressBar")
        self.config = config or ProgressBarConfig()
        root_element = self._resolve_root(container=container, root=root)
        if root_element is None:
            raise RuntimeError("Unable to resolve root element for ProgressBar.")
        self.bar = js.wapyt.ProgressBar.new(root_element, js.JSON.parse(json.dumps(self.config.to_dict())))

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

    def set_value(self, value: Number, max: Optional[Number] = None, *, text: Optional[str] = None) -> None:
        """
        Move the bar. ``max`` changes the total; ``text`` replaces the
        percentage readout (``""`` returns to the percentage).
        """
        self.bar.setValue(
            value,
            js.undefined if max is None else max,
            js.undefined if text is None else str(text),
        )

    def set_label(self, label: Optional[str]) -> None:
        self.bar.setLabel("" if label is None else str(label))

    def set_state(self, state: str) -> None:
        """``active``, ``done``, ``error`` or ``paused``."""
        self.bar.setState(_check_state(state))

    def set_indeterminate(self, indeterminate: bool = True) -> None:
        self.bar.setIndeterminate(bool(indeterminate))

    def destroy(self) -> None:
        self.bar.destroy()


__all__ = ["ProgressBar", "ProgressBarConfig", "progress_html", "STATES"]
