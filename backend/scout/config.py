import json
import os
import secrets
from pathlib import Path
from threading import RLock
from urllib.parse import quote_plus, urlsplit, urlunsplit

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SCOUT_DATA_DIR", str(ROOT / ".scout"))).resolve()
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
(DATA / "images").mkdir(exist_ok=True, mode=0o700)
DEFAULTS = dict(
    matterport_api_key="",
    matterport_api_token="",
    matterport_sdk_key="",
    vexcel_api_key="",
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


SECRET_FIELDS = (
    "gemini_api_key",
    "google_vision_api_key",
    "matterport_api_key",
    "matterport_api_token",
    "matterport_sdk_key",
    "vexcel_api_key",
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
        for field in SECRET_FIELDS:
            self.values[field] = os.getenv(field.upper(), self.values[field])
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
        for key in SECRET_FIELDS:
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


def mongodb_settings():
    """Read only Atlas fields from the root .env; process env takes precedence."""
    file_values = dotenv_values(ROOT / ".env", interpolate=False)

    def value(key, default=""):
        return (
            os.environ[key] if key in os.environ else (file_values.get(key) or default)
        )

    uri = value("MONGODB_URI").strip()
    name = value("MONGODB_DB", "scout").strip()
    username, password = value("MONGODB_USERNAME"), value("MONGODB_PASSWORD")
    # A process-provided URI is a complete override unless process credentials
    # are explicitly supplied as well; don't mix it with stale .env secrets.
    if "MONGODB_URI" in os.environ and not any(
        k in os.environ for k in ("MONGODB_USERNAME", "MONGODB_PASSWORD")
    ):
        username, password = "", ""
    if bool(username) != bool(password):
        raise ValueError("Set both MongoDB username and password.")
    if username and password:
        if not uri:
            raise ValueError("Set the MongoDB cluster URI.")
        parsed = urlsplit(uri)
        if parsed.scheme not in ("mongodb", "mongodb+srv") or not parsed.netloc:
            raise ValueError("Invalid MongoDB URI.")
        authority = parsed.netloc
        if "@" in authority:
            userinfo, _, authority = authority.rpartition("@")
            if not any(
                token in userinfo.lower()
                for token in (
                    "<username>",
                    "<password>",
                    "<db_username>",
                    "<db_password>",
                )
            ):
                raise ValueError(
                    "Do not combine embedded URI credentials with separate MongoDB credentials."
                )
        authority = f"{quote_plus(username)}:{quote_plus(password)}@{authority}"
        uri = urlunsplit(
            (parsed.scheme, authority, parsed.path, parsed.query, parsed.fragment)
        )
    return uri, name
