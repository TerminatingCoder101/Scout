# Scout's connected workflow

Use the main dashboard at `/`. Business is a separate simplified inspection page;
the complete sponsor-to-site workflow is in the main dashboard.

## What CoStar contributes

Scout uses the licensed local hackathon extract, not a general-purpose live CoStar
API. Import reads commercial-properties.csv with data/commercial-property.jsonl,
and residential-listings.csv with data/residential-listings.jsonl. Commercial
PropertyId and residential ListingId join to the JSONL record.id. MatterportModelId
comes from the supplied mapping row, not from a fuzzy address search.

A normalized property contains its source ID, building name, address, city, state,
coordinates, linked model IDs, and a subset of available facts: property type code,
stories, building area, and parking. Missing facts remain missing. Scout does not
currently import or reason over the full CoStar lease, rent, tenant, sale, or lending
dataset. Property type codes are retained as supplied, not silently decoded.

The import preserves provider, dataset, mapping filename, join description, import
time, and an unknown source record date. Import time is not a claim of freshness.
The records are stored in local SQLite sponsor_properties and searchable by ID,
name, address, city, and state.

## How the layers join

1. Choose a CoStar property and one of its explicitly mapped Matterport model IDs.
   The backend rejects models absent from that property's mapping.
2. Matterport GraphQL retrieves model metadata, available floor geometry, room
   dimensions/classifications, and a preview. The browser SDK displays the model.
   Room width does not become a door-clearance measurement.
3. CoStar coordinates drive Vexcel retrieval of a 120 m exterior context window.
   This is not a verified cadastral boundary. Nearby structures may be visible.
4. Model address differences and geocode offsets produce warnings. An operator
   must confirm the match before generating a plan. Model creation and retrieval
   timestamps are not automatically treated as capture dates.

## How the agent uses the combination

The LangChain DeepAgent calls read_property_context, inspect_interior_geometry,
inspect_visual_evidence, and publish_inspection_plan. Gemini examines downloaded
interior/exterior images when available. The plan describes priorities, target
locations, reasons, next physical checks, cited layers, and limitations.

Publication requires at least two read layers and two cited layers across the
plan, and visual inspection when an available image exists. These gates establish
source use; the quality of the proposed combination still needs human review.
CoStar supplies identity and context, Matterport supplies interior evidence, and
Vexcel supplies exterior evidence. The useful result is a targeted site-check
plan, not a restatement of a property record or an accessibility verdict.

## From plan to physical evidence

Each action has Create site inspection from this plan. The existing inspection
form retains a separate measurement reference baseline, location ID, profile,
mode, and optional AI setting. Server-side lookup resolves the action, property,
model and cited evidence; clients cannot supply arbitrary sponsor provenance.

Local fixture is the default. Property-site mode requires hardware and explicit
operator confirmation. A completed scan only completes the selected measurement
profile. It does not verify every concern in a broad plan action; route continuity,
curb geometry, door force and other unmeasured items need separate site review.

The scan, work order, PDF, and Atlas record retain plan/action IDs, property/model
identity, target, reason, sources, and fixture/site label. New scans retain a
snapshot of CoStar facts/provenance, provider timestamps/image references, and
match warnings. Older scans retain only the provenance originally recorded; the
system does not invent historical evidence snapshots.

## History identity and comparisons

A baseline's ID identifies its reference measurements, not necessarily the real
property. Linked history therefore uses the CoStar property ID as building_id.
Local fixtures use fixture-<property_id>. Location keys include the Matterport
model ID and the operator's location ID. Long keys are bounded with a stable hash.
This separates properties, models, and fixture demonstrations from property-site
measurements even when all use the same baseline.

Atlas saving, the agent's previous-inspections tool, filters, and latest-two
comparisons use these keys consistently. History shows the building/location keys.
Repeat the same property, model and location for comparable visits. Change bounds
remain deterministic: a numerical difference must exceed combined uncertainty to
be labeled detectable; missing values, unit mismatch and overlapping intervals
remain inconclusive. A detectable change is not automatically improvement or pass.

Sync local history imports completed scans idempotently by scan ID. It also moves
older linked records into the correct property/model/fixture history groups while
preserving measurement values, reviewed findings, and audit notes.

## Human review and analytics

Human review requires notes and keeps finding keys and measured values intact.
Finding changes have an audit trail. A resolved finding only counts as a verified
fix when the latest reviewed record resolves a matching observed finding from the
previous inspection. Merely passing a scan or omitting a finding is insufficient.
Analytics aggregates all completed Atlas records for activity, but current open
findings use the latest inspection at each location. Fixture building IDs remain
separate and can be filtered independently from real property sites.

## Remaining boundaries

Remote plans do not move the rig to a property. Location confirmation is an
operator assertion, not geolocation proof. Provider access remains dependent on
valid event credentials and data availability. A real hardware run is necessary
to validate acquisition on the assembled rig; demo runs validate software plumbing.
Deterministic code controls measured checks, never the LLM. Scout does not provide
certified ADA compliance or infer unmeasured dimensions from images.

## Site baselines (formerly Digital twins)

The main dashboard retains the reference-management page as **Site baselines**.
It now has a concrete workflow role rather than duplicating the Matterport viewer.
Baselines can be linked to property ID, model ID, raw operator location ID, and
fixture/site mode, and carry verification notes, source inspection ID, record date,
and measurement uncertainty. Missing slope references remain null, not zero.
Manual scoped baselines must use a model mapped to the chosen CoStar property.

After human review in Inspection History, expand **Create site baseline from this
reviewed inspection**, enter a name and reference verification notes, and confirm
suitability. This calls `POST /api/inspections/{id}/baseline`. The endpoint requires
a reviewed record, explicit confirmation and a measured width in cm or inches.
It preserves/converts width uncertainty and only copies measured slope values in
degrees. Repeating the operation reuses the same baseline ID without overwriting edits.

When creating another action-linked inspection, Scout calls
`GET /api/sponsor/reviews/{id}/baselines?location_id=...&execution_site=...`.
The newest matching verified baseline is suggested. Matching requires the same
property, model, raw location and execution site. A fixture reference cannot be
silently used at a property site. The backend enforces the match, not only the UI.

Baseline comparison is optional (`use_baseline: false`). If no matching baseline
exists, a sponsor-linked scan starts measurement-only. It still uses deterministic
measurement checks and historical comparison. The reference-drift panel contains
no fabricated defaults. Atlas saves whether a baseline was used and its exact
snapshot, so later reference edits do not change historical evidence.

Reference drift accounts for current and reference uncertainty. Unknown reference
uncertainty, missing values or overlapping bounds remain inconclusive; a difference
alone does not establish improvement. Baselines do not define regulatory thresholds.
