"""Documented sponsor adapters and evidence-backed remote inspection planning.

CoStar is a local licensed extract, Matterport is GraphQL with Basic auth,
Vexcel uses X-API-KEY. No remote mutations or local hardware motion here.
"""

import asyncio
import csv
import io
import json
import math
import os
import re
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import Field

from . import db
from .config import DATA, ROOT, config
from .models import StrictModel

router = APIRouter(prefix="/api/sponsor")
KIT = Path(os.getenv("COSTAR_KIT_DIR", str(ROOT / "costar-hackathon-kit")))
IMAGES = DATA / "sponsor-images"
MP_API = "https://api.matterport.com/api/models/graph"
VX_API = "https://api.vexcelgroup.com/v2"
LAYERS = "urban,urban-r,wide-area,urban-g"
JOBS = {}

BASICS = """query ScoutBasics($id: ID!) { model(id: $id) {
 id name description created visibility
 address { address locality administrativeArea postalCode }
 geolocation { lat long } image { url }
} }"""
ROOMS = """query ScoutRooms($id: ID!) { model(id: $id) {
 floors { id label vertices { id position { x y } } edges { id type vertices { id } } }
 rooms { id floor { id } classifications { label confidence }
 dimensions(units: metric) { areaFloor width depth height } }
} }"""


def init():
    IMAGES.mkdir(exist_ok=True, mode=0o700)
    with db.connection() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS sponsor_properties(id TEXT PRIMARY KEY, search TEXT, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sponsor_reviews(id TEXT PRIMARY KEY, document TEXT NOT NULL);
        """)
        for row in c.execute("SELECT id, document FROM sponsor_reviews"):
            doc = json.loads(row["document"])
            if doc["status"] in ("loading", "planning"):
                doc.update(
                    status="interrupted", error="Server restarted; start a new review."
                )
                c.execute(
                    "UPDATE sponsor_reviews SET document=? WHERE id=?",
                    (json.dumps(doc), row["id"]),
                )


def put_review(doc):
    with db.connection() as c:
        c.execute(
            "INSERT OR REPLACE INTO sponsor_reviews VALUES (?,?)",
            (doc["id"], json.dumps(doc)),
        )


def review(id):
    with db.connection() as c:
        row = c.execute(
            "SELECT document FROM sponsor_reviews WHERE id=?", (id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Review not found.")
    return json.loads(row[0])


def property_record(id):
    with db.connection() as c:
        row = c.execute(
            "SELECT document FROM sponsor_properties WHERE id=?", (id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Import the CoStar kit and choose a property first.")
    return json.loads(row[0])


def import_kit(path=KIT):
    result = []
    for kind, filename, dataset, key in [
        (
            "commercial",
            "commercial-properties.csv",
            "commercial-property",
            "PropertyId",
        ),
        (
            "residential",
            "residential-listings.csv",
            "residential-listings",
            "ListingId",
        ),
    ]:
        mapping = {}
        with (path / filename).open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                entry = mapping.setdefault(row[key], {**row, "models": []})
                mid = row.get("MatterportModelId", "").strip()
                if (
                    mid
                    and re.fullmatch(r"[A-Za-z0-9]{5,32}", mid)
                    and mid not in entry["models"]
                ):
                    entry["models"].append(mid)
        with (path / "data" / f"{dataset}.jsonl").open(encoding="utf-8") as f:
            for line in f:
                record = json.loads(line)
                sid = str(record["id"])
                if sid not in mapping:
                    continue
                row = mapping[sid]
                detail = record.get("property") or {}
                addr = (
                    (record.get("primaryAddress") or {})
                    if kind == "commercial"
                    else (detail.get("address") or {})
                )
                geo = {
                    "latitude": addr.get("latitude"),
                    "longitude": addr.get("longitude"),
                }
                p = dict(
                    id=f"{kind}-{sid}",
                    source_id=sid,
                    kind=kind,
                    name=record.get("buildingName")
                    or row.get("Address")
                    or f"Property {sid}",
                    address=row.get("Address", ""),
                    city=row.get("City", ""),
                    state=row.get("State", ""),
                    model_ids=row["models"],
                    **geo,
                    facts={
                        "property_type_code": record.get(
                            "propertyType", detail.get("propertyType")
                        ),
                        "stories": record.get("numStoriesAboveGrade"),
                        "building_area_sqft": record.get(
                            "grossBuildingAreaSquareFeet", detail.get("sqftMin")
                        ),
                        "parking": record.get(
                            "parking", detail.get("totalParkingSpaces")
                        ),
                    },
                    provenance={
                        "provider": "CoStar",
                        "dataset": dataset,
                        "mapping_file": filename,
                        "join": f"{key} = record.id; MatterportModelId from same CSV row",
                        "imported_at": db.now(),
                        "record_date": None,
                    },
                )
                result.append(p)
    if not result:
        raise ValueError("No linked records found in kit.")
    with db.connection() as c:
        c.executemany(
            "INSERT OR REPLACE INTO sponsor_properties VALUES (?,?,?)",
            [
                (
                    p["id"],
                    " ".join(
                        str(p[k]) for k in ("id", "name", "address", "city", "state")
                    ).lower(),
                    json.dumps(p),
                )
                for p in result
            ],
        )
    return {
        "imported": len(result),
        "with_models": sum(bool(p["model_ids"]) for p in result),
    }


class ProviderError(RuntimeError):
    pass


def provider_error(name, status):
    reason = {
        401: "credentials rejected",
        403: "access denied for this resource",
        404: "no coverage or resource not found",
        429: "rate limit reached",
    }.get(status, "request failed")
    return ProviderError(f"{name}: {reason} (HTTP {status}).")


async def graph(query, mid, settings):
    if not settings["matterport_api_key"] or not settings["matterport_api_token"]:
        raise ProviderError("Save both the Matterport API key and API token first.")
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.post(
            MP_API,
            auth=(settings["matterport_api_key"], settings["matterport_api_token"]),
            json={"query": query, "variables": {"id": mid}},
        )
    if r.status_code != 200:
        raise provider_error("Matterport", r.status_code)
    body = r.json()
    if body.get("errors"):
        codes = {
            str((e.get("extensions") or {}).get("code", "")) for e in body["errors"]
        }
        if codes & {"not.found", "request.unauthorized", "request.unauthenticated"}:
            raise ProviderError(
                "Matterport model is missing or not accessible with these credentials."
            )
        raise ProviderError(
            "Matterport rejected the GraphQL query or a requested field. Check API entitlement/schema."
        )
    model = (body.get("data") or {}).get("model")
    if not model or (model.get("id") and model["id"] != mid):
        raise ProviderError("Matterport returned no matching model.")
    return model


async def fetch_preview(url):
    # Only fetch server-provided Matterport CDN images, never user/LLM URLs.
    u = urlparse(url)
    if (
        u.scheme != "https"
        or not (u.hostname or "").endswith(".matterport.com")
        or u.port not in (None, 443)
    ):
        raise ProviderError(
            "Matterport preview host is unsupported; use the 3D viewer."
        )
    async with httpx.AsyncClient(timeout=30) as client:
        async with client.stream("GET", url) as r:
            if r.status_code != 200:
                raise provider_error("Matterport preview", r.status_code)
            chunks, size = [], 0
            async for chunk in r.aiter_bytes():
                size += len(chunk)
                if size > 12_000_000:
                    raise ProviderError("Preview image exceeds the download limit.")
                chunks.append(chunk)
    return b"".join(chunks)


def save_image(content):
    if len(content) > 12_000_000:
        raise ProviderError("Image exceeds the download limit.")
    with Image.open(io.BytesIO(content)) as im:
        if im.width * im.height > 20_000_000:
            raise ProviderError("Image dimensions exceed the preview limit.")
        im = im.convert("RGB")
        im.thumbnail((1600, 1600))
        name = f"{uuid.uuid4()}.jpg"
        im.save(IMAGES / name, "JPEG", quality=90)
    return name


def point_coords(p):
    try:
        lat, lon = float(p["latitude"]), float(p["longitude"])
        if (
            not math.isfinite(lat + lon)
            or not -90 <= lat <= 90
            or not -180 <= lon <= 180
        ):
            raise ValueError
        return lat, lon
    except (TypeError, ValueError, KeyError):
        raise ProviderError(
            "CoStar record has no usable coordinates; aerial lookup is unavailable."
        )


def area_wkt(lat, lon):
    dy = 60 / 111320
    dx = dy / max(0.01, math.cos(math.radians(lat)))
    return f"POLYGON(({lon - dx} {lat - dy},{lon + dx} {lat - dy},{lon + dx} {lat + dy},{lon - dx} {lat + dy},{lon - dx} {lat - dy}))"


async def aerial(p, settings):
    if not settings["vexcel_api_key"]:
        raise ProviderError("Save a Vexcel API key first.")
    lat, lon = point_coords(p)
    async with httpx.AsyncClient(
        timeout=60, headers={"X-API-KEY": settings["vexcel_api_key"]}
    ) as client:
        r = await client.get(
            VX_API + "/property/extract",
            params={
                "wkt": f"POINT({lon} {lat})",
                "srid": 4326,
                "layer": LAYERS,
                "latest": "true",
                "include": "precomputed",
                "unit-system": "imperial",
            },
        )
        if r.status_code not in (200, 404):
            raise provider_error("Vexcel", r.status_code)
        parcel = r.json() if r.status_code == 200 else None
        # A fixed 120m context window is explicit, not mislabeled as a parcel boundary.
        response = await client.post(
            VX_API + "/ortho/extract",
            json={
                "wkt": area_wkt(lat, lon),
                "srid": 4326,
                "layer": LAYERS,
                "crop": "bounding_box",
                "destination-dimensions": "1000,1000",
                "image-format": "jpeg",
            },
        )
        if response.status_code != 200:
            raise provider_error("Vexcel imagery", response.status_code)
        image = save_image(response.content)
    return {
        "provider": "Vexcel",
        "image": image,
        "parcel": parcel,
        "coordinates": {"latitude": lat, "longitude": lon, "crs": "EPSG:4326"},
        "extent": "120m square centered on CoStar geocode; may include neighboring buildings",
        "capture_date": None,
        "capture_date_note": "Not supplied by this image response; retrieval date is not capture date.",
        "retrieved_at": db.now(),
    }


def event(doc, message):
    doc.setdefault("events", []).append({"at": db.now(), "message": message})
    put_review(doc)


async def load_evidence(doc):
    s = config.snapshot()
    try:
        event(doc, "Read CoStar record and its explicit model mapping.")
        try:
            m = await graph(BASICS, doc["model_id"], s)
            image_url = (m.pop("image", None) or {}).get("url")
            m["retrieved_at"] = db.now()
            m["created_note"] = "Model creation time, not a verified capture date."
            doc["matterport"] = m
            # CSV links can describe a unit or another structure on a large site.
            # Do not silently equate that model with the property geocode.
            addr = (m.get("address") or {}).get("address", "")
            expected = doc["property"].get("address", "")
            if expected and not addr.lower().startswith(expected.lower()):
                doc.setdefault("match_warnings", []).append(
                    "The Matterport address differs from the CoStar address. Check unit/building coverage before confirming the match."
                )
            try:
                lat, lon = point_coords(doc["property"])
                geo = m.get("geolocation") or {}
                delta = math.hypot(
                    (float(geo["lat"]) - lat) * 111320,
                    (float(geo["long"]) - lon) * 111320 * math.cos(math.radians(lat)),
                )
                doc["model_geocode_distance_m"] = round(delta, 1)
                if delta > 50:
                    doc.setdefault("match_warnings", []).append(
                        f"Model geocode is {delta:.0f} m from the CoStar point. The 120 m aerial window may not cover the selected model; verify before planning."
                    )
            except (ProviderError, TypeError, ValueError, KeyError):
                doc.setdefault("match_warnings", []).append(
                    "Model-to-property geocode distance could not be verified."
                )
            try:
                m["geometry"] = await graph(ROOMS, doc["model_id"], s)
            except ProviderError as e:
                m["geometry_error"] = str(e)
            if image_url:
                try:
                    m["image"] = save_image(await fetch_preview(image_url))
                except (ProviderError, httpx.HTTPError, OSError, ValueError):
                    m["image_error"] = (
                        "Model preview could not be downloaded; 3D viewer remains available."
                    )
            event(
                doc,
                "Loaded linked Matterport model; room dimensions are not doorway widths.",
            )
        except ProviderError as e:
            doc["layer_errors"]["matterport"] = str(e)
        except (httpx.HTTPError, ValueError, OSError):
            doc["layer_errors"]["matterport"] = (
                "Matterport request failed or returned invalid data; check connectivity and access."
            )
        try:
            doc["vexcel"] = await aerial(doc["property"], s)
            event(doc, "Loaded Vexcel imagery at the CoStar coordinates.")
        except ProviderError as e:
            doc["layer_errors"]["vexcel"] = str(e)
        except (httpx.HTTPError, ValueError, OSError):
            doc["layer_errors"]["vexcel"] = (
                "Vexcel request failed or returned invalid data; check connectivity and access."
            )
        doc["layers"] = ["costar"] + [k for k in ("matterport", "vexcel") if doc.get(k)]
        doc["status"] = "ready" if len(doc["layers"]) >= 2 else "needs_credentials"
        event(
            doc,
            "Evidence retrieval finished. Review the model/parcel match before planning.",
        )
    except (httpx.HTTPError, ValueError, OSError):
        doc.update(
            status="error",
            error="Provider request failed or returned invalid data. Check connectivity and retry.",
        )
    finally:
        put_review(doc)


class ReviewRequest(StrictModel):
    property_id: str = Field(max_length=100)
    model_id: str = Field(pattern=r"^[A-Za-z0-9]{5,32}$")


class PlanningRequest(StrictModel):
    location_confirmed: bool


@router.get("/status")
def status():
    with db.connection() as c:
        count = c.execute("SELECT COUNT(*) FROM sponsor_properties").fetchone()[0]
    return {
        "properties": count,
        "kit_available": (KIT / "commercial-properties.csv").is_file(),
    }


@router.post("/import")
async def import_data():
    try:
        return await asyncio.to_thread(import_kit)
    except (OSError, ValueError, KeyError):
        raise HTTPException(
            400,
            "Cannot import kit. Set COSTAR_KIT_DIR to the extracted folder containing CSVs and data/.",
        )


@router.get("/properties")
def properties(q: str = "", offset: int = 0):
    if len(q) > 200 or offset < 0:
        raise HTTPException(400, "Invalid search.")
    with db.connection() as c:
        rows = c.execute(
            "SELECT document FROM sponsor_properties WHERE instr(search, ?) > 0 ORDER BY id LIMIT 40 OFFSET ?",
            (q.lower(), offset),
        ).fetchall()
        count = c.execute(
            "SELECT COUNT(*) FROM sponsor_properties WHERE instr(search, ?) > 0",
            (q.lower(),),
        ).fetchone()[0]
    return {"total": count, "items": [json.loads(r[0]) for r in rows]}


@router.post("/reviews", status_code=202)
async def start_review(payload: ReviewRequest):
    if any(not t.done() for t in JOBS.values()):
        raise HTTPException(409, "Wait for the current property review to finish.")
    p = property_record(payload.property_id)
    if payload.model_id not in p["model_ids"]:
        raise HTTPException(
            400,
            "The selected model is not linked to this property in the supplied extract.",
        )
    doc = {
        "id": str(uuid.uuid4()),
        "created_at": db.now(),
        "property": p,
        "model_id": payload.model_id,
        "status": "loading",
        "layer_errors": {},
        "layers": ["costar"],
        "events": [],
    }
    put_review(doc)
    JOBS[doc["id"]] = asyncio.create_task(load_evidence(doc))
    return doc


@router.get("/reviews")
def list_reviews():
    with db.connection() as c:
        return [
            json.loads(r[0])
            for r in c.execute(
                "SELECT document FROM sponsor_reviews ORDER BY rowid DESC LIMIT 30"
            )
        ]


@router.get("/reviews/{id}")
def get_review(id: str):
    return review(id)


@router.get("/images/{name}")
def image(name: str):
    if not re.fullmatch(r"[0-9a-f-]{36}\.jpg", name) or not (IMAGES / name).is_file():
        raise HTTPException(404, "Image not found.")
    return FileResponse(IMAGES / name, media_type="image/jpeg")


@router.get("/viewer/{id}")
def viewer(id: str):
    doc = review(id)
    # SDK key is intentionally browser-visible, unlike the API key/token pair.
    return {
        "model_id": doc["model_id"],
        "sdk_key": config.snapshot()["matterport_sdk_key"],
    }


@router.post("/reviews/{id}/plan", status_code=202)
async def plan(id: str, payload: PlanningRequest):
    doc = review(id)
    if not payload.location_confirmed:
        raise HTTPException(
            400,
            "Confirm that the selected model and aerial extent correspond to this property.",
        )
    if doc["status"] in ("loading", "planning") or any(
        not t.done() for t in JOBS.values()
    ):
        raise HTTPException(409, "A property review is already running.")
    if len(doc.get("layers", [])) < 2:
        raise HTTPException(400, "Load at least two sponsor layers before planning.")
    if not config.snapshot()["gemini_api_key"]:
        raise HTTPException(400, "Save your Gemini key in Settings first.")
    doc.update(status="planning", error=None, location_confirmed=True, plan=None)
    put_review(doc)
    from .sponsor_agent import run_plan

    JOBS[id] = asyncio.create_task(run_plan(doc))
    return doc


async def close():
    for task in JOBS.values():
        if not task.done():
            task.cancel()
    await asyncio.gather(*JOBS.values(), return_exceptions=True)
    JOBS.clear()
