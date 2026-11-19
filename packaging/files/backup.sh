#!/usr/bin/env bash
#
# Consistent SQLite backup for the packaged Life Logger service.
# Exits non-zero if the copy fails or PRAGMA integrity_check is not ok.
set -euo pipefail

DB_PATH="${DB_PATH:-/var/lib/lifelogger/life-logger.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/lifelogger/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SQLITE3="${SQLITE3:-sqlite3}"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/life-logger-$timestamp.db"
temporary="$BACKUP_DIR/.life-logger-$timestamp.db.tmp"

remove_temporary() {
  rm -f "$temporary"
}
trap remove_temporary EXIT

echo "Backing up $DB_PATH to $target"
if ! "$SQLITE3" "$DB_PATH" ".backup '$temporary'"; then
  echo "sqlite3 backup failed" >&2
  exit 1
fi

integrity="$("$SQLITE3" "$temporary" 'PRAGMA integrity_check;')"
if [ "$integrity" != "ok" ]; then
  echo "Backup failed integrity check: $integrity" >&2
  exit 1
fi

chmod 600 "$temporary"
mv "$temporary" "$target"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f -name 'life-logger-*.db' \
  -mtime "+$RETENTION_DAYS" -print -delete

echo "Backup complete: $target"
