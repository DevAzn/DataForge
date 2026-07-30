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
  echo "error: Python 3.12+ not found on PATH" >&2
  echo "       Need: python3.12 / python3 / python (or set PYTHON=...)" >&2
  echo "       Install: https://www.python.org/downloads/  (or pyenv / deadsnakes)" >&2
  echo "       Windows: enable \"Add python.exe to PATH\" during setup" >&2
  echo "       Then re-run: ./scripts/start-backend.sh" >&2
  echo "       Or install deps first: ./scripts/install.sh" >&2
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

WHEELS="$BACKEND/vendor/wheels"

install_deps() {
  local py="$1"
  # Prefer vendored wheels (committed for offline / first-run clones).
  if [[ -d "$WHEELS" ]] && compgen -G "$WHEELS/*.whl" >/dev/null 2>&1; then
    echo "Installing Python deps from vendor/wheels (offline-friendly)..."
    if "$py" -m pip install --no-index --find-links="$WHEELS" -r requirements.txt; then
      return 0
    fi
    echo "Vendor wheelhouse incomplete for this platform/Python — falling back to PyPI..."
    "$py" -m pip install --find-links="$WHEELS" -r requirements.txt
  else
    "$py" -m pip install -r requirements.txt
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
  install_deps "$VENV_PY"
else
  echo "Using existing venv Python $("$VENV_PY" -c 'import sys; print(sys.version.split()[0])')"
  # Ensure core imports work (fresh clone may ship empty .venv paths incorrectly)
  if ! "$VENV_PY" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    echo "Venv missing packages — installing..."
    install_deps "$VENV_PY"
  fi
fi

# Ensure data dir exists (SQLite path is relative to project root)
mkdir -p "$ROOT/data"

echo "API:  http://127.0.0.1:8765"
echo "docs: http://127.0.0.1:8765/docs"
exec "$VENV_PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
