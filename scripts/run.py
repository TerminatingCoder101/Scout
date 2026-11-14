#!/usr/bin/env python3
"""Single-command local launcher; the access key is never printed."""

import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from scout.config import config


def open_browser():
    import urllib.request

    for _ in range(60):
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:8000/api/health", timeout=1
            ) as r:
                if r.status == 200:
                    break
        except OSError:
            time.sleep(0.25)
    else:
        return
    webbrowser.open("http://127.0.0.1:8000/#token=" + config.access_key)


if __name__ == "__main__":
    if not (ROOT / "frontend/dist/index.html").exists():
        sys.exit(
            "Build the dashboard first: npm --prefix frontend ci && npm --prefix frontend run build"
        )
    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_browser, daemon=True).start()
    import uvicorn

    print("Scout Radar: http://127.0.0.1:8000 — Ctrl+C to stop. Local data: .scout/")
    uvicorn.run(
        "scout.main:app", host="127.0.0.1", port=8000, workers=1, log_level="info"
    )
