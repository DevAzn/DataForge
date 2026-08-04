"""
DataForge desktop entry — start API + packaged UI, open the browser.

Used by:
  python desktop_main.py          (dev / installed tree)
  DataForge.exe                   (PyInstaller frozen build)
"""
from __future__ import annotations

import os
import sys
import threading
import time
import webbrowser


HOST = os.environ.get("DATAFORGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("DATAFORGE_PORT", "8765"))
OPEN_BROWSER = os.environ.get("DATAFORGE_NO_BROWSER", "").strip() not in (
    "1",
    "true",
    "yes",
)


def _ensure_import_path() -> None:
    """Allow `app` imports when launched as a script from backend/ or frozen."""
    if getattr(sys, "frozen", False):
        return
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)


def _open_browser_when_ready() -> None:
    url = f"http://{HOST}:{PORT}/"
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            import urllib.request

            with urllib.request.urlopen(url + "api/health", timeout=1) as resp:
                if resp.status == 200:
                    webbrowser.open(url)
                    return
        except Exception:
            time.sleep(0.35)
    # Still open UI even if health check lagged
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main() -> int:
    _ensure_import_path()
    import uvicorn

    from app.runtime_paths import project_root, ui_dist_dir

    root = project_root()
    ui = ui_dist_dir()
    print("")
    print("  DataForge")
    print(f"  UI + API  →  http://{HOST}:{PORT}/")
    print(f"  Data dir  →  {root / 'data'}")
    if ui:
        print(f"  UI files  →  {ui}")
    else:
        print("  WARNING: frontend/dist not found — API only (build the UI or use Vite).")
    print("  Press Ctrl+C to stop.")
    print("")

    if OPEN_BROWSER:
        threading.Thread(target=_open_browser_when_ready, daemon=True).start()

    # Import app after path setup
    from app.main import app

    try:
        uvicorn.run(
            app,
            host=HOST,
            port=PORT,
            log_level=os.environ.get("DATAFORGE_LOG", "info"),
            access_log=False,
        )
    except KeyboardInterrupt:
        print("\nDataForge stopped.")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
