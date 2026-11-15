"""Explicit opt-in real driver check. Never uses production MONGODB_URI implicitly."""

import os
import uuid
from datetime import datetime, timezone

import pytest
from bson import ObjectId

from scout import inspections
from scout.models import InspectionCreate


@pytest.mark.asyncio
async def test_real_mongodb_round_trip(monkeypatch):
    uri = os.getenv("MONGODB_TEST_URI")
    name = os.getenv("MONGODB_TEST_DB")
    if not uri or not name:
        pytest.skip(
            "Set MONGODB_TEST_URI and MONGODB_TEST_DB explicitly for the live test"
        )
    monkeypatch.setattr(inspections, "mongodb_settings", lambda: (uri, name))
    store = inspections.InspectionStore()
    ids = []
    try:
        await store.open()
        location = "test-" + uuid.uuid4().hex
        building = "test-" + uuid.uuid4().hex
        for i in range(2):
            result = await store.create(
                InspectionCreate(
                    building_id=building,
                    location_id=location,
                    timestamp=datetime(2026, 1, i + 1, tzinfo=timezone.utc),
                    measurements=[
                        dict(key="width", value=90 - i * 5, uncertainty=1, unit="cm")
                    ],
                    findings=[
                        dict(
                            key="obstruction",
                            category="clearance",
                            status="observed" if i == 0 else "resolved",
                        )
                    ],
                    review_status="recheck" if i == 0 else "reviewed",
                )
            )
            ids.append(ObjectId(result["id"]))
        latest = await store.latest(building, location, 2)
        assert len(latest) == 2
        assert (await store.get(str(ids[0])))["location_id"] == location
        assert (
            inspections.compare(latest[1], latest[0])["measurement_changes"][0]["delta"]
            == -5
        )
        assert len(await store.browse(building)) == 2
        assert len(await store.browse(building, location, offset=1)) == 1
        summary = await store.analytics(building)
        assert summary["total_inspections"] == 2
        assert summary["open_findings"] == 0
        assert summary["verified_fixes"] == 1
        assert summary["categories"] == [{"category": "clearance", "count": 1}]
        assert [v["count"] for v in summary["activity"]] == [1, 1]
    finally:
        try:
            if store.collection is not None and ids:
                await store.collection.delete_many({"_id": {"$in": ids}})
        finally:
            await store.close()
