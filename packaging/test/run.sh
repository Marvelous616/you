#!/usr/bin/env bash
#
# Run the packaging checks. Requires `npm run build` to have produced
# apps/server/dist and apps/web/dist.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$HERE/package.test.sh"
bash "$HERE/scripts.test.sh"
