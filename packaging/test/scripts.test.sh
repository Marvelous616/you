#!/usr/bin/env bash
#
# Stub-based tests for the packaged backup, restore and install-release scripts.
# systemctl, curl and sqlite3 are replaced with stubs in a temporary directory,
# so this runs anywhere bash does:
#
#   bash packaging/test/scripts.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP="$ROOT/packaging/backup.sh"
RESTORE="$ROOT/packaging/restore.sh"
INSTALL="$ROOT/packaging/install-release.sh"

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

BIN="$WORK/bin"
LOG="$WORK/commands.log"
mkdir -p "$BIN"
: >"$LOG"
export WORK LOG

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

chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

export DB_PATH="$WORK/data/life.db"
export BACKUP_DIR="$WORK/backups"
export SERVICE_NAME="lifelogger"
export SYSTEMCTL="systemctl"
export CURL="curl"
export HEALTH_ATTEMPTS="2"
export HEALTH_DELAY="0"
export SUDO=""

mkdir -p "$(dirname "$DB_PATH")"
printf 'live contents\n' >"$DB_PATH"

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
# install-release validates tags and shows the full plan in dry-run mode.
# The dry run must not need root, the network or a systemd unit.
# ---------------------------------------------------------------------------
if "$INSTALL" --help >"$WORK/install-help.log" 2>&1; then
  pass "install-release --help exits zero"
else
  fail "install-release --help exits zero"
fi

for bad_tag in "0.3.6" "v0.3" "v0.3.6;echo pwned"; do
  if "$INSTALL" "$bad_tag" --dry-run >"$WORK/install-bad.log" 2>&1; then
    fail "install-release rejects ${bad_tag}"
  else
    pass "install-release rejects ${bad_tag}"
  fi
done

if [ -f /etc/systemd/system/lifelogger.service ]; then
  pass "install-release unit-shadow check skipped (admin unit present on this host)"
else
  if CACHE_DIR="$WORK/cache" "$INSTALL" v0.3.6-increment-3.5 --dry-run \
    >"$WORK/install-dry.log" 2>&1; then
    pass "install-release dry run exits zero"
  else
    fail "install-release dry run exits zero"
    cat "$WORK/install-dry.log" >&2
  fi
  assert_file_contains "$WORK/install-dry.log" \
    "https://github.com/Marvelous616/you/releases/download/v0.3.6-increment-3.5/lifelogger-0.3.6-1-any.pkg.tar.zst" \
    "dry run resolves the release asset URL"
  assert_file_contains "$WORK/install-dry.log" "pacman -U --noconfirm" \
    "dry run shows the pacman install"
  assert_file_contains "$WORK/install-dry.log" "systemctl restart lifelogger.service" \
    "dry run shows the service restart"
  assert_file_missing "$LOG" "curl" "dry run does not download"
fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
