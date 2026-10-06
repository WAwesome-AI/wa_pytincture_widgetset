"""
Every widget converts JS values through wapyt._runtime.to_plain, which turns
JS null (Pyodide's JsNull) into None. CPython stand-ins mimic the two shapes
Pyodide produces: a bare JsNull, and a proxy whose to_py() keeps JsNull inside.
"""
from __future__ import annotations

import re
from pathlib import Path

from wapyt._runtime import to_plain


class JsNull:  # same type name as pyodide.ffi.JsNull
    def __bool__(self):
        return False


class Proxy:
    """A JsProxy stand-in: to_py() returns a structure that may hold JsNull."""

    def __init__(self, converted):
        self._converted = converted

    def to_py(self):
        return self._converted


class Unconvertible:
    def to_py(self):
        raise TypeError("not convertible")


def test_bare_jsnull_is_none():
    assert to_plain(JsNull()) is None


def test_tree_select_cleared():
    assert to_plain(Proxy({"id": JsNull(), "node": JsNull()})) == {"id": None, "node": None}


def test_datatable_multi_select_payload():
    payload = to_plain(Proxy({"ids": ["a", "b"], "id": JsNull(), "rows": [{"id": "a"}, {"id": "b"}]}))
    assert payload["id"] is None and payload["ids"] == ["a", "b"]


def test_nested_lists_and_dicts():
    assert to_plain(Proxy([{"x": [JsNull(), 1]}, JsNull()])) == [{"x": [None, 1]}, None]


def test_plain_values_pass_through():
    for value in ("text", 0, 1.5, False, None, {"a": 1}, [1, 2]):
        assert to_plain(value) == value


def test_falsy_values_are_not_turned_into_none():
    assert to_plain(Proxy({"count": 0, "name": "", "flag": False})) == {"count": 0, "name": "", "flag": False}


def test_unconvertible_proxy_is_returned_as_is():
    obj = Unconvertible()
    assert to_plain(obj) is obj


def test_no_wrapper_calls_to_py_directly():
    """Guard: conversions go through to_plain, or JsNull leaks back in."""
    root = Path(__file__).resolve().parents[1] / "wapyt"
    offenders = []
    for path in root.rglob("*.py"):
        if path.name == "_runtime.py" or "__pycache__" in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            if re.search(r"\.to_py\(\)", code) and "``" not in line:
                offenders.append(f"{path.relative_to(root)}:{number}")
    assert offenders == []
