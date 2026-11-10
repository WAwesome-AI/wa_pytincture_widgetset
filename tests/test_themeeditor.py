"""ThemeEditor config, theme validation and the wrapper's calls."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

import wapyt.themeeditor.themeeditor as te_module
from wapyt import ThemeEditor, ThemeEditorConfig, ThemePalette
from wapyt.themeeditor import check_theme
from wapyt.themeeditor.themeeditor_config import normalize_hex


def test_default_config():
    assert ThemeEditorConfig().to_dict() == {
        "previewMode": True, "apply": True, "showShape": True, "showFont": True,
        "showExport": True, "title": "Theme",
    }


def test_title_none_is_sent_as_null():
    assert ThemeEditorConfig(title=None).to_dict()["title"] is None


def test_palettes_mix_built_ins_and_custom():
    brand = ThemePalette("brand", "Brand", light={"accent": "#0A7"}, dark={"accent": "#0c9"})
    payload = ThemeEditorConfig(palettes=["default", brand], value={"palette": "brand"}).to_dict()
    assert payload["palettes"] == ["default", {"id": "brand", "label": "Brand",
                                               "light": {"accent": "#00aa77"}, "dark": {"accent": "#00cc99"}}]
    assert payload["value"]["palette"] == "brand"


@pytest.mark.parametrize("palettes, message", [
    (["nope"], "unknown palette"),
    ([], "at least one"),
    ([ThemePalette("ocean")], "built-in"),
    ([ThemePalette("x", light={"shadow": "#000"})], "unknown theme token"),
])
def test_bad_palettes(palettes, message):
    with pytest.raises(ValueError, match=message):
        ThemeEditorConfig(palettes=palettes).to_dict()


def test_bad_mode():
    with pytest.raises(ValueError):
        ThemeEditorConfig(mode="sepia").to_dict()


def test_check_theme_normalises():
    assert check_theme({"palette": "forest", "dark": {"text": "#FFF"}, "radius": 7.6}) == {
        "palette": "forest", "light": {}, "dark": {"text": "#ffffff"}, "radius": 8, "font": "system"}
    assert check_theme(None)["palette"] == "default"


@pytest.mark.parametrize("theme, message", [
    ({"palette": "mystery"}, "unknown palette"),
    ({"light": {"accent": "blue"}}, "not a hex"),
    ({"light": {"glow": "#000"}}, "unknown theme token"),
    ({"radius": 40}, "radius"),
    ({"radius": True}, "radius"),
    ({"colours": {}}, "unknown theme keys"),
])
def test_check_theme_rejects(theme, message):
    with pytest.raises(ValueError, match=message):
        check_theme(theme)


def test_custom_palette_ids_are_accepted_when_named():
    assert check_theme({"palette": "brand"}, ["brand"])["palette"] == "brand"


@pytest.mark.parametrize("raw, hex_", [("#ABC", "#aabbcc"), ("123456", "#123456"), (" #0f0f0f ", "#0f0f0f")])
def test_normalize_hex(raw, hex_):
    assert normalize_hex(raw) == hex_


class FakeEditor:
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        return lambda *args: self.calls.append((name, args)) or {"palette": "default"}


@pytest.fixture
def editor(monkeypatch):
    monkeypatch.setattr(te_module, "_to_js", lambda value: json.loads(json.dumps(value)))
    w = object.__new__(ThemeEditor)
    w.config = ThemeEditorConfig(palettes=["default", ThemePalette("brand")])
    w.editor = FakeEditor()
    return w


def test_set_theme_validates_then_calls_js(editor):
    editor.set_theme({"palette": "brand", "light": {"accent": "#ABC"}})
    name, (theme, opts) = editor.editor.calls[-1]
    assert name == "setTheme" and theme["light"] == {"accent": "#aabbcc"} and opts == {"silent": False}
    with pytest.raises(ValueError):
        editor.set_theme({"palette": "unknown"})


def test_set_mode_checks_its_argument(editor):
    editor.set_mode("dark")
    assert editor.editor.calls[-1] == ("setMode", ("dark",))
    with pytest.raises(ValueError):
        editor.set_mode("dusk")


def test_apply_theme_registers_palettes(monkeypatch):
    calls = []
    ns = SimpleNamespace(registerPalette=lambda spec: calls.append(("register", spec)),
                         apply=lambda theme: calls.append(("apply", theme)) or theme)
    monkeypatch.setattr(te_module, "_theme_js", lambda: ns)
    monkeypatch.setattr(te_module, "_to_js", lambda value: value)
    result = te_module.apply_theme({"palette": "brand"}, palettes=[ThemePalette("brand", light={"accent": "#000"})])
    assert calls[0][0] == "register" and calls[1][0] == "apply"
    assert result["palette"] == "brand"
    te_module.apply_theme(None)
    assert calls[-1] == ("apply", None)
