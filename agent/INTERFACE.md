# agent/: LangChain DeepAgent, tools, ADA rules, Gemini vision, work order
Owner: Member 3 (see team/OWNERS.txt). Uses `firmware/bridge`, `hardware/metrology.py` and `hud/data/twins.json`.
`hud/` reads its output. Draft from the master plan. The owner should change it freely and announce changes on the board.

## Run
    python -m agent.run --building demo-suite-101 [--wait-button]
`SCOUT_MOCK=1` runs everything without hardware. With `--wait-button`, it loops: wait for the button, then audit.

## ADA rules: `agent/ada_rules.py` (fixed table, never from LLM memory)
| Check | Limit |
|---|---|
| Door clear width | ≥ 32.0 in (81.3 cm) |
| Corridor / accessible route width | ≥ 36.0 in |
| Ramp running slope | ≤ 1:12 = 8.33% = 4.76° |
| Ramp cross slope | ≤ 1:48 = 2.08% = 1.19° |
| Threshold height | ≤ 0.5 in |
| Door hardware height | 34–48 in |
Verdict: PASS if every value clears its limit by more than its error bar, FAIL if it misses by more than the error bar, WARN otherwise.

## The 5 tools (names from the plan)
1. `get_digital_twin_specs(building_id)` reads `hud/data/twins.json` and returns the expected width and slopes.
2. `execute_hardware_sweep()` calls `ScoutSerial.scan()` then `metrology.clear_width/slopes/anomalies`.
3. `aim_turret_and_capture(angle_deg)` calls `ScoutSerial.aim()`, then takes a webcam photo and returns its path.
4. `analyze_obstruction_with_gemini(image_path, radar_data)` returns `{"label": "delivery box", "kind": "temporary|structural", "fix": "...", "est_cost_usd": 45}`.
5. `publish_verdict_and_work_order(status, report)` calls `ScoutSerial.status()` and writes the report.
Replanning: for every anomaly (a bottleneck or high spread), aim, capture and analyze it, then re-scan once if the result is WARN.

## Output (the contract with hud/)
Each run writes to `runs/<run_id>/` (gitignored), and `runs/latest` holds the current run_id.
- `events.jsonl`, appended live, one per line: `{"t": <unix>, "type": "run_start|tilt|point|scan_end|metrics|aim|capture|gemini|verdict|report", ...}`.
  `point` events pass the firmware's point fields through, so the HUD can draw the radar live.
- `report.json`:
```json
{"run_id": "...", "building_id": "demo-suite-101", "status": "FAIL",
 "measured": {"width_in": 29.1, "running_deg": 3.4, "cross_deg": 2.1},
 "expected": {"width_in": 36.0, "running_deg": 3.5, "cross_deg": 0.0},
 "drift": {"width_in": -6.9},
 "checks": [{"name": "door_width", "status": "FAIL", "value": 29.1, "limit": ">= 32.0", "unit": "in", "err": 0.5}],
 "obstructions": [{"angle": 40, "image": "runs/.../40.jpg", "label": "delivery box", "kind": "temporary"}],
 "work_order": [{"fix": "Remove staging box from doorway", "est_cost_usd": 0},
                {"fix": "Install offset swing-clear hinges", "est_cost_usd": 45}]}
```

## Config (.env, never committed)
`GEMINI_API_KEY`, plus whatever key the agent's LLM needs. Name it here.

## Backlog (in order)
1. `ada_rules.py` and the verdict logic with tests.
2. The tools on mocks (`SCOUT_MOCK=1`) and the events/report output, then post DONE to the HUD owner.
3. The DeepAgent loop with replanning.
4. Gemini vision on real webcam photos.
5. Work-order wording and cost estimates; the `--wait-button` loop.
