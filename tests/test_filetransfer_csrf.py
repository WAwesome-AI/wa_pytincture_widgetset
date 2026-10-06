"""
filetransfer.js picks the CSRF cookie for uploads. Run the real function under
Node against simulated cookies (skipped when node is missing).
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "wapyt" / "assets" / "filetransfer.js"


def token(cookie: str, configured: str | None = None) -> str:
    node_bin = shutil.which("node")
    if not node_bin:
        pytest.skip("node is not installed")
    js = """
      globalThis.wapyt = {};
      globalThis.document = { cookie: process.argv[2] };
      if (process.argv[3]) globalThis.__pytinctureCsrfCookieName = process.argv[3];
      require("vm").runInThisContext(require("fs").readFileSync(process.argv[1], "utf8"));
      console.log(JSON.stringify(globalThis.wapyt.files._csrfToken()));
    """
    out = subprocess.run([node_bin, "-e", js, str(SCRIPT), cookie, configured or ""],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_default_dev_cookie():
    assert token("pytincture-dev-csrf=abc") == "abc"


def test_default_https_cookie():
    assert token("__Host-pytincture-csrf=xyz") == "xyz"


def test_own_namespace_without_runtime_hint():
    assert token("other=1; iguanaxterm-dev-csrf=ns%3Dtok") == "ns=tok"


def test_configured_name_wins_when_several_apps_share_a_host():
    cookies = "pytincture-dev-csrf=wrong; monguana-dev-csrf=also-wrong; iguanaxterm-dev-csrf=right"
    assert token(cookies, "iguanaxterm-dev-csrf") == "right"


def test_configured_name_missing_sends_nothing():
    # Never fall back to another app's token when the runtime names this one.
    assert token("monguana-dev-csrf=other-app", "iguanaxterm-dev-csrf") == ""


def test_fallback_prefers_the_default_namespace():
    assert token("monguana-dev-csrf=m; pytincture-dev-csrf=p") == "p"


def test_lookalikes_are_ignored():
    assert token("mypytincture_csrf=x; pytincture-dev-csrf-old=y; a--b-dev-csrf=z") == ""
