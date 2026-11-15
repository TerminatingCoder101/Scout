import json
import time
import pytest
from scout.config import config
from scout import db


def complete(client, id):
    for _ in range(300):
        s = client.get("/api/scans/" + id).json()
        if s["status"] not in ("queued", "running"):
            return s
        time.sleep(0.02)
    pytest.fail("Scan timed out")


@pytest.mark.parametrize(
    "scenario,expected",
    [
        ("obstructed", "FAIL"),
        ("clear", "PASS"),
        ("borderline", "VERIFY"),
        ("noisy", "VERIFY"),
    ],
)
def test_end_to_end_scan(client, scenario, expected):
    res = client.post("/api/scans", json={"scenario": scenario})
    assert res.status_code == 202
    s = complete(client, res.json()["id"])
    assert s["status"] == "completed", s
    assert s["result"]["verdict"] == expected
    assert len(s["points"]) == 37
    assert s["work_order"]["status"] == "open"
    exported = client.get(f"/api/scans/{s['id']}/export.json")
    assert exported.status_code == 200 and exported.json()["id"] == s["id"]
    pdf = client.get(f"/api/scans/{s['id']}/report.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    if scenario != "clear":
        image = client.get(s["images"][0]["url"])
        assert (
            image.status_code == 200 and image.headers["content-type"] == "image/jpeg"
        )
        assert s["diagnosis"]["provider"] == "simulation"
    timeline = client.get(f"/api/scans/{s['id']}/events")
    assert "event: end" in timeline.text and '"kind": "complete"' in timeline.text
    event = client.get(f"/api/scans/{s['id']}/timeline").json()[-1]
    resumed = client.get(
        f"/api/scans/{s['id']}/events", headers={"Last-Event-ID": str(event["id"])}
    )
    assert '"kind"' not in resumed.text
    assert (
        client.patch(
            f"/api/scans/{s['id']}/work-order",
            json={
                "status": "resolved",
                "assignee": "Facilities",
                "notes": "Verified on site.",
            },
        ).json()["work_order"]["status"]
        == "resolved"
    )


def test_auth_and_csrf(client):
    client.headers.pop("Authorization")
    assert client.get("/api/settings").status_code == 401
    assert client.post("/api/auth", json={"key": "bad"}).status_code == 401
    assert (
        client.post(
            "/api/auth",
            json={"key": config.access_key},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
    login = client.post("/api/auth", json={"key": config.access_key})
    assert (
        "HttpOnly" in login.headers["set-cookie"]
        and "SameSite=strict" in login.headers["set-cookie"]
    )
    assert client.get("/api/settings").status_code == 200
    assert (
        client.get("/api/health", headers={"host": "evil.example"}).status_code == 400
    )
    client.delete("/api/auth")
    assert client.get("/api/settings").status_code == 401


def test_secrets_redacted(client):
    key = "sensitive-test-secret"
    r = client.patch("/api/settings", json={"gemini_api_key": key})
    assert r.status_code == 200 and r.json()["gemini_api_key_configured"]
    assert key not in r.text
    assert key not in client.get("/api/status").text
    s = complete(
        client, client.post("/api/scans", json={"scenario": "clear"}).json()["id"]
    )
    assert key not in json.dumps(s)


def test_cancel_and_concurrency(client):
    s = client.post("/api/scans", json={}).json()
    assert client.post("/api/scans", json={}).status_code == 409
    assert client.patch("/api/settings", json={"camera_index": 1}).status_code == 409
    r = client.post("/api/scans/" + s["id"] + "/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post("/api/scans/" + s["id"] + "/cancel").status_code == 409
    next_scan = client.post("/api/scans", json={"scenario": "clear"})
    assert next_scan.status_code == 202
    assert complete(client, next_scan.json()["id"])["status"] == "completed"


def test_validation_and_import(client):
    invalid = client.post("/api/twins", json={"id": "../x"})
    assert invalid.status_code == 422
    twin = dict(
        id="entrance-1",
        name="<script>building</script>",
        source="matterport_export",
        width_in=36,
    )
    assert client.post("/api/twins", json=twin).status_code == 200
    s = client.post(
        "/api/scans", json={"building_id": "entrance-1", "scenario": "clear"}
    ).json()
    twin["width_in"] = 40
    client.post("/api/twins", json=twin)
    assert complete(client, s["id"])["twin"]["width_in"] == 36
    assert (
        client.post(
            "/api/validation",
            json={
                "metric": "width_cm",
                "reference": 100,
                "measured": 99.2,
                "notes": "=SUM(A1)",
            },
        ).status_code
        == 200
    )
    data = client.get("/api/validation").json()
    assert data["summary"]["width_cm"]["mean_absolute_error"] == pytest.approx(0.8)
    assert "'=SUM(A1)" in client.get("/api/validation/export.csv").text


def test_bad_requests_and_missing_credentials(client):
    assert client.post("/api/scans", json={"use_ai": True}).status_code == 400
    assert client.post("/api/scans", json={"mode": "hardware"}).status_code == 400
    assert client.post("/api/scans", json={"building_id": "missing"}).status_code == 404
    assert client.post("/api/scans", json={"threshold_in": -1}).status_code == 422
    assert client.patch("/api/settings", json={"camera_index": -1}).status_code == 422
    assert client.get("/api/images/not-a-frame.jpg").status_code == 404
    assert client.get("/api/scans/no-such-scan/report.pdf").status_code == 404
    assert client.get("/api/health").json()["status"] == "ok"


def test_restart_marks_running_interrupted(client):
    doc = dict(id="stale", created_at=db.now(), status="running")
    db.save_scan(doc)
    db.init()
    assert db.get_scan("stale")["status"] == "interrupted"


def test_completed_scan_automatically_saved_to_atlas(client, monkeypatch):
    from scout import inspections
    from unittest.mock import AsyncMock
    from bson import ObjectId

    saved_id = str(ObjectId())
    create = AsyncMock(return_value={"id": saved_id})
    monkeypatch.setattr(inspections.store, "create", create)
    res = client.post(
        "/api/scans", json={"scenario": "obstructed", "location_id": "east-door"}
    )
    scan = complete(client, res.json()["id"])
    assert scan["atlas_status"] == "saved"
    assert scan["atlas_inspection_id"] == saved_id
    payload = create.call_args.args[0]
    assert payload.location_id == "east-door" and payload.source_mode == "demo"
    assert payload.scan_id == scan["id"]
    assert len(payload.raw_sensor_measurements) == 37
    assert payload.measurements[0].uncertainty == scan["result"]["checks"][0]["error"]
    assert payload.photo_references == [image["url"] for image in scan["images"]]
    assert all(f.status != "resolved" for f in payload.findings)
    assert payload.review_status != "reviewed"
    create.assert_awaited_once()


def test_atlas_failure_keeps_completed_local_inspection(client):
    res = client.post("/api/scans", json={"scenario": "clear"})
    scan = complete(client, res.json()["id"])
    assert scan["status"] == "completed"
    assert scan["atlas_status"] == "failed"
    assert "saved locally" in scan["atlas_error"]
    assert len(scan["points"]) == 37


def test_linked_plan_flows_through_scan_work_order_and_atlas(client, monkeypatch):
    from scout import inspections, sponsor
    from bson import ObjectId
    from unittest.mock import AsyncMock

    review = dict(
        id="flow-review",
        status="completed",
        location_confirmed=True,
        property=dict(
            id="commercial-flow",
            name="Fixture property",
            address="Test address",
            provenance={"provider": "CoStar", "join": "explicit mapping"},
            facts={"stories": 2},
        ),
        model_id="modelFlow",
        layers=["costar", "matterport"],
        plan=dict(
            id="PLAN-FLOW",
            actions=[
                dict(
                    title="Check entrance",
                    location="East door",
                    reason="Joined context and geometry",
                    next_action="Measure opening",
                    sources=["costar", "matterport"],
                )
            ],
        ),
    )
    sponsor.put_review(review)
    save = AsyncMock(return_value={"id": str(ObjectId())})
    monkeypatch.setattr(inspections.store, "create", save)
    started = client.post(
        "/api/scans",
        json={
            "scenario": "clear",
            "sponsor_review_id": "flow-review",
            "use_baseline": False,
            "location_id": "east-door",
        },
    )
    assert started.status_code == 202
    scan = complete(client, started.json()["id"])
    assert scan["atlas_status"] == "saved"
    assert scan["history_scope"]["building_id"] == "fixture-commercial-flow"
    assert scan["work_order"]["sponsor_context"]["plan_id"] == "PLAN-FLOW"
    payload = save.call_args.args[0]
    assert payload.building_id == "fixture-commercial-flow"
    assert payload.location_id == "modelFlow-east-door"
    assert payload.sponsor_context.evidence_provenance["costar"]["provider"] == "CoStar"
    assert payload.sponsor_context.execution_site == "local_fixture"
    linked = client.get("/api/sponsor/reviews/flow-review/inspections").json()
    assert linked[0]["history_scope"] == scan["history_scope"]
    from io import BytesIO
    from pypdf import PdfReader

    pdf = client.get(f"/api/scans/{scan['id']}/report.pdf")
    report_text = " ".join(
        p.extract_text() for p in PdfReader(BytesIO(pdf.content)).pages
    )
    assert "Sponsor evidence and inspection task" in report_text
    assert "PLAN-FLOW" in report_text and "LOCAL FIXTURE" in report_text
    assert "Measurement-only inspection" in report_text


def test_imu_calibration_capture_and_level_confirmation(client, monkeypatch):
    from scout.service import manager
    from unittest.mock import AsyncMock
    from scout.hardware import DeviceError

    old = config.snapshot()
    monkeypatch.setattr(manager.device, "connect", AsyncMock())
    sample = AsyncMock(return_value=dict(pitch_deg=0.8, roll_deg=-1.2, still=True))
    monkeypatch.setattr(manager.device, "sample_tilt", sample)
    try:
        assert (
            client.post(
                "/api/calibration/level", json={"confirmed_level": False}
            ).status_code
            == 422
        )
        sample.assert_not_awaited()
        result = client.post("/api/calibration/read-imu").json()
        assert result["pitch_deg"] == 0.8
        assert config.snapshot()["pitch_bias_deg"] == old["pitch_bias_deg"]
        response = client.post("/api/calibration/level", json={"confirmed_level": True})
        assert response.status_code == 200
        assert config.snapshot()["pitch_bias_deg"] == 0.8
        assert config.snapshot()["roll_bias_deg"] == -1.2
        assert not config.snapshot()["calibration_verified"]
        monkeypatch.setattr(manager, "active_id", "busy-scan")
        assert client.post("/api/calibration/read-imu").status_code == 409
        monkeypatch.setattr(manager, "active_id", None)
        sample.side_effect = DeviceError("Hold the rig still")
        assert client.post("/api/calibration/read-imu").status_code == 400
    finally:
        config.update(
            {
                k: old[k]
                for k in ("pitch_bias_deg", "roll_bias_deg", "calibration_verified")
            }
        )


def test_ai_inspection_preserves_hardware_failure_instead_of_blaming_google(
    client, monkeypatch
):
    from scout import agent
    from scout.service import manager
    from scout.hardware import DeviceError
    from unittest.mock import AsyncMock

    config.update({"gemini_api_key": "test-key"})
    monkeypatch.setattr(manager.device, "connect", AsyncMock())
    monkeypatch.setattr(
        manager.device,
        "sweep",
        AsyncMock(side_effect=DeviceError("IMU not detected. Check wiring.")),
    )
    monkeypatch.setattr(manager.device, "stop", AsyncMock())

    async def run(context):
        await context.sweep()

    monkeypatch.setattr(agent, "run_deep_agent", run)
    response = client.post("/api/scans", json={"mode": "hardware", "use_ai": True})
    assert response.status_code == 202
    scan = complete(client, response.json()["id"])
    assert scan["status"] == "failed"
    assert scan["error"] == "IMU not detected. Check wiring."
    assert scan["device_error"] == scan["error"]
    assert "ai_error" not in scan
    notices = [
        e
        for e in client.get(f"/api/scans/{scan['id']}/timeline").json()
        if e["kind"] == "notice"
    ]
    assert notices[-1]["data"]["stage"] == "hardware"
