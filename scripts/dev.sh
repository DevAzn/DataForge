#!/usr/bin/env bash
# Optional: start API + UI in one terminal (Linux / macOS). Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bash "$ROOT/scripts/start-backend.sh" &
# give API a moment to bind
sleep 1
bash "$ROOT/scripts/start-frontend.sh" &
wait
