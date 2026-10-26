#!/usr/bin/env bash
#
# Download, verify and install a published Life Logger package on the server.
#
#   sudo packaging/install-release.sh v0.3.6-increment-3.5
#   packaging/install-release.sh v0.3.6-increment-3.5 --dry-run
#
# The package is kept in the cache, the service and backup timer are enabled,
# and /health must report the new version. If it does not, the previous cached
# package is reinstalled and the service restarted. This script never edits
# /etc/lifelogger.env and never touches /var/lib/lifelogger.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-release.sh <tag> [--dry-run]

  <tag>       Release tag, for example v0.3.6-increment-3.5.
  --dry-run   Print the plan and exit without downloading or installing.

Environment overrides:
  REPO            GitHub repository            (default Marvelous616/you)
  PKGREL          Package release number       (default 1)
  CACHE_DIR       Keep downloaded packages in  (default /var/cache/lifelogger)
  BASE_URL        Release download base        (default GitHub releases)
  HEALTH_URL      Health endpoint              (default http://127.0.0.1:8080/health)
  HEALTH_ATTEMPTS Attempts before rollback     (default 20)
  HEALTH_DELAY    Seconds between attempts     (default 1)
  PACMAN          pacman binary                (default pacman)
  SYSTEMCTL       systemctl binary             (default systemctl)
  CURL            curl binary                  (default curl)
EOF
}

TAG=""
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$TAG" ]; then
        echo "Only one tag may be given." >&2
        exit 2
      fi
      TAG="$arg"
      ;;
  esac
done

if [ -z "$TAG" ]; then
  usage >&2
  exit 2
fi

if [[ ! "$TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)(-[A-Za-z0-9._-]+)?$ ]]; then
  echo "Invalid release tag: $TAG" >&2
  exit 2
fi
PKGVER="${BASH_REMATCH[1]}"

REPO="${REPO:-Marvelous616/you}"
PKGREL="${PKGREL:-1}"
CACHE_DIR="${CACHE_DIR:-/var/cache/lifelogger}"
BASE_URL="${BASE_URL:-https://github.com/${REPO}/releases/download/${TAG}}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_DELAY="${HEALTH_DELAY:-1}"
PACMAN="${PACMAN:-pacman}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
CURL="${CURL:-curl}"

FILENAME="lifelogger-${PKGVER}-${PKGREL}-any.pkg.tar.zst"
PACKAGE_PATH="$CACHE_DIR/$FILENAME"

if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

for unit in lifelogger.service lifelogger-backup.service lifelogger-backup.timer; do
  if [ -f "/etc/systemd/system/$unit" ]; then
    echo "An administrator unit at /etc/systemd/system/$unit shadows the package." >&2
    echo "Remove the old deploy units first; the migration steps are in packaging/README.md." >&2
    exit 4
  fi
done

PREV_VER="$("$PACMAN" -Q lifelogger 2>/dev/null | awk '{print $2}' | sed -E 's/-[^-]+$//' || true)"
find_previous_package() {
  local version="$1"
  [ -n "$version" ] || return 0
  find "$CACHE_DIR" /var/cache/pacman/pkg -maxdepth 1 -type f \
    -name "lifelogger-${version}-*.pkg.tar.zst" -printf '%T@ %p\n' 2>/dev/null |
    sort -nr | head -1 | cut -d' ' -f2- || true
}
PREV_PACKAGE="$(find_previous_package "$PREV_VER")"

download() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ curl -fL --proto '=https' -o $PACKAGE_PATH $BASE_URL/$FILENAME"
    echo "+ curl -fL --proto '=https' -o $PACKAGE_PATH.sha256 $BASE_URL/$FILENAME.sha256"
    return 0
  fi
  mkdir -p "$CACHE_DIR"
  "$CURL" -fL --proto '=https' --tlsv1.2 -o "$PACKAGE_PATH" "$BASE_URL/$FILENAME"
  "$CURL" -fL --proto '=https' --tlsv1.2 -o "$PACKAGE_PATH.sha256" "$BASE_URL/$FILENAME.sha256"
  ( cd "$CACHE_DIR" && sha256sum -c "$FILENAME.sha256" )
}

verify_health() {
  local body
  for _attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    body="$("$CURL" -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null || true)"
    case "$body" in
      *"\"version\":\"${PKGVER}\""*) return 0 ;;
    esac
    sleep "$HEALTH_DELAY"
  done
  return 1
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ $*"
  else
    "$@"
  fi
}

echo "== Life Logger ${PKGVER} =="
echo "Tag:        $TAG"
echo "Package:    $FILENAME"
echo "Source:     $BASE_URL"
echo "Previous:   ${PREV_VER:-none}${PREV_PACKAGE:+ ($PREV_PACKAGE)}"

if [ "$DRY_RUN" -eq 0 ]; then
  exec 9>/run/lifelogger-install.lock
  flock -n 9 || {
    echo "Another install is already running." >&2
    exit 3
  }
fi

download
run "$PACMAN" -U --noconfirm "$PACKAGE_PATH"
run "$SYSTEMCTL" daemon-reload
run "$SYSTEMCTL" enable --now lifelogger.service lifelogger-backup.timer
run "$SYSTEMCTL" restart lifelogger.service

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: nothing was downloaded or installed."
  exit 0
fi

if verify_health; then
  echo "Health check passed: ${PKGVER} is running."
  exit 0
fi

echo "Health check failed for ${PKGVER} at ${HEALTH_URL}." >&2
if [ -n "$PREV_PACKAGE" ] && [ -f "$PREV_PACKAGE" ]; then
  echo "Rolling back to ${PREV_VER} from ${PREV_PACKAGE}" >&2
  "$PACMAN" -U --noconfirm "$PREV_PACKAGE"
  "$SYSTEMCTL" restart lifelogger.service
  echo "Rolled back to ${PREV_VER}." >&2
else
  echo "No cached package for the previous version; roll back manually." >&2
  echo "Inspect: journalctl -u lifelogger -n 100 --no-pager" >&2
fi
exit 1
