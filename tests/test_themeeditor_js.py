"""
The theme model in themeeditor.js, run under Node (skipped without node):
it must agree with the Python lists and with wapyt.css, and every built-in
palette must meet its own contrast targets.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from wapyt.themeeditor import FONTS, PALETTES, THEME_TOKENS

ASSETS = Path(__file__).resolve().parents[1] / "wapyt" / "assets"

HARNESS = r"""
globalThis.document = { documentElement: { style: { setProperty(){}, removeProperty(){} },
  setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; } } };
require("vm").runInThisContext(require("fs").readFileSync(process.argv[1], "utf8"));
const T = globalThis.wapyt.theme;
const accents = ["#2563eb", "#0e7490", "#facc15", "#ff00ff", "#111111", "#eeeeee", "#16a34a", "#9333ea"];
const derived = {};
for (const a of accents) for (const m of ["light", "dark"]) {
  const d = T.deriveAccent(a, m);
  derived[a + "/" + m] = { ...d, ratio: T.contrast(a, d["on-accent"]) };
}
console.log(JSON.stringify({
  tokens: T.TOKENS.map((t) => ({ key: t.key, light: t.light, dark: t.dark, on: t.on || null, min: t.min || null })),
  fonts: T.FONTS.map((f) => f.id),
  palettes: T.palettes().map((p) => ({ id: p.id, ...T.resolve({ palette: p.id }) })),
  defaults: T.DEFAULT,
  normalized: T.normalize({ palette: "nope", light: { accent: "#ABC", bogus: "#000", text: "red" }, radius: 99 }),
  ratioWhiteBlack: T.contrast("#ffffff", "#000000"),
  derived,
}));
"""


@pytest.fixture(scope="module")
def model():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    out = subprocess.run([node, "-e", HARNESS, str(ASSETS / "themeeditor.js")],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _lum(hex_):
    def ch(v):
        c = int(v, 16) / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(hex_[i:i + 2]) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def test_lists_match_python(model):
    assert [t["key"] for t in model["tokens"]] == THEME_TOKENS
    assert [p["id"] for p in model["palettes"]] == PALETTES
    assert model["fonts"] == FONTS


def test_defaults_match_the_stylesheet(model):
    css = (ASSETS / "wapyt.css").read_text()
    root = css[css.index(":root {"):css.index("}", css.index(":root {"))]
    declared = dict(re.findall(r"(--wapyt-[a-z-]+):\s*(#[0-9a-fA-F]{6})", root))
    for tok in model["tokens"]:
        for mode in ("light", "dark"):
            assert declared[tok[mode]].lower() == model["defaults"][mode][tok["key"]], (tok["key"], mode)
    assert "--wapyt-radius: 6px" in root


def test_contrast_maths(model):
    assert round(model["ratioWhiteBlack"], 2) == 21.0


@pytest.mark.parametrize("mode", ["light", "dark"])
def test_built_in_palettes_meet_their_targets(model, mode):
    failures = []
    for p in model["palettes"]:
        v = p[mode]
        for tok in model["tokens"]:
            if not tok["on"] or tok["on"] == "tint":
                continue
            r = ratio(v[tok["key"]], v[tok["on"]])
            if r < tok["min"]:
                failures.append(f"{p['id']}/{mode}: {tok['key']} on {tok['on']} = {r:.2f} < {tok['min']}")
        r = ratio(v["text"], v["surface"])
        if r < 4.5:
            failures.append(f"{p['id']}/{mode}: text on surface = {r:.2f}")
    assert failures == []


def test_normalize_drops_bad_values(model):
    n = model["normalized"]
    assert n["palette"] == "default"
    assert n["light"] == {"accent": "#aabbcc"}
    assert n["radius"] == 24


def test_derived_accent_text_is_readable(model):
    assert all(d["ratio"] >= 4.5 for d in model["derived"].values()), {
        k: round(d["ratio"], 2) for k, d in model["derived"].items() if d["ratio"] < 4.5}
