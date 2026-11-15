#!/usr/bin/env bash
#
# Build a Life Logger release tarball for Debian deployment.
#
#   packaging/debian/build-release.sh
#
# Requires: the web app and server bundle to be built first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKGVER="$(node -p "require('../../package.json').version")"
RELEASE_DIR="$ROOT/releases"
TARBALL="$RELEASE_DIR/lifelogger-${PKGVER}.tar.gz"
VERSION_DIR="$RELEASE_DIR/v${PKGVER}"

if [ -z "$PKGVER" ]; then
  echo "Could not read version from package.json." >&2
  exit 1
fi

# Clean and recreate the release directory.
rm -rf "$VERSION_DIR"
mkdir -p "$VERSION_DIR"

echo "== Building release tarball for v${PKGVER} =="

# Server bundle.
if [ ! -f "../../apps/server/dist/index.js" ]; then
  echo "Server build not found. Run: npm run build" >&2
  exit 1
fi
node ../bundle-server.mjs "$VERSION_DIR/server.cjs"

# Web build.
if [ ! -d "../../apps/web/dist" ]; then
  echo "Web build not found. Run: npm run --workspace=@life-logger/web build" >&2
  exit 1
fi
cp -r ../../apps/web/dist/. "$VERSION_DIR/web/"

# Package defaults and version.
cp ../lifelogger.env "$VERSION_DIR/lifelogger.env"
printf 'APP_VERSION=%s\n' "$PKGVER" > "$VERSION_DIR/version.env"
chmod 0644 "$VERSION_DIR/version.env"

# Scripts.
cp ../backup.sh "$VERSION_DIR/backup.sh"
cp ../restore.sh "$VERSION_DIR/restore.sh"
cp ../lifelogger-runner "$VERSION_DIR/lifelogger-runner"
chmod +x "$VERSION_DIR/backup.sh" "$VERSION_DIR/restore.sh" "$VERSION_DIR/lifelogger-runner"

# Systemd units.
cp ../lifelogger.service "$VERSION_DIR/lifelogger.service"
cp ../lifelogger-backup.service "$VERSION_DIR/lifelogger-backup.service"
cp ../lifelogger-backup.timer "$VERSION_DIR/lifelogger-backup.timer"

# Create tarball.
rm -f "$TARBALL"
tar -czf "$TARBALL" -C "$RELEASE_DIR" "v${PKGVER}"
sha256sum "$TARBALL" >"${TARBALL}.sha256"

echo
echo "Tarball:  $TARBALL"
echo "Checksum: ${TARBALL}.sha256"
echo "Size:     $(stat -c%s "$TARBALL") bytes"
echo "Deploy:   sudo packaging/debian/install-release.sh $TARBALL"
