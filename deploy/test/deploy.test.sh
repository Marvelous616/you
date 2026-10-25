#!/usr/bin/env bash
#
# Stub-based tests for the deploy, backup, restore and post-receive scripts.
#
# systemctl, curl, sqlite3, git, npm, flock, ln and readlink are replaced with
# small stubs in a temporary directory, so this runs anywhere bash does.
# Run with: bash deploy/test/deploy.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HERE/../deploy.sh"
BACKUP="$HERE/../backup.sh"
RESTORE="$HERE/../restore.sh"
POST_RECEIVE="$HERE/../post-receive"

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

BIN="$WORK/bin"
LOG="$WORK/commands.log"
LINK_STATE="$WORK/current-link"
mkdir -p "$BIN"
: >"$LOG"
export WORK LOG LINK_STATE

cat >"$BIN/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >>"$LOG"
if [ "${4:-}" = "add" ]; then mkdir -p "${5:?}"; fi
if [ "${4:-}" = "remove" ]; then rm -rf "${6:?}"; fi
exit 0
STUB

cat >"$BIN/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $*" >>"$LOG"
exit 0
STUB

cat >"$BIN/flock" <<'STUB'
#!/usr/bin/env bash
echo "flock $*" >>"$LOG"
exit 0
STUB

cat >"$BIN/systemctl" <<'STUB'
#!/usr/bin/env bash
echo "systemctl $*" >>"$LOG"
exit 0
STUB

cat >"$BIN/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >>"$LOG"
if [ -f "$WORK/health-fail" ]; then
  exit 22
fi
printf '{"status":"ok"}\n'
STUB

cat >"$BIN/sqlite3" <<'STUB'
#!/usr/bin/env bash
echo "sqlite3 $*" >>"$LOG"
if [ "${2:-}" = "PRAGMA integrity_check;" ]; then
  if [ "${SQLITE3_BAD_INTEGRITY:-0}" = "1" ]; then
    echo "corrupt"
  else
    echo "ok"
  fi
  exit 0
fi
if [[ "${2:-}" == .backup* ]]; then
  if [ "${SQLITE3_BACKUP_FAIL:-0}" = "1" ]; then
    exit 1
  fi
  target="${2#.backup }"
  target="${target//\'/}"
  : >"$target"
  exit 0
fi
exit 0
STUB

cat >"$BIN/ln" <<'STUB'
#!/usr/bin/env bash
echo "ln $*" >>"$LOG"
printf '%s\n' "${2:-}" >"$LINK_STATE"
STUB

cat >"$BIN/readlink" <<'STUB'
#!/usr/bin/env bash
echo "readlink $*" >>"$LOG"
if [ -f "$LINK_STATE" ]; then cat "$LINK_STATE"; fi
STUB

chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

export APP_ROOT="$WORK/app"
export DB_PATH="$WORK/data/life.db"
export BACKUP_DIR="$WORK/backups"
export VERSION_FILE="$WORK/app/version.env"
export SERVICE_NAME="lifelogger"
export SYSTEMCTL="systemctl"
export CURL="curl"
export HEALTH_ATTEMPTS="2"
export HEALTH_DELAY="0"
export SUDO=""
export KEEP_RELEASES="5"

mkdir -p "$APP_ROOT" "$(dirname "$DB_PATH")"
printf 'live contents\n' >"$DB_PATH"
printf 'APP_VERSION=v0.0.1\n' >"$VERSION_FILE"

PASSED=0
FAILED=0

pass() {
  PASSED=$((PASSED + 1))
  printf 'ok - %s\n' "$1"
}

fail() {
  FAILED=$((FAILED + 1))
  printf 'not ok - %s\n' "$1" >&2
}

assert_eq() {
  if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 (expected [$2], got [$1])"; fi
}

assert_file_contains() {
  if grep -Fq -- "$2" "$1"; then pass "$3"; else fail "$3"; fi
}

assert_file_missing() {
  if grep -Fq -- "$2" "$1"; then fail "$3"; else pass "$3"; fi
}

# ---------------------------------------------------------------------------
# Successful deploy switches the current pointer and records the version.
# ---------------------------------------------------------------------------
rm -f "$WORK/health-fail"
: >"$LOG"

if "$DEPLOY" v1.2.3 >"$WORK/deploy-ok.log" 2>&1; then
  pass "successful deploy exits zero"
else
  fail "successful deploy exits zero"
  cat "$WORK/deploy-ok.log" >&2
fi

assert_eq "$(cat "$LINK_STATE")" "$APP_ROOT/releases/v1.2.3" "current points at the new release"
assert_eq "$(cat "$VERSION_FILE")" "APP_VERSION=v1.2.3" "version file records the deployed tag"
assert_file_contains "$LOG" "npm ci" "deploy installs dependencies"
assert_file_contains "$LOG" "npm run build" "deploy builds the release"
assert_file_contains "$LOG" "systemctl restart lifelogger" "deploy restarts the service"
assert_file_contains "$LOG" "sqlite3" "deploy backs up the database when it exists"

# A second successful deploy moves the pointer again.
if "$DEPLOY" v1.2.4 >"$WORK/deploy-second.log" 2>&1; then
  pass "second deploy exits zero"
else
  fail "second deploy exits zero"
fi
assert_eq "$(cat "$LINK_STATE")" "$APP_ROOT/releases/v1.2.4" "second deploy points at its release"

# ---------------------------------------------------------------------------
# A failed health check rolls back to the previous release and version.
# ---------------------------------------------------------------------------
touch "$WORK/health-fail"
: >"$LOG"

if "$DEPLOY" v1.2.5 >"$WORK/deploy-fail.log" 2>&1; then
  fail "failed health check exits non-zero"
else
  pass "failed health check exits non-zero"
fi

assert_eq "$(cat "$LINK_STATE")" "$APP_ROOT/releases/v1.2.4" "rollback restores the previous release"
assert_eq "$(cat "$VERSION_FILE")" "APP_VERSION=v1.2.4" "rollback restores the previous version"
assert_file_contains "$WORK/deploy-fail.log" "Rolled back" "rollback is reported"
if [ -d "$APP_ROOT/releases/v1.2.5" ]; then
  fail "failed release directory is removed"
else
  pass "failed release directory is removed"
fi
rm -f "$WORK/health-fail"

# ---------------------------------------------------------------------------
# Invalid tags are rejected before any build or service change.
# ---------------------------------------------------------------------------
: >"$LOG"
if "$DEPLOY" "v1.2" >"$WORK/deploy-bad.log" 2>&1; then
  fail "invalid tag is rejected"
else
  status=$?
  assert_eq "$status" "2" "invalid tag exits with status 2"
fi
assert_file_missing "$LOG" "npm" "invalid tag does not build"
assert_eq "$(cat "$LINK_STATE")" "$APP_ROOT/releases/v1.2.4" "invalid tag leaves current alone"

: >"$LOG"
if "$DEPLOY" "v1.2.3; echo pwned" >"$WORK/deploy-inject.log" 2>&1; then
  fail "tag with shell metacharacters is rejected"
else
  pass "tag with shell metacharacters is rejected"
fi
assert_file_missing "$LOG" "npm" "rejected tag does not build"

# ---------------------------------------------------------------------------
# Dry run changes nothing.
# ---------------------------------------------------------------------------
: >"$LOG"
if "$DEPLOY" v9.9.9 --dry-run >"$WORK/deploy-dry.log" 2>&1; then
  pass "dry run exits zero"
else
  fail "dry run exits zero"
fi
assert_file_contains "$WORK/deploy-dry.log" "Dry run" "dry run explains the plan"
assert_file_missing "$LOG" "npm" "dry run does not build"
assert_eq "$(cat "$LINK_STATE")" "$APP_ROOT/releases/v1.2.4" "dry run leaves current alone"

# ---------------------------------------------------------------------------
# post-receive deploys pushed v* tags only and ignores deletions and branches.
# ---------------------------------------------------------------------------
cat >"$WORK/fake-deploy.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1" >>"$WORK/deployed-tags"
STUB
chmod +x "$WORK/fake-deploy.sh"
: >"$WORK/deployed-tags"

printf 'old new refs/heads/main\nold new refs/tags/v1.2.6\nold %s refs/tags/v1.2.7\n' \
  "0000000000000000000000000000000000000000" |
  DEPLOY_SCRIPT="$WORK/fake-deploy.sh" "$POST_RECEIVE" >"$WORK/post-receive.log" 2>&1

assert_eq "$(cat "$WORK/deployed-tags")" "v1.2.6" "post-receive deploys only surviving v* tags"

# ---------------------------------------------------------------------------
# Restore refuses to run without --yes, then restores a valid backup.
# ---------------------------------------------------------------------------
backup_file="$WORK/restore-source.db"
printf 'backup contents\n' >"$backup_file"
printf 'live contents\n' >"$DB_PATH"
: >"$LOG"

if "$RESTORE" "$backup_file" >"$WORK/restore-refuse.log" 2>&1; then
  fail "restore without --yes is refused"
else
  status=$?
  assert_eq "$status" "3" "restore without --yes exits with status 3"
fi
assert_file_contains "$WORK/restore-refuse.log" "without --yes" "restore explains the confirmation"
assert_file_missing "$LOG" "systemctl stop" "refused restore does not stop the service"

if "$RESTORE" "$backup_file" --yes >"$WORK/restore.log" 2>&1; then
  pass "confirmed restore exits zero"
else
  fail "confirmed restore exits zero"
  cat "$WORK/restore.log" >&2
fi
assert_eq "$(cat "$DB_PATH")" "backup contents" "restore installs the chosen backup"
assert_file_contains "$LOG" "systemctl stop lifelogger" "restore stops the service"
assert_file_contains "$LOG" "systemctl start lifelogger" "restore starts the service"
if find "$WORK/data" -maxdepth 1 -name 'life.db.before-restore.*' | grep -q .; then
  pass "restore moves the live database aside"
else
  fail "restore moves the live database aside"
fi

# ---------------------------------------------------------------------------
# Backup writes a verified copy and fails on a corrupt copy.
# ---------------------------------------------------------------------------
printf 'live contents\n' >"$DB_PATH"
rm -rf "$BACKUP_DIR"
: >"$LOG"

if "$BACKUP" >"$WORK/backup.log" 2>&1; then
  pass "backup exits zero"
else
  fail "backup exits zero"
  cat "$WORK/backup.log" >&2
fi

backup_copy="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'life-logger-*.db' | head -n 1)"
if [ -n "$backup_copy" ]; then
  pass "backup creates a database copy"
else
  fail "backup creates a database copy"
fi
assert_file_contains "$LOG" "PRAGMA integrity_check;" "backup checks the copy"

if SQLITE3_BAD_INTEGRITY=1 "$BACKUP" >"$WORK/backup-bad.log" 2>&1; then
  fail "corrupt backup exits non-zero"
else
  pass "corrupt backup exits non-zero"
fi
if find "$BACKUP_DIR" -maxdepth 1 -name '*.tmp' | grep -q .; then
  fail "corrupt backup removes the temporary file"
else
  pass "corrupt backup removes the temporary file"
fi

# ---------------------------------------------------------------------------
printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
