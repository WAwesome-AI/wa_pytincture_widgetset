"""CPython tests for ModalWindow's event API (no browser needed)."""
from __future__ import annotations

from wapyt.modal.modal import ModalWindow


def test_modal_has_event_api():
    assert all(hasattr(ModalWindow, name) for name in ("on_show", "on_hide", "on_close", "is_visible"))
