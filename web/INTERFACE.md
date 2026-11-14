# web/ interface: API + dashboard
Owner: see team/OWNERS.txt. It consumes the report JSON defined in agent/INTERFACE.md.
This is a starting draft, so the owner should change it freely and announce it on the board.

## HTTP API
| Method | Route | Body / Returns |
|---|---|---|
| `POST` | `/api/reports` | Body: the report JSON. Returns `{"id": "..."}`. Upserts by `id`. |
| `GET` | `/api/reports` | `[{"id", "location", "finished_at", "summary", "fail_count", "check_count"}]`, newest first. |
| `GET` | `/api/reports/:id` | The full report JSON. |
| `GET` | `/api/health` | `{"ok": true}` |

The local dev URL goes here once it exists (for example `http://localhost:3000`). Others set `SCOUT_API_URL` to it.

## Storage
MongoDB Atlas, database `scout`, collection `reports`, one document per report (same shape as the JSON).

## Dashboard
- Audit history list, and one report per page with pass/fail per check, the measured value against the ADA limit, the fix and the evidence photo.
- It must work with no agent running: seed it with `web/sample-report.json`.

## Config (.env, never committed)
- `MONGODB_URI`

## Also owned here
Devpost write-up, pitch, demo video and the public `README.md`.
