#!/usr/bin/env bash
#
# Build the Life Logger package on an Arch Linux machine.
#
# The PKGBUILD builds from the pushed release tag, so this script refuses to run
# until the tag exists on origin. Run it from anywhere inside the repository:
#
#   packaging/build.sh
#
# Requires: base-devel, git, nodejs (>= 22.5), npm and network access for npm ci.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKGVER="$(node -p "require('./package.json').version")"
TAG="v${PKGVER}-increment-3.5"
ARTIFACT="lifelogger-${PKGVER}-1-any.pkg.tar.zst"

if ! grep -qx "pkgver=${PKGVER}" packaging/PKGBUILD; then
  echo "packaging/PKGBUILD pkgver does not match package.json (${PKGVER})." >&2
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "Tag ${TAG} does not exist locally. Commit and run packaging/release.sh." >&2
  exit 1
fi

if ! git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "Tag ${TAG} is not pushed to origin; makepkg builds from GitHub." >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Warning: the worktree has uncommitted changes; the package is built from ${TAG}." >&2
fi

MAKEPKG_ARGS=(--cleanbuild --force --noconfirm)

# This PC's pacman `nodejs` provider is an older LTS, while a newer Node (nvm) is
# first on PATH. The PKGBUILD declares nodejs>=22.5 for correctness; when only
# the local provider is too old, verify the actual Node and skip pacman's check.
if ! pacman -T 'nodejs>=22.5' >/dev/null 2>&1; then
  if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then
    echo "Note: pacman's nodejs provider is older than 22.5; using Node $(node -v) from PATH (--nodeps)." >&2
    MAKEPKG_ARGS+=(--nodeps)
  else
    echo "Node.js >= 22.5 is required to build (found $(node -v 2>/dev/null || echo none))." >&2
    exit 1
  fi
fi

echo "== Building ${ARTIFACT} from ${TAG} =="
(
  cd packaging
  makepkg "${MAKEPKG_ARGS[@]}"
  sha256sum "$ARTIFACT" >"${ARTIFACT}.sha256"
)

packaging/test/verify-package.sh "packaging/${ARTIFACT}" "packaging/${ARTIFACT}.sha256"

echo
echo "Package:  ${ROOT}/packaging/${ARTIFACT}"
echo "Checksum: ${ROOT}/packaging/${ARTIFACT}.sha256"
echo "Install:  sudo pacman -U ${ROOT}/packaging/${ARTIFACT}"
