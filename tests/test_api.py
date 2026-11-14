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
