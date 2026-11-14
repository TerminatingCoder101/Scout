# pi/ interface: Python hardware + vision tools
Owner: see OWNERS.txt. The consumer is `agent/`. The producer underneath is `firmware/` (see firmware/INTERFACE.md).
This is a starting draft, so the owner should change it freely and announce it on the board.

## Module
`pi/scout_hw.py`. Import it with `from pi.scout_hw import ...` from the repo root.
Every function returns plain JSON-serializable dicts, so the agent can pass them straight into the report.

| Function | Returns |
|---|---|
| `connect(port: str \| None = None) -> None` | Opens serial. It auto-detects `/dev/ttyACM*` or `/dev/ttyUSB*`. No-op in mock mode. |
| `sweep_width(start=0, end=180, step=10) -> dict` | `{"width_in": 34.2, "width_cm": 86.9, "left_cm": 40.1, "right_cm": 38.3, "points": [[0, 38.3], ...]}` |
| `measure_distance(angle: int = 90) -> dict` | `{"angle": 90, "cm": 120.4}` |
| `read_slope() -> dict` | `{"pitch_deg": 4.1, "roll_deg": 0.6, "running_slope_pct": 7.2, "cross_slope_pct": 1.0}` |
| `capture_image(label: str = "") -> str` | Path to the saved JPEG under `pi/captures/`. |
| `analyze_image(path: str, question: str \| None = None) -> dict` | Gemini vision. `{"findings": [{"item": "door_handle", "ok": false, "note": "round knob, needs lever"}], "summary": "..."}` |
| `set_status(state: str, text: str \| None = None) -> None` | `state` is one of PASS, FAIL, WORKING or IDLE. Drives the LED, buzzer and LCD. |
| `wait_for_button(timeout: float \| None = None) -> bool` | True if the button was pressed. |

## Math (owned here)
- Width = `left_cm + right_cm + chassis width`, using the shortest reading on each side (perpendicular to the wall).
- Slope % = `tan(angle) * 100`. ADA limits: running slope ≤ 8.33% (1:12), cross slope ≤ 2.08% (1:48).

## Config (.env, never committed)
- `GEMINI_API_KEY`: needed for `analyze_image` when not in mock mode.
- `SCOUT_SERIAL_PORT` (optional): overrides auto-detect.

## Mock
`SCOUT_MOCK=1` gives realistic fake values with no Arduino, camera or API key. Make one mock door deliberately fail
(for example 30.5 in), so the agent's re-measure and fix-report path gets exercised.
