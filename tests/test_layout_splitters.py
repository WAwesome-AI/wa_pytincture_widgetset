"""CPython tests for resizable layout cells (no browser needed)."""
from __future__ import annotations

from wapyt import CellConfig, LayoutConfig


def test_resizable_and_max_size_only_sent_when_set():
    assert "resizable" not in CellConfig(id="a").to_dict()
    assert "maxSize" not in CellConfig(id="a").to_dict()
    payload = CellConfig(id="a", width=240, resizable=True, min_size=160, max_size="40%").to_dict()
    assert payload["resizable"] is True and payload["minSize"] == 160 and payload["maxSize"] == "40%"


def test_nested_cells_keep_resizable():
    layout = LayoutConfig(cols=[
        CellConfig(id="side", width=240, resizable=True),
        CellConfig(id="main", rows=[CellConfig(id="editor"), CellConfig(id="console", height=160, resizable=True)]),
    ]).to_dict()
    assert layout["cols"][0]["resizable"] is True
    assert layout["cols"][1]["rows"][1]["resizable"] is True


def test_layout_has_size_api():
    from wapyt.layout.layout import Layout

    assert all(hasattr(Layout, name) for name in ("on_resize", "set_size", "get_size"))
