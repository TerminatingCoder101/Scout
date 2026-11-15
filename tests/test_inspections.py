import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from pymongo.errors import ConnectionFailure

from scout import inspections
from scout.models import InspectionCreate


def payload(**changes):
    return (
        dict(
            building_id="building-1",
            location_id="door-1",
            timestamp="2026-11-14T12:00:00Z",
            raw_sensor_measurements=[
                dict(angle_deg=0, distance_cm=42, spread_cm=0.5, valid_pings=15)
            ],
            raw_tilt={"pitch_deg": -0.5, "roll_deg": 0.2, "still": True},
            measurements=[dict(key="width", value=85, unit="cm", uncertainty=1)],
            findings=[dict(key="box", status="observed", detail="Box at jamb")],
            photo_references=["/api/images/local.jpg"],
            agent_actions=[dict(name="capture", detail="Aimed at jamb")],
            review_status="recheck",
        )
        | changes
    )


class Collection:
    def __init__(self):
        self.docs = []
        self.queries = []

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        doc = copy.deepcopy(doc)
        doc["_id"] = ObjectId()
        self.docs.append(doc)
        return SimpleNamespace(inserted_id=doc["_id"])

    async def find_one(self, query):
        return next(
            (copy.deepcopy(d) for d in self.docs if d["_id"] == query["_id"]), None
        )

    def find(self, query):
        self.queries.append(query)
        docs = [
            copy.deepcopy(d)
            for d in self.docs
            if all(d[k] == v for k, v in query.items())
        ]

        class Cursor:
            def sort(self, order):
                assert order == [("timestamp", -1), ("_id", -1)]
                docs.sort(key=lambda d: (d["timestamp"], d["_id"]), reverse=True)
                return self

            def limit(self, n):
                self.n = n
                return self

            async def to_list(self, length):
                return docs[: min(length, self.n)]

        return Cursor()


@pytest.fixture
def atlas(client, monkeypatch):
    c = Collection()
    monkeypatch.setattr(inspections.store, "collection", c)
    return client, c


def test_create_get_latest_comparison_and_isolation(atlas):
    client, c = atlas
    first = client.post("/api/inspections", json=payload())
    assert first.status_code == 201
    before = first.json()
    assert ObjectId.is_valid(before["id"])
    assert before["measurements"][0]["uncertainty"] == 1
    assert before["raw_tilt"]["pitch_deg"] == -0.5
    assert before["raw_sensor_measurements"][0]["valid_pings"] == 15
    assert client.get("/api/inspections/" + before["id"]).json() == before
    other = payload(building_id="other", timestamp="2026-11-15T12:00:00Z")
    client.post("/api/inspections", json=other)
    client.post(
        "/api/inspections",
        json=payload(location_id="other", timestamp="2026-11-15T12:00:00Z"),
    )
    after = client.post(
        "/api/inspections",
        json=payload(
            timestamp="2026-11-14T13:00:00Z",
            measurements=[dict(key="width", value=80, unit="cm", uncertainty=2)],
            findings=[dict(key="box", status="resolved")],
        ),
    ).json()
    params = dict(building_id="building-1", location_id="door-1")
    assert [
        d["id"] for d in client.get("/api/inspections/latest", params=params).json()
    ] == [after["id"], before["id"]]
    result = client.get("/api/inspections/compare", params=params).json()
    assert result["before_id"] == before["id"] and result["after_id"] == after["id"]
    assert result["measurement_changes"][0]["delta"] == -5
    assert result["measurement_changes"][0]["combined_uncertainty"] == 3
    assert result["measurement_changes"][0]["status"] == "changed"
    assert result["finding_changes"][0]["change"] == "status_changed"


def test_validation_auth_missing_records_and_insufficient_history(atlas):
    client, _ = atlas
    for changes in [
        dict(timestamp="2026-01-01T00:00:00"),
        dict(review_status="certified"),
        dict(measurements=[dict(key="x", value=1, unit="cm", uncertainty=-1)]),
        dict(findings=[dict(key="x"), dict(key="x")]),
    ]:
        assert (
            client.post("/api/inspections", json=payload(**changes)).status_code == 422
        )
    assert client.get("/api/inspections/bad-id").status_code == 422
    assert client.get("/api/inspections/" + str(ObjectId())).status_code == 404
    params = dict(building_id="building-1", location_id="door-1")
    assert client.get("/api/inspections/compare", params=params).status_code == 409
    assert (
        client.get(
            "/api/inspections/latest", params=params | dict(limit=101)
        ).status_code
        == 422
    )
    client.headers.pop("Authorization")
    assert client.post("/api/inspections", json=payload()).status_code == 401


def test_uncertainty_overlap_missing_units_and_removed_finding():
    a = payload() | {"id": "a"}
    b = payload(
        measurements=[dict(key="width", value=83, unit="cm", uncertainty=1)],
        findings=[],
    ) | {"id": "b"}
    r = inspections.compare(a, b)
    assert r["measurement_changes"][0]["status"] == "inconclusive"  # touching intervals
    assert r["review_status"] == "recheck"
    assert r["finding_changes"][0]["change"] == "absent_in_latest"
    for measurements in (
        [],
        [dict(key="width", value=None, unit="cm", uncertainty=1)],
        [dict(key="width", value=3, unit="in", uncertainty=1)],
    ):
        assert all(
            m["status"] == "inconclusive"
            for m in inspections.compare(a, b | dict(measurements=measurements))[
                "measurement_changes"
            ]
        )


def test_disabled_and_failure_responses_are_safe(client, monkeypatch):
    assert client.post("/api/inspections", json=payload()).status_code == 503
    c = Collection()
    c.insert_one = AsyncMock(
        side_effect=ConnectionFailure("mongodb+srv://user:secret@internal-host")
    )
    monkeypatch.setattr(inspections.store, "collection", c)
    r = client.post("/api/inspections", json=payload())
    assert (
        r.status_code == 503
        and "secret" not in r.text
        and "internal-host" not in r.text
    )


@pytest.mark.asyncio
async def test_shared_client_lifecycle_indexes_and_failure_cleanup(monkeypatch):
    c = Collection()
    c.create_index = AsyncMock()
    client = SimpleNamespace(
        admin=SimpleNamespace(command=AsyncMock()), close=AsyncMock()
    )

    class FakeClient:
        admin = client.admin
        close = client.close

        def __getitem__(self, key):
            return {"inspections": c}

    monkeypatch.setattr(
        inspections, "mongodb_settings", lambda: ("test-uri", "test-db")
    )
    monkeypatch.setattr(inspections, "AsyncMongoClient", lambda *a, **kw: FakeClient())
    store = inspections.InspectionStore()
    await store.open()
    assert store.collection is c
    c.create_index.assert_awaited_once_with(
        [("building_id", 1), ("location_id", 1), ("timestamp", -1), ("_id", -1)],
        name="location_history",
    )
    await store.close()
    client.close.assert_awaited_once()
    assert store.collection is None
    client.admin.command.side_effect = ConnectionFailure("secret")
    with pytest.raises(
        inspections.InspectionUnavailable, match="initialization failed"
    ):
        await store.open()
    assert client.close.await_count == 2


@pytest.mark.asyncio
async def test_async_store_yields_and_tool_is_location_bound(monkeypatch):
    c = Collection()
    monkeypatch.setattr(inspections.store, "collection", c)
    progressed = []

    async def heartbeat():
        await asyncio.sleep(0)
        progressed.append(True)

    await asyncio.gather(
        inspections.store.create(InspectionCreate(**payload())), heartbeat()
    )
    assert progressed
    tool = inspections.previous_inspections_tool("building-1", "door-1")
    assert "door-1" in await tool.ainvoke({"limit": 2})
    assert c.queries[-1] == dict(building_id="building-1", location_id="door-1")
    assert "between" in await tool.ainvoke({"limit": 21})
    monkeypatch.setattr(inspections.store, "collection", None)
    assert "unavailable" in await tool.ainvoke({})
    assert "No location_id" in await inspections.previous_inspections_tool(
        "building-1", None
    ).ainvoke({})


def test_history_and_analytics_endpoints(client, monkeypatch):
    browse = AsyncMock(return_value=[])
    analytics = AsyncMock(return_value={"total_inspections": 0})
    monkeypatch.setattr(inspections.store, "browse", browse)
    monkeypatch.setattr(inspections.store, "analytics", analytics)
    assert (
        client.get("/api/inspections?building_id=b&location_id=l&offset=50").json()
        == []
    )
    browse.assert_awaited_once_with("b", "l", 50, 50)
    assert client.get("/api/inspections/analytics?building_id=b").json() == {
        "total_inspections": 0
    }
    analytics.assert_awaited_once_with("b")
    assert client.get("/api/inspections?limit=101").status_code == 422
    assert client.get("/api/inspections?offset=-1").status_code == 422
    client.headers.pop("Authorization")
    assert client.get("/api/inspections").status_code == 401
    assert client.get("/api/inspections/analytics").status_code == 401


def test_history_analytics_disabled_database(client):
    assert client.get("/api/inspections").status_code == 503
    assert client.get("/api/inspections/analytics").status_code == 503


def test_sync_imports_all_local_history_and_skips_existing(client, monkeypatch):
    from scout import db

    c = SimpleNamespace(find_one=AsyncMock(return_value=None))
    monkeypatch.setattr(inspections.store, "collection", c)
    save = AsyncMock(return_value=str(ObjectId()))
    monkeypatch.setattr(inspections, "save_completed_scan", save)
    for i in range(105):
        db.save_scan(
            dict(
                id=f"old-{i}",
                created_at="2026-01-01T00:00:00Z",
                status="completed",
                result={"checks": []},
            )
        )
    db.save_scan(
        dict(id="cancelled", created_at="2026-01-01T00:00:00Z", status="cancelled")
    )
    result = client.post("/api/inspections/sync-local")
    assert result.status_code == 200
    assert result.json()["imported"] == 105  # bypasses the recent-scans LIMIT 100
    assert save.await_count == 105
    save.reset_mock()
    c.find_one.return_value = {"_id": ObjectId()}
    result = client.post("/api/inspections/sync-local").json()
    assert result["imported"] == 0
    assert result["already_saved_or_skipped"] == 105
    save.assert_not_awaited()


def test_human_review_keeps_measurements_and_original_keys(atlas):
    client, collection = atlas
    record = client.post("/api/inspections", json=payload()).json()

    async def update(query, changes):
        for doc in collection.docs:
            if doc["_id"] == query["_id"]:
                doc.update(changes["$set"])
                doc.setdefault("review_history", []).append(
                    changes["$push"]["review_history"]
                )

    collection.update_one = update
    response = client.patch(
        f"/api/inspections/{record['id']}/review",
        json={
            "findings": [
                dict(
                    key="box",
                    status="resolved",
                    detail="Removed and physically rechecked",
                )
            ],
            "notes": "Operator rechecked opening.",
        },
    )
    assert response.status_code == 200
    assert response.json()["measurements"] == record["measurements"]
    assert response.json()["review_status"] == "reviewed"
    assert response.json()["review_history"][0]["before"][0]["status"] == "observed"
    assert (
        client.patch(
            f"/api/inspections/{record['id']}/review",
            json={"findings": [], "notes": "Do not silently discard findings"},
        ).status_code
        == 422
    )
