"""CPython tests for ProgressBar config and progress_html (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import ProgressBarConfig, progress_html


def test_exported_with_add_helper():
    import wapyt
    from wapyt.layout.layout import Layout

    assert {"ProgressBar", "ProgressBarConfig", "progress_html"} <= set(wapyt.__all__)
    assert hasattr(Layout, "add_progressbar")


def test_config_defaults():
    assert ProgressBarConfig().to_dict() == {
        "value": 0, "max": 100, "showValue": True, "state": "active",
        "indeterminate": False, "compact": False,
    }


def test_config_options_are_camel_cased():
    payload = ProgressBarConfig(value=3, max=8, label="a.txt", value_text="3/8", state="paused",
                                indeterminate=True, compact=True, show_value=False).to_dict()
    assert payload["valueText"] == "3/8" and payload["showValue"] is False
    assert payload["state"] == "paused" and payload["compact"] is True


def test_config_rejects_bad_state_and_max():
    with pytest.raises(ValueError, match="state must be one of"):
        ProgressBarConfig(state="failed").to_dict()
    with pytest.raises(ValueError, match="max must not be negative"):
        ProgressBarConfig(max=-1).to_dict()


def test_progress_html_escapes_and_reports():
    markup = progress_html(42, label='disk "/" <root>')
    assert 'aria-valuenow="42"' in markup and 'aria-valuemax="100"' in markup
    assert "width:42.00%" in markup and ">42%<" in markup
    assert "&lt;root&gt;" in markup and "<root>" not in markup
    assert 'aria-label="disk &quot;/&quot; &lt;root&gt;"' in markup


def test_progress_html_fraction_and_clamping():
    assert "width:42.00%" in progress_html(0.42, 1)
    assert "width:100.00%" in progress_html(5, 2)
    assert "width:0.00%" in progress_html(-3)


def test_progress_html_text_state_and_hidden_value():
    markup = progress_html(10, text="10 of 40 MB", state="done", compact=False)
    assert 'data-state="done"' in markup and "10 of 40 MB" in markup
    assert 'data-compact' not in markup
    assert '<span class="wapyt-progress-value" hidden>' in progress_html(10, show_value=False)


def test_progress_html_zero_max_does_not_divide_by_zero():
    assert "width:0.00%" in progress_html(0, 0)


def test_label_and_value_widths():
    payload = ProgressBarConfig(label_width=120, value_width="7em").to_dict()
    assert payload["labelWidth"] == 120 and payload["valueWidth"] == "7em"
    assert "labelWidth" not in ProgressBarConfig().to_dict()
