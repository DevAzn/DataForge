#!/usr/bin/env bash
# DataForge installer — Linux, macOS, WSL, Git Bash on Windows
#
# Usage (from a clone):
#   ./scripts/install.sh
#   ./scripts/install.sh --bulk          # also install optional polars/numpy
#   ./scripts/install.sh --force         # recreate venv + reinstall node_modules
#
# One-liner download + install (any empty dir or home):
#   curl -fsSL https://raw.githubusercontent.com/DevAzn/DataForge/main/scripts/install.sh | bash
#   # or with flags:
#   curl -fsSL .../install.sh | bash -s -- --bulk
#
set -euo pipefail

REPO_URL="${DATAFORGE_REPO_URL:-https://github.com/DevAzn/DataForge.git}"
REPO_BRANCH="${DATAFORGE_BRANCH:-main}"
INSTALL_DIR_NAME="${DATAFORGE_DIR:-DataForge}"

FORCE=0
WITH_BULK=0
SKIP_CLONE=0
SKIP_FRONTEND=0
SKIP_BACKEND=0

# ── colors (TTY only) ──────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_CYAN=$'\033[36m'
else
  C_RESET= C_BOLD= C_DIM= C_GREEN= C_YELLOW= C_RED= C_CYAN=
fi

info()  { echo "${C_CYAN}==>${C_RESET} $*"; }
ok()    { echo "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}!${C_RESET} $*" >&2; }
die()   { echo "${C_RED}error:${C_RESET} $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
DataForge installer

Usage:
  ./scripts/install.sh [options]

Options:
  --bulk            Install optional bulk extras (polars, numpy)
  --force           Recreate Python venv and reinstall frontend deps
  --skip-backend    Skip Python venv / pip install
  --skip-frontend   Skip npm install
  --no-clone        Never auto-clone (fail if not already in a repo tree)
  -h, --help        Show this help

Environment:
  DATAFORGE_REPO_URL   Git clone URL (default: https://github.com/DevAzn/DataForge.git)
  DATAFORGE_BRANCH     Branch to clone (default: main)
  DATAFORGE_DIR        Directory name when cloning (default: DataForge)
  PYTHON               Preferred Python interpreter (must be 3.12+)
EOF
}

# ── args ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bulk) WITH_BULK=1; shift ;;
    --force) FORCE=1; shift ;;
    --skip-backend) SKIP_BACKEND=1; shift ;;
    --skip-frontend) SKIP_FRONTEND=1; shift ;;
    --no-clone) SKIP_CLONE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# ── locate / obtain project root ───────────────────────────────────
is_repo_root() {
  [[ -f "$1/backend/requirements.txt" && -f "$1/frontend/package.json" ]]
}

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
ROOT=""

# When executed from a real file (not curl | bash), prefer its repo root.
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
  _script_dir="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  _candidate="$(cd "$_script_dir/.." && pwd)"
  if is_repo_root "$_candidate"; then
    ROOT="$_candidate"
  fi
fi

# curl | bash: BASH_SOURCE may be empty or "-" — search cwd then clone.
if [[ -z "$ROOT" ]]; then
  if is_repo_root "$(pwd)"; then
    ROOT="$(pwd)"
  elif is_repo_root "$(pwd)/$INSTALL_DIR_NAME"; then
    ROOT="$(cd "$(pwd)/$INSTALL_DIR_NAME" && pwd)"
  elif [[ "$SKIP_CLONE" -eq 1 ]]; then
    die "not inside a DataForge tree and --no-clone was set"
  else
    if ! command -v git >/dev/null 2>&1; then
      die "git not found. Install git, or clone the repo manually and re-run install.sh"
    fi
    info "Cloning DataForge ($REPO_BRANCH) into ./$INSTALL_DIR_NAME ..."
    if [[ -e "$INSTALL_DIR_NAME" ]]; then
      die "./$INSTALL_DIR_NAME already exists and is not a DataForge tree"
    fi
    git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR_NAME"
    ROOT="$(cd "$INSTALL_DIR_NAME" && pwd)"
  fi
fi

cd "$ROOT"
ok "Project root: $ROOT"

# ── platform note ──────────────────────────────────────────────────
uname_s="$(uname -s 2>/dev/null || echo unknown)"
case "$uname_s" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows-bash" ;;
  Linux*)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      PLATFORM="wsl"
    else
      PLATFORM="linux"
    fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) PLATFORM="unknown" ;;
esac
info "Platform: $PLATFORM ($uname_s)"

# ── prerequisite checks ───────────────────────────────────────────
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"
}

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
      if [[ "$ver" =~ ^3\.(1[2-9]|[2-9][0-9])$ ]]; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}

check_prereqs() {
  info "Checking prerequisites..."

  local missing=0

  if [[ "$SKIP_BACKEND" -eq 0 ]]; then
    if PY="$(resolve_python)"; then
      local pyver
      pyver="$("$PY" -c 'import sys; print(sys.version.split()[0])')"
      ok "Python: $PY ($pyver)"
    else
      warn "Python 3.12+ not found on PATH"
      echo "         Install: https://www.python.org/downloads/  (or pyenv / deadsnakes)"
      echo "         Windows: enable \"Add python.exe to PATH\" during setup"
      missing=1
    fi
  fi

  if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
      local node_ver npm_ver
      node_ver="$(node -v 2>/dev/null | sed 's/^v//')"
      npm_ver="$(npm -v 2>/dev/null || true)"
      if version_ge "$node_ver" "18.0"; then
        ok "Node.js: v$node_ver  |  npm: $npm_ver"
      else
        warn "Node.js $node_ver found, but 18+ is required"
        echo "         Install LTS: https://nodejs.org/"
        missing=1
      fi
    else
      warn "Node.js / npm not found"
      echo "         Install LTS: https://nodejs.org/"
      missing=1
    fi
  fi

  if ! command -v git >/dev/null 2>&1; then
    warn "git not found (optional after clone, useful for updates)"
  else
    ok "git: $(git --version 2>/dev/null | head -n1)"
  fi

  if [[ "$missing" -ne 0 ]]; then
    die "missing required tools — install them and re-run this script"
  fi
}

resolve_venv_python() {
  local backend="$ROOT/backend"
  if [[ -x "$backend/.venv/bin/python" ]]; then
    echo "$backend/.venv/bin/python"
  elif [[ -f "$backend/.venv/Scripts/python.exe" ]]; then
    echo "$backend/.venv/Scripts/python.exe"
  else
    echo ""
  fi
}

# ── backend ────────────────────────────────────────────────────────
install_backend() {
  local backend="$ROOT/backend"
  cd "$backend"

  if [[ "$FORCE" -eq 1 && -d .venv ]]; then
    info "Removing existing venv (--force)..."
    rm -rf .venv
  fi

  local venv_py
  venv_py="$(resolve_venv_python)"

  if [[ -z "$venv_py" ]]; then
    info "Creating Python virtualenv with: $PY"
    "$PY" -m venv .venv
    venv_py="$(resolve_venv_python)"
    [[ -n "$venv_py" ]] || die "venv created but python not found under .venv/bin or .venv/Scripts"
  else
    info "Using existing venv: $venv_py"
  fi

  info "Installing Python dependencies..."
  "$venv_py" -m pip install --upgrade pip
  local wheels="$backend/vendor/wheels"
  if [[ -d "$wheels" ]] && compgen -G "$wheels/*.whl" >/dev/null 2>&1; then
    info "Using vendored wheels in backend/vendor/wheels ..."
    if ! "$venv_py" -m pip install --no-index --find-links="$wheels" -r requirements.txt; then
      warn "Offline wheel install incomplete for this Python/platform — using PyPI fallback"
      "$venv_py" -m pip install --find-links="$wheels" -r requirements.txt
    fi
  else
    "$venv_py" -m pip install -r requirements.txt
  fi

  if [[ "$WITH_BULK" -eq 1 ]]; then
    info "Installing optional bulk extras (polars, numpy)..."
    "$venv_py" -m pip install "polars>=1.0.0" "numpy>=2.0.0"
  fi

  ok "Backend ready ($("$venv_py" -c 'import sys; print(sys.version.split()[0])'))"

  init_sqlite_db "$venv_py"
}

# Create data dirs, init SQLite schema, fail loud if not writable
init_sqlite_db() {
  local venv_py="$1"
  local backend="$ROOT/backend"
  mkdir -p "$ROOT/data/encryption" "$ROOT/data/exports"

  # Write smoke (catches read-only / synced-folder permission issues)
  local probe="$ROOT/data/.write_probe"
  if ! (echo ok >"$probe" && rm -f "$probe"); then
    die "cannot write to $ROOT/data — check folder permissions"
  fi

  info "Initializing SQLite (design data store)..."
  local db_path
  db_path="$(
    cd "$backend" && "$venv_py" -c "
from app.database import init_db, DB_PATH, DATA_DIR, connect
init_db()
# read/write smoke
c = connect()
try:
    c.execute('SELECT COUNT(*) FROM settings')
    c.execute(\"INSERT OR REPLACE INTO settings (key, value_json) VALUES ('_install_probe', '1')\")
    c.execute(\"DELETE FROM settings WHERE key = '_install_probe'\")
    c.commit()
finally:
    c.close()
print(DB_PATH)
"
  )" || die "SQLite init failed — is the venv healthy? re-run: ./scripts/install.sh --force"

  ok "SQLite ready: $db_path"
  ok "Local only — this file is per machine (not shared via git)"
}

# ── frontend ───────────────────────────────────────────────────────
install_frontend() {
  local frontend="$ROOT/frontend"
  cd "$frontend"

  if [[ "$FORCE" -eq 1 && -d node_modules ]]; then
    info "Removing existing node_modules (--force)..."
    rm -rf node_modules
  fi

  # node_modules is committed for clone-and-run; only install when missing or --force
  if [[ "$FORCE" -eq 1 || ! -d node_modules || ! -d node_modules/vite ]]; then
    info "Installing frontend dependencies (npm install)..."
    npm install
  else
    info "node_modules already present (vendored) — skipping npm install"
  fi

  ok "Frontend ready"
}

# ── finish ─────────────────────────────────────────────────────────
chmod_scripts() {
  if chmod +x "$ROOT/scripts/"*.sh 2>/dev/null; then
    ok "scripts/*.sh are executable"
  else
    warn "could not chmod scripts (Windows FS?); run with: bash scripts/install.sh"
  fi
}

ensure_data_dir() {
  mkdir -p "$ROOT/data/encryption" "$ROOT/data/exports"
  ok "data/ directory ready (SQLite + exports)"
}

print_next_steps() {
  cat <<EOF

${C_BOLD}DataForge install complete.${C_RESET}

  Project:  $ROOT
  SQLite:   $ROOT/data/pv_dataforge.sqlite  ${C_DIM}(created on install / first API start)${C_RESET}

Start (two terminals):
  ${C_CYAN}./scripts/start-backend.sh${C_RESET}
  ${C_CYAN}./scripts/start-frontend.sh${C_RESET}

Or both in one terminal:
  ${C_CYAN}./scripts/dev.sh${C_RESET}

URLs:
  UI          http://localhost:5173
  API health  http://127.0.0.1:8765/api/health
  API status  http://127.0.0.1:8765/api/status   ${C_DIM}(shows dbPath + counts)${C_RESET}
  API docs    http://127.0.0.1:8765/docs

${C_DIM}Persistence: schemas, themes, categories, settings live in the local SQLite file.
Each clone has its own data/ — not shared via git. Open the UI at :5173 (proxies to the API).${C_RESET}
${C_DIM}Windows: use Git Bash or WSL for these scripts.${C_RESET}
EOF
}

# ── main ───────────────────────────────────────────────────────────
main() {
  echo ""
  echo "${C_BOLD}DataForge installer${C_RESET}"
  echo "${C_DIM}repo: $REPO_URL  branch: $REPO_BRANCH${C_RESET}"
  echo ""

  check_prereqs
  chmod_scripts
  ensure_data_dir

  if [[ "$SKIP_BACKEND" -eq 0 ]]; then
    install_backend
  else
    info "Skipping backend (--skip-backend)"
  fi

  if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
    install_frontend
  else
    info "Skipping frontend (--skip-frontend)"
  fi

  print_next_steps
}

main
