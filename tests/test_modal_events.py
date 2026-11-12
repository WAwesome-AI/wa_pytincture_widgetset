"""CPython tests for ModalWindow's event API (no browser needed)."""
from __future__ import annotations

from wapyt.modal.modal import ModalWindow


def test_modal_has_event_api():
    assert all(hasattr(ModalWindow, name) for name in ("on_show", "on_hide", "on_close", "is_visible"))


def test_backdrop_click_keeps_the_modal_by_default():
    from wapyt.modal.modal import ModalConfig

    assert ModalConfig().to_dict()["closeOnBackdrop"] is False
    assert ModalConfig(close_on_backdrop=True).to_dict()["closeOnBackdrop"] is True
