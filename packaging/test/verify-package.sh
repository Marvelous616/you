#!/usr/bin/env bash
#
# Verify a built package: file list, metadata, ownership boundaries and a smoke
# test of the bundled server extracted from the package.
#
#   packaging/test/verify-package.sh packaging/lifelogger-0.3.6-1-any.pkg.tar.zst \
#     packaging/lifelogger-0.3.6-1-any.pkg.tar.zst.sha256
set -euo pipefail

PKG="${1:-}"
SUM="${2:-}"

if [ -z "$PKG" ] || [ ! -f "$PKG" ]; then
  echo "Usage: verify-package.sh <package.pkg.tar.zst> [package.sha256]" >&2
  exit 2
fi

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

check_present() {
  if [ -e "$ROOT_DIR/$1" ]; then pass "package contains $1"; else fail "package contains $1"; fi
}

check_absent() {
  if [ -e "$ROOT_DIR/$1" ]; then fail "package must not own /$1"; else pass "package does not own /$1"; fi
}

if [ -n "$SUM" ]; then
  if ( cd "$(dirname "$PKG")" && sha256sum -c "$(basename "$SUM")" >/dev/null ); then
    pass "checksum matches $SUM"
  else
    fail "checksum matches $SUM"
  fi
fi

ROOT_DIR="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT_DIR"
}
trap cleanup EXIT

NODE="${NODE:-node}"
if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then
  echo "Node.js >= 22.5 is required for the packaged smoke test (found $("$NODE" -v 2>/dev/null || echo none))." >&2
  exit 2
fi
NODE="$(command -v "$NODE")"

bsdtar -xf "$PKG" -C "$ROOT_DIR"

PKGINFO="$ROOT_DIR/.PKGINFO"
FULLVER="$(awk -F' = ' '$1 == "pkgver" { print $2 }' "$PKGINFO")"
PKGREL="${FULLVER##*-}"
BASEVER="${FULLVER%-*}"

if grep -qx "pkgname = lifelogger" "$PKGINFO"; then pass "package name is lifelogger"; else fail "package name is lifelogger"; fi
if [ -n "$BASEVER" ] && grep -qx "pkgver = ${BASEVER}-${PKGREL}" "$PKGINFO"; then
  pass "package version is ${BASEVER}-${PKGREL}"
else
  fail "package version is ${BASEVER}-${PKGREL}"
fi
if grep -qx "arch = any" "$PKGINFO"; then pass "package is architecture independent"; else fail "package is architecture independent"; fi
if grep -qx "depend = nodejs>=22.5" "$PKGINFO"; then pass "package depends on nodejs>=22.5"; else fail "package depends on nodejs>=22.5"; fi
if grep -qx "depend = sqlite" "$PKGINFO"; then pass "package depends on sqlite"; else fail "package depends on sqlite"; fi

check_present usr/bin/lifelogger
check_present usr/lib/lifelogger/server.cjs
check_present usr/lib/lifelogger/web/index.html
check_present usr/lib/lifelogger/backup.sh
check_present usr/lib/lifelogger/restore.sh
check_present usr/lib/lifelogger/lifelogger.env
check_present usr/lib/lifelogger/version.env
check_present usr/lib/systemd/system/lifelogger.service
check_present usr/lib/systemd/system/lifelogger-backup.service
check_present usr/lib/systemd/system/lifelogger-backup.timer
check_present usr/lib/sysusers.d/lifelogger.conf
check_present usr/lib/tmpfiles.d/lifelogger.conf
check_present usr/share/doc/lifelogger/README.md

check_absent etc/lifelogger.env
check_absent var/lib/lifelogger
check_absent usr/lib/lifelogger/node_modules

if [ -x "$ROOT_DIR/usr/bin/lifelogger" ]; then pass "runner is executable"; else fail "runner is executable"; fi
if [ -x "$ROOT_DIR/usr/lib/lifelogger/backup.sh" ]; then pass "backup script is executable"; else fail "backup script is executable"; fi
if [ -x "$ROOT_DIR/usr/lib/lifelogger/restore.sh" ]; then pass "restore script is executable"; else fail "restore script is executable"; fi

if grep -qx "APP_VERSION=${BASEVER}" "$ROOT_DIR/usr/lib/lifelogger/version.env"; then
  pass "version.env records ${BASEVER}"
else
  fail "version.env records ${BASEVER}"
fi

if find "$ROOT_DIR/usr/lib/lifelogger/web" -name '*.js' -print -quit | grep -q .; then
  pass "web assets are packaged"
else
  fail "web assets are packaged"
fi

PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"
SMOKE_DB="$ROOT_DIR/smoke/life.db"
mkdir -p "$ROOT_DIR/smoke"

(
  cd "$ROOT_DIR/smoke"
  exec env APP_VERSION="$BASEVER" \
    DB_PATH="$SMOKE_DB" \
    WEB_DIR="$ROOT_DIR/usr/lib/lifelogger/web" \
    HOST=127.0.0.1 \
    PORT="$PORT" \
    LOG_LEVEL=silent \
    "$NODE" "$ROOT_DIR/usr/lib/lifelogger/server.cjs" >"$ROOT_DIR/smoke/server.log" 2>&1
) &
SERVER_PID=$!

HEALTH=""
for _attempt in $(seq 1 50); do
  HEALTH="$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 0.1
done

if [ -z "$HEALTH" ]; then
  echo "--- packaged server log ---" >&2
  cat "$ROOT_DIR/smoke/server.log" >&2 || true
fi

case "$HEALTH" in
  *"\"version\":\"${BASEVER}\""*) pass "packaged server answers /health with ${BASEVER}" ;;
  *) fail "packaged server answers /health with ${BASEVER} (got: $HEALTH)" ;;
esac

if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
  kill -TERM "$SERVER_PID"
  if wait "$SERVER_PID"; then
    pass "packaged server stops cleanly"
  else
    fail "packaged server stops cleanly"
  fi
  SERVER_PID=""
fi

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
