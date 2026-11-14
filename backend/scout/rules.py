"""Measurement screening only. Rule decisions never come from an LLM."""

import math
from statistics import median

SOURCE = "https://www.access-board.gov/ada/chapter/ch04/"
RULE_VERSION = "2010 ADA · chapter 4 · reviewed 2026-11-13"
RUNNING_MAX = math.degrees(math.atan(1 / 12))
CROSS_MAX = math.degrees(math.atan(1 / 48))


def check(key, label, value, error, low, high, unit, section):
    if value is None:
        status = "NOT_MEASURED"
    elif (low is not None and value + error < low) or (
        high is not None and value - error > high
    ):
        status = "FAIL"
    elif (low is not None and value - error < low) or (
        high is not None and value + error > high
    ):
        status = "VERIFY"
    else:
        status = "PASS"
    return dict(
        key=key,
        label=label,
        value=value,
        error=error,
        minimum=low,
        maximum=high,
        unit=unit,
        status=status,
        section=section,
        source=SOURCE,
    )


def evaluate(points, tilt, request, settings, twin):
    valid = [
        p for p in points if p["distance_cm"] is not None and p["valid_pings"] >= 8
    ]
    # Only near-lateral returns estimate doorway boundaries; forward obstacle range is NOT a width.
    left = [
        p["distance_cm"] * math.cos(math.radians(p["angle_deg"]))
        for p in valid
        if p["angle_deg"] <= 10
    ]
    right = [
        p["distance_cm"] * abs(math.cos(math.radians(p["angle_deg"])))
        for p in valid
        if p["angle_deg"] >= 170
    ]
    width_cm = (
        (
            (median(left) + median(right))
            * math.cos(math.radians(settings["alignment_deg"]))
            + settings["turret_offset_cm"]
        )
        if len(left) >= 2 and len(right) >= 2
        else None
    )
    width_in = width_cm / 2.54 if width_cm is not None else None
    pitch = (
        abs(tilt["pitch_deg"] - settings["pitch_bias_deg"])
        if tilt.get("pitch_deg") is not None
        else None
    )
    roll = (
        abs(tilt["roll_deg"] - settings["roll_bias_deg"])
        if tilt.get("roll_deg") is not None
        else None
    )
    profile = request.profile
    min_width = (
        32.0 if profile == "doorway" and request.opening_depth_in <= 24 else 36.0
    )
    width_section = (
        "404.2.3"
        if profile == "doorway"
        else ("405.5" if profile == "ramp" else "403.5.1")
    )
    checks = [
        check(
            "width",
            "Clear width",
            width_in,
            settings["width_error_cm"] / 2.54,
            min_width,
            None,
            "in",
            width_section,
        )
    ]
    if profile in ("ramp", "corridor"):
        checks += [
            check(
                "running_slope",
                "Running slope",
                pitch,
                settings["slope_error_deg"],
                None,
                RUNNING_MAX if profile == "ramp" else math.degrees(math.atan(1 / 20)),
                "deg",
                "405.2" if profile == "ramp" else "403.3",
            ),
            check(
                "cross_slope",
                "Cross slope",
                roll,
                settings["slope_error_deg"],
                None,
                CROSS_MAX,
                "deg",
                "405.3" if profile == "ramp" else "403.3",
            ),
        ]
    if profile == "doorway":
        checks += [
            check(
                "threshold",
                "Threshold height",
                request.threshold_in,
                0.04,
                None,
                0.5,
                "in",
                "404.2.5",
            ),
            check(
                "handle",
                "Handle height",
                request.handle_height_in,
                0.1,
                34,
                48,
                "in",
                "404.2.7",
            ),
        ]
    issues = []
    noisy = [
        p
        for p in points
        if p["spread_cm"] > 3 or p["valid_pings"] < 8 or p["distance_cm"] is None
    ]
    if len(valid) < 30:
        issues.append("Too few valid returns. Reposition and scan again.")
    if noisy:
        issues.append("Noisy or missing acoustic returns require visual verification.")
    if not tilt.get("still", False):
        issues.append("Stillness check failed. Keep the base motionless.")
    if profile in ("ramp", "corridor") and pitch is None:
        issues.append("IMU data missing. Slope cannot be evaluated.")
    if request.mode == "hardware" and not settings["calibration_verified"]:
        issues.append("Calibration has not been verified against a physical reference.")
    statuses = [c["status"] for c in checks]
    verdict = (
        "FAIL"
        if "FAIL" in statuses
        else "VERIFY"
        if issues
        or "VERIFY" in statuses
        or any(
            c["status"] == "NOT_MEASURED"
            for c in checks
            if c["key"] in ("width", "running_slope", "cross_slope")
        )
        else "PASS"
    )
    # Missing optional manual dimensions remain explicitly unmeasured, even on a passing width screen.
    drift = []
    for key, label, value, expected, unit, tolerance in [
        (
            "width",
            "Clear width",
            width_in,
            twin["width_in"],
            "in",
            settings["width_error_cm"] / 2.54,
        ),
        (
            "running_slope",
            "Running slope",
            pitch,
            twin["running_slope_deg"],
            "deg",
            settings["slope_error_deg"],
        ),
        (
            "cross_slope",
            "Cross slope",
            roll,
            twin["cross_slope_deg"],
            "deg",
            settings["slope_error_deg"],
        ),
    ]:
        drift.append(
            dict(
                key=key,
                label=label,
                measured=value,
                expected=expected,
                delta=None if value is None else value - expected,
                unit=unit,
                changed=value is not None and abs(value - expected) > tolerance,
            )
        )
    return dict(
        verdict=verdict,
        checks=checks,
        width_cm=width_cm,
        width_in=width_in,
        running_slope_deg=pitch,
        cross_slope_deg=roll,
        issues=issues,
        drift=drift,
        noisy_angles=[p["angle_deg"] for p in noisy],
        rule_version=RULE_VERSION,
        scope="Screening of measured dimensions only; not a full accessibility certification.",
        limitations=[
            "Single-height ultrasonic sweep cannot measure door force, maneuvering space, bevels, handrails, surface conditions, or the full three-dimensional clear opening.",
            "Stated error bounds are provisional until validated with your assembled rig.",
        ],
    )


def flip_calibration(values):
    return dict(
        pitch_bias_deg=(values.forward_pitch + values.reverse_pitch) / 2,
        roll_bias_deg=(values.forward_roll + values.reverse_roll) / 2,
        corrected_pitch_deg=(values.forward_pitch - values.reverse_pitch) / 2,
        corrected_roll_deg=(values.forward_roll - values.reverse_roll) / 2,
    )
