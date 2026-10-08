"""Every wapyt module compiles without warnings (no invalid escapes and the like)."""
from __future__ import annotations

import pathlib
import warnings

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "wapyt"


@pytest.mark.parametrize("path", sorted(ROOT.rglob("*.py")), ids=lambda p: str(p.relative_to(ROOT)))
def test_compiles_without_warnings(path):
    # An invalid escape such as "\;" in a normal string is a SyntaxWarning
    # today (on every import, in every app) and an error in a future Python.
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
