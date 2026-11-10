"""WidgetBase: event binding, payload conversion and proxy release."""
from __future__ import annotations

import asyncio
import datetime as dt
from types import SimpleNamespace

import pytest

import wapyt._base as base
from wapyt import (
    CardPanel, Chart, Chat, ContextMenu, DataTable, Form, Kanban, Listbox,
    MediaPlayer, MenuBar, ModalWindow, Pagination, Popup, ProgressBar,
    ResourceBoard, Scheduler, Sidebar, TabWidget, Terminal, Toolbar, Tree, Window,
)
from wapyt._base import WidgetBase, resolve_root


class FakeProxy:
    def __init__(self, fn):
        self.fn = fn
        self.destroyed = False

    def __call__(self, *args):
        assert not self.destroyed, "called a destroyed proxy"
        return self.fn(*args)

    def destroy(self):
        self.destroyed = True


class FakeJsWidget:
    """Stands in for a JS widget: on/off/emit/destroy."""

    def __init__(self):
        self.listeners = {}
        self.destroyed = False
        self.closed = False

    def on(self, event, handler):
        self.listeners.setdefault(event, []).append(handler)

    def off(self, event, handler):
        self.listeners[event].remove(handler)

    def emit(self, event, *args):
        return [h(*args) for h in self.listeners.get(event, [])]

    def destroy(self):
        self.destroyed = True

    def close(self):
        self.closed = True


class JsNull:  # what to_plain recognises by type name
    pass


class Demo(WidgetBase):
    _js_attr = "thing"


@pytest.fixture(autouse=True)
def fake_proxies(monkeypatch):
    monkeypatch.setattr(base, "create_proxy", FakeProxy)


def make(cls=Demo):
    widget = object.__new__(cls)  # no __init__, like the Form tests
    setattr(widget, cls._js_attr, FakeJsWidget())
    return widget


def test_payload_is_converted():
    w = make()
    seen = []
    w._bind_event("select", seen.append)
    w.thing.emit("select", {"id": JsNull(), "items": [JsNull()]})
    assert seen == [{"id": None, "items": [None]}]


def test_no_argument_event_calls_handler_without_arguments():
    # CardPanel emits "add" with nothing.
    w = make()
    calls = []
    w._bind_event("add", lambda: calls.append("add"))
    w.thing.emit("add")
    assert calls == ["add"]


def test_return_value_goes_back_to_js():
    # Chat marks an event handled when a listener returns True.
    w = make()
    w._bind_event("send", lambda payload: True)
    assert w.thing.emit("send", {}) == [True]


def test_async_handler_is_scheduled():
    w = make()
    done = []

    async def handler(payload):
        done.append(payload)

    async def main():
        w._bind_event("change", handler)
        assert w.thing.emit("change", 7) == [None]
        await asyncio.sleep(0)

    asyncio.run(main())
    assert done == [7]


def test_every_handler_is_kept():
    w = make()
    seen = []
    w._bind_event("select", lambda p: seen.append(("a", p)))
    w._bind_event("select", lambda p: seen.append(("b", p)))
    w.thing.emit("select", 1)
    assert seen == [("a", 1), ("b", 1)]
    assert len(w._proxies["select"]) == 2


def test_dispose_destroys_widget_then_unhooks_and_destroys_proxies():
    w = make()
    w._bind_event("a", lambda p: None)
    w._bind_event("b", lambda p: None)
    proxies = [p for ps in w._proxies.values() for p in ps]
    w._dispose()
    assert w.thing.destroyed
    assert all(p.destroyed for p in proxies)
    assert w.thing.listeners == {"a": [], "b": []}
    assert w._proxies == {}
    # A late event (a socket closing after destroy) reaches nothing.
    assert w.thing.emit("a", 1) == []


def test_release_happens_even_if_js_destroy_fails():
    w = make()
    w._bind_event("a", lambda p: None)
    proxy = w._proxies["a"][0]

    def boom():
        raise RuntimeError("js failed")

    w.thing.destroy = boom
    with pytest.raises(RuntimeError):
        w._dispose()
    assert proxy.destroyed and w._proxies == {}


def test_release_without_off_still_destroys_proxies():
    w = object.__new__(Demo)
    w.thing = SimpleNamespace(on=lambda event, handler: None)
    w._bind_event("a", lambda p: None)
    proxy = w._proxies["a"][0]
    w._release_proxies()
    assert proxy.destroyed


def test_resolve_root(monkeypatch):
    cell = SimpleNamespace(getContainer=lambda: "cell-el")
    assert resolve_root(cell, None) == "cell-el"
    assert resolve_root(SimpleNamespace(element="wrapped-el"), None) == "wrapped-el"
    found = {"#a": None, "a": "by-id"}
    document = SimpleNamespace(
        querySelector=lambda sel: found.get(sel),
        getElementById=lambda id_: found.get(id_),
    )
    monkeypatch.setattr(base._runtime, "js", SimpleNamespace(document=document))
    assert resolve_root(None, "a") == "by-id"
    element = object()
    assert resolve_root(None, element) is element


def test_scheduler_payloads_become_dates():
    w = make(Scheduler)
    seen = []
    w._bind_event("move", seen.append)
    w.scheduler.emit("move", {"start": "2026-10-08T09:30", "end": "2026-10-08T10:00"})
    assert seen[0]["start"] == dt.datetime(2026, 10, 8, 9, 30)


WITH_DESTROY = [
    CardPanel, Chart, Chat, ContextMenu, DataTable, Kanban, Listbox, MediaPlayer,
    MenuBar, Pagination, Popup, ProgressBar, Scheduler, Sidebar, Terminal, Toolbar, Tree,
]
WITH_CLOSE = [ModalWindow, Window]
ALL = WITH_DESTROY + WITH_CLOSE + [Form, ResourceBoard, TabWidget]


@pytest.mark.parametrize("cls", ALL, ids=lambda c: c.__name__)
def test_widget_binds_through_the_base(cls):
    assert issubclass(cls, WidgetBase) and cls._js_attr
    w = make(cls)
    seen = []
    w._bind_event("x", seen.append)
    getattr(w, cls._js_attr).emit("x", {"v": JsNull()})
    assert seen == [{"v": None}]


@pytest.mark.parametrize("cls", WITH_DESTROY, ids=lambda c: c.__name__)
def test_destroy_releases_handlers(cls):
    w = make(cls)
    w._bind_event("x", lambda p: None)
    proxy = w._proxies["x"][0]
    w.destroy()
    assert getattr(w, cls._js_attr).destroyed
    assert proxy.destroyed and w._proxies == {}


@pytest.mark.parametrize("cls", WITH_CLOSE, ids=lambda c: c.__name__)
def test_close_releases_handlers(cls):
    w = make(cls)
    w._bind_event("x", lambda p: None)
    proxy = w._proxies["x"][0]
    w.close()
    assert getattr(w, cls._js_attr).closed
    assert proxy.destroyed and w._proxies == {}
