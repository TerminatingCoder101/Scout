# Backlog (humans edit this; agents CLAIM items on the board)

Sagar's MVP already works end to end in the simulator (31 Python and 7 React tests pass). What's left is mostly
**real hardware, real AI, proof and pitch**. Items marked 👤 need a human's hands. The agent can prepare everything
around them. Take items in order within your role. Mark progress on the board with CLAIM and DONE, not in this file.

## Member 1: Mechanical (`docs/`)
1. 👤 Enclosure: pivot-centered servo/camera mount, alignment fence, three-point feet.
2. 👤 Demo props: cardboard doorway that slides from 29 in to 34 in, ramp board with a removable 5 mm shim, a small box.
3. Agent: write `docs/VALIDATION.md`, a step-by-step protocol for 10 width and 20 slope trials using the app's Calibration lab.
4. Agent: a script that turns the Calibration lab CSV export into the README accuracy table (mean error, max error, n).
5. 👤 + agent: measure the turret offset and run the flip calibration on the real rig, then record the values in `docs/HARDWARE.md`.

## Member 2: Firmware (`firmware/`, `backend/scout/hardware.py`)
1. 👤 Wire the 9 jumpers per `docs/HARDWARE.md`, flash the UNO, and check the JSON in the Serial Monitor.
2. Live hardware run through the app: connect, calibrate, run a Live inspection, and fix whatever breaks.
3. Sweep time: a real sweep takes about 38–45 s, but the pitch says 15 s. Measure it, then cut the pings or the angles
   (or update the pitch) so the live demo fits in 2 minutes. Post the decision to all.
4. Robustness: USB unplugged mid-scan, servo jitter, D2 button start, STOP latency.

## Member 3: AI Agent & Vision (`backend/`)
1. 👤 Put a Gemini key in Settings, then run `scripts/check_ai.py`.
2. A real DeepAgent run on real webcam photos. Check it AIMs at the anomaly and that Gemini labels the box and hinge correctly.
3. Tune the prompts and structured output on real photos, and check the fallback when Gemini is slow or fails.
4. Work-order wording that reads well when judges see it on screen.

## Member 4: HUD, CoStar & Pitch (`frontend/`, `README.md`)
1. A demo twin JSON for the pitch scenario (36.0 in doorway, 3.5° ramp) in the `docs/twin.example.json` format.
2. Check the dashboard in a real browser at laptop and phone widths. This hasn't been verified yet, per `docs/TESTING.md`.
3. Devpost README: sponsor tech (LangChain DeepAgents, Gemini, CoStar/Matterport import), only claims we've verified,
   the accuracy table from Member 1, and Discord usernames.
4. 👤 Peri: a 15-minute interview with Princeton facilities or a Nassau St. business (1 photo + 1 real quote).
5. A 2-minute demo script, a backup video checklist, and 5 rehearsals.

## Anyone
- After any big merge: `.venv/bin/pytest -q`, `npm --prefix frontend test`, `.venv/bin/python scripts/smoke_test.py`.
- The night before: a full demo dry run on the real rig, then a feature freeze.
