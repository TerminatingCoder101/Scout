import io
import json
import time

import httpx
import pytest
from PIL import Image

from scout import db, sponsor
from scout.config import SECRET_FIELDS, config


@pytest.fixture
def property_doc():
    return dict(
        id="commercial-1",
        source_id="1",
        name="Fixture",
        address="1 Test St",
        city="Houston",
        state="TX",
        kind="commercial",
        model_ids=["model123"],
        latitude=29.75,
        longitude=-95.4,
        facts={},
        provenance={"dataset": "synthetic", "imported_at": "2026-01-01"},
    )


@pytest.fixture
def prepared(client, property_doc):
    old = config.snapshot()
    config.update({k: "fixture-" + k for k in SECRET_FIELDS})
    with db.connection() as c:
        c.execute("DELETE FROM sponsor_reviews")
        c.execute("DELETE FROM sponsor_properties")
        c.execute(
            "INSERT INTO sponsor_properties VALUES (?,?,?)",
            (property_doc["id"], "fixture houston", json.dumps(property_doc)),
        )
    yield client
    config.update(old)


def complete_review(client, id):
    for _ in range(100):
        r = client.get("/api/sponsor/reviews/" + id).json()
        if r["status"] not in ("loading", "planning"):
            return r
        time.sleep(0.02)
    pytest.fail("Review did not complete")


def test_import_preserves_explicit_model_mapping_and_missing_coordinates(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "commercial-properties.csv").write_text(
        "PropertyId,MatterportModelId,Address,City,State\n1,model123,1 Test St,Houston,TX\n1,model456,1 Test St,Houston,TX\n1,model123,1 Test St,Houston,TX\n"
    )
    (tmp_path / "residential-listings.csv").write_text(
        "ListingId,ResidentialListingId,MatterportModelId,Address,City,State\n"
    )
    (tmp_path / "data/commercial-property.jsonl").write_text(
        json.dumps({"id": 1, "primaryAddress": {}, "numStoriesAboveGrade": 4}) + "\n"
    )
    (tmp_path / "data/residential-listings.jsonl").write_text("")
    sponsor.init()
    assert sponsor.import_kit(tmp_path)["imported"] == 1
    p = sponsor.property_record("commercial-1")
    assert p["model_ids"] == ["model123", "model456"]
    assert p["latitude"] is None
    assert p["facts"]["stories"] == 4
    with pytest.raises(sponsor.ProviderError, match="coordinates"):
        sponsor.point_coords(p)


def test_sponsor_secrets_and_routes(prepared):
    for endpoint in ("/api/settings", "/api/status", "/api/sponsor/status"):
        r = prepared.get(endpoint)
        assert r.status_code == 200
        assert "fixture-matterport" not in r.text and "fixture-vexcel" not in r.text
    assert (
        prepared.post(
            "/api/sponsor/reviews",
            json={"property_id": "commercial-1", "model_id": "unlinked"},
        ).status_code
        == 400
    )
    prepared.headers.pop("Authorization")
    assert prepared.get("/api/sponsor/properties").status_code == 401
    assert prepared.get("/api/sponsor/viewer/anything").status_code == 401


def test_joined_retrieval_real_http_shapes(prepared, monkeypatch):
    original = httpx.AsyncClient
    image = io.BytesIO()
    Image.new("RGB", (12, 12), "white").save(image, "JPEG")
    calls = []

    def handler(req):
        calls.append(req)
        if req.url.host == "api.matterport.com":
            assert req.headers["Authorization"].startswith("Basic ")
            body = json.loads(req.content)
            assert body["variables"] == {"id": "model123"}
            m = {
                "id": "model123",
                "name": "Fixture",
                "created": "2026-01-01",
                "image": {"url": "https://cdn-2.matterport.com/test.jpg"},
            }
            if "ScoutRooms" in body["query"]:
                m = {"floors": [], "rooms": []}
            return httpx.Response(200, json={"data": {"model": m}})
        if req.url.host == "cdn-2.matterport.com":
            assert "authorization" not in req.headers
            return httpx.Response(200, content=image.getvalue())
        assert req.headers["X-API-KEY"] == "fixture-vexcel_api_key"
        if req.url.path.endswith("property/extract"):
            assert req.url.params["wkt"] == "POINT(-95.4 29.75)"
            return httpx.Response(404)
        body = json.loads(req.content)
        assert body["srid"] == 4326 and body["wkt"].startswith("POLYGON((-95.")
        return httpx.Response(200, content=image.getvalue())

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    start = prepared.post(
        "/api/sponsor/reviews",
        json={"property_id": "commercial-1", "model_id": "model123"},
    )
    assert start.status_code == 202
    result = complete_review(prepared, start.json()["id"])
    assert result["status"] == "ready", result
    assert result["layers"] == ["costar", "matterport", "vexcel"]
    assert result["vexcel"]["parcel"] is None
    assert "fixture-matterport" not in json.dumps(result)
    assert len(calls) == 5
    assert (
        prepared.get("/api/sponsor/images/" + result["vexcel"]["image"]).status_code
        == 200
    )
    assert (
        prepared.post(
            f"/api/sponsor/reviews/{result['id']}/plan",
            json={"location_confirmed": False},
        ).status_code
        == 400
    )


@pytest.mark.asyncio
async def test_provider_auth_errors_are_redacted(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(
                lambda req: httpx.Response(401, text="secret echoed")
            ),
            **kw,
        ),
    )
    with pytest.raises(sponsor.ProviderError) as e:
        await sponsor.graph(
            sponsor.BASICS,
            "model123",
            {"matterport_api_key": "secret", "matterport_api_token": "secret"},
        )
    assert "401" in str(e.value) and "secret" not in str(e.value)
    with pytest.raises(sponsor.ProviderError):
        await sponsor.fetch_preview("http://127.0.0.1/private")


@pytest.mark.asyncio
async def test_planner_publishes_only_after_two_layers_read(
    prepared, property_doc, monkeypatch
):
    import deepagents
    from scout.sponsor_agent import run_plan

    doc = {
        "id": "test-plan",
        "property": property_doc,
        "model_id": "model123",
        "layers": ["costar", "matterport"],
        "layer_errors": {},
        "status": "planning",
        "events": [],
        "matterport": {
            "created_note": "unknown",
            "geometry": {"rooms": [], "floors": []},
        },
    }
    plan = {
        "summary": "Inspect the shared entrance.",
        "actions": [
            {
                "title": "Measure entry",
                "location": "Entrance to selected model",
                "reason": "Property use and incomplete interior opening evidence require on-site verification.",
                "next_action": "Measure the doorway physically.",
                "sources": ["costar", "matterport"],
            }
        ],
        "limitations": ["No physical measurements."],
    }

    class Agent:
        def __init__(self, tools):
            self.tools = {t.name: t for t in tools}

        async def ainvoke(self, *a):
            pub = self.tools["publish_inspection_plan"]
            denied = await pub.ainvoke({"plan_json": json.dumps(plan)})
            assert "at least two" in denied
            await self.tools["read_property_context"].ainvoke({})
            await self.tools["inspect_interior_geometry"].ainvoke({})
            await pub.ainvoke({"plan_json": json.dumps(plan)})

    monkeypatch.setattr(
        deepagents, "create_deep_agent", lambda **kw: Agent(kw["tools"])
    )
    await run_plan(doc)
    assert doc["status"] == "completed"
    assert doc["plan"]["status"] == "requires_site_verification"
    assert "verdict" not in doc["plan"]
    assert doc["plan"]["provenance"]["agent_read_layers"] == ["costar", "matterport"]


def test_plan_to_inspection_context_and_site_guard(prepared):
    from scout.models import ScanRequest

    doc = dict(
        id="linked-plan",
        status="completed",
        location_confirmed=True,
        property=property_doc_for_link(),
        model_id="model123",
        layers=["costar", "matterport"],
        plan=dict(
            id="PLAN-LINK",
            actions=[
                dict(
                    title="Inspect entrance",
                    location="East entrance",
                    reason="Joined context and interior evidence prioritize this entrance.",
                    next_action="Measure opening",
                    sources=["costar", "matterport"],
                )
            ],
        ),
    )
    sponsor.put_review(doc)
    req = ScanRequest(sponsor_review_id=doc["id"])
    context = sponsor.inspection_context(req)
    assert context["property_id"] == "commercial-1"
    assert context["sources"] == ["costar", "matterport"]
    assert context["execution_site"] == "local_fixture"
    with pytest.raises(ValueError, match="hardware"):
        sponsor.inspection_context(
            req.model_copy(
                update={"execution_site": "property_site", "site_confirmed": True}
            )
        )
    context = sponsor.inspection_context(
        req.model_copy(
            update={
                "execution_site": "property_site",
                "mode": "hardware",
                "site_confirmed": True,
            }
        )
    )
    assert context["execution_site"] == "property_site"
    with pytest.raises(ValueError, match="does not exist"):
        sponsor.inspection_context(req.model_copy(update={"sponsor_action_index": 7}))


def property_doc_for_link():
    return dict(id="commercial-1", name="Synthetic property", address="Fixture")


def test_history_scope_separates_properties_models_and_fixture_from_site():
    from scout.models import ScanRequest

    request = ScanRequest(building_id="shared-baseline", location_id="east-door")
    context = dict(
        property_id="commercial-1", model_id="model123", execution_site="local_fixture"
    )
    fixture = sponsor.history_scope(request, context)
    site = sponsor.history_scope(request, context | {"execution_site": "property_site"})
    other = sponsor.history_scope(request, context | {"property_id": "commercial-2"})
    model = sponsor.history_scope(request, context | {"model_id": "model456"})
    assert fixture == dict(
        building_id="fixture-commercial-1", location_id="model123-east-door"
    )
    assert site["building_id"] == "commercial-1"
    assert len({tuple(x.values()) for x in (fixture, site, other, model)}) == 4
    assert sponsor.history_scope(request) == dict(
        building_id="shared-baseline", location_id="east-door"
    )
    long = sponsor.history_scope(
        request.model_copy(update={"location_id": "x" * 120}), context
    )
    assert len(long["location_id"]) <= 120
