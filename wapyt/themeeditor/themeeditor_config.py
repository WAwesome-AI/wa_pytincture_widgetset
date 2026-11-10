"""
Configuration for the ThemeEditor and the theme model it edits.

A *theme* is a plain dict, the same shape the JS uses and the editor exports
as JSON::

    {"palette": "ocean",                  # a built-in or registered palette id
     "light": {"accent": "#0f766e"},      # per-mode overrides on the palette
     "dark": {},
     "radius": 8,                         # corner radius in px (0-24)
     "font": "system"}                    # a FONTS id, or a CSS font-family

Only overrides are stored, so a theme stays small and follows the palette
for everything the person did not change.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from .._config import drop_none

#: Colour tokens the editor shows, in display order (keys of "light" / "dark").
THEME_TOKENS = [
    "bg", "surface", "border", "divider",
    "text", "muted",
    "accent", "accent-strong", "accent-text", "on-accent", "focus",
    "danger", "danger-strong", "success", "success-strong", "warning",
]
#: Built-in palettes.
PALETTES = ["default", "ocean", "forest", "sunset", "grape", "rose", "graphite", "paper", "contrast"]
#: Built-in font choices (a theme's "font" may also be any CSS font-family).
FONTS = ["system", "humanist", "rounded", "serif", "mono"]

_HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def normalize_hex(value: Any) -> str:
    """``"#ABC"`` -> ``"#aabbcc"``; raises ValueError for anything else."""
    match = _HEX.match(str(value).strip()) if value is not None else None
    if not match:
        raise ValueError(f"not a hex colour: {value!r}")
    hex_ = match.group(1).lower()
    if len(hex_) == 3:
        hex_ = "".join(c * 2 for c in hex_)
    return f"#{hex_}"


def _check_overrides(mapping: Optional[Dict[str, Any]], where: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for key, value in (mapping or {}).items():
        if key not in THEME_TOKENS:
            raise ValueError(f"unknown theme token {key!r} in {where}; expected one of {', '.join(THEME_TOKENS)}")
        out[key] = normalize_hex(value)
    return out


def check_theme(theme: Optional[Dict[str, Any]], palettes: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Validate a theme dict and return it normalised (lower-case 6-digit hex,
    an int radius). ``palettes`` adds custom palette ids to the known ones.
    """
    theme = dict(theme or {})
    unknown = set(theme) - {"palette", "light", "dark", "radius", "font"}
    if unknown:
        raise ValueError(f"unknown theme keys: {', '.join(sorted(unknown))}")
    palette = theme.get("palette") or "default"
    if palette not in PALETTES + list(palettes or []):
        raise ValueError(f"unknown palette {palette!r}")
    radius = theme.get("radius", 6)
    if not isinstance(radius, (int, float)) or isinstance(radius, bool) or not 0 <= radius <= 24:
        raise ValueError("radius must be a number of px from 0 to 24")
    return {
        "palette": palette,
        "light": _check_overrides(theme.get("light"), "light"),
        "dark": _check_overrides(theme.get("dark"), "dark"),
        "radius": int(round(radius)),
        "font": str(theme.get("font") or "system"),
    }


@dataclass
class ThemePalette:
    """
    A palette of your own, offered beside the built-in ones. ``light`` /
    ``dark`` override the Default palette's colours (keys from THEME_TOKENS).
    """

    id: str
    label: Optional[str] = None
    light: Dict[str, str] = field(default_factory=dict)
    dark: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        if not self.id:
            raise ValueError("a ThemePalette needs an id")
        if self.id in PALETTES:
            raise ValueError(f"palette id {self.id!r} is a built-in palette")
        return {
            "id": self.id,
            "label": self.label or self.id,
            "light": _check_overrides(self.light, f"palette {self.id!r} light"),
            "dark": _check_overrides(self.dark, f"palette {self.id!r} dark"),
        }


@dataclass
class ThemeEditorConfig:
    """
    Args:
        palettes: palette ids and/or ``ThemePalette``s to offer, in order;
            ``None`` offers every built-in palette.
        value: the theme to start from (see the module docstring).
        mode: which colours to edit first, ``"light"`` or ``"dark"``;
            ``None`` follows the page.
        preview_mode: switching Light / Dark in the editor switches the page
            theme too, so you see what you edit.
        storage_key: remember the theme in the browser under this key and
            start from it next time (``restore_theme`` applies it early).
        apply: apply the theme to the page while editing. Turn off to edit
            a theme that is saved elsewhere, e.g. per user on the server.
        show_shape / show_font / show_export: the corner-radius slider, the
            font picker, and the Copy / Download / Import buttons.
        title: heading above the editor; ``None`` for none.
    """

    palettes: Optional[List[Union[str, ThemePalette]]] = None
    value: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None
    preview_mode: bool = True
    storage_key: Optional[str] = None
    apply: bool = True
    show_shape: bool = True
    show_font: bool = True
    show_export: bool = True
    title: Optional[str] = "Theme"

    def to_dict(self) -> Dict[str, Any]:
        if self.mode not in (None, "light", "dark"):
            raise ValueError("mode must be 'light', 'dark' or None")
        palettes = None
        custom: List[str] = []
        if self.palettes is not None:
            palettes = []
            for p in self.palettes:
                if isinstance(p, ThemePalette):
                    spec = p.to_dict()
                    custom.append(spec["id"])
                    palettes.append(spec)
                elif p in PALETTES:
                    palettes.append(p)
                else:
                    raise ValueError(f"unknown palette {p!r}; pass a ThemePalette for your own")
            if not palettes:
                raise ValueError("palettes must name at least one palette")
        payload = drop_none({
            "palettes": palettes,
            "value": check_theme(self.value, custom) if self.value is not None else None,
            "mode": self.mode,
            "previewMode": self.preview_mode,
            "storageKey": self.storage_key,
            "apply": self.apply,
            "showShape": self.show_shape,
            "showFont": self.show_font,
            "showExport": self.show_export,
        })
        # None means no heading: a dropped key would bring back "Theme".
        payload["title"] = self.title
        return payload


__all__ = ["ThemeEditorConfig", "ThemePalette", "THEME_TOKENS", "PALETTES", "FONTS", "check_theme", "normalize_hex"]
