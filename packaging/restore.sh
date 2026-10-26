#!/usr/bin/env bash
#
# Restore a Life Logger database from a backup file.
#
# This stops the service, moves the live database aside, installs the chosen
# backup, removes stale WAL/SHM files, starts the service and health-checks it.
# It refuses to run without an explicit --yes.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: restore.sh <backup.db> --yes

  <backup.db>  Backup file to restore.
  --yes        Required confirmation for the destructive restore.

Environment overrides:
  DB_PATH         Live database            (default /var/lib/lifelogger/life.db)
  SERVICE_NAME    systemd service name     (default lifelogger)
  SYSTEMCTL       systemctl binary         (default systemctl)
  SUDO            command prefix           (default sudo; empty disables)
  CURL            curl binary              (default curl)
  HEALTH_URL      Health endpoint          (default http://127.0.0.1:8080/health)
  HEALTH_ATTEMPTS Health check attempts    (default 10)
  HEALTH_DELAY    Seconds between attempts (default 1)
  OWNER           File owner when run root (default lifelogger)
  GROUP           File group when run root (default lifelogger)
EOF
}

BACKUP=""
CONFIRMED=0

for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=1 ;;
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
      if [ -n "$BACKUP" ]; then
        echo "Only one backup path may be given" >&2
        exit 2
      fi
      BACKUP="$arg"
      ;;
  esac
done

if [ -z "$BACKUP" ]; then
  usage >&2
  exit 2
fi

if [ ! -f "$BACKUP" ]; then
  echo "Backup not found: $BACKUP" >&2
  exit 2
fi

if [ "$CONFIRMED" -ne 1 ]; then
  echo "Refusing to restore without --yes." >&2
  echo "The live database at ${DB_PATH:-/var/lib/lifelogger/life.db} would be replaced." >&2
  exit 3
fi

DB_PATH="${DB_PATH:-/var/lib/lifelogger/life.db}"
SERVICE_NAME="${SERVICE_NAME:-lifelogger}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SUDO="${SUDO-sudo}"
CURL="${CURL:-curl}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-10}"
HEALTH_DELAY="${HEALTH_DELAY:-1}"
SQLITE3="${SQLITE3:-sqlite3}"
OWNER="${OWNER:-lifelogger}"
GROUP="${GROUP:-lifelogger}"

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

echo "Checking backup integrity: $BACKUP"
integrity="$("$SQLITE3" "$BACKUP" 'PRAGMA integrity_check;')"
if [ "$integrity" != "ok" ]; then
  echo "Refusing to restore a corrupt backup: $integrity" >&2
  exit 4
fi

echo "Stopping $SERVICE_NAME"
run_systemctl stop "$SERVICE_NAME"

mkdir -p "$(dirname "$DB_PATH")"

if [ -f "$DB_PATH" ]; then
  aside="$DB_PATH.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "Moving live database to $aside"
  mv "$DB_PATH" "$aside"
fi

rm -f "$DB_PATH-wal" "$DB_PATH-shm"

echo "Restoring $BACKUP to $DB_PATH"
cp "$BACKUP" "$DB_PATH"
chmod 600 "$DB_PATH"
if [ "$(id -u)" -eq 0 ]; then
  chown "$OWNER:$GROUP" "$DB_PATH"
fi

echo "Starting $SERVICE_NAME"
run_systemctl start "$SERVICE_NAME"

if health_check; then
  echo "Restore complete; health check passed"
  exit 0
fi

echo "Restore finished but the health check failed. Inspect: journalctl -u $SERVICE_NAME -n 100" >&2
exit 1
