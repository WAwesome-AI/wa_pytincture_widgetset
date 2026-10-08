"""CPython tests for the Window config (no browser needed)."""
from __future__ import annotations

import wapyt
from wapyt import WindowConfig


def test_window_is_exported():
    assert {"Window", "WindowConfig"} <= set(wapyt.__all__)


def test_defaults():
    payload = WindowConfig().to_dict()
    assert payload["width"] == 480 and payload["height"] == 320 and payload["modal"] is False
    assert "left" not in payload and "top" not in payload and "maxWidth" not in payload


def test_options_are_camel_cased():
    payload = WindowConfig(title="Q", left=10, top=20, min_width=300, max_height=600, modal=True,
                           maximizable=False, maximized=True, footer=True, dispose_on_close=True).to_dict()
    assert (payload["left"], payload["top"], payload["minWidth"], payload["maxHeight"]) == (10, 20, 300, 600)
    assert payload["modal"] and payload["maximized"] and payload["footer"] and payload["disposeOnClose"]
    assert payload["maximizable"] is False
