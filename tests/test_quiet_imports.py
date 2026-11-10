"""Importing a widget module must not write to stdout or log above DEBUG."""
import importlib
import logging
import sys

import pytest

MODULES = ["wapyt.chat.chat", "wapyt.cardpanel.cardpanel"]


@pytest.mark.parametrize("name", MODULES)
def test_import_is_quiet(name, capsys, caplog):
    sys.modules.pop(name, None)
    with caplog.at_level(logging.INFO):
        importlib.import_module(name)
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""
    assert not [r for r in caplog.records if r.name == name]
