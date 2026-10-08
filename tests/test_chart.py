"""CPython tests for the Chart config (no browser needed)."""
from __future__ import annotations

import pytest

import wapyt
from wapyt import ChartConfig, ChartDataset


def test_exported_with_a_layout_helper():
    from wapyt.layout.layout import Layout
    assert {"Chart", "ChartConfig", "ChartDataset"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_chart")


def test_defaults_are_minimal():
    assert ChartConfig().to_dict() == {"type": "line", "labels": [], "datasets": [], "legend": "auto"}
    assert ChartDataset("a", [1, 2]).to_dict() == {"label": "a", "data": [1, 2]}


def test_options_are_camel_cased():
    payload = ChartConfig(type="bar", labels=["Q1"], datasets=[ChartDataset("x", [1], color="#123456")],
                          title="T", legend="bottom", stacked=True, horizontal=True, x_label="Quarter",
                          y_label="$", y_min=0, y_max=10, begin_at_zero=False, value_prefix="$", decimals=1,
                          compact=True, animation=False, resize_delay=80, height=240, table_toggle=True,
                          aria_label="Rev", options={"plugins": {"legend": {"align": "end"}}}).to_dict()
    assert payload["format"] == {"prefix": "$", "decimals": 1, "compact": True}
    assert (payload["stacked"], payload["horizontal"], payload["beginAtZero"], payload["animation"]) == (True, True, False, False)
    assert (payload["resizeDelay"], payload["height"], payload["tableToggle"]) == (80, 240, True)
    assert payload["options"] == {"plugins": {"legend": {"align": "end"}}}


def test_dataset_options():
    payload = ChartDataset("t", [1, None], type="line", fill=True, tension=0.3, stack="a", dashed=True,
                           point_radius=0, hidden=True).to_dict()
    assert payload == {"label": "t", "data": [1, None], "type": "line", "fill": True, "tension": 0.3,
                       "stack": "a", "dashed": True, "pointRadius": 0, "hidden": True}


@pytest.mark.parametrize("bad", [dict(type="gauge"), dict(legend="middle"), dict(type="line", horizontal=True),
                                 dict(type="pie", stacked=True)])
def test_invalid_configs(bad):
    with pytest.raises(ValueError):
        ChartConfig(**bad).to_dict()


def test_legend_false_means_none():
    assert ChartConfig(legend=False).to_dict()["legend"] == "none"


def test_more_series_than_palette_colours_is_refused():
    series = [ChartDataset(f"s{i}", [i]) for i in range(9)]
    with pytest.raises(ValueError, match="palette has 8"):
        ChartConfig(datasets=series).to_dict()
    coloured = series[:8] + [ChartDataset("s8", [8], color="#777777")]
    ChartConfig(datasets=coloured).to_dict()


def test_pie_slices_beyond_the_palette_need_colours():
    labels = [f"l{i}" for i in range(9)]
    with pytest.raises(ValueError, match="9 slices"):
        ChartConfig(type="pie", labels=labels, datasets=[ChartDataset("x", list(range(9)))]).to_dict()
    ChartConfig(type="pie", labels=labels, datasets=[ChartDataset("x", list(range(9)), colors=["#111111"] * 9)]).to_dict()
