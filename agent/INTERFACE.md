# agent/ interface: the audit agent and its report
Owner: see team/OWNERS.txt. It consumes `pi/` (see pi/INTERFACE.md), and `web/` consumes its report.
This is a starting draft, so the owner should change it freely and announce it on the board.

## Run
    python -m agent.run --location "Friend Center, 2nd floor" [--checks door,ramp,signage]

- With no `--checks`, the agent plans its own checks.
- With `SCOUT_MOCK=1`, the run goes end to end on fake hardware.
- The agent plans checks, calls the `pi/` tools, **re-measures any failure** before reporting it, and writes fixes.
- Output: `agent/out/report-<id>.json`. If `SCOUT_API_URL` is set, it also does `POST $SCOUT_API_URL/api/reports`.

## Report JSON (the contract with web/)
```json
{
  "id": "2026-11-14T15-02-11Z-friend-2f",
  "location": "Friend Center, 2nd floor",
  "started_at": "2026-11-14T15:02:11Z",
  "finished_at": "2026-11-14T15:04:40Z",
  "mock": false,
  "summary": "2 of 4 checks failed. Door 2F-A is too narrow; ramp is fine.",
  "checks": [
    {
      "id": "door-1",
      "type": "door_width",
      "target": "Door 2F-A",
      "status": "fail",
      "measured": {"value": 30.5, "unit": "in", "attempts": [30.4, 30.6]},
      "limit": {"op": ">=", "value": 32, "unit": "in", "rule": "ADA 404.2.3"},
      "evidence": {"image": null, "raw": {}},
      "fix": "Replace the hinges with offset hinges to gain about 1.5 in, or widen the frame.",
      "est_cost_usd": 150
    }
  ]
}
```
- `type` is one of `door_width`, `hallway_width`, `ramp_running_slope`, `ramp_cross_slope`, `signage` or `hardware`.
- `status` is one of `pass`, `fail` or `unsure`. `unsure` is for disagreeing re-measures or low vision confidence.
- `evidence.image` is a path or URL, or null. `fix` and `est_cost_usd` are null when the check passes.

## Config (.env, never committed)
- The LLM API key: the owner names it here.
- `SCOUT_API_URL` (optional).
