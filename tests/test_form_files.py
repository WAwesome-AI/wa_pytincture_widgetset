"""CPython tests for file and avatar fields (no browser needed)."""
from __future__ import annotations

import pytest

import wapyt.filetransfer.filetransfer as filetransfer_module
from wapyt import FieldConfig, Form


def test_file_options():
    payload = FieldConfig(id="docs", type="file", multiple=True, accept=".csv,.tsv", max_size=1_000_000,
                          max_files=3, placeholder="Drop CSVs").to_dict()
    assert (payload["accept"], payload["maxSize"], payload["maxFiles"], payload["multiple"]) == (".csv,.tsv", 1_000_000, 3, True)


def test_avatar_may_start_with_a_url():
    assert FieldConfig(id="pic", type="avatar", value="/static/me.png").to_dict()["value"] == "/static/me.png"


@pytest.mark.parametrize("kind,value", [("file", ["x.csv"]), ("avatar", {"name": "me.png"})])
def test_files_cannot_be_preset(kind, value):
    with pytest.raises(ValueError, match="cannot start with files"):
        FieldConfig(id="f", type=kind, value=value).to_dict()


def test_file_options_need_a_file_field():
    with pytest.raises(ValueError, match="need type 'file' or 'avatar'"):
        FieldConfig(id="t", accept=".csv").to_dict()
    with pytest.raises(ValueError, match="max_files needs"):
        FieldConfig(id="f", type="file", max_files=2).to_dict()


def test_adopt_files_registers_each(monkeypatch):
    form = object.__new__(Form)

    class FakeJsForm:
        def getFiles(self, field_id):
            return ["file-a", "file-b"]

    form.form = FakeJsForm()
    monkeypatch.setattr(filetransfer_module, "adopt", lambda f: f"id-{f}")
    assert form.adopt_files("docs") == ["id-file-a", "id-file-b"]
