#!/usr/bin/env bash
# Start DataForge Vue dev server (proxies /api -> :8765)
# bash: Linux, macOS, WSL, Git Bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
cd "$FRONTEND"

version_ge() {
  # version_ge A B  → true if A >= B (dot-separated ints, major.minor)
  local a="$1" b="$2"
  local a_maj a_min b_maj b_min
  IFS=. read -r a_maj a_min _ <<<"$a"
  IFS=. read -r b_maj b_min _ <<<"$b"
  a_maj=${a_maj:-0}; a_min=${a_min:-0}
  b_maj=${b_maj:-0}; b_min=${b_min:-0}
  if (( a_maj > b_maj )); then return 0; fi
  if (( a_maj < b_maj )); then return 1; fi
  (( a_min >= b_min ))
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "error: Node.js / npm not found on PATH" >&2
  echo "       Need: Node.js 18+ (npm is bundled with Node)" >&2
  echo "       Install LTS: https://nodejs.org/" >&2
  echo "       Then re-run: ./scripts/start-frontend.sh" >&2
  echo "       Or install deps first: ./scripts/install.sh" >&2
  exit 1
fi

node_ver="$(node -v 2>/dev/null | sed 's/^v//')"
if ! version_ge "$node_ver" "18.0"; then
  echo "error: Node.js $node_ver found, but 18+ is required" >&2
  echo "       Install LTS: https://nodejs.org/" >&2
  echo "       Then re-run: ./scripts/start-frontend.sh" >&2
  exit 1
fi

# node_modules is committed; only npm install when incomplete (e.g. wrong OS natives)
if [[ ! -d "$FRONTEND/node_modules" || ! -d "$FRONTEND/node_modules/vite" ]]; then
  echo "Installing frontend dependencies..."
  npm install
elif [[ ! -x "$FRONTEND/node_modules/.bin/vite" && ! -f "$FRONTEND/node_modules/.bin/vite.cmd" ]]; then
  echo "Frontend tooling incomplete — running npm install..."
  npm install
fi

echo "UI: http://localhost:5173  (prefer localhost over 127.0.0.1 if binding fails)"
exec npm run dev -- --host 127.0.0.1 --port 5173
