"""Desktop launcher: run the FastAPI app in-process and open it in a native
window (pywebview). Packaged into a single executable with PyInstaller.

The SQLite database is kept in a per-user data folder so it persists across
runs (the app/server/webview all run in memory; only the data file is on disk).

Run headless for testing / as a browser fallback:
    python desktop.py --no-window      # serves, prints URL, no window
"""
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

WINDOW_TITLE = "Expense Tracker"


def data_dir() -> Path:
    """Per-user, writable folder for the SQLite file."""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or str(Path.home())
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    d = Path(base) / "ExpenseTracker"
    d.mkdir(parents=True, exist_ok=True)
    return d


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(port: int):
    """Boot uvicorn in a daemon thread; return the server handle."""
    import uvicorn
    from app.main import app  # imported AFTER EXPENSE_DB_URL is set

    # log_config=None: a windowed build has no console, and uvicorn's default
    # logging touches sys.stdout.isatty() — which crashes when stdout is None.
    config = uvicorn.Config(
        app, host="127.0.0.1", port=port, log_config=None, access_log=False
    )
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()
    return server


def wait_until_up(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/api/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def main() -> int:
    # A windowed (console=False) build has no stdout/stderr — give any stray
    # writes somewhere harmless so prints/logging never crash the app.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")

    # Persist data in the per-user folder unless overridden.
    os.environ.setdefault(
        "EXPENSE_DB_URL", f"sqlite:///{data_dir() / 'expense_tracker.db'}"
    )
    port = free_port()
    server = start_server(port)
    if not wait_until_up(port):
        print("error: backend did not start", file=sys.stderr)
        return 1

    url = f"http://127.0.0.1:{port}"
    if "--no-window" in sys.argv:
        print(f"serving on {url}  (Ctrl+C to quit)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        import webview  # noqa: WPS433 — only needed in windowed mode

        webview.create_window(WINDOW_TITLE, url, width=1240, height=860, min_size=(900, 600))
        webview.start()

    server.should_exit = True
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
