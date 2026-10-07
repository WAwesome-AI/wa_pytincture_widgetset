"""The version must agree everywhere pytincture and the release workflow read it."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _pyproject_version() -> str:
    return re.search(r'^version\s*=\s*"([^"]+)"', (ROOT / "pyproject.toml").read_text(), re.M).group(1)


def test_versions_agree():
    import wapyt

    manifest = json.loads((ROOT / "wapyt" / "pytincture-assets.json").read_text())
    assert wapyt.__version__ == _pyproject_version() == manifest["version"]


def test_version_is_valid_pep440_and_tuple_is_numeric():
    import wapyt

    assert re.fullmatch(r"\d+(\.\d+)*((a|b|rc)\d+)?(\.post\d+)?(\.dev\d+)?", wapyt.__version__)
    assert all(isinstance(part, int) for part in wapyt.__version_tuple__)


def test_version_is_a_plain_literal_for_pytincture():
    # pytincture finds __version__ by parsing wapyt/__init__.py, not importing it.
    text = (ROOT / "wapyt" / "__init__.py").read_text()
    assert re.search(r'^__version__ = "[^"]+"$', text, re.M)
    assert re.search(r'^__widgetset__ = "wapyt"$', text, re.M)
