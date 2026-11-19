#!/usr/bin/env bash
# Safety-gate tests for the scripts installed by the Life Logger package.
# Uses stub commands so nothing touches a real service or package database.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILES="$ROOT/packaging/files"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BIN="$WORK/bin"
mkdir -p "$BIN" "$WORK/backups" "$WORK/cache"
printf 'backup data' >"$WORK/backups/stub.db"

export CACHE_DIR="$WORK/cache"
export LIFELOGGER_RELEASE_BASE="https://example.invalid/releases/download/v0.3.5"

cat >"$BIN/id" <<'EOF'
#!/bin/sh
echo "${STUB_UID:-0}"
EOF

cat >"$BIN/uname" <<'EOF'
#!/bin/sh
echo x86_64
EOF

cat >"$BIN/curl" <<'EOF'
#!/bin/sh
out=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "-o" ]; then out="$arg"; fi
  previous="$arg"
done
if [ -n "$out" ]; then
  case "$out" in
    *.sha256) printf '%064d  package\n' 0 >"$out" ;;
    *) printf 'stub package' >"$out" ;;
  esac
else
  printf '{"status":"ok","version":"0.3.5"}'
fi
EOF

cat >"$BIN/sqlite3" <<'EOF'
#!/bin/sh
case "$*" in
  *.backup*)
    target=$(printf '%s\n' "$*" | sed -n "s/.*\.backup '\([^']*\)'.*/\1/p")
    printf 'stub database' >"$target"
    ;;
  *) echo ok ;;
esac
EOF

for tool in systemctl pacman chown; do
  cat >"$BIN/$tool" <<EOF
#!/bin/sh
echo "\$@" >>"$WORK/$tool.log"
EOF
done

chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

PASS=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  printf 'ok   %s\n' "$1"
}

not_ok() {
  FAIL=$((FAIL + 1))
  printf 'FAIL %s\n' "$1"
}

expect_exit() {
  local expected="$1" label="$2"
  shift 2
  "$@" >"$WORK/output" 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then ok "$label"; else
    not_ok "$label (expected $expected, got $actual)"
    cat "$WORK/output"
  fi
}

expect_exit 0 'lifelogger-update --help' bash "$FILES/lifelogger-update" --help
expect_exit 2 'lifelogger-update rejects a bad version' bash "$FILES/lifelogger-update" v0.3.5
expect_exit 2 'lifelogger-update requires a version' bash "$FILES/lifelogger-update"
expect_exit 0 'lifelogger-update --dry-run installs nothing' \
  bash "$FILES/lifelogger-update" 0.3.5 --dry-run

if [ ! -f "$WORK/pacman.log" ]; then ok 'dry run never calls pacman'; else
  not_ok 'dry run never calls pacman'
fi

STUB_UID=1000 expect_exit 1 'lifelogger-update requires root' \
  bash "$FILES/lifelogger-update" 0.3.5 --dry-run

expect_exit 4 'lifelogger-update rejects a bad checksum' \
  bash "$FILES/lifelogger-update" 0.3.5

expect_exit 3 'restore.sh refuses without --yes' \
  env DB_PATH="$WORK/live.sqlite" bash "$FILES/restore.sh" "$WORK/backups/stub.db"

printf 'live data' >"$WORK/live.sqlite"
expect_exit 0 'restore.sh completes with --yes and stubbed commands' \
  env DB_PATH="$WORK/live.sqlite" HEALTH_ATTEMPTS=1 HEALTH_DELAY=0 \
    bash "$FILES/restore.sh" "$WORK/backups/stub.db" --yes

if grep -q 'stop lifelogger' "$WORK/systemctl.log" &&
  grep -q 'start lifelogger' "$WORK/systemctl.log"; then
  ok 'restore.sh stops and starts the service'
else
  not_ok 'restore.sh stops and starts the service'
fi

expect_exit 0 'backup.sh creates an integrity-checked backup' \
  env DB_PATH="$WORK/live.sqlite" BACKUP_DIR="$WORK/backups" \
    bash "$FILES/backup.sh"

if find "$WORK/backups" -maxdepth 1 -name 'life-logger-*.db' | grep -q .; then
  ok 'backup.sh wrote a timestamped backup'
else
  not_ok 'backup.sh wrote a timestamped backup'
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
