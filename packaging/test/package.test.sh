#!/usr/bin/env bash
#
# Static and runtime checks for the package inputs. Proves that the PKGBUILD
# version matches package.json, that the unit files point at packaged paths, and
# that the esbuild bundle starts and serves /health without node_modules.
#
# Run after `npm run build`, from the repository root:
#   bash packaging/test/package.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PKGVER="$(node -p "require('./package.json').version")"
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

check_file_contains() {
  if grep -Fq -- "$2" "$1"; then pass "$3"; else fail "$3"; fi
}

check_file_missing() {
  if grep -Fq -- "$2" "$1"; then fail "$3"; else pass "$3"; fi
}

check_path() {
  if [ -e "$1" ]; then pass "$2"; else fail "$2 ($1 missing)"; fi
}

# ---------------------------------------------------------------------------
# Version and source are consistent.
# ---------------------------------------------------------------------------
if grep -qx "pkgver=${PKGVER}" packaging/PKGBUILD; then
  pass "PKGBUILD pkgver matches package.json"
else
  fail "PKGBUILD pkgver matches package.json"
fi

check_file_contains packaging/PKGBUILD \
  "source=(\"\$pkgname-\$pkgver::git+\${url}.git#tag=\${_tag}\")" \
  "PKGBUILD builds from the release tag"
check_file_contains packaging/PKGBUILD "tag=\${_tag}" "PKGBUILD tag reference"
check_file_contains packaging/PKGBUILD "arch=('any')" "package is architecture independent"
check_file_contains packaging/PKGBUILD "depends=('nodejs>=22.5' 'sqlite')" \
  "runtime dependencies match node:sqlite and sqlite3"

# ---------------------------------------------------------------------------
# Units refer only to packaged paths and keep the hardening from the old unit.
# ---------------------------------------------------------------------------
SERVICE=packaging/lifelogger.service
check_file_contains "$SERVICE" "ExecStart=/usr/bin/node /usr/lib/lifelogger/server.cjs" \
  "service runs the bundled server"
check_file_contains "$SERVICE" "WorkingDirectory=/usr/lib/lifelogger" "service working directory"
check_file_contains "$SERVICE" "User=lifelogger" "service runs unprivileged"
check_file_contains "$SERVICE" "EnvironmentFile=-/etc/lifelogger.env" \
  "service loads the optional host environment"
check_file_contains "$SERVICE" "MemoryMax=1G" "service keeps the memory cap"
check_file_contains "$SERVICE" "ProtectSystem=strict" "service keeps systemd hardening"
check_file_contains "$SERVICE" "ReadWritePaths=/var/lib/lifelogger" "service can write its data"
check_file_missing "$SERVICE" "/opt/lifelogger" "service has no old deploy paths"

check_file_contains packaging/lifelogger-backup.service \
  "ExecStart=/usr/lib/lifelogger/backup.sh" "backup unit runs the packaged script"
check_file_contains packaging/lifelogger-backup.timer "OnCalendar=*-*-* 03:30:00" \
  "backup timer keeps its schedule"
check_file_contains packaging/lifelogger.sysusers "u lifelogger -" "sysusers creates the account"
check_file_contains packaging/lifelogger.tmpfiles "d /var/lib/lifelogger 0750" \
  "tmpfiles creates the data directory"

# ---------------------------------------------------------------------------
# Shell syntax.
# ---------------------------------------------------------------------------
for script in packaging/backup.sh packaging/restore.sh packaging/build.sh \
  packaging/release.sh packaging/install-release.sh packaging/test/package.test.sh \
  packaging/test/scripts.test.sh packaging/test/run.sh packaging/test/verify-package.sh; do
  if bash -n "$script"; then pass "bash syntax: $script"; else fail "bash syntax: $script"; fi
done

if sh -n packaging/lifelogger-runner; then
  pass "sh syntax: packaging/lifelogger-runner"
else
  fail "sh syntax: packaging/lifelogger-runner"
fi

# ---------------------------------------------------------------------------
# The bundle runs with no node_modules and passes a health check.
# ---------------------------------------------------------------------------
check_path apps/server/dist/index.js "server build output exists"
check_path apps/web/dist/index.html "web build output exists"

WORK="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

if node packaging/bundle-server.mjs "$WORK/server.cjs" >"$WORK/bundle.log" 2>&1; then
  pass "esbuild produces the server bundle"
else
  fail "esbuild produces the server bundle"
  cat "$WORK/bundle.log" >&2
fi

if [ -f "$WORK/server.cjs" ]; then
  pass "bundle file exists"
else
  fail "bundle file exists"
fi

PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"

(
  cd "$WORK"
  exec env APP_VERSION="$PKGVER" \
    DB_PATH="$WORK/life.db" \
    WEB_DIR="$ROOT/apps/web/dist" \
    HOST=127.0.0.1 \
    PORT="$PORT" \
    LOG_LEVEL=silent \
    node "$WORK/server.cjs" >"$WORK/server.log" 2>&1
) &
SERVER_PID=$!

HEALTH=""
for _attempt in $(seq 1 50); do
  HEALTH="$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 0.1
done

if [ -n "$HEALTH" ]; then
  pass "bundled server answers /health"
else
  fail "bundled server answers /health"
  cat "$WORK/server.log" >&2
fi

case "$HEALTH" in
  *"\"version\":\"${PKGVER}\""*) pass "health reports the package version" ;;
  *) fail "health reports the package version (got: $HEALTH)" ;;
esac

case "$HEALTH" in
  *'"database":"connected"'*) pass "health reports a connected database" ;;
  *) fail "health reports a connected database (got: $HEALTH)" ;;
esac

if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/" 2>/dev/null | grep -Fq '<div id="root">'; then
  pass "bundled server serves the web app"
else
  fail "bundled server serves the web app"
fi

if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
  kill -TERM "$SERVER_PID"
  if wait "$SERVER_PID"; then
    pass "server exits cleanly on SIGTERM"
  else
    fail "server exits cleanly on SIGTERM"
  fi
  SERVER_PID=""
else
  fail "server stays up until SIGTERM"
fi

if [ -f "$WORK/life.db" ]; then
  pass "bundled server creates the database"
else
  fail "bundled server creates the database"
fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
