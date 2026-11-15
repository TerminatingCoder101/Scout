# Scout judge walkthrough

The website and backend must be running. Unlock Scout before recording. Keep
credentials and unrelated windows off screen. The local fixture must always be
identified as a demonstration, not as a measurement of the selected remote property.

1. Open Property intelligence. Select a real imported CoStar property and its
   linked Matterport model. Show address/coverage warnings and source provenance.
2. Load actual available provider layers. Show interior geometry and exterior
   imagery; distinguish retrieval/model creation times from verified capture dates.
3. Confirm the property/model match only after checking it. Run the DeepAgent
   planner, or transparently open an existing completed plan. Show the tool activity,
   image observations, source references, and a concrete prioritized action.
4. Click **Create site inspection from this plan**. Show the local-fixture label,
   selected baseline, and stable location ID. Do not substitute Matterport room
   width for doorway clearance. Choose Demo, Doorway, and Obstructed. Start.
5. Show radar readings, deterministic results, sponsor context, and Saved to Atlas.
   Create the same plan action again with the SAME location and Clear scenario.
6. Open Inspection History. Expand the two records, showing uncertainty, photos,
   and sponsor provenance. Compare latest two. Explain that detectable change and
   regulatory screening are distinct; missing evidence remains inconclusive.
7. Show the explicit human-review control. Do not mark a demonstration as a real
   property repair. Return to the plan to show the linked inspection progress.
8. Open Analytics. Show actual all-history activity and explain that current open
   findings use the latest inspection per location. Verified fixes require explicit
   reviewed resolution of a previously observed finding.

`demo/judge-run.json` identifies two successful local-fixture scans executed from
an existing real plan during integration verification. Their observed outcomes
were FAIL followed by PASS. They remain demo records, never real property measurements.

## Record on this Mac

With only the unlocked Scout browser visible on the main display, run:

```sh
.venv/bin/python scripts/record_judge_demo.py
```

The recorder waits eight seconds, captures the main display while playing the
prepared narration, and writes `demo/scout-judge-demonstration.mp4`. Advance the
website manually with the narration. macOS may require Screen Recording permission
for your terminal. Review the recording before sharing it. This script does not
fabricate website screenshots or replace unavailable provider results.
