#!/usr/bin/env python3
"""Exercise a running Scout server without printing credentials or sending cloud requests."""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from scout.config import config

BASE = "http://127.0.0.1:8000"


def request(path, body=None):
    req = urllib.request.Request(
        BASE + "/api" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + config.access_key,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.headers.get_content_type() == "application/pdf":
            return response.read()
        return json.load(response)


if __name__ == "__main__":
    assert request("/health")["status"] == "ok"
    for scenario, profile, verdict in [
        ("obstructed", "ramp", "FAIL"),
        ("clear", "doorway", "PASS"),
    ]:
        scan = request(
            "/scans", {"mode": "demo", "scenario": scenario, "profile": profile}
        )
        for _ in range(100):
            scan = request("/scans/" + scan["id"])
            if scan["status"] not in ("queued", "running"):
                break
            time.sleep(0.1)
        assert scan["status"] == "completed", scan.get("error")
        assert scan["result"]["verdict"] == verdict
        assert len(scan["points"]) == 37
        pdf = request("/scans/" + scan["id"] + "/report.pdf")
        assert pdf.startswith(b"%PDF")
        if "--render-report" in sys.argv:
            import fitz

            out = ROOT / ".scout" / "qa"
            out.mkdir(exist_ok=True)
            report = fitz.open(stream=pdf, filetype="pdf")
            for i, page in enumerate(report):
                page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(
                    out / f"{scenario}-report-{i + 1}.png"
                )
            print(
                f"{scenario}: {verdict}, {len(scan['points'])} points, {len(report)} PDF pages"
            )
        else:
            print(f"{scenario}: {verdict}, 37 points, valid PDF")
    print("Live local API smoke test passed. Demo inspections are saved in history.")
