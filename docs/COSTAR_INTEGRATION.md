# Sponsor integration status and implementation contract

Current status: live CoStar extract, Matterport GraphQL, and Vexcel imagery retrieval implemented and verified with saved event credentials. The separate remote DeepAgent planner is implemented; its live verification status is recorded below. The original normalized baseline import and physical inspection workflow remain available.

## Using the integration

1. Refresh Scout and open **Property intelligence**.
2. Expand **Connect sponsor accounts**. Enter Matterport API key (Basic username), API token (Basic password), browser SDK key, and Vexcel API key. Save. Blank fields preserve saved values. Credentials are stored in ignored, owner-only `.scout/settings.json`; only configured flags are returned through Settings.
3. Click **Import local CoStar kit**. The supplied `costar-hackathon-kit` folder is discovered at the project root. Override `COSTAR_KIT_DIR` for another location. The licensed kit is ignored by Git.
4. Search an address/city, select the property and its linked model, and click **Load Matterport + Vexcel evidence**. The kit's CSV mapping is authoritative for the link; visible warnings identify address/geocode differences that still require review.
5. Inspect the model preview, floor geometry, room measurements and aerial image. The aerial view is a 120m context square centered on CoStar coordinates, not a parcel outline. Capture dates unavailable from the current response stay unknown. Model creation date is explicitly not treated as capture date.
6. Confirm the location match. Clicking **Run DeepAgent inspection planner** sends the selected property evidence and downloaded images to Google Gemini. Only proceed under your event data-use authorization. The planner records tool activity and returns prioritized actions with sources and limitations.
7. Export the evidence and plan as JSON or reopen it in Recent reviews. Plans are local recommendations requiring site verification, not measured accessibility verdicts.

The browser SDK uses a separate key that is intentionally browser-visible. Its allowed-domain list must include the host/port used to open Scout. API key/token credentials stay server-side. Private model access can require additional Matterport entitlement; a successful GraphQL response does not guarantee browser viewer access.

## Verification

The supplied kit imported **5,459 records**, with **5,407** linked to at least one model. Live retrieval succeeded for all three layers on a commercial Houston record and a residential Los Angeles record. The residential test returned 19 Matterport rooms, floor geometry, a downloaded model preview and Vexcel aerial imagery. A commercial test exposed a differing street number within a site, motivating visible match warnings.

After explicit operator authorization, the live Gemini DeepAgent test completed and published **PLAN-8CF35A1A**. The agent read CoStar context, examined Matterport geometry, inspected the Vexcel image with Gemini vision, and published a plan citing all three retrieved layers. A rejected premature publication now returns feedback to the agent rather than terminating its workflow.

Backend tests cover explicit model joins, missing coordinates, Basic/header authentication, longitude-first WKT, image retrieval, provider errors, secret redaction, route authorization and planner publication gates. Dashboard tests cover local credential saving, evidence display and location confirmation. Live Gemini planning requires explicit authorization to transmit sponsor evidence. The browser SDK viewer has not been visually verified on this machine.

## Verified event entry point

https://beta-app.matterport.com/2026-princeton-hackathon/

The event's public `assets/config.json` identifies:

- CoStar: Houston and Los Angeles **data extract**, obtained through `/costar-keys` in the track Discord. Do not invent a CoStar REST endpoint.
- Matterport: Model API GraphQL at `https://api.matterport.com/api/models/graph`, with API credentials; separate Showcase SDK key for interactive 3D views.
- Vexcel: imagery API plus the event's `api/assets/doc/vexcel_quickstart.py` and tutorial PDF.
- `/costar-keys`: accept event terms, name/join a team, then retrieve private credentials and extract access.

Use event-issued credentials and the licensed extract. Public sample model IDs alone are not evidence of matching a CoStar property.

## Scout workflow to implement against real data

1. Ingest the licensed CoStar extract with source IDs, address, coordinates, property use and available ownership/contact context. Preserve missing fields rather than generating values.
2. Resolve a Matterport model for that same property using supplied IDs or an explicit user-confirmed mapping. Record match evidence and confidence. A nearby coordinate alone is not a confirmed building match.
3. Retrieve interior geometry and available imagery. Label room measurements as room measurements: they are not automatically clear doorway widths. Any inspection baseline needs an identified entrance/measurement and provenance.
4. Retrieve Vexcel capture metadata and exterior imagery at the confirmed property's coordinates. Preserve capture dates and CRS/coordinate order. Show imagery alongside the linked interior model.
5. Let the agent inspect those sources, select an entrance/route segment, flag uncertain or stale evidence, and produce a targeted inspection plan. Exterior imagery can suggest approach obstacles but cannot establish curb height, slope or legal accessibility.
6. Perform the physical scan only at the operator-confirmed property and entrance. An on-campus hardware demonstration must remain separate from a Houston/Los Angeles property, not be represented as its live measurements.
7. Produce a work order with source IDs/dates, the selected location, observed issues, physical measurements if available, missing evidence, and recommended next action. Deterministic measured checks retain control of the verdict.

## Acceptance criteria

- At least one real property with two successfully retrieved and correctly joined sponsor layers; three preferred.
- The plan or recommendation materially changes based on the combined data, rather than displaying an unrelated image alongside text.
- Traceable agent tool calls for retrieval, spatial evidence inspection, planning and work-order publication.
- Dashboard exposes layer coverage, provenance, actual capture dates and unmatched records.
- Tests cover missing credentials, provider errors, invalid matches, coordinate ordering, secret redaction and incomplete geometry. Real authenticated requests verify what mocks cannot.

Provider coverage, browser model access, and image dates vary. Show missing layers and limits explicitly in the demo.
