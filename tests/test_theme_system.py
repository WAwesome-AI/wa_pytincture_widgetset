"""
wapyt.setTheme in layout.js: "system" follows prefers-color-scheme. Run the
real script under Node with a fake document and matchMedia (skipped when
node is missing).
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "wapyt" / "assets" / "layout.js"

HARNESS = """
const attrs = {};
globalThis.document = { documentElement: {
  setAttribute: (k, v) => { attrs[k] = String(v); },
  getAttribute: (k) => (k in attrs ? attrs[k] : null),
} };
const listeners = [];
const query = { matches: process.argv[2] === "dark",
  addEventListener: (type, fn) => listeners.push(fn) };
globalThis.matchMedia = () => query;
require("vm").runInThisContext(require("fs").readFileSync(process.argv[1], "utf8"));
const log = [];
const snap = (label) => log.push([label, attrs["data-wapyt-theme"], attrs["data-wapyt-theme-mode"],
  globalThis.wapyt.getTheme()]);
const osTo = (dark) => { query.matches = dark; listeners.forEach((fn) => fn({ matches: dark })); };
for (const step of JSON.parse(process.argv[3])) {
  if (step[0] === "set") globalThis.wapyt.setTheme(step[1]);
  else osTo(step[1] === "dark");
  snap(step.join(" "));
}
console.log(JSON.stringify(log));
"""


def run(os_scheme: str, steps):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    out = subprocess.run([node, "-e", HARNESS, str(SCRIPT), os_scheme, json.dumps(steps)],
                         capture_output=True, text=True, check=True)
    return [(theme, mode, info) for _label, theme, mode, info in json.loads(out.stdout)]


def test_system_resolves_and_follows_the_os():
    result = run("dark", [["set", "system"], ["os", "light"], ["os", "dark"]])
    assert [r[0] for r in result] == ["dark", "light", "dark"]
    assert all(r[1] == "system" for r in result)
    assert result[1][2] == {"mode": "system", "resolved": "light"}


def test_explicit_theme_ignores_the_os():
    result = run("light", [["set", "system"], ["set", "light"], ["os", "dark"]])
    assert result[-1][:2] == ("light", "light")


def test_back_to_system_picks_up_the_current_os_setting():
    result = run("light", [["set", "dark"], ["os", "light"], ["set", "System"]])
    assert result[-1][:2] == ("light", "system")
