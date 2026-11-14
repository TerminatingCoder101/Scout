import json
import os
import secrets
from pathlib import Path
from threading import RLock

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SCOUT_DATA_DIR", str(ROOT / ".scout"))).resolve()
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
(DATA / "images").mkdir(exist_ok=True, mode=0o700)
DEFAULTS = dict(
    gemini_api_key="",
    google_vision_api_key="",
    gemini_model="gemini-3.8-flash",
    serial_port="",
    camera_index=0,
    turret_offset_cm=0.0,
    alignment_deg=0.0,
    pitch_bias_deg=0.0,
    roll_bias_deg=0.0,
    width_error_cm=1.2,
    slope_error_deg=0.15,
    calibration_verified=False,
    button_enabled=False,
    button_building_id="princeton-demo",
    button_profile="doorway",
    button_use_ai=False,
)


class Config:
    def __init__(self):
        self.lock = RLock()
        self.path = DATA / "settings.json"
        self.values = DEFAULTS | (
            json.loads(self.path.read_text()) if self.path.exists() else {}
        )
        self.values["gemini_api_key"] = os.getenv(
            "GEMINI_API_KEY", self.values["gemini_api_key"]
        )
        self.values["google_vision_api_key"] = os.getenv(
            "GOOGLE_VISION_API_KEY", self.values["google_vision_api_key"]
        )
        self.values["gemini_model"] = os.getenv(
            "GEMINI_MODEL", self.values["gemini_model"]
        )
        keypath = DATA / "access-key"
        if not keypath.exists():
            fd = os.open(keypath, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(secrets.token_urlsafe(32))
        self.access_key = os.getenv("SCOUT_API_KEY") or keypath.read_text().strip()
        if len(self.access_key) < 24:
            raise ValueError("SCOUT_API_KEY must be at least 24 characters")

    def snapshot(self):
        with self.lock:
            return dict(self.values)

    def public(self):
        v = self.snapshot()
        for key in ("gemini_api_key", "google_vision_api_key"):
            v[key + "_configured"] = bool(v.pop(key))
        return v

    def update(self, changes):
        with self.lock:
            self.values.update(changes)
            temp = self.path.with_suffix(".tmp")
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(self.values, f)
            temp.replace(self.path)
        return self.public()


config = Config()
