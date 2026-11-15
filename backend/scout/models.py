from typing import Literal
from datetime import datetime, timezone
from pydantic import model_validator
from pydantic import BaseModel, Field, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Twin(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=200)
    source: Literal["demo", "manual", "matterport_export", "costar_export"] = "manual"
    source_reference: str = Field(default="", max_length=500)
    width_in: float = Field(gt=0, le=250)
    running_slope_deg: float = Field(default=0, ge=0, le=45)
    cross_slope_deg: float = Field(default=0, ge=0, le=45)
    captured_at: str = Field(default="", max_length=50)


class ScanRequest(StrictModel):
    building_id: str = "princeton-demo"
    location_id: str | None = Field(
        default=None, min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$"
    )
    mode: Literal["demo", "hardware"] = "demo"
    scenario: Literal["obstructed", "clear", "borderline", "noisy"] = "obstructed"
    profile: Literal["doorway", "ramp", "corridor"] = "doorway"
    use_ai: bool = False
    opening_depth_in: float = Field(default=12, ge=0, le=240)
    threshold_in: float | None = Field(default=None, ge=0, le=10)
    handle_height_in: float | None = Field(default=None, ge=0, le=100)


class Point(StrictModel):
    angle_deg: float = Field(ge=0, le=180)
    distance_cm: float | None = Field(default=None, gt=0, le=400)
    spread_cm: float = Field(default=0, ge=0, le=400)
    valid_pings: int = Field(default=15, ge=0, le=15)


class SettingsUpdate(StrictModel):
    matterport_api_key: str | None = Field(default=None, max_length=1000)
    matterport_api_token: str | None = Field(default=None, max_length=2000)
    matterport_sdk_key: str | None = Field(default=None, max_length=1000)
    vexcel_api_key: str | None = Field(default=None, max_length=4000)
    gemini_api_key: str | None = Field(default=None, max_length=300)
    google_vision_api_key: str | None = Field(default=None, max_length=300)
    gemini_model: str | None = Field(
        default=None, min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9._/-]+$"
    )
    serial_port: str | None = Field(default=None, max_length=200)
    camera_index: int | None = Field(default=None, ge=0, le=10)
    turret_offset_cm: float | None = Field(default=None, ge=-10, le=20)
    alignment_deg: float | None = Field(default=None, ge=-15, le=15)
    pitch_bias_deg: float | None = Field(default=None, ge=-10, le=10)
    roll_bias_deg: float | None = Field(default=None, ge=-10, le=10)
    width_error_cm: float | None = Field(default=None, ge=0.1, le=20)
    slope_error_deg: float | None = Field(default=None, ge=0.05, le=5)
    calibration_verified: bool | None = None
    button_enabled: bool | None = None
    button_building_id: str | None = Field(default=None, max_length=64)
    button_profile: Literal["doorway", "ramp", "corridor"] | None = None
    button_use_ai: bool | None = None


class CalibrationRequest(StrictModel):
    forward_pitch: float = Field(ge=-45, le=45)
    reverse_pitch: float = Field(ge=-45, le=45)
    forward_roll: float = Field(ge=-45, le=45)
    reverse_roll: float = Field(ge=-45, le=45)


class ValidationTrial(StrictModel):
    metric: Literal["width_cm", "running_slope_deg", "cross_slope_deg"]
    reference: float = Field(ge=0, le=500)
    measured: float = Field(ge=0, le=500)
    notes: str = Field(default="", max_length=500)


class WorkOrderUpdate(StrictModel):
    status: Literal["open", "in_progress", "resolved"]
    assignee: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=2000)


class InspectionMeasurement(StrictModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    value: float | None = Field(default=None, ge=-1e12, le=1e12)
    unit: str = Field(min_length=1, max_length=30)
    uncertainty: float = Field(ge=0, le=1e12)


class InspectionFinding(StrictModel):
    category: str = Field(default="uncategorized", min_length=1, max_length=80)
    key: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    status: Literal["observed", "resolved", "passed", "inconclusive", "recheck"] = (
        "recheck"
    )
    detail: str = Field(default="", max_length=2000)


class InspectionAction(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    detail: str = Field(default="", max_length=2000)


class InspectionTilt(StrictModel):
    pitch_deg: float | None = Field(default=None, ge=-90, le=90)
    roll_deg: float | None = Field(default=None, ge=-90, le=90)
    still: bool = False


class InspectionCreate(StrictModel):
    scan_id: str | None = Field(default=None, max_length=80)
    source_mode: Literal["demo", "hardware"] | None = None
    building_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    location_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    raw_sensor_measurements: list[Point] = Field(default_factory=list, max_length=1000)
    raw_tilt: InspectionTilt | None = None
    measurements: list[InspectionMeasurement] = Field(
        default_factory=list, max_length=100
    )
    findings: list[InspectionFinding] = Field(default_factory=list, max_length=100)
    photo_references: list[str] = Field(default_factory=list, max_length=20)
    agent_actions: list[InspectionAction] = Field(default_factory=list, max_length=100)
    review_status: Literal["pending", "reviewed", "inconclusive", "recheck"] = "recheck"

    @model_validator(mode="after")
    def validate_record(self):
        if self.timestamp.utcoffset() is None:
            raise ValueError("timestamp must include a timezone")
        self.timestamp = self.timestamp.astimezone(timezone.utc)
        # BSON dates have millisecond precision; create/get must agree exactly.
        self.timestamp = self.timestamp.replace(
            microsecond=(self.timestamp.microsecond // 1000) * 1000
        )
        for items in (self.measurements, self.findings):
            if len({item.key for item in items}) != len(items):
                raise ValueError(
                    "Measurement and finding keys must be unique within each list"
                )
        if any(not p or len(p) > 500 for p in self.photo_references):
            raise ValueError(
                "Photo references must be nonempty and at most 500 characters"
            )
        return self
