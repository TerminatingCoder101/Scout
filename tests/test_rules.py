import math
import pytest
from scout.rules import check, evaluate, flip_calibration, RUNNING_MAX, CROSS_MAX
from scout.config import DEFAULTS
from scout.models import ScanRequest, CalibrationRequest

TWIN = dict(width_in=36, running_slope_deg=3.5, cross_slope_deg=0.4)


def points(width=34, spread=0.4):
    return [
        dict(
            angle_deg=a,
            distance_cm=(width * 2.54 / 2) / max(abs(math.cos(math.radians(a))), 0.2),
            spread_cm=spread,
            valid_pings=15,
        )
        for a in range(0, 181, 5)
    ]


def result(width=34, profile="doorway", pitch=3.5, roll=0.4, mode="demo", **extra):
    return evaluate(
        points(width),
        dict(pitch_deg=pitch, roll_deg=roll, still=True),
        ScanRequest(profile=profile, mode=mode, **extra),
        DEFAULTS,
        TWIN,
    )


@pytest.mark.parametrize(
    "value,error,low,high,expected",
    [
        (32.5, 0.5, 32, None, "PASS"),
        (32, 0.5, 32, None, "VERIFY"),
        (31.4, 0.5, 32, None, "FAIL"),
        (1.0, 0.1, None, 1.2, "PASS"),
        (1.2, 0.1, None, 1.2, "VERIFY"),
        (1.4, 0.1, None, 1.2, "FAIL"),
        (None, 0.1, None, 1.2, "NOT_MEASURED"),
    ],
)
def test_error_intervals(value, error, low, high, expected):
    assert check("x", "x", value, error, low, high, "in", "s")["status"] == expected


def test_profiles_and_deep_opening():
    assert result(34)["verdict"] == "PASS"
    assert result(34, "corridor")["checks"][0]["status"] == "FAIL"
    assert result(34, "ramp")["checks"][0]["status"] == "FAIL"
    assert result(34, opening_depth_in=25)["checks"][0]["minimum"] == 36
    assert result(34, opening_depth_in=24)["checks"][0]["minimum"] == 32


def test_precise_slope_limits():
    assert RUNNING_MAX == pytest.approx(4.76364169)
    assert CROSS_MAX == pytest.approx(1.19348942)
    assert result(37, "ramp", roll=2.1)["verdict"] == "FAIL"
    assert result(37, "ramp", roll=1.2)["verdict"] == "VERIFY"
    assert result(37, "ramp")["verdict"] == "PASS"
    assert result(37, "corridor", pitch=3.5)["verdict"] == "FAIL"


def test_missing_and_noisy_readings_never_pass():
    req = ScanRequest()
    p = points()
    p = [x for x in p if 10 < x["angle_deg"] < 170]
    assert (
        evaluate(p, dict(pitch_deg=0, roll_deg=0, still=True), req, DEFAULTS, TWIN)[
            "verdict"
        ]
        == "VERIFY"
    )
    assert (
        evaluate(
            points(spread=5),
            dict(pitch_deg=0, roll_deg=0, still=True),
            req,
            DEFAULTS,
            TWIN,
        )["verdict"]
        == "VERIFY"
    )
    assert (
        evaluate(
            points(), dict(pitch_deg=0, roll_deg=0, still=False), req, DEFAULTS, TWIN
        )["verdict"]
        == "VERIFY"
    )


def test_uncalibrated_hardware():
    assert result(mode="hardware")["verdict"] == "VERIFY"


def test_manual_dimensions_and_drift():
    r = result(34, threshold_in=0.7, handle_height_in=30)
    assert r["verdict"] == "FAIL"
    assert r["drift"][0]["delta"] == pytest.approx(-2)
    assert r["checks"][1]["status"] == "FAIL"
    assert r["checks"][2]["status"] == "FAIL"


def test_flip_calibration():
    r = flip_calibration(
        CalibrationRequest(
            forward_pitch=3.7, reverse_pitch=-3.3, forward_roll=0.8, reverse_roll=-0.4
        )
    )
    assert r["pitch_bias_deg"] == pytest.approx(0.2)
    assert r["corrected_pitch_deg"] == pytest.approx(3.5)
    assert r["roll_bias_deg"] == pytest.approx(0.2)


def test_positive_and_negative_slope_equal():
    assert (
        result(37, "ramp", pitch=-3.5, roll=-2.1)["verdict"]
        == result(37, "ramp", pitch=3.5, roll=2.1)["verdict"]
    )


def test_no_baseline_disables_drift_without_changing_deterministic_checks():
    from scout.models import ScanRequest
    from scout import rules
    from scout.config import config

    points = [
        dict(angle_deg=a, distance_cm=45, spread_cm=0, valid_pings=15)
        for a in range(0, 181, 5)
    ]
    twin = dict(width_in=36, running_slope_deg=0, cross_slope_deg=0)
    tilt = dict(pitch_deg=0, roll_deg=0, still=True)
    before = rules.evaluate(points, tilt, ScanRequest(), config.public(), twin)
    after = rules.evaluate(
        points, tilt, ScanRequest(use_baseline=False), config.public(), twin
    )
    assert after["drift"] == []
    assert after["checks"] == before["checks"]
    assert after["verdict"] == before["verdict"]
