#!/usr/bin/env bash
#
# Debian deployment for Life Logger.
#
# Unpacks a release tarball, switches the current link, restarts the service,
# and requires /health to report the new version. On failure it reinstalls the
# previous release. The database (/var/lib/lifelogger) and /etc/lifelogger.env
# are never touched by this script.
#
#   sudo packaging/debian/install-release.sh /path/to/lifelogger-0.3.6.tar.gz
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-release.sh <tarball> [--dry-run]

  <tarball>   Path to a Life Logger release tarball, e.g.
              lifelogger-0.3.6.tar.gz
  --dry-run   Print the plan and exit without changing anything.

Environment overrides:
  RELEASE_DIR   Where releases live       (default /opt/lifelogger/releases)
  RUNNER        Runner binary             (default /usr/bin/lifelogger)
  UNIT_DIR      systemd unit directory    (default /etc/systemd/system)
  HEALTH_URL    Health endpoint           (default http://127.0.0.1:8080/health)
  HEALTH_ATTEMPTS Attempts before rollback (default 20)
  HEALTH_DELAY    Seconds between attempts (default 1)
  SYSTEMCTL     systemctl binary          (default systemctl)
EOF
}

TARBALL=""
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
      if [ -n "$TARBALL" ]; then
        echo "Only one tarball may be given." >&2
        exit 2
      fi
      TARBALL="$arg"
      ;;
  esac
done

if [ -z "$TARBALL" ]; then
  usage >&2
  exit 2
fi

if [ ! -f "$TARBALL" ]; then
  echo "Tarball not found: $TARBALL" >&2
  exit 2
fi

if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

RELEASE_DIR="${RELEASE_DIR:-/opt/lifelogger/releases}"
RUNNER="${RUNNER:-/usr/bin/lifelogger}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_DELAY="${HEALTH_DELAY:-1}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

TARBALL_NAME="$(basename "$TARBALL")"
# Strip "lifelogger-" prefix and ".tar.gz" suffix to get the version number.
VERSION="${TARBALL_NAME#lifelogger-}"
VERSION="${VERSION%.tar.gz}"
RELEASE_NAME="v${VERSION}"
NEW_RELEASE="$RELEASE_DIR/$RELEASE_NAME"

echo "== Life Logger Debian deploy =="
echo "Tarball:    $TARBALL"
echo "Version:    $VERSION"
echo "Release:    $RELEASE_NAME"
echo "Release dir: $RELEASE_DIR"
echo "New release: $NEW_RELEASE"

if [ "$DRY_RUN" -eq 0 ]; then
  exec 9>/run/lifelogger-deploy.lock
  flock -n 9 || {
    echo "Another deploy is already running." >&2
    exit 3
  }
fi

# Determine the previous release for rollback.
previous_release() {
  if [ -L "$RELEASE_DIR/current" ]; then
    readlink -f "$RELEASE_DIR/current" 2>/dev/null || true
  fi
}
PREV_RELEASE="$(previous_release)"

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ $*"
  else
    "$@"
  fi
}

# Stop the service before deploying.
if [ "$DRY_RUN" -eq 0 ]; then
  echo "Stopping lifelogger.service..."
  run "$SYSTEMCTL" stop lifelogger.service || true
fi

# Unpack the new release.
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ mkdir -p $RELEASE_DIR"
  echo "+ tar -xzf $TARBALL -C $RELEASE_DIR"
else
  mkdir -p "$RELEASE_DIR"
  tar -xzf "$TARBALL" -C "$RELEASE_DIR"
fi

# Make scripts executable.
if [ "$DRY_RUN" -eq 0 ]; then
  chmod +x "$NEW_RELEASE/backup.sh" "$NEW_RELEASE/restore.sh" "$NEW_RELEASE/lifelogger-runner"
fi

# Switch the current symlink.
if [ "$DRY_RUN" -eq 0 ]; then
  ln -sfn "$RELEASE_NAME" "$RELEASE_DIR/current"
fi

# Install systemd units.
if [ "$DRY_RUN" -eq 0 ]; then
  cp "$NEW_RELEASE/lifelogger.service" "$UNIT_DIR/lifelogger.service"
  cp "$NEW_RELEASE/lifelogger-backup.service" "$UNIT_DIR/lifelogger-backup.service"
  cp "$NEW_RELEASE/lifelogger-backup.timer" "$UNIT_DIR/lifelogger-backup.timer"
  cp "$NEW_RELEASE/lifelogger-runner" "$RUNNER"
  chmod +x "$RUNNER"
  run "$SYSTEMCTL" daemon-reload
fi

# Start the service.
if [ "$DRY_RUN" -eq 0 ]; then
  run "$SYSTEMCTL" start lifelogger.service
fi

# Health check.
verify_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    local body
    body="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null || true)"
    case "$body" in
      *"\"version\":\"${VERSION}\""*) return 0 ;;
    esac
    sleep "$HEALTH_DELAY"
  done
  return 1
}

rollback() {
  echo "Health check failed for $VERSION at $HEALTH_URL." >&2
  if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ] && [ "$PREV_RELEASE" != "$NEW_RELEASE" ]; then
    echo "Rolling back to $(basename "$PREV_RELEASE")" >&2
    if [ "$DRY_RUN" -eq 0 ]; then
      run "$SYSTEMCTL" stop lifelogger.service || true
      ln -sfn "$(basename "$PREV_RELEASE")" "$RELEASE_DIR/current"
      cp "$PREV_RELEASE/lifelogger.service" "$UNIT_DIR/lifelogger.service"
      cp "$PREV_RELEASE/lifelogger-backup.service" "$UNIT_DIR/lifelogger-backup.service"
      cp "$PREV_RELEASE/lifelogger-backup.timer" "$UNIT_DIR/lifelogger-backup.timer"
      cp "$PREV_RELEASE/lifelogger-runner" "$RUNNER"
      chmod +x "$RUNNER"
      run "$SYSTEMCTL" daemon-reload
      run "$SYSTEMCTL" start lifelogger.service
    fi
    echo "Rolled back to $(basename "$PREV_RELEASE")." >&2
  else
    echo "No previous release to roll back to." >&2
  fi
  exit 1
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: nothing was changed."
  exit 0
fi

if verify_health; then
  echo "Health check passed: $VERSION is running."
  echo "Previous release kept at $PREV_RELEASE for rollback."
  exit 0
fi

rollback
