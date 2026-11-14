# Verification record

The MVP was built and checked locally on macOS with Python 3.11 and Node 22.19. Tests use isolated temporary databases and fake credentials. No real Google key or physical rig was available for live inference or sensor validation.

**Results:** 31 Python tests and 7 React interaction tests passed; the production frontend build and UNO firmware compilation succeeded.

## Automated coverage

Python tests exercise:

- Four complete simulated inspection flows: obstructed FAIL, clear PASS, borderline VERIFY, noisy VERIFY.
- Width profiles, deep doorways, signed slopes, exact slope ratios, uncertainty boundaries, incomplete/noisy sweeps, calibration gating, and flip-bias correction.
- Authentication, origin/host checks, secret redaction, invalid inputs, single-scan coordination, cancellation, and restart recovery.
- Persistent twin snapshots, work-order updates, JSON and PDF exports, image authorization, resumable SSE, and CSV formula-injection mitigation.
- Serial command mapping, AIM bounds, timeouts, and device errors.
- The actual compiled LangChain DeepAgent with a scripted model calling all five Scout tools, including camera capture and a mocked Gemini response.
- Google Cloud Vision's HTTP request contract, multimodal Gemini image payload and response schema, and optional Cloud Vision failure handling.

Dashboard DOM tests exercise new-inspection configuration, AI-key gating, streaming updates, completion, cancellation, navigation, displayed backend errors, keyboard dialog dismissal, and launcher authentication under React StrictMode. These are real React interaction tests in jsdom, not screenshot-based browser tests.

## Running application

The local launcher served the production frontend and authenticated a browser successfully. `scripts/smoke_test.py` exercised the running HTTP server, created a failing ramp inspection and a passing doorway inspection, verified 37 points in each, and downloaded valid PDFs. The resulting demo records are clearly marked and remain in local inspection history.

The exported work orders were rasterized and visually inspected. Report layout was adjusted after detecting an orphaned final line in the passing report.

The Arduino sketch compiles for `arduino:avr:uno` with AVR core 1.8.6 and Servo 1.3.0. It uses approximately 14 KB of flash and 591 bytes of static RAM. It was not flashed or physically exercised.

The frontend production build succeeds. The npm dependency audit reported no vulnerabilities after updating the test dependencies.

## Verification limits

- Browser automation was unavailable: the tool reported no available browser surfaces. Therefore no desktop/mobile visual browser inspection or screen recording is claimed. Responsive rules and DOM behavior are implemented; inspect the actual viewport before presentation.
- Live Gemini/Cloud Vision inference still needs your own Google credentials, model access, and quota. The app includes a credential/model check and visible inference failure handling.
- Real hardware measurements, camera indexing/permissions, power stability, physical STOP latency, and sensor accuracy must be verified on your assembled rig.
- The CoStar/Matterport path is an authorized normalized JSON import, not a tested proprietary API integration.
- The calibration trial database intentionally starts empty; the planned ground-truth study and field interviews were not fabricated.

## Reproduce

```bash
.venv/bin/pytest -q
npm --prefix frontend test
npm --prefix frontend run build
# With the app running:
.venv/bin/python scripts/smoke_test.py
```

Formatting uses Ruff for Python and Prettier for TypeScript/CSS. `requirements-lock.txt` and `frontend/package-lock.json` record the tested dependency graph.
