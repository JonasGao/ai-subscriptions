#!/usr/bin/env bash
# Rehearse the ADR-0017 JSON→SQLite migration on a copy of a legacy data
# directory. The source is never modified. Repeatable: each run uses a fresh
# scratch directory (or pass --work to inspect one).
#
#   server/scripts/migration-drill.sh                       # default prod path
#   server/scripts/migration-drill.sh /path/to/legacy-data  # explicit source
#
# All arguments after the optional source directory are forwarded to the Go
# command (e.g. --keep --work /tmp/drill).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_dir="$(cd "${script_dir}/.." && pwd)"

source_dir="${1:-${DATA_DIR:-$HOME/docker/ai-subscriptions/data}}"
if [[ $# -gt 0 ]]; then
  shift
fi

cd "${server_dir}"
exec go run ./cmd/migration-drill --source "${source_dir}" "$@"
