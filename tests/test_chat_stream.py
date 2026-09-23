"""
Unit tests for `Chat`'s stream consumption.

These cover the Python side of the backend -> widget boundary: how chunks from
a streaming proxy (see `multiaiproxy.py`) are turned into text, how in-band
provider errors surface, and how the coroutine is scheduled under Pyodide.

No browser is involved. `Chat.__init__` requires the Pyodide runtime, so the
tests drive a subclass that replaces only the two JS-facing methods the stream
helpers call.
"""
import asyncio

import pytest

from wapyt.chat import chat as chat_module
from wapyt.chat.chat import Chat, ChatStreamError


class FakeChat(Chat):
    """
    A `Chat` with the JS bridge stubbed out.

    Bypasses `Chat.__init__` (which needs `js.wapyt.ChatWidget`) and records
    what the real widget would have been told to render.
    """

    def __init__(self) -> None:  # noqa: D107 - deliberately skips super()
        self.appended: list[str] = []
        self.finished = 0

    def append_stream(self, message_id: str, chunk: str) -> None:
        self.appended.append(chunk)

    def finish_stream(self, message_id: str, final_chunk=None) -> None:
        self.finished += 1

    @property
    def text(self) -> str:
        return "".join(self.appended)


@pytest.fixture
def chat() -> FakeChat:
    return FakeChat()


def openai_chunk(text: str) -> dict:
    """A LiteLLM/OpenAI-shaped content chunk."""
    return {"choices": [{"delta": {"content": text}}]}


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("chunk", "expected"),
    [
        (openai_chunk("hi"), "hi"),
        ({"type": "chunk", "chunk": {"choices": [{"delta": {"content": "hi"}}]}}, "hi"),
        # `content.delta` used to return "" unconditionally, which dropped the
        # entire response from any proxy that forwards provider chunks as-is.
        ({"type": "content.delta", "delta": {"text": "hi"}}, "hi"),
        ({"type": "content.delta", "delta": {"content": "hi"}}, "hi"),
        ({"type": "content.delta", "delta": "hi"}, "hi"),
        ({"type": "response.output_text.delta", "delta": {"text": "hi"}}, "hi"),
        ({"type": "response.output_text.delta", "delta": "hi"}, "hi"),
        ("hi", "hi"),
        (None, ""),
        ({}, ""),
        ({"choices": []}, ""),
    ],
)
def test_extract_stream_text(chunk, expected):
    assert Chat.extract_stream_text(chunk) == expected


def test_content_delta_is_assembled_in_order(chat):
    chat.consume_stream(
        "msg",
        [
            {"type": "content.delta", "delta": {"text": "He"}},
            {"type": "content.delta", "delta": {"content": "llo"}},
            {"type": "response.output_text.delta", "delta": "!"},
        ],
    )
    assert chat.text == "Hello!"
    assert chat.finished == 1


# ---------------------------------------------------------------------------
# In-band provider errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("chunk", "expected"),
    [
        ({"error": {"message": "boom", "type": "provider_error"}}, "boom"),
        ({"error": {"detail": "boom"}}, "boom"),
        ({"error": {"code": "stream_error"}}, "stream_error"),
        ({"error": "boom"}, "boom"),
        ({"type": "error", "message": "boom"}, "boom"),
        ({"error": {}}, "Unknown backend error"),
        (openai_chunk("hi"), None),
        ({}, None),
        ("plain text", None),
        (None, None),
    ],
)
def test_extract_stream_error(chunk, expected):
    assert Chat.extract_stream_error(chunk) == expected


def test_error_chunk_keeps_partial_text_and_closes_stream(chat):
    chat.consume_stream(
        "msg",
        [
            openai_chunk("partial "),
            {"error": {"message": "Model 'x' is not supported."}},
            openai_chunk("never reached"),
        ],
    )
    assert chat.text == "partial Backend error: Model 'x' is not supported."
    assert chat.finished == 1


def test_error_chunk_reaches_on_error_hook(chat):
    seen: list[Exception] = []

    chat.consume_stream("msg", [{"error": "boom"}], on_error=seen.append)

    assert len(seen) == 1
    assert isinstance(seen[0], ChatStreamError)
    assert str(seen[0]) == "boom"
    # A custom hook owns the presentation, so nothing is written by default.
    assert chat.text == ""


def test_transport_exception_still_reaches_on_error(chat):
    def exploding():
        yield openai_chunk("partial ")
        raise ConnectionError("socket closed")

    seen: list[Exception] = []
    chat.consume_stream("msg", exploding(), on_error=seen.append)

    assert chat.text == "partial "
    assert isinstance(seen[0], ConnectionError)


# ---------------------------------------------------------------------------
# Ordinary streaming
# ---------------------------------------------------------------------------


def test_sync_stream_appends_and_finishes(chat):
    chat.consume_stream("msg", [openai_chunk("a"), openai_chunk("b")])
    assert chat.text == "ab"
    assert chat.finished == 1


def test_finish_false_leaves_stream_open(chat):
    chat.consume_stream("msg", [openai_chunk("a")], finish=False)
    assert chat.text == "a"
    assert chat.finished == 0


def test_custom_parser_overrides_extraction(chat):
    chat.consume_stream("msg", [{"raw": "a"}, {"raw": "b"}], parser=lambda c: c["raw"])
    assert chat.text == "ab"


def test_non_iterable_stream_is_rejected(chat):
    with pytest.raises(ValueError, match="iterable"):
        chat.consume_stream("msg", 42)


# ---------------------------------------------------------------------------
# Scheduling (item: asyncio.run must never run under Pyodide)
# ---------------------------------------------------------------------------


@pytest.fixture
def browser_loop(monkeypatch):
    """
    Stand in for Pyodide: a `js` module is importable and an event loop is the
    current loop, but nothing is *running* — the state a synchronous JS event
    handler sees. `asyncio.run` would create and close a second loop here,
    permanently breaking Pyodide's WebLoop, so it is made fatal.
    """

    def forbidden(*args, **kwargs):
        raise AssertionError("asyncio.run() must not be called under Pyodide")

    monkeypatch.setattr(chat_module, "js", object())
    monkeypatch.setattr(asyncio, "run", forbidden)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        yield loop
    finally:
        asyncio.set_event_loop(None)
        loop.close()


def test_async_stream_is_scheduled_not_blocked(chat, browser_loop):
    async def agen():
        for token in ("x", "y"):
            yield openai_chunk(token)

    chat.consume_stream("msg", agen())

    # consume_stream returns immediately; the browser drives the coroutine.
    assert chat.text == ""

    browser_loop.run_until_complete(asyncio.sleep(0))
    assert chat.text == "xy"
    assert chat.finished == 1


def test_async_error_chunk_reaches_on_error(chat, browser_loop):
    async def agen():
        yield openai_chunk("partial ")
        yield {"error": {"message": "upstream died"}}

    seen: list[Exception] = []
    chat.consume_stream("msg", agen(), on_error=seen.append)
    browser_loop.run_until_complete(asyncio.sleep(0))

    assert chat.text == "partial "
    assert isinstance(seen[0], ChatStreamError)
    assert str(seen[0]) == "upstream died"
