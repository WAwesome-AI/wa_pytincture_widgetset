"""CPython tests for Form.clear / Form.reset (no browser needed)."""
from __future__ import annotations

from wapyt.form.form import Form


def test_form_has_clear_and_reset():
    assert hasattr(Form, "clear") and hasattr(Form, "reset")
