import asyncio
import csv
import io
import json
import re
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from . import db, rules, vision, inspections, sponsor
from .config import config, DATA, ROOT
from .hardware import ports, DeviceError
from .models import (
    ScanRequest,
    SettingsUpdate,
    Twin,
    CalibrationRequest,
    ValidationTrial,
    WorkOrderUpdate,
)
from .service import manager
from .reports import work_order_pdf


@asynccontextmanager
async def lifespan(app):
    db.init()
    sponsor.init()
    try:
        await inspections.store.open()
        yield
    finally:
        try:
            await manager.close()
        finally:
            try:
                await sponsor.close()
            finally:
                await inspections.store.close()


app = FastAPI(
    title="Scout Radar API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "testserver", "[::1]"],
)


@app.middleware("http")
async def safety_headers(request, call_next):
    # Cookie auth is limited to this local application; reject cross-origin mutations.
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in (
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ):
            return Response("Origin not allowed", status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


bearer = HTTPBearer(auto_error=False)


async def authorized(
    request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
):
    token = (
        credentials.credentials
        if credentials
        else request.cookies.get("scout_session", "")
    )
    if not secrets.compare_digest(token, config.access_key):
        raise HTTPException(401, "Unlock Scout with your local access key.")


class Login(BaseModel):
    key: str = Field(max_length=300)


@app.post("/api/auth")
async def login(payload: Login):
    if not secrets.compare_digest(payload.key, config.access_key):
        await asyncio.sleep(0.3)
        raise HTTPException(401, "Invalid access key.")
    response = Response(content='{"ok":true}', media_type="application/json")
    response.set_cookie(
        "scout_session",
        config.access_key,
        httponly=True,
        samesite="strict",
        max_age=86400,
    )
    return response


@app.delete("/api/auth")
async def logout():
    response = Response(status_code=204)
    response.delete_cookie("scout_session")
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


protected = [Depends(authorized)]
app.include_router(sponsor.router, dependencies=protected)
app.include_router(inspections.router, dependencies=protected)


@app.exception_handler(inspections.InspectionUnavailable)
async def inspection_database_error(request, exc):
    return Response(
        content='{"detail":"Inspection database unavailable. Check configuration or retry shortly."}',
        status_code=503,
        media_type="application/json",
    )


@app.get("/api/status", dependencies=protected)
async def status():
    return dict(
        active_scan_id=manager.active_id,
        device=manager.device.status(),
        settings=config.public(),
    )


@app.get("/api/settings", dependencies=protected)
async def settings():
    return config.public()


@app.patch("/api/settings", dependencies=protected)
async def update_settings(payload: SettingsUpdate):
    if manager.active_id:
        raise HTTPException(
            409, "Wait for the inspection to finish before changing settings."
        )
    changes = payload.model_dump(exclude_none=True)
    if (
        "serial_port" in changes
        and changes["serial_port"] != config.snapshot()["serial_port"]
    ):
        await manager.device.close()
    return config.update(changes)


@app.post("/api/settings/test-google", dependencies=protected)
async def test_google():
    return await vision.test_credentials(config.snapshot())


@app.get("/api/hardware/ports", dependencies=protected)
async def serial_ports():
    return await asyncio.to_thread(ports)


@app.post("/api/hardware/connect", dependencies=protected)
async def connect():
    if manager.active_id:
        raise HTTPException(409, "An inspection is running.")
    try:
        await manager.device.connect(config.snapshot()["serial_port"])
    except DeviceError as exc:
        raise HTTPException(400, str(exc))
    return manager.device.status()


@app.post("/api/hardware/disconnect", dependencies=protected)
async def disconnect():
    if manager.active_id:
        raise HTTPException(409, "Cancel the inspection before disconnecting.")
    await manager.device.close()
    return manager.device.status()


@app.get("/api/twins", dependencies=protected)
async def list_twins():
    return db.twins()


@app.post("/api/twins", dependencies=protected)
async def put_twin(payload: Twin):
    return db.put_twin(payload.model_dump())


@app.get("/api/twins/{id}", dependencies=protected)
async def get_twin(id: str):
    twin = db.get_twin(id)
    if not twin:
        raise HTTPException(404, "Twin not found.")
    return twin


@app.post("/api/scans", status_code=202, dependencies=protected)
async def start_scan(payload: ScanRequest):
    try:
        return await manager.start(payload)
    except KeyError:
        raise HTTPException(404, "Digital twin not found.")
    except ValueError as exc:
        raise HTTPException(409 if manager.active_id else 400, str(exc))
    except DeviceError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/scans", dependencies=protected)
async def list_scans():
    return db.scans()


def require_scan(id):
    scan = db.get_scan(id)
    if not scan:
        raise HTTPException(404, "Inspection not found.")
    return scan


@app.get("/api/scans/{id}", dependencies=protected)
async def get_scan(id: str):
    return require_scan(id)


@app.post("/api/scans/{id}/cancel", dependencies=protected)
async def cancel_scan(id: str):
    require_scan(id)
    try:
        await manager.cancel(id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return require_scan(id)


@app.get("/api/scans/{id}/events", dependencies=protected)
async def scan_events(id: str, request: Request, after: int = 0):
    require_scan(id)
    try:
        cursor = max(after, int(request.headers.get("last-event-id", "0")))
    except ValueError:
        raise HTTPException(400, "Invalid event cursor.")

    async def generate():
        nonlocal cursor
        while not await request.is_disconnected():
            rows = db.events(id, cursor)
            for event in rows:
                cursor = event["id"]
                yield f"id: {cursor}\ndata: {json.dumps(event)}\n\n"
            scan = db.get_scan(id)
            if scan and scan["status"] not in ("queued", "running"):
                # Events and terminal scan update may race by one scheduler tick.
                for event in db.events(id, cursor):
                    cursor = event["id"]
                    yield f"id: {cursor}\ndata: {json.dumps(event)}\n\n"
                yield "event: end\ndata: {}\n\n"
                break
            yield ": keepalive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(
        generate(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )


@app.get("/api/scans/{id}/timeline", dependencies=protected)
async def timeline(id: str):
    require_scan(id)
    return db.events(id)


@app.get("/api/scans/{id}/export.json", dependencies=protected)
async def export_json(id: str):
    scan = require_scan(id)
    return Response(
        json.dumps(scan, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="scout-{scan["id"]}.json"'
        },
    )


@app.get("/api/scans/{id}/report.pdf", dependencies=protected)
async def report(id: str):
    scan = require_scan(id)
    if not scan.get("work_order"):
        raise HTTPException(409, "Work order is not ready yet.")
    content = await asyncio.to_thread(work_order_pdf, scan)
    return Response(
        content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{scan["work_order"]["id"]}.pdf"'
        },
    )


@app.patch("/api/scans/{id}/work-order", dependencies=protected)
async def update_order(id: str, payload: WorkOrderUpdate):
    scan = require_scan(id)
    if scan["status"] in ("queued", "running"):
        raise HTTPException(409, "Wait for this inspection to complete.")
    if not scan.get("work_order"):
        raise HTTPException(409, "No work order exists.")
    scan["work_order"].update(payload.model_dump())
    db.save_scan(scan)
    db.add_event(id, "order_updated", payload.model_dump())
    return scan


@app.get("/api/images/{name}", dependencies=protected)
async def image(name: str):
    if not re.fullmatch(r"[0-9a-f-]{36}-[1-3]\.jpg", name):
        raise HTTPException(404, "Image not found.")
    path = DATA / "images" / name
    if not path.is_file():
        raise HTTPException(404, "Image not found.")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/calibration/flip", dependencies=protected)
async def calibrate(payload: CalibrationRequest):
    if manager.active_id:
        raise HTTPException(409, "Wait for the inspection to finish.")
    result = rules.flip_calibration(payload)
    if abs(result["pitch_bias_deg"]) > 10 or abs(result["roll_bias_deg"]) > 10:
        raise HTTPException(
            400,
            "Bias exceeds plausible range. Check orientation and repeat calibration.",
        )
    config.update(
        {k: result[k] for k in ("pitch_bias_deg", "roll_bias_deg")}
        | {"calibration_verified": False}
    )
    return result


@app.post("/api/validation", dependencies=protected)
async def add_validation(payload: ValidationTrial):
    return db.add_trial(payload.model_dump())


@app.get("/api/validation", dependencies=protected)
async def validation():
    trials = db.trials()
    summary = {}
    for key in ("width_cm", "running_slope_deg", "cross_slope_deg"):
        rows = [t for t in trials if t["metric"] == key]
        errors = [abs(t["measured"] - t["reference"]) for t in rows]
        summary[key] = dict(
            count=len(rows),
            mean_absolute_error=sum(errors) / len(errors) if errors else None,
            max_absolute_error=max(errors) if errors else None,
        )
    return dict(trials=trials, summary=summary)


@app.get("/api/validation/export.csv", dependencies=protected)
async def validation_csv():
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(
        [
            "id",
            "created_at",
            "metric",
            "reference",
            "measured",
            "absolute_error",
            "notes",
        ]
    )
    for row in db.trials():
        note = row["notes"]
        note = "'" + note if note.startswith(("=", "+", "-", "@", "\t", "\r")) else note
        writer.writerow(
            [
                row["id"],
                row["created_at"],
                row["metric"],
                row["reference"],
                row["measured"],
                abs(row["measured"] - row["reference"]),
                note,
            ]
        )
    return Response(
        stream.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="scout-validation.csv"'},
    )


frontend = ROOT / "frontend" / "dist"
if frontend.exists():
    app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")


@app.get("/favicon.svg")
async def favicon():
    return FileResponse(frontend / "favicon.svg", media_type="image/svg+xml")


@app.get("/")
@app.get(
    "/business"
)  # simple one-click page for business users (same app, see frontend/src/main.tsx)
async def index():
    if (frontend / "index.html").exists():
        return FileResponse(frontend / "index.html")
    return {
        "message": "Build the dashboard with: cd frontend && npm install && npm run build",
        "api": "/api/docs",
    }
