"""
Helpers shared by the config dataclasses.

The convention for every ``to_dict()``: a field left at ``None`` is not sent,
so the JS widget's own default applies. Use :func:`drop_none` on each mapping
rather than writing ``if x is not None`` chains.

The one exception is a field whose ``None`` means "none" rather than "the
default": ``FormConfig(submit_text=None)`` hides the button and
``SidebarConfig(title=None)`` shows no heading, so those are sent as ``null``
on purpose. Check the JS defaults before dropping a key that used to be sent. ``tests/test_config_none.py`` lists the allowed
exceptions.
"""
from __future__ import annotations

from typing import Any, Dict


def drop_none(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Return ``mapping`` without its ``None`` values (shallow: nested values are kept)."""
    return {key: value for key, value in mapping.items() if value is not None}
