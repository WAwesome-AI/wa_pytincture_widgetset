#!/usr/bin/env bash
# Build wapyt as the Pytincture development wheel and install it into an
# application's modules_path, so widgetset edits reach the browser without a
# release.
#
#   scripts/dev_wheel.sh ~/Development/Pytinc/wAwesomeChat/src/wawesomechat
#
# Pytincture serves a root-level wheel from modules_path at either the pinned
# version or PYTINCTURE_DEV_WHEEL_VERSION (default 99.99.99), and prefers the
# pinned one. It also hash-verifies every widgetset asset, so the manifest must
# be regenerated for the dev version or the app fails at widgetset-load.
#
# Builds from a temporary copy so the working tree keeps its real version.
set -euo pipefail

DEST="${1:?usage: dev_wheel.sh <modules_path>}"
VERSION="${PYTINCTURE_DEV_WHEEL_VERSION:-99.99.99}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"

[ -d "$DEST" ] || { echo "no such modules_path: $DEST" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -C "$ROOT" --exclude=.git --exclude=__pycache__ --exclude=build \
    --exclude=dist --exclude=.venv -cf - . | tar -C "$WORK" -xf -

sed -i "s/^version = \".*\"$/version = \"$VERSION\"/" "$WORK/pyproject.toml"
grep -q "pytincture-assets.json" "$WORK/MANIFEST.in" || \
    sed -i '1i include wapyt/pytincture-assets.json' "$WORK/MANIFEST.in"

"$PYTHON" "$ROOT/scripts/generate_assets_manifest.py" "$WORK"
"$PYTHON" -m pip wheel "$WORK" --no-deps -w "$WORK/dist" >/dev/null

rm -f "$DEST"/wapyt-*-py3-none-any.whl
cp "$WORK/dist/wapyt-$VERSION-py3-none-any.whl" "$DEST/"
echo "installed wapyt-$VERSION into $DEST -- restart the service to pick it up"
