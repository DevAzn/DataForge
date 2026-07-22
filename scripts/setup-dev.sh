#!/usr/bin/env bash
# One-shot setup for macOS/Linux developers (run from repo root).
# Usage:  bash scripts/setup-dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Node version (need 20+):"
node -v
npm -v

echo "==> npm install (downloads deps + rebuilds better-sqlite3 for Electron)..."
npm install

echo "==> Repair Electron binary if needed..."
npm run repair:electron

echo "==> Typecheck..."
npm run typecheck

echo ""
echo "Setup OK. Start the app with:"
echo "  npm run dev"
echo ""
echo "Build installers with:"
echo "  npm run dist:win    # Windows (on Windows)"
echo "  npm run dist:linux  # Linux"
