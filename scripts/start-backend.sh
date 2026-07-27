#!/usr/bin/env bash
# Start DataForge FastAPI backend on port 8765 (bash: Linux, macOS, WSL, Git Bash)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
cd "$BACKEND"

resolve_python() {
  local candidates=(
    "${PYTHON:-}"
    python3.14
    python3.13
    python3.12
    python3
    python
  )
  local c ver
  for c in "${candidates[@]}"; do
    [[ -z "$c" ]] && continue
    if command -v "$c" >/dev/null 2>&1; then
      ver="$("$c" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
      # Require Python 3.12+
      if [[ "$ver" =~ ^3\.(1[2-9]|[2-9][0-9])$ ]]; then
        echo "$c"
        return 0
      fi
    fi
  done
  echo "error: need Python 3.12+ on PATH (python3.12 / python3 / python)" >&2
  exit 1
}

# Unix venv layout vs Windows (Git Bash / WSL using a Windows venv)
resolve_venv_python() {
  if [[ -x "$BACKEND/.venv/bin/python" ]]; then
    echo "$BACKEND/.venv/bin/python"
  elif [[ -f "$BACKEND/.venv/Scripts/python.exe" ]]; then
    echo "$BACKEND/.venv/Scripts/python.exe"
  else
    echo ""
  fi
}

VENV_PY="$(resolve_venv_python)"
if [[ -z "$VENV_PY" ]]; then
  PY="$(resolve_python)"
  echo "Creating virtualenv with: $PY ($("$PY" -c 'import sys; print(sys.version.split()[0])'))"
  "$PY" -m venv .venv
  VENV_PY="$(resolve_venv_python)"
  if [[ -z "$VENV_PY" ]]; then
    echo "error: venv created but python not found under .venv/bin or .venv/Scripts" >&2
    exit 1
  fi
  "$VENV_PY" -m pip install --upgrade pip
  "$VENV_PY" -m pip install -r requirements.txt
else
  echo "Using existing venv Python $("$VENV_PY" -c 'import sys; print(sys.version.split()[0])')"
fi

# Ensure data dir exists (SQLite path is relative to project root)
mkdir -p "$ROOT/data"

echo "API:  http://127.0.0.1:8765"
echo "docs: http://127.0.0.1:8765/docs"
exec "$VENV_PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
