"""
Chart widget: Chart.js charts that fill and follow their container.
"""
from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from .._runtime import create_proxy, require_js, to_plain
from .chart_config import ChartConfig, ChartDataset, check_palette

try:  # pragma: no cover - only available inside Pyodide
    import js  # type: ignore
except Exception:  # pragma: no cover - executed on CPython
    js = None  # type: ignore


def _dataset_payload(datasets: Sequence[Union[ChartDataset, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    return [d.to_dict() if hasattr(d, "to_dict") else d for d in datasets]


class Chart:
    """
    A chart in a container.

    Quick start::

        chart = self.add_chart("sales", ChartConfig(
            type="bar", labels=["Q1", "Q2", "Q3", "Q4"], title="Revenue",
            datasets=[ChartDataset("2025", [12, 19, 14, 21]),
                      ChartDataset("2026", [15, 22, 18, 25])],
            value_prefix="$", compact=True,
        ))
        chart.on_click(lambda p: drill_down(p["label"], p["dataset"]))

    It fills its container and redraws whenever the container's size
    changes: a layout splitter, a tab becoming visible, a dashboard tile
    being resized. Give it a container with a height (a layout cell, a grid
    item), or set ``ChartConfig(height=...)``.
    """

    def __init__(
        self,
        config: Optional[ChartConfig] = None,
        *,
        container: Any = None,
        root: Optional[Union[str, Any]] = None,
    ) -> None:
        if container is None and root is None:
            raise ValueError("Chart requires a container or a root element.")
        require_js("Chart")
        self.config = config or ChartConfig()
        self._event_proxies: Dict[str, List[Any]] = {}
        target = self._resolve_root(container=container, root=root)
        if target is None:
            raise RuntimeError("Unable to resolve root element for Chart.")
        self.chart = js.wapyt.Chart.new(target, js.JSON.parse(json.dumps(self.config.to_dict())))

    def _resolve_root(self, *, container: Any, root: Optional[Union[str, Any]]) -> Any:
        if container is not None:
            if hasattr(container, "getContainer"):
                return container.getContainer()
            if hasattr(container, "element"):
                return container.element
            return container
        if isinstance(root, str):
            return js.document.querySelector(root) or js.document.getElementById(root)
        return root

    def _bind_event(self, event_name: str, handler: Callable) -> None:
        proxy = create_proxy(lambda payload=None: handler(to_plain(payload)))
        self._event_proxies.setdefault(event_name, []).append(proxy)
        self.chart.on(event_name, proxy)

    # Events ------------------------------------------------------------

    def on_click(self, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """A bar, point or slice was clicked:
        ``{"dataset", "dataset_index", "label", "index", "value"}``."""
        self._bind_event("click", handler)

    # Data --------------------------------------------------------------

    def set_data(
        self,
        labels: Optional[Sequence[Any]] = None,
        datasets: Optional[Sequence[Union[ChartDataset, Dict[str, Any]]]] = None,
    ) -> None:
        """Replace the labels and / or datasets. A series keeps its colour
        (colours follow the label), so filtering never repaints the rest."""
        payload = None if datasets is None else _dataset_payload(datasets)
        if payload is not None:
            check_palette(self.config.type, list(labels if labels is not None else self.config.labels), payload)
        self.chart.setData(
            js.undefined if labels is None else js.JSON.parse(json.dumps(list(labels))),
            js.undefined if payload is None else js.JSON.parse(json.dumps(payload)),
        )

    def update_dataset(self, key: Union[int, str], data: Sequence[Any]) -> None:
        """Replace one series' values, by index or label."""
        self.chart.updateDataset(key, js.JSON.parse(json.dumps(list(data))))

    def append(self, label: Any, values: Union[Any, Sequence[Any]], max_points: Optional[int] = None) -> None:
        """
        Add one point per series at the end (``values`` in dataset order, or
        one value for a single series), dropping the oldest beyond
        ``max_points``: a live feed.
        """
        if not isinstance(values, (list, tuple)):
            values = [values]
        self.chart.append(label, js.JSON.parse(json.dumps(list(values))), max_points or 0)

    def set_title(self, title: Optional[str]) -> None:
        self.chart.setTitle(title or "")

    def set_type(self, chart_type: str) -> None:
        """Redraw as another type (bar <-> line, say), same data."""
        ChartConfig(type=chart_type).to_dict()  # validates the name
        self.config.type = chart_type
        self.chart.setType(chart_type)

    def set_options(self, options: Dict[str, Any]) -> None:
        """Merge raw Chart.js options in and redraw."""
        self.chart.setOptions(js.JSON.parse(json.dumps(options)))

    # View --------------------------------------------------------------

    def resize(self) -> None:
        """Redraw at the container's size now. Not needed normally (a
        ResizeObserver does it); for a dashboard's resize-stop hook."""
        self.chart.resize()

    def show_table(self, show: bool = True) -> None:
        """Show the data as a table instead of the chart (or back)."""
        self.chart.showTable(bool(show))

    def to_image(self) -> str:
        """The chart as a PNG data URL."""
        return str(self.chart.toImage())

    def destroy(self) -> None:
        self.chart.destroy()
        for proxies in self._event_proxies.values():
            for proxy in proxies:
                try:
                    proxy.destroy()
                except Exception:
                    pass
        self._event_proxies.clear()


__all__ = ["Chart", "ChartConfig", "ChartDataset"]
