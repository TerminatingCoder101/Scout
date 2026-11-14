# hud/: live radar HUD, CoStar/Matterport digital twin, drift panel, Devpost
Owner: Member 4 (see team/OWNERS.txt). Reads `runs/` from agent/. Owns the twin data the agent reads.
Draft from the master plan. The owner should change it freely and announce changes on the board.

## Run
    streamlit run hud/app.py        # recommended: fastest to build; React only if there's time
The HUD **never opens the serial port**. It only reads `runs/latest` and `runs/<run_id>/events.jsonl` and `report.json` (see agent/INTERFACE.md).

## Screens
1. **Live polar radar**: green radar look, points drawn as `point` events arrive, bottleneck and anomaly angles marked.
2. **Twin vs live**: CoStar/Matterport expected values against measured ones, with drift in big red or green text ("CRITICAL DRIFT −6.9 in").
3. **Verdict and work order**: PASS/WARN/FAIL, the Gemini photo, the fix list and costs.
4. **Validation table**: from `hardware/validation/` (engineering proof for judges).

## Digital twin data: `hud/data/twins.json` (read by agent/)
```json
{"demo-suite-101": {"name": "Commercial Suite 101 (demo)", "source": "CoStar record + Matterport twin (mock)",
  "expected": {"width_in": 36.0, "running_deg": 3.5, "cross_deg": 0.0},
  "status": "COMPLIANT"}}
```
"Update the CoStar record to COMPLIANT" is done locally in `hud/data/twin_status.json`. Say on Devpost that it's a mock of the record.

## Backlog (in order)
1. `twins.json` (unblocks agent/), then post DONE to the agent owner.
2. Streamlit HUD reading a sample `runs/` folder (make one by hand from agent/INTERFACE.md).
3. Live radar animation from `events.jsonl`.
4. Twin drift panel and the "mark compliant" flow.
5. Devpost README (every sponsor tech: LangChain DeepAgents, Gemini, CoStar), the 2-minute demo script and video checklist.
