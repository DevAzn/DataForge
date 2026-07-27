#!/usr/bin/env bash
# Start DataForge Vue dev server (proxies /api -> :8765) — Linux / macOS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
cd "$FRONTEND"

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found. Install Node.js 18+ (https://nodejs.org/)" >&2
  exit 1
fi

if [[ ! -d "$FRONTEND/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "UI: http://localhost:5173  (prefer localhost over 127.0.0.1 on some Linux setups)"
exec npm run dev -- --host 127.0.0.1 --port 5173
