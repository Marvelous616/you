#!/usr/bin/env bash
#
# Publish the current commit as the Life Logger release on GitHub.
#
#   packaging/release.sh
#
# Order matters: the tag must be on GitHub before makepkg runs, because the
# PKGBUILD builds from `git+https://...#tag=...`. If the package build fails, the
# tag stays on GitHub with no release; fix the tree, force-update the tag and
# run this script again.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO="${REPO:-Marvelous616/you}"
PKGVER="$(node -p "require('./package.json').version")"
TAG="v${PKGVER}-increment-3.5"
ARTIFACT="packaging/lifelogger-${PKGVER}-1-any.pkg.tar.zst"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The worktree has uncommitted changes. Commit them first." >&2
  exit 1
fi

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Releases are cut from main." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required to create the release." >&2
  exit 1
fi
gh auth status >/dev/null 2>&1 || {
  echo "gh is not authenticated. Run: gh auth login" >&2
  exit 1
}

( cd packaging && makepkg --printsrcinfo >.SRCINFO )
if ! git diff --quiet -- packaging/.SRCINFO; then
  echo "packaging/.SRCINFO is out of date. Commit the regenerated file first." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  if [ "$(git rev-parse "${TAG}^{commit}")" != "$(git rev-parse HEAD)" ]; then
    echo "Tag ${TAG} already exists on another commit. Bump the version." >&2
    exit 1
  fi
else
  git tag -a "${TAG}" -m "Life Logger ${PKGVER} (packaged release)"
fi

echo "== Pushing main and ${TAG} =="
git push origin main
git push origin "${TAG}"

echo "== Building the package =="
packaging/build.sh

echo "== Creating the GitHub release =="
# GitHub renames a leading-dot asset; upload the generated metadata under a
# plain SRCINFO name while keeping .SRCINFO in the repository.
SRCINFO_DIR="$(mktemp -d)"
trap 'rm -rf "$SRCINFO_DIR"' EXIT
cp packaging/.SRCINFO "$SRCINFO_DIR/SRCINFO"
gh release create "${TAG}" \
  "${ARTIFACT}" \
  "${ARTIFACT}.sha256" \
  packaging/PKGBUILD \
  "$SRCINFO_DIR/SRCINFO" \
  --repo "$REPO" \
  --title "Life Logger ${PKGVER}" \
  --notes "Pacman package for Life Logger ${PKGVER}.

Install on Arch:

    curl -fLO https://github.com/${REPO}/releases/download/${TAG}/$(basename "${ARTIFACT}")
    curl -fLO https://github.com/${REPO}/releases/download/${TAG}/$(basename "${ARTIFACT}").sha256
    sha256sum -c $(basename "${ARTIFACT}").sha256
    sudo pacman -U $(basename "${ARTIFACT}")

Or run \`packaging/install-release.sh ${TAG}\` on the server, which also
restarts the service, checks /health and rolls back to the cached previous
package on failure."

echo
echo "Release: https://github.com/${REPO}/releases/tag/${TAG}"
