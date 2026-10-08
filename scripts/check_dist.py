#!/usr/bin/env python3
"""
Check built wapyt distributions before they are published.

    python scripts/check_dist.py dist/            # every wheel and sdist in dist/
    python scripts/check_dist.py dist/ --version 0.2.0   # and require this version

pytincture installs the wheel in the browser and refuses it unless
wapyt/pytincture-assets.json names the installed version and every asset's
SHA-256 matches the file in the wheel. This script applies the same rules to
the files about to be uploaded, so a stale manifest fails here rather than in
a user's browser. It also checks the sdist carries the manifest and assets, and
that the version agrees with wapyt/__init__.py.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import tarfile
import zipfile
from pathlib import Path

MANIFEST = "wapyt/pytincture-assets.json"


def fail(message: str) -> None:
    raise SystemExit(f"check_dist: {message}")


def check_members(name: str, read, names: set[str], version: str) -> None:
    if MANIFEST not in names:
        fail(f"{name}: {MANIFEST} is missing")
    manifest = json.loads(read(MANIFEST))
    if manifest.get("package") != "wapyt" or manifest.get("schema") != 1:
        fail(f"{name}: manifest package/schema is wrong: {manifest.get('package')}/{manifest.get('schema')}")
    if manifest.get("version") != version:
        fail(f"{name}: manifest version {manifest.get('version')} != distribution version {version}")
    assets = manifest.get("assets") or []
    if not assets:
        fail(f"{name}: manifest lists no assets")
    for entry in assets:
        path = entry["path"]  # already relative to the distribution root (wapyt/...)
        if path not in names:
            fail(f"{name}: {path} is in the manifest but not in the distribution")
        digest = hashlib.sha256(read(path)).hexdigest()
        if digest != entry["sha256"]:
            fail(f"{name}: {path} sha256 {digest[:12]}… != manifest {entry['sha256'][:12]}…")
    init = read("wapyt/__init__.py").decode("utf-8")
    match = re.search(r'^__version__\s*=\s*"([^"]+)"', init, re.MULTILINE)
    if not match or match.group(1) != version:
        fail(f"{name}: wapyt/__init__.py __version__ {match.group(1) if match else '?'} != {version}")
    print(f"ok  {name}: version {version}, {len(assets)} assets verified")


def check_wheel(path: Path) -> str:
    match = re.match(r"wapyt-([^-]+)-py3-none-any\.whl$", path.name)
    if not match:
        fail(f"{path.name}: unexpected wheel name (want wapyt-<version>-py3-none-any.whl)")
    version = match.group(1)
    with zipfile.ZipFile(path) as wheel:
        names = set(wheel.namelist())
        check_members(path.name, wheel.read, names, version)
        metadata = next((n for n in names if n.endswith(".dist-info/METADATA")), None)
        if not metadata:
            fail(f"{path.name}: no METADATA")
        text = wheel.read(metadata).decode("utf-8")
        if re.search(r"^Requires-Dist:", text, re.MULTILINE):
            fail(f"{path.name}: declares runtime dependencies; micropip would resolve them in the browser")
        # Everything installs under wapyt/ (plus the dist-info): a stray
        # top-level package such as tests/ lands in every user's
        # site-packages.
        stray = sorted({n.split("/", 1)[0] for n in names} - {"wapyt", f"wapyt-{version}.dist-info"})
        if stray:
            fail(f"{path.name}: installs top-level names besides wapyt: {', '.join(stray)}")
    return version


def check_sdist(path: Path) -> str:
    match = re.match(r"wapyt-(.+)\.tar\.gz$", path.name)
    if not match:
        fail(f"{path.name}: unexpected sdist name")
    version = match.group(1)
    prefix = f"wapyt-{version}/"
    with tarfile.open(path) as sdist:
        members = {m.name[len(prefix):]: m for m in sdist.getmembers() if m.name.startswith(prefix)}
        check_members(path.name, lambda n: sdist.extractfile(members[n]).read(), set(members), version)
    return version


def main() -> int:
    args = [a for a in sys.argv[1:]]
    want = None
    if "--version" in args:
        i = args.index("--version")
        want = args[i + 1]
        del args[i:i + 2]
    folder = Path(args[0] if args else "dist")
    wheels = sorted(folder.glob("wapyt-*.whl"))
    sdists = sorted(folder.glob("wapyt-*.tar.gz"))
    if not wheels or not sdists:
        fail(f"{folder}: need a wheel and an sdist (found {len(wheels)} and {len(sdists)})")
    versions = {check_wheel(w) for w in wheels} | {check_sdist(s) for s in sdists}
    if len(versions) != 1:
        fail(f"distributions disagree on the version: {sorted(versions)}")
    if want is not None and versions != {want}:
        fail(f"distribution version {versions.pop()} != required {want}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
