"""Every config follows one None convention: unset means "not sent"."""
from __future__ import annotations

import dataclasses
import importlib
import inspect
import pkgutil

import pytest

import wapyt
from wapyt._config import drop_none

# Fields whose None means "none" (hide it), so JS must see null. Keep short.
ALLOWED_NULLS = {
    ("FormConfig", "cancelText"),
    ("FormConfig", "submitText"),
    ("SidebarConfig", "title"),
}

# Classes that cannot be built from defaults alone get minimal arguments.
ARGS = {
    "MenuItem": {"id": "m"},
    "ScheduleItem": {"id": "s", "start": "2026-10-08T09:00"},
}


def _config_classes():
    for info in pkgutil.walk_packages(wapyt.__path__, "wapyt."):
        module = importlib.import_module(info.name)
        for name, cls in inspect.getmembers(module, inspect.isclass):
            if cls.__module__ == module.__name__ and dataclasses.is_dataclass(cls) and hasattr(cls, "to_dict"):
                yield cls


def _build(cls):
    if cls.__name__ in ARGS:
        return cls(**ARGS[cls.__name__])
    required = {
        f.name: "x"
        for f in dataclasses.fields(cls)
        if f.init and f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING
    }
    return cls(**required)


def _nulls(value, path=""):
    if isinstance(value, dict):
        for key, item in value.items():
            if item is None:
                yield path + key
            else:
                yield from _nulls(item, f"{path}{key}.")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _nulls(item, f"{path}[{index}].")


CLASSES = sorted(set(_config_classes()), key=lambda c: (c.__module__, c.__name__))


def test_found_the_configs():
    assert len(CLASSES) > 40


@pytest.mark.parametrize("cls", CLASSES, ids=lambda c: c.__name__)
def test_defaults_send_no_nulls(cls):
    payload = _build(cls).to_dict()
    unexpected = [p for p in _nulls(payload) if (cls.__name__, p) not in ALLOWED_NULLS]
    assert unexpected == []


def test_drop_none_is_shallow():
    assert drop_none({"a": None, "b": 0, "c": False, "d": {"e": None}}) == {"b": 0, "c": False, "d": {"e": None}}
