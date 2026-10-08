from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Union

CHART_TYPES = ("line", "area", "bar", "pie", "doughnut", "polarArea", "scatter", "bubble", "radar")
ARC_TYPES = ("pie", "doughnut", "polarArea")
LEGEND_POSITIONS = ("auto", "top", "bottom", "left", "right", "none")
PALETTE_SIZE = 8

Number = Union[int, float]


def _clean(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the JS defaults win for anything unset."""
    return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class ChartDataset:
    """
    One series.

    Args:
        label: Series name: the legend, the tooltip and the table header. It
            also keys the series' colour, so a series keeps its colour when
            others are filtered out.
        data: Values, one per label (``None`` leaves a gap). Scatter takes
            ``{"x", "y"}`` points, bubble ``{"x", "y", "r"}``.
        color: An explicit colour (hex) instead of the next palette slot.
        colors: For pie, doughnut and polar area: one colour per slice.
        type: Draw this series as another type (``"line"`` over bars, say)
            on the same axis.
        fill: Fill under a line (an area).
        tension: Line curve, 0 (straight, default) to 1.
        stack: Stack group name, to stack some bar series and not others.
        dashed: Dashed line (a target or forecast).
        point_radius: Line / scatter point size; lines with more than 24
            points hide points by default.
        hidden: Start hidden (the legend can show it).
    """

    label: Optional[str] = None
    data: Sequence[Any] = field(default_factory=list)
    color: Optional[str] = None
    colors: Optional[List[str]] = None
    type: Optional[str] = None
    fill: bool = False
    tension: Optional[Number] = None
    stack: Optional[str] = None
    dashed: bool = False
    point_radius: Optional[Number] = None
    hidden: bool = False

    def to_dict(self) -> Dict[str, Any]:
        if self.type is not None and self.type not in CHART_TYPES:
            raise ValueError(f"ChartDataset {self.label!r}: unknown type {self.type!r}")
        return _clean({
            "label": self.label,
            "data": list(self.data),
            "color": self.color,
            "colors": list(self.colors) if self.colors else None,
            "type": self.type,
            "fill": self.fill or None,
            "tension": self.tension,
            "stack": self.stack,
            "dashed": self.dashed or None,
            "pointRadius": self.point_radius,
            "hidden": self.hidden or None,
        })


@dataclass
class ChartConfig:
    """
    A chart, drawn with Chart.js. It fills its container (a layout cell, a
    splitter pane, a dashboard tile) and redraws whenever that container
    changes size.

    Args:
        type: ``line``, ``area``, ``bar``, ``pie``, ``doughnut``,
            ``polarArea``, ``scatter``, ``bubble`` or ``radar``.
        labels: Category labels (x axis; slices for pie-like types).
        datasets: :class:`ChartDataset` entries. Colours come from wapyt's
            8-colour palette in a fixed order, light and dark; more than 8
            series (or pie slices) need explicit colours. Group the rest
            into "Other" rather than inventing a 9th hue.
        title: Drawn above the chart.
        legend: ``auto`` (shown for 2+ series and for pie-like charts),
            ``top`` / ``bottom`` / ``left`` / ``right``, or ``none``.
        stacked: Stack bars or areas.
        horizontal: Horizontal bars.
        x_label / y_label: Axis titles.
        y_min / y_max: Value axis bounds; begin_at_zero: start it at 0
            (default on).
        value_prefix / value_suffix / decimals / compact: How values show on
            the value axis, in tooltips and in the table (``"$"``, ``"%"``,
            2 decimals, ``1.2K``).
        animation: Animate updates (off under reduced motion anyway).
        resize_delay: Milliseconds to wait after the container stops
            changing size before redrawing; raise it if a dashboard resize
            drag feels heavy (default 0: redraw every frame).
        height: A fixed height (pixels or CSS) when the container has none
            of its own; leave unset in a sized cell or dashboard tile.
        table_toggle: A small button that switches between the chart and a
            table of its data. (A screen-reader table is always there.)
        aria_label: Accessible name; defaults to the title and type.
        options: Raw Chart.js options, merged over wapyt's (an escape hatch).

    One value axis only: wapyt does not draw dual-axis charts. Two measures
    of different scale belong in two charts.
    """

    type: str = "line"
    labels: List[Any] = field(default_factory=list)
    datasets: List[ChartDataset] = field(default_factory=list)
    title: Optional[str] = None
    legend: Union[str, bool] = "auto"
    stacked: bool = False
    horizontal: bool = False
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    y_min: Optional[Number] = None
    y_max: Optional[Number] = None
    begin_at_zero: bool = True
    value_prefix: Optional[str] = None
    value_suffix: Optional[str] = None
    decimals: Optional[int] = None
    compact: bool = False
    animation: bool = True
    resize_delay: int = 0
    height: Optional[Union[int, str]] = None
    table_toggle: bool = False
    aria_label: Optional[str] = None
    options: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        if self.type not in CHART_TYPES:
            raise ValueError(f"unknown chart type {self.type!r}; expected one of {', '.join(CHART_TYPES)}")
        legend = "none" if self.legend is False else self.legend
        if legend not in LEGEND_POSITIONS:
            raise ValueError(f"legend must be one of {', '.join(LEGEND_POSITIONS)}; got {self.legend!r}")
        if self.horizontal and self.type != "bar":
            raise ValueError("horizontal applies to bar charts")
        if self.stacked and self.type not in ("bar", "line", "area"):
            raise ValueError("stacked applies to bar, line and area charts")
        datasets = [d.to_dict() if hasattr(d, "to_dict") else d for d in self.datasets]
        check_palette(self.type, list(self.labels), datasets)
        return _clean({
            "type": self.type,
            "labels": list(self.labels),
            "datasets": datasets,
            "title": self.title,
            "legend": legend,
            "stacked": self.stacked or None,
            "horizontal": self.horizontal or None,
            "xLabel": self.x_label,
            "yLabel": self.y_label,
            "yMin": self.y_min,
            "yMax": self.y_max,
            "beginAtZero": None if self.begin_at_zero else False,
            "format": _clean({
                "prefix": self.value_prefix,
                "suffix": self.value_suffix,
                "decimals": self.decimals,
                "compact": self.compact or None,
            }) or None,
            "animation": None if self.animation else False,
            "resizeDelay": self.resize_delay or None,
            "height": self.height,
            "tableToggle": self.table_toggle or None,
            "ariaLabel": self.aria_label,
            "options": self.options or None,
        })


def check_palette(chart_type: str, labels: List[Any], datasets: List[Dict[str, Any]]) -> None:
    """
    Refuse more series (or slices) than the palette has colours, unless they
    bring their own: a 9th colour would repeat or invent a hue, and colour
    is how a reader tells series apart.
    """
    if chart_type in ARC_TYPES:
        uncoloured = [d for d in datasets if not d.get("colors")]
        if uncoloured and len(labels) > PALETTE_SIZE:
            raise ValueError(
                f"{chart_type} chart with {len(labels)} slices: the palette has {PALETTE_SIZE} colours. "
                "Group the smallest into 'Other', or pass colors= on the dataset"
            )
        return
    uncoloured = [d for d in datasets if not d.get("color")]
    if len(uncoloured) > PALETTE_SIZE:
        raise ValueError(
            f"{len(uncoloured)} series without a colour: the palette has {PALETTE_SIZE}. "
            "Group the rest into 'Other', split the chart, or pass color= on each dataset"
        )
