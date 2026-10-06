"""CPython tests for the pure half of wapyt.message (no browser needed)."""
from __future__ import annotations

import pytest

from wapyt import message
from wapyt.message import dialog_options, toast_options


def test_message_is_exported_from_the_package():
    import wapyt

    assert wapyt.message is message
    assert "message" in wapyt.__all__


def test_toast_defaults():
    assert toast_options() == {"kind": "info", "timeoutMs": 4000}


@pytest.mark.parametrize("kind", ["info", "success", "warning", "error"])
def test_toast_accepts_every_kind(kind):
    assert toast_options(kind)["kind"] == kind


def test_toast_rejects_an_unknown_kind():
    with pytest.raises(ValueError, match="kind must be one of"):
        toast_options("danger")


def test_toast_zero_timeout_means_sticky_and_negative_is_rejected():
    assert toast_options(timeout_ms=0)["timeoutMs"] == 0
    with pytest.raises(ValueError):
        toast_options(timeout_ms=-1)


def test_confirm_options_are_camel_cased_and_minimal():
    assert dialog_options("confirm", "Drop it?") == {"kind": "confirm", "text": "Drop it?"}
    assert dialog_options(
        "confirm", "Drop it?", title="Drop", ok_text="Drop", cancel_text="Keep", danger=True
    ) == {
        "kind": "confirm",
        "text": "Drop it?",
        "title": "Drop",
        "okText": "Drop",
        "cancelText": "Keep",
        "danger": True,
    }


def test_prompt_keeps_an_empty_initial_value():
    # "" is a real initial value for a prompt, distinct from "no value given".
    assert dialog_options("prompt", "Name?", value="")["value"] == ""
    assert "value" not in dialog_options("prompt", "Name?")


def test_dialog_text_is_stringified_and_none_is_empty():
    assert dialog_options("alert", None)["text"] == ""
    assert dialog_options("alert", 42)["text"] == "42"


def test_dialog_rejects_an_unknown_kind():
    with pytest.raises(ValueError, match="unknown dialog kind"):
        dialog_options("toast", "hi")
