#!/usr/bin/env bash
# Runs shellcheck over every shell script shipped or tested by the package.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

shellcheck \
  packaging/files/backup.sh \
  packaging/files/restore.sh \
  packaging/files/lifelogger \
  packaging/files/lifelogger-update \
  packaging/test/package.test.sh \
  packaging/test/shellcheck.sh
