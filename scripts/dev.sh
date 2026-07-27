#!/usr/bin/env bash
# Optional: start API + UI in one terminal. Ctrl+C stops both.
# bash: Linux, macOS, WSL, Git Bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cleanup() {
  # xargs -r is GNU; fall back for BSD/macOS
  if jobs -p | grep -q .; then
    jobs -p | xargs kill 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

bash "$ROOT/scripts/start-backend.sh" &
# give API a moment to bind
sleep 1
bash "$ROOT/scripts/start-frontend.sh" &
wait
