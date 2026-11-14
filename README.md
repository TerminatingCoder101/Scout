# Scout Radar

A local inspection workspace for the HackPrinceton Scout Radar rig: ultrasonic sweeps, deterministic accessibility screening, digital-twin drift, LangChain DeepAgents, Google Gemini Vision, optional Google Cloud Vision, and contractor work orders.

The MVP runs entirely on the laptop connected to the Arduino and webcam. It includes a complete simulator so you can demonstrate the workflow before assembling hardware. Demo readings, illustrated frames, and simulated diagnoses are explicitly labeled.

## Run it

This checkout already has dependencies installed and a built dashboard.

```bash
.venv/bin/python scripts/run.py
```

The launcher starts **http://127.0.0.1:8000** and opens an authenticated browser tab. Keep the terminal running. Stop with Ctrl+C. Your local access key is generated automatically in `.scout/access-key`; the launcher never prints it. If you open the URL manually in a different browser, use that key to unlock the workspace.

On a fresh checkout, use Python 3.11+ and Node 22.19+:

```bash
bash scripts/setup.sh
.venv/bin/python scripts/run.py
```

The setup script creates a virtual environment, installs the tested lockfile, installs frontend packages, and builds React. The lockfile was verified on macOS x86_64 / Python 3.11. Windows users should run the equivalent commands with `.venv\Scripts\python.exe` and `.venv\Scripts\pip.exe` instead of the shell script. Native wheel availability can vary by platform.

## First demonstration

1. Click **New inspection**. Choose the supplied illustrative twin.
2. Select **Demo simulator → Obstructed → Ramp** and start. Watch 37 points stream in, targeted camera inspection, the FAIL verdict, twin drift, and the work order.
3. Run **Clear → Doorway** to show a passing measured-width screen. Use **Clear → Ramp** to also evaluate running and cross slope.
4. Open **Work orders** to assign work, update status, and download a PDF. Resolving a work order does not rewrite the inspection verdict; rescan to verify a fix.
5. **Inspections** retains every scan and its evidence. **Calibration lab** records real reference trials and exports CSV.

The clear simulation is 36.8 inches wide, allowing both a doorway and a ramp profile to pass their different minimum widths. Borderline/noisy scenarios demonstrate uncertainty. Optional threshold and handle-height fields are manually entered dimensions; the single-axis radar does not measure them.

## Enable real AI

Open **Settings → AI & vision**:

1. Create your key in [Google AI Studio](https://aistudio.google.com/apikey), enter it into **Gemini API key**, and save.
2. Set a Gemini model supported by your account. The initial value is [`gemini-3.8-flash`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), a documented stable multimodal/function-calling model. Update it if unavailable to your account.
3. Click **Test saved Gemini key**. This sends a small generation request to verify that the selected model can actually respond. Full vision inference is exercised during an AI inspection.
4. For optional object localization, enable [Cloud Vision API](https://console.cloud.google.com/apis/library/vision.googleapis.com) on a billing-enabled Google Cloud project. Create a key restricted to Cloud Vision API and enter it into the optional Cloud Vision field. Gemini and Cloud Vision are separate services; one key is not assumed to authorize both.
5. In **New inspection**, enable **Use DeepAgent + Gemini**. For real visual evidence, select live hardware. AI with simulator mode sends an illustrated demo frame, not a real photograph.

Google keys were **not created**: they must come from your account, as agreed. No cloud account, billing subscription, or third-party property access was created. Scout's own local key was generated. Keys entered in Settings are stored in a gitignored file with owner-only permissions; they are not encrypted at rest. The API returns only configured/not-configured flags. Google calls are server-side.

The real `deepagents.create_deep_agent` graph uses these tools:

- `get_digital_twin_specs(building_id)` reads a persisted baseline and its provenance.
- `execute_hardware_sweep()` reads the rig and invokes Python's rules engine; repeat calls reuse the same sweep.
- `aim_turret_and_capture(angle_deg)` limits motion to 0–180° and captures up to three images per inspection.
- `analyze_obstruction_with_gemini(image_id)` sends the captured image plus measurements to Gemini with a validated structured output schema. Optional Cloud Vision adds object labels and bounding boxes.
- `publish_verdict_and_work_order(summary)` publishes the deterministic verdict and a reviewable work order. The model cannot override thresholds or measurement outcomes.

The dashboard shows tool activity, not private model reasoning. AI runs have a 180-second bound. Provider failure is surfaced; existing measurements are retained and a manual-review work order can still be produced. Google does not run when AI is disabled.

## Integrate hardware

See **[docs/HARDWARE.md](docs/HARDWARE.md)** for exact wiring, power, upload, serial JSON, alignment, and calibration instructions. Firmware: **[firmware/scout_radar/scout_radar.ino](firmware/scout_radar/scout_radar.ino)**.

In brief: flash the UNO, plug the UNO and USB webcam into the backend laptop, select the serial port and camera index in Settings, connect, calibrate, and run a **Live hardware** inspection. The physical D2 button can start scans after you enable its baseline/profile in Settings. No separate network bridge or Arduino Wi-Fi is needed.

## Digital twins and scope

**Digital twins → Import JSON** accepts an authorized normalized export, with [docs/twin.example.json](docs/twin.example.json) as its schema example. Manual baseline entry also works. Every scan retains an immutable copy of the baseline used at scan time.

CoStar/Matterport integration in this MVP is **import-based**. There are no fabricated live API calls or external record updates. Provider-specific APIs require licensed access and documented field mapping. Source identifiers and references are retained in reports.

Rules use [the U.S. Access Board's ADA chapter 4](https://www.access-board.gov/ada/chapter/ch04/), with separate doorway, ramp, and corridor profiles. The plan's shared 32-inch corridor/doorway assumption was corrected: general accessible routes and ramps normally require 36 inches; normal doorway openings require 32, and openings deeper than 24 inches require 36. Ramp running/cross slopes use `atan(1/12)` and `atan(1/48)`, not rounded constants. Walking-surface running slope uses `atan(1/20)`. Special exceptions and broader accessibility requirements are outside this screening MVP.

PASS means **the checks actually measured passed**, not complete ADA certification. Unmeasured dimensions stay unmeasured. Interval overlap, missing readings, noisy returns, failed stillness, or unverified hardware calibration prevent an unwarranted pass. Initial ±1.2 cm and ±0.15° uncertainty values are provisional targets, not demonstrated sensor accuracy. Validate them on the assembled rig.

The physical sweep deliberately takes approximately **38–45 seconds**, plus camera/AI latency: 37 angles × 15 pings × 60 ms spacing already consumes 33.3 seconds. The plan's 15-second total is not compatible with that acquisition method. The simulator is accelerated. Do not advertise physical timing or accuracy until measured.

Cost ranges are labeled illustrative planning allowances, not contractor quotes. A visual diagnosis cannot measure a threshold lip or certify structural root cause from one image.

## Architecture and API

- React + TypeScript + Vite frontend, responsive CSS, SVG polar radar, reconnectable SSE stream.
- FastAPI backend, SQLite WAL persistence, local image storage, ReportLab PDFs.
- A single serial reader owns device I/O; concurrent inspections are rejected. STOP cancels scans, and unfinished scans become interrupted after restart.
- PySerial adapter, OpenCV camera capture, actual UNO firmware with median/MAD filtering and IMU stillness checks.
- Narrow model tools, deterministic checks, bounded hardware actions, server-side secrets, local-only bind, host validation, same-origin mutations, and HTTP-only cookie or Bearer authentication.

Interactive API documentation: **http://127.0.0.1:8000/api/docs**. Log in through the app first, or use the Swagger Authorize button with `.scout/access-key`. Main routes include `POST /api/scans`, `GET /api/scans/{id}/events`, `POST /api/scans/{id}/cancel`, `GET /api/scans/{id}/report.pdf`, `GET /api/scans/{id}/export.json`, `/api/twins`, `/api/settings`, `/api/hardware/*`, `/api/calibration/flip`, and `/api/validation`.

Run exactly one backend worker: serial ownership and scan coordination are process-local. This is a laptop MVP, not a multi-user cloud deployment. Do not expose it publicly without adding deployment-grade identity, HTTPS, shared job coordination, and retention policies. Local data lives in `.scout/`; back up that folder privately if you want to preserve inspections and credentials.

## Development and validation

```bash
# Backend
.venv/bin/pytest -q

# Dashboard interaction tests and production build
npm --prefix frontend test
npm --prefix frontend run build

# Live local API test: starts no cloud requests; saves two labeled demo scans
.venv/bin/python scripts/smoke_test.py

# Development (two terminals)
PYTHONPATH=backend .venv/bin/uvicorn scout.main:app --host 127.0.0.1 --port 8000
npm --prefix frontend run dev
```

In development, Vite proxies `/api` to the backend. Unlock the development tab with the local access key. The production launcher serves both frontend and API on port 8000.

See **[docs/TESTING.md](docs/TESTING.md)** for tested behavior and verification limits. Physical sensor accuracy, live Google inference, and authorized provider data still require your actual hardware, credentials, and exports. No facilities interview, field-validation dataset, sponsor claim, or competition submission was fabricated.
