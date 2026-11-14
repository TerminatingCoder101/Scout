# hardware/: metrology math, calibration, scenarios, validation, end-to-end test
Owner: Member 1 (see team/OWNERS.txt). While the human builds the enclosure, fence and demo props, their agent builds the
engineering-rigor software below (this is what wins Best Hardware).
Draft from the master plan. The owner should change it freely and announce changes on the board.

## Metrology: `hardware/metrology.py` (used by agent/)
```python
clear_width(points, turret_offset_cm=TURRET_OFFSET_CM) -> {
  "width_cm": 73.9, "width_in": 29.1, "err_cm": 1.2,
  "left_cm": .., "right_cm": .., "bottleneck_angle": 40, "bottleneck_cm": 31.0}
slopes(tilt, flip_tilt=None) -> {"running_deg": 3.4, "cross_deg": 2.1, "err_deg": 0.15}   # flip_tilt: the 180° flip reading cancels the zero offset
anomalies(points, spread_threshold_cm=3.0) -> [{"angle": 40, "reason": "high_spread" | "bottleneck", "cm": .., "spread_cm": ..}]
```
Clear width uses the jamb readings near 0° and 180°, corrected by `cos(theta)`, plus `TURRET_OFFSET_CM`, as in the plan.
Put the constants (`TURRET_OFFSET_CM` and so on) in `hardware/constants.py` and fill them in from tape-measure calibration.

## Scenarios: `hardware/scenarios/<name>.json` (used by the firmware mock)
Exactly the JSON lines the Arduino would send for one SCAN: `{"lines": [ {...tilt...}, {...point...}, ..., {"type":"scan_end"} ]}`.
Needed: `fail_29in_box` (29 in doorway, box at 40°, cross-slope 2.1°), `pass_34in` (34 in, flat), `noisy_echo`, `not_still`.

## Validation: `hardware/validation/`
`trials.csv` (trial, kind width|slope, truth, measured) plus `make_table.py`, which prints the README accuracy table
(the target is ±1.2 cm width and ±0.15° slope) and saves a plot. The humans fill in the CSV from real tape-measure trials.

## End-to-end demo test: `hardware/e2e_test.py`
Runs the whole demo on mocks: the fail scenario, then the pass scenario. It checks the agent produces RED then GREEN and that the
HUD files appear. Run it before every big push and before judging.

## Backlog (in order)
1. Scenario files (unblocks the firmware mock), then post DONE to the firmware owner.
2. `metrology.py` with unit tests, then post DONE to the agent owner.
3. `e2e_test.py` (fill it in as the other parts land).
4. Validation CSV template, `make_table.py` and the plot.
5. `hardware/WIRING.md` (pin table plus a mermaid diagram) and build notes for the enclosure, fence and three-point feet.
