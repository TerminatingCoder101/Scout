import os
import tempfile

os.environ["SCOUT_DATA_DIR"] = tempfile.mkdtemp(prefix="scout-tests-")
os.environ["SCOUT_API_KEY"] = "test-key-long-enough-for-scout-12345"
import pytest
from fastapi.testclient import TestClient
from scout.config import config
from scout.main import app
from scout import db


@pytest.fixture
def client(monkeypatch):
    # Unit/API tests must never connect to a developer's Atlas database.
    monkeypatch.delenv("MONGODB_URI", raising=False)
    with TestClient(app) as c:
        with db.connection() as conn:
            conn.execute("DELETE FROM scans")
            conn.execute("DELETE FROM events")
            conn.execute("DELETE FROM trials")
        config.update(
            {
                "gemini_api_key": "",
                "google_vision_api_key": "",
                "calibration_verified": False,
                "button_enabled": False,
            }
        )
        c.headers["Authorization"] = "Bearer " + config.access_key
        yield c
