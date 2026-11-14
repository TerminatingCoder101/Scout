"""Run a labeled demo inspection against Google without displaying credentials."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from scout import db
from scout.config import config
from scout.models import ScanRequest
from scout.service import manager


async def main(model):
    if model:
        config.values["gemini_model"] = model
    scan = await manager.start(
        ScanRequest(mode="demo", scenario="obstructed", use_ai=True)
    )
    print(
        "Inspection:",
        scan["id"],
        "Model:",
        config.snapshot()["gemini_model"],
        flush=True,
    )
    try:
        await manager.task
        result = db.get_scan(scan["id"])
        print("Status:", result["status"], flush=True)
        if result.get("ai_error"):
            print(result["ai_error"], flush=True)
            return 1
        print("Vision:", result.get("diagnosis", {}).get("provider"), flush=True)
        print("Work order:", result.get("work_order", {}).get("id"), flush=True)
        return (
            0
            if result.get("diagnosis", {}).get("provider") == "google_gemini"
            and result.get("work_order")
            else 1
        )
    finally:
        await manager.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.model)))
