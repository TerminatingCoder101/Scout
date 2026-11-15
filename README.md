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

### MongoDB Atlas inspection history

Atlas SRV connections use the installed `certifi` CA bundle by default to support Python installations without a working system certificate path. TLS certificate/hostname validation remains enabled. An explicit `tlsCAFile` in the URI is preserved.

Scout optionally stores longitudinal inspection records in Atlas using PyMongo's `AsyncMongoClient`. The existing FastAPI lifespan creates one shared client, pings it and creates the `location_history` compound index on `(building_id, location_id, timestamp DESC, _id DESC)`. Shutdown awaits client closure. All Atlas operations use async I/O. There is no Vector Search dependency.

Create an Atlas cluster, a database user with `readWrite` permission on your chosen database, and a Network Access entry for the backend machine. Obtain the Python driver connection string from Atlas. Scout reads the Atlas fields from the project-root `.env`, which is ignored by Git. Enter the URI, username and password privately in that file; never paste credentials into chat. See [MongoDB's driver connection instructions](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/connect/).

Edit `.env` in VS Code and set these values:

```dotenv
MONGODB_URI=mongodb+srv://your-cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_USERNAME=your-database-user
MONGODB_PASSWORD='your-database-password'
MONGODB_DB=scout
```

Replace `your-cluster.mongodb.net` with your actual Atlas hostname. You can instead paste Atlas's URI containing `<db_username>` / `<db_password>` placeholders; Scout replaces those using the two separate fields. For separate fields enter the original password, not a URL-encoded password: Scout encodes it. Quote a password containing spaces or `#`; to include a literal apostrophe use double quotes and escape backslashes/double quotes as needed. The project process environment takes precedence over `.env`. An explicitly exported `MONGODB_URI` is treated as a complete override unless MongoDB username/password are also exported. Alternatively use a complete, percent-encoded URI and leave the separate username/password empty. Do not combine real embedded URI credentials with separate credentials.

```bash
.venv/bin/pip install -r requirements.txt
# Fill in the ignored project-root .env before starting Scout.
.venv/bin/python scripts/run.py
# API-only alternative:
PYTHONPATH=backend .venv/bin/uvicorn scout.main:app --host 127.0.0.1 --port 8000
```

With no URI, existing SQLite scans and hardware continue to work; Atlas endpoints return a safe 503. A configured but unreachable/misconfigured Atlas database fails startup with a sanitized message rather than accepting writes that cannot be persisted. Fix the configuration and restart. Runtime database failures return a generic 503 without connection details. URI/database configuration stays outside public Settings and scan snapshots.

The new routes use Scout's existing cookie/Bearer authentication:

- `POST /api/inspections`: create an inspection from [docs/inspection.example.json](docs/inspection.example.json).
- `GET /api/inspections/{id}`: retrieve the string ObjectId returned on creation.
- `GET /api/inspections/latest?building_id=local-demo&location_id=east-door&limit=10`: recent records scoped to both identifiers; limit 1–100.
- `GET /api/inspections/compare?building_id=local-demo&location_id=east-door`: compare the latest two records by observation timestamp, breaking ties with ObjectId; returns 409 when fewer than two exist.

Use **http://127.0.0.1:8000/api/docs**, authorize with your local access key, and execute the example POST. Change the example timestamp and measured value, create a second record, then call compare for that same building/location. All records in this example are synthetic. You can also use a logged-in browser's console:

```javascript
const record = {
  building_id: "local-demo", location_id: "east-door",
  measurements: [{key: "clear_width", value: 87, unit: "cm", uncertainty: 1.2}],
  findings: [{key: "opening", status: "recheck", detail: "Synthetic demonstration"}],
  review_status: "recheck"
};
await fetch("/api/inspections", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(record)});
record.measurements[0].value = 80;
await fetch("/api/inspections", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(record)});
console.log(await (await fetch("/api/inspections/compare?building_id=local-demo&location_id=east-door")).json());
```

Records retain raw acoustic points and optional signed IMU readings, processed measurements with absolute uncertainty, findings, photo references, agent actions and review status. Timestamps must include a timezone and are stored in UTC. Arrays are bounded, keys must be unique and numeric measurements finite. Photos are references only; Atlas does not upload or fetch them automatically.

Comparison reports `delta = after − before` and a conservative combined uncertainty `before uncertainty + after uncertainty`. It reports a detectable change only when the absolute delta exceeds that sum. Overlapping/touching intervals, missing readings or incompatible units are `inconclusive`; no automatic unit conversion occurs. Missing findings are `absent_in_latest`, never silently resolved. Review status supports `inconclusive` and `recheck`. Change detection is not a regulatory compliance decision; existing deterministic rules remain authoritative and Scout provides no certified ADA compliance.

The existing DeepAgent includes the LangChain-compatible `get_previous_inspections` tool. Supply `location_id` alongside `building_id` when calling `POST /api/scans` to bind the tool to the current location. The tool cannot query another location via model arguments. Without location metadata or Atlas access it returns an actionable message and lets the existing workflow continue. Historical text is untrusted evidence and cannot define thresholds.

Atlas records are created explicitly through `POST /api/inspections`; existing `/api/scans` records continue to persist in SQLite. This integration does not automatically upload old or newly captured scans or change acquisition. A caller can submit a completed scan's points, tilt, evaluated measurements, uncertainty and references with its verified building/location identifiers.

```bash
# Offline tests use async collection doubles and do not touch Atlas
.venv/bin/pytest -q
.venv/bin/pytest -q tests/test_inspections.py
# Optional real-driver round trip; choose a dedicated test database
# Set MONGODB_TEST_URI privately, and set MONGODB_TEST_DB=scout_test
.venv/bin/pytest -q tests/test_inspections_live.py
```

The live test skips unless both test variables are supplied. When enabled it creates synthetic records under a unique location and deletes only its inserted IDs on exit; it also creates the history index. It never implicitly uses the production `MONGODB_URI`.

For MongoDB for VS Code, connect the extension to your Atlas cluster separately using **MongoDB: Connect with Connection String**, then open `scout-inspections.mongodb.js` and click the playground's Run button. The playground is read-only and filters by the building and location IDs at the top of the file. Change `use('scout')` if your `MONGODB_DB` differs. An empty result means no matching Atlas inspection records have been created yet. The extension's saved connection is separate from Scout: configure the backend with its own root `.env` or environment variables before startup.

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

### Atlas inspection history and analytics

In the existing dashboard at `/`, select **Inspection History** in the sidebar
for MongoDB records, building/location filters, and **Compare latest two**. Select
**Analytics** for property-wide trends (filter by building ID, or leave blank for
all buildings). The combined **Inspection History** tab includes local scans and Atlas records as expandable rows, with linked records shown once.
These tabs poll FastAPI every five seconds and provide a manual Refresh button.
New completed live and demo scans are automatically saved into Atlas. Opening Analytics imports previous completed local scans into Atlas without duplicating linked scan IDs.

API requests use the dashboard's existing authentication:

- `GET /api/inspections?building_id=...&location_id=...&limit=50&offset=0`
  lists saved history, newest first; filters are optional.
- `GET /api/inspections/compare?building_id=...&location_id=...` compares the
  latest two records; HTTP 409 explains insufficient history.
- `GET /api/inspections/analytics?building_id=...` aggregates total inspection
  activity and current findings. Requires MongoDB 5.2+ (`$firstN`); Atlas supports it.
- `POST /api/inspections` saves a validated inspection; existing single-record
  `GET /api/inspections/{id}` and `/latest` endpoints remain available.

Findings optionally accept `category` (default `uncategorized`); older records
remain supported. Open findings count observed, inconclusive and recheck findings
in each location's latest inspection. Verified fixes count only explicit resolved
findings in reviewed latest inspections whose matching finding was observed in
the immediately preceding record. Disappearance does not prove resolution.
Category charts count findings from each location's latest record, including
resolved findings. Activity counts all records by UTC date. Measurement differences
show the sum of both uncertainty bounds; overlapping bounds remain inconclusive.
These are screening and review metrics, not certified ADA compliance.

To exercise the UI, authenticate via the launcher, then use `/api/docs` to POST
`docs/inspection.example.json` twice with the same building and location IDs and
different timestamps. Change a measurement and preserve its uncertainty. For a
verified fix, set a finding to `observed` in the first record, then `resolved`
with `review_status: "reviewed"` in the second. Use a category such as `clearance`.
Filter Inspection History to those IDs and click Compare latest two; inspect
Analytics using the same building filter. New saves appear within five seconds.
Use unique test IDs so these synthetic records do not mix with real inspections.

Run the backend and frontend checks from the repository root:

```sh
.venv/bin/python scripts/run.py --no-browser
# In another terminal:
.venv/bin/pytest -q
cd frontend
npm test
npm run build
```

The optional live integration test uses only explicitly supplied
`MONGODB_TEST_URI` and `MONGODB_TEST_DB`. Point them at a test database, then run
`.venv/bin/pytest tests/test_inspections_live.py -q`. It creates two uniquely
scoped synthetic records, checks history, comparison and aggregation results,
and deletes its inserted records in cleanup. Keep credentials in environment
variables, never in committed files or shell commands shared with others.


### Automatic Atlas saving from Scout

Start an inspection in the dashboard with **New inspection** (or use `/business`).
Choose the building/twin, enter a stable **Location ID**, and select live hardware
or demo mode. Completed inspections save automatically to Atlas before completion
is reported to the frontend. Use the same building and location IDs on subsequent
runs for comparisons. Demo records are labeled `demo`; use a separate demo
building/location when testing so simulated measurements do not mix with field data.
API or hardware-button callers without a location use the profile (`doorway`,
`ramp`, or `corridor`) as their location ID.

The completed scan shows **Saved to Atlas** or a database save failure message.
If Atlas is unavailable, local evidence and scan completion are retained; failed
saves remain local until Analytics imports previous completed scans. Cancelled and failed scans are
not published as completed Atlas inspections. Atlas records include the scan ID,
source mode, raw measurements and tilt, uncertainty, deterministic check results,
and photo references. Photos remain on the Scout server. Passing measured checks
are stored as `passed`, never automatically marked as human-reviewed verified fixes.

### Property intelligence

The dashboard at `/` includes **Property intelligence** alongside Inspection
History and Analytics. Use **Connect sponsor accounts** to manage Matterport
API key/token, browser SDK key, and Vexcel credentials. Search imported CoStar
properties, select a linked Matterport space, and load interior/aerial evidence.
If no properties are present, use **Import local CoStar kit** with the extracted
`costar-hackathon-kit` folder (or set `COSTAR_KIT_DIR`). Existing saved sponsor
credentials and imported properties are reused. See
[the integration guide](docs/COSTAR_INTEGRATION.md) for provider setup and scope.

Inspection History combines local and Atlas inspection rows. Expand a row to see its radar plot, measured values and uncertainty, findings, and available photos. The activity graph counts loaded records for the current filters/page; Analytics retains property-wide aggregation. Use Open full inspection for the original workspace and timeline.

Analytics now imports all previous completed local scans through authenticated `POST /api/inspections/sync-local` before loading its aggregates. This reads the full SQLite history, bypassing the recent-scans 100-record UI limit. Repeated imports are duplicate-safe by scan ID. Invalid legacy records are reported as skipped/failed; failed and cancelled scans are not counted as completed inspections. The import preserves original timestamps and demo/hardware provenance.

### Evidence-linked site inspections

In **Property intelligence**, publish an agent inspection plan from at least two
retrieved sponsor layers after checking the property/model match. Each action now
has **Create site inspection from this plan**. It opens the existing inspection
form with a stable location ID and the plan action attached. Choose a measured
reference baseline and inspection profile; remote room dimensions are not doorway
clearance measurements.

The default is **Local test fixture — demonstration only**. Choosing the actual
property site requires hardware mode and explicit operator confirmation of the
rig's location. The server resolves property, model, plan, target and evidence
sources from its saved plan, rather than trusting client-supplied provenance.
These links persist in the scan, Atlas record, comparison, and History details.
The property plan displays its linked inspections and their save/result status.

History includes **Human review / record a verified resolution**. Reviewers supply
notes and explicitly update finding statuses; this endpoint preserves measured
values and records the previous finding state in a review audit trail. Analytics
continues to distinguish passing checks from reviewed fixes. No demo is evidence
of repair at a remote sponsor property.

See [the judge walkthrough](docs/JUDGE_DEMO.md) for the full demonstration and
local recording command. Live sponsor access depends on provider credentials and
the event's data availability. Existing saved evidence/plans can be transparently
shown as prior runs when providers are unavailable.
