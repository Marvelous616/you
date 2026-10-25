#!/usr/bin/env bash
#
# Deploy one release tag to the Life Logger home server.
#
# The build happens in a private worktree under $APP_ROOT/releases. The live
# database is backed up before the current symlink moves, and a failed health
# check restores the previous release.
#
# Everything host-specific can be overridden from the environment so the tests
# can run against a temporary directory with stubs. Run as the repository owner
# (post-receive does this); systemctl is called through sudo.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: deploy.sh <tag> [--dry-run]

  <tag>       Release tag, for example v0.4.0-increment-4.
  --dry-run   Print what would happen and exit without changing anything.

Environment overrides:
  APP_ROOT        Application root                 (default /opt/lifelogger)
  DB_PATH         SQLite database                  (default /var/lib/lifelogger/life.db)
  BACKUP_DIR      Pre-deploy backup directory      (default /var/lib/lifelogger/backups)
  VERSION_FILE    Release marker read by systemd   (default $APP_ROOT/version.env)
  SERVICE_NAME    systemd service name             (default lifelogger)
  SYSTEMCTL       systemctl binary                 (default systemctl)
  SUDO            command prefix for systemctl     (default sudo; empty disables)
  CURL            curl binary                      (default curl)
  HEALTH_URL      Health endpoint                  (default http://127.0.0.1:8080/health)
  HEALTH_ATTEMPTS Health check attempts            (default 10)
  HEALTH_DELAY    Seconds between attempts         (default 1)
  KEEP_RELEASES   Releases to keep after success   (default 5)
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
        echo "Only one tag may be given" >&2
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

if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$ ]]; then
  echo "Refusing to deploy invalid tag: $TAG" >&2
  exit 2
fi

APP_ROOT="${APP_ROOT:-/opt/lifelogger}"
DB_PATH="${DB_PATH:-/var/lib/lifelogger/life.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/lifelogger/backups}"
VERSION_FILE="${VERSION_FILE:-$APP_ROOT/version.env}"
SERVICE_NAME="${SERVICE_NAME:-lifelogger}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SUDO="${SUDO-sudo}"
CURL="${CURL:-curl}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-10}"
HEALTH_DELAY="${HEALTH_DELAY:-1}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"
REPO="$APP_ROOT/repo.git"
LOCK="$APP_ROOT/.deploy.lock"
RELEASE_DIR="$RELEASES/$TAG"

read_version() {
  if [ -f "$VERSION_FILE" ]; then
    sed -n 's/^APP_VERSION=//p' "$VERSION_FILE" | tail -n 1
  fi
}

write_version() {
  local tmp="$VERSION_FILE.tmp.$$"
  printf 'APP_VERSION=%s\n' "$1" >"$tmp"
  mv "$tmp" "$VERSION_FILE"
}

run_systemctl() {
  if [ -n "$SUDO" ]; then
    "$SUDO" -n "$SYSTEMCTL" "$@"
  else
    "$SYSTEMCTL" "$@"
  fi
}

health_check() {
  for _attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if "$CURL" -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

prune_releases() {
  local current
  current="$(readlink "$CURRENT" 2>/dev/null || true)"

  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null |
    sort -rn |
    tail -n "+$((KEEP_RELEASES + 1))" |
    cut -d' ' -f2- |
    while IFS= read -r old_release; do
      if [ "$old_release" = "$current" ]; then
        continue
      fi
      git -C "$REPO" worktree remove --force "$old_release" >/dev/null 2>&1 ||
        rm -rf "$old_release"
      echo "Pruned old release: $old_release"
    done
}

PREV="$(readlink "$CURRENT" 2>/dev/null || true)"
PREV_VERSION="$(read_version)"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: would deploy $TAG"
  echo "  app root:    $APP_ROOT"
  echo "  release:     $RELEASE_DIR"
  echo "  previous:    ${PREV:-none}"
  echo "  previous ver ${PREV_VERSION:-none}"
  echo "  health URL:  $HEALTH_URL"
  exit 0
fi

mkdir -p "$RELEASES" "$BACKUP_DIR"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "Another deploy is already running" >&2
  exit 3
fi

if [ -e "$RELEASE_DIR" ]; then
  echo "Release directory already exists: $RELEASE_DIR" >&2
  exit 4
fi

DEPLOY_DONE=0

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$DEPLOY_DONE" -ne 1 ] && [ -d "$RELEASE_DIR" ]; then
    git -C "$REPO" worktree remove --force "$RELEASE_DIR" >/dev/null 2>&1 ||
      rm -rf "$RELEASE_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT

echo "Deploying $TAG"
git -C "$REPO" worktree add "$RELEASE_DIR" "$TAG"

(
  cd "$RELEASE_DIR"
  npm ci
  APP_VERSION="$TAG" npm run build
)

if [ -f "$DB_PATH" ]; then
  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/pre-$TAG.db"
  echo "Backing up database to $backup"
  sqlite3 "$DB_PATH" ".backup '$backup'"
else
  echo "No database at $DB_PATH; skipping pre-deploy backup"
fi

write_version "$TAG"
ln -sfn "$RELEASE_DIR" "$CURRENT"

echo "Restarting $SERVICE_NAME"
run_systemctl restart "$SERVICE_NAME"

if health_check; then
  DEPLOY_DONE=1
  echo "Deployed $TAG; health check passed"
  prune_releases || true
  exit 0
fi

echo "Health check failed for $TAG" >&2

if [ -n "$PREV" ]; then
  ln -sfn "$PREV" "$CURRENT"
  if [ -n "$PREV_VERSION" ]; then
    write_version "$PREV_VERSION"
  else
    rm -f "$VERSION_FILE"
  fi
  run_systemctl restart "$SERVICE_NAME" || true
  echo "Rolled back to $PREV" >&2
else
  echo "No previous release to roll back to; service may be down" >&2
fi

exit 1
