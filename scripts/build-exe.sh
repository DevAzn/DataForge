#!/usr/bin/env bash
# Build DataForge desktop binary (Linux/macOS; Windows users: build-exe.ps1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${ROOT}/backend/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  python3 -m venv "${ROOT}/backend/.venv"
  PY="${ROOT}/backend/.venv/bin/python"
fi

"$PY" -m pip install -q -r backend/requirements.txt
"$PY" -m pip install -q 'pyinstaller>=6.0'

if [[ "${SKIP_FRONTEND_BUILD:-}" != "1" ]]; then
  (cd frontend && { [[ -d node_modules ]] || npm install; } && npm run build)
fi

test -f frontend/dist/index.html

SEP=":"
# PyInstaller --add-data is os-specific; Linux/mac use colon
"$PY" -m PyInstaller \
  --noconfirm --clean \
  --name DataForge \
  --onedir \
  --distpath dist \
  --workpath build/pyinstaller \
  --specpath build/pyinstaller \
  --paths backend \
  --add-data "frontend/dist${SEP}frontend/dist" \
  --collect-all uvicorn \
  --collect-all fastapi \
  --collect-all starlette \
  --collect-all anyio \
  --hidden-import app.main \
  --hidden-import app.database \
  --hidden-import app.runtime_paths \
  --console \
  backend/desktop_main.py

echo "Built: ${ROOT}/dist/DataForge/DataForge"
