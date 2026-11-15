import { useEffect, useState } from "react";
import { api, post, patch } from "./api";
import Radar from "./Radar";
import type { Scan, Point, SponsorContext } from "./types";

type Measurement = {
  key: string;
  value: number | null;
  unit: string;
  uncertainty: number;
};
type Finding = {
  key: string;
  category?: string;
  status: string;
  detail: string;
};
type Record = {
  sponsor_context?: SponsorContext | null;
  scan_id?: string;
  raw_sensor_measurements?: Point[];
  photo_references?: string[];
  agent_actions?: { name: string; detail: string }[];
  local?: Scan;
  source_mode?: "demo" | "hardware";
  id: string;
  building_id: string;
  location_id: string;
  timestamp: string;
  measurements: Measurement[];
  findings: Finding[];
  review_status: string;
};
type Comparison = {
  before_timestamp: string;
  after_timestamp: string;
  review_status: string;
  measurement_changes: {
    key: string;
    before: Measurement | null;
    after: Measurement | null;
    delta: number | null;
    combined_uncertainty: number | null;
    status: string;
  }[];
  finding_changes: {
    key: string;
    before: Finding | null;
    after: Finding | null;
    change: string;
  }[];
};
type Analytics = {
  total_inspections: number;
  open_findings: number;
  verified_fixes: number;
  categories: { category: string; count: number }[];
  activity: { date: string; count: number }[];
};
const reading = (m: Measurement | null) =>
  m?.value == null ? "Unmeasured" : `${m.value} ± ${m.uncertainty} ${m.unit}`;
const status = (s?: string) =>
  s === "observed"
    ? "Flagged"
    : s === "passed"
      ? "Passed (measured checks)"
      : s === "resolved"
        ? "Passed / resolved"
        : s === "inconclusive" || s === "recheck"
          ? "Inconclusive / recheck"
          : s?.replaceAll("_", " ") || "Absent";
const date = (s: string) => new Date(s).toLocaleString();
function Bars({
  title,
  values,
}: {
  title: string;
  values: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...values.map((v) => v.count));
  return (
    <section className="panel settings-card">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="settings-body">
        {values.length ? (
          <ul className="history-bars" aria-label={title}>
            {values.map((v) => (
              <li key={v.label}>
                <span>{v.label}</span>
                <div
                  className="analytics-bar-track"
                  role="img"
                  aria-label={`${v.label}: ${v.count} findings`}
                >
                  <div
                    className="analytics-bar-fill"
                    style={{ width: `${(v.count / max) * 100}%` }}
                  />
                </div>
                <strong>{v.count}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>No recorded data yet.</p>
        )}
      </div>
    </section>
  );
}
export function ActivityChart({
  title,
  values,
}: {
  title: string;
  values: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...values.map((v) => v.count));
  const width = Math.max(680, values.length * 90 + 100);
  const slot = (width - 100) / Math.max(1, values.length);
  return (
    <section className="panel settings-card">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="settings-body">
        {values.length ? (
          <>
            <div className="activity-chart-scroll">
              <svg
                className="inspection-activity-chart"
                viewBox={`0 0 ${width} 300`}
                style={{ minWidth: width }}
                role="img"
                aria-label={title}
              >
                <title>{title}</title>
                <desc>
                  Inspections per UTC date. Only dates with saved records are
                  shown. Bar height represents the count, not a measurement or
                  compliance score.
                </desc>
                {[0, 1, 2, 3, 4].map((i) => {
                  const y = 240 - i * 50;
                  return (
                    <g key={i}>
                      <line
                        x1={60}
                        x2={width - 20}
                        y1={y}
                        y2={y}
                        stroke="#35473b"
                      />
                      <text
                        x={50}
                        y={y + 4}
                        textAnchor="end"
                        fill="#b5c3b8"
                        fontSize={12}
                      >
                        {Number(((max * i) / 4).toFixed(2))}
                      </text>
                    </g>
                  );
                })}
                {values.map((v, i) => {
                  const x = 60 + slot * (i + 0.5),
                    height = (v.count / max) * 200;
                  return (
                    <g key={v.label}>
                      <title>
                        {v.label}: {v.count} inspections
                      </title>
                      <rect
                        x={x - 26}
                        y={240 - height}
                        width={52}
                        height={height}
                        rx={4}
                        fill="#b6ee78"
                      />
                      <text
                        x={x}
                        y={230 - height}
                        textAnchor="middle"
                        fill="#e2eddf"
                        fontSize={14}
                      >
                        {v.count}
                      </text>
                      <text
                        x={x}
                        y={266}
                        textAnchor="middle"
                        fill="#b5c3b8"
                        fontSize={12}
                      >
                        {v.label}
                      </text>
                    </g>
                  );
                })}
                <text x={60} y={20} fill="#b5c3b8" fontSize={12}>
                  INSPECTIONS
                </text>
              </svg>
            </div>
            <p className="muted">
              Each bar counts saved inspections on a UTC date. Dates without
              records are omitted. Expand an inspection below for its sensor
              graph.
            </p>
          </>
        ) : (
          <p>No recorded data yet.</p>
        )}
      </div>
    </section>
  );
}

function ReviewInspection({
  record,
  onSaved,
}: {
  record: Record;
  onSaved: () => void;
}) {
  const [findings, setFindings] = useState(record.findings),
    [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="advanced">
      <summary>Human review / record a verified resolution</summary>
      <p>
        Review the physical evidence before marking a finding resolved. This
        records your review, not certified compliance. Original measurements
        remain unchanged.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await patch(`/inspections/${record.id}/review`, {
              findings,
              notes,
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {findings.map((f, i) => (
          <label key={f.key}>
            {f.key}
            <select
              aria-label={`Review ${f.key}`}
              value={f.status}
              onChange={(e) =>
                setFindings((old) =>
                  old.map((v, j) =>
                    j === i ? { ...v, status: e.target.value } : v,
                  ),
                )
              }
            >
              {[
                "observed",
                "passed",
                "resolved",
                "inconclusive",
                "recheck",
              ].map((s) => (
                <option key={s} value={s}>
                  {status(s)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Review evidence and notes
          <textarea
            value={notes}
            required
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button className="secondary" disabled={busy}>
          Save human review
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}

export default function InspectionHistory({
  analytics = false,
  onViewScan,
}: {
  analytics?: boolean;
  onViewScan?: (scan: Scan) => void;
}) {
  const [building, setBuilding] = useState(""),
    [location, setLocation] = useState("");
  const [syncNote, setSyncNote] = useState("");
  const [localScans, setLocalScans] = useState<Scan[]>([]);
  const [records, setRecords] = useState<Record[]>([]),
    [summary, setSummary] = useState<Analytics | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null),
    [compareError, setCompareError] = useState("");
  const [selected, setSelected] = useState<{
    building: string;
    location: string;
  } | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let live = true,
      inFlight = false,
      synced = false;
    setLocalScans([]);
    setLoading(true);
    setRecords([]);
    setSummary(null);
    setError("");
    async function load() {
      if (inFlight) return;
      inFlight = true;
      const params = new URLSearchParams();
      if (building.trim()) params.set("building_id", building.trim());
      if (!analytics && location.trim())
        params.set("location_id", location.trim());
      if (!analytics) {
        params.set("offset", String(offset));
        params.set("limit", "50");
      }
      if (analytics && !synced) {
        synced = true;
        if (live) setSyncNote("Importing previous completed inspections…");
        try {
          const result = await post<{ imported: number; failed: number }>(
            "/inspections/sync-local",
          );
          if (live)
            setSyncNote(
              `Previous inspections included. Imported ${result.imported || 0} records.${result.failed ? ` ${result.failed} older records could not be imported; totals may be incomplete.` : ""}`,
            );
        } catch {
          if (live)
            setSyncNote(
              "Previous local inspections could not be imported. Charts show available Atlas records; refresh to retry.",
            );
        }
      }
      if (!analytics) {
        try {
          const scans = await api<Scan[]>("/scans");
          if (live) setLocalScans(scans.filter((s) => s.request));
        } catch {
          /* Atlas records remain independently accessible. */
        }
      }
      try {
        const data = await api<Record[] | Analytics>(
          `/inspections${analytics ? "/analytics" : ""}?${params}`,
        );
        if (live) {
          if (analytics) setSummary(data as Analytics);
          else setRecords(data as Record[]);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (live) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [building, location, analytics, offset, refresh]);
  useEffect(() => {
    let live = true;
    setComparison(null);
    setCompareError("");
    if (!selected || analytics) return;
    async function load() {
      try {
        const data = await api<Comparison>(
          "/inspections/compare?" +
            new URLSearchParams({
              building_id: selected!.building,
              location_id: selected!.location,
            }),
        );
        if (live) {
          setComparison(data);
          setCompareError("");
        }
      } catch (e) {
        if (live) {
          setComparison(null);
          setCompareError((e as Error).message);
        }
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected, analytics, refresh]);
  const linked = new Set(records.map((r) => r.scan_id).filter(Boolean));
  const localRecords: Record[] =
    offset === 0
      ? localScans
          .filter(
            (s) =>
              !linked.has(s.id) &&
              (!s.atlas_inspection_id || !!error) &&
              (!building.trim() || s.request.building_id === building.trim()) &&
              (!location.trim() ||
                (s.request.location_id || s.request.profile) ===
                  location.trim()),
          )
          .map((s) => ({
            id: "local-" + s.id,
            sponsor_context: s.sponsor_context,
            local: s,
            building_id: s.request.building_id,
            location_id: s.request.location_id || s.request.profile,
            timestamp: s.completed_at || s.created_at,
            source_mode: s.request.mode as "demo" | "hardware",
            review_status: s.status + " · local only",
            raw_sensor_measurements: s.points,
            photo_references: s.images.map((i) => i.url),
            measurements: (s.result?.checks || []).map((c) => ({
              key: c.key,
              value: c.value,
              unit: c.unit,
              uncertainty: c.error,
            })),
            findings: (s.result?.checks || []).map((c) => ({
              key: c.key,
              status:
                c.status === "FAIL"
                  ? "observed"
                  : c.status === "PASS"
                    ? "passed"
                    : "inconclusive",
              detail: c.label,
            })),
          }))
      : [];
  const displayed = [
    ...records.map((r) => ({
      ...r,
      local: localScans.find((s) => s.id === r.scan_id),
    })),
    ...localRecords,
  ].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const activity = new Map<string, number>();
  for (const r of displayed) {
    const day = r.timestamp.slice(0, 10);
    activity.set(day, (activity.get(day) || 0) + 1);
  }
  return (
    <div className="atlas-history">
      <section className="panel settings-card">
        <div className="settings-body history-filters">
          <label>
            Building ID
            <input
              value={building}
              maxLength={120}
              placeholder="All buildings"
              onChange={(e) => {
                setBuilding(e.target.value);
                setOffset(0);
                setSelected(null);
              }}
            />
          </label>
          {!analytics && (
            <label>
              Location ID
              <input
                value={location}
                maxLength={120}
                placeholder="All locations"
                onChange={(e) => {
                  setLocation(e.target.value);
                  setOffset(0);
                  setSelected(null);
                }}
              />
            </label>
          )}
          <button
            className="secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Refresh
          </button>
          <small>MongoDB records · refreshes every 5 seconds</small>
        </div>
      </section>
      <p className="info-note">
        Accessibility screening for human review. Scout does not provide
        certified ADA compliance. Resolved findings are recorded outcomes; no
        unmeasured checks are assumed to pass.
      </p>
      {error && (
        <p role="alert" className="error">
          {error} Displayed data may be stale.
        </p>
      )}
      {loading && <p role="status">Loading inspection data…</p>}
      {analytics && syncNote && (
        <p role="status" className="info-note">
          {syncNote}
        </p>
      )}
      {analytics && summary && (
        <>
          <div className="metrics">
            {[
              ["Total inspections", summary.total_inspections],
              ["Open findings", summary.open_findings],
              ["Verified fixes", summary.verified_fixes],
            ].map(([name, value]) => (
              <div className="metric" key={name}>
                <div className="metric-label">{name}</div>
                <strong className="metric-value">{value}</strong>
              </div>
            ))}
          </div>
          <p className="muted">
            Open findings include flagged and inconclusive results in each
            location’s latest inspection. Verified fixes require a reviewed,
            resolved finding that was observed in the immediately preceding
            inspection. Charts count latest findings by category and all
            inspections by UTC day; days without bars have no inspections.
          </p>
          <Bars
            title="Findings by category"
            values={summary.categories.map((v) => ({
              label: v.category,
              count: v.count,
            }))}
          />
          <ActivityChart
            title="Inspection activity (UTC)"
            values={summary.activity.map((v) => ({
              label: v.date,
              count: v.count,
            }))}
          />
        </>
      )}
      {!analytics && (
        <>
          <ActivityChart
            title="Inspection activity · loaded records (UTC)"
            values={[...activity]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([label, count]) => ({ label, count }))}
          />
          {!loading && !error && !displayed.length && (
            <div className="empty">
              <h3>No saved inspections</h3>
              <p>
                No saved inspections match these filters. Run a live or demo
                inspection to begin.
              </p>
            </div>
          )}
          {displayed.map((r) => (
            <details className="panel settings-card" key={r.id}>
              <summary className="panel-heading">
                <div>
                  <h2>
                    {r.building_id} / {r.location_id}
                  </h2>
                  <p>
                    {date(r.timestamp)} · {r.source_mode || "API record"} ·
                    Review: {status(r.review_status)}
                  </p>
                </div>
                <span>Expand inspection details</span>
              </summary>
              <div className="settings-body">
                <div className="history-filters">
                  {!r.id.startsWith("local-") && (
                    <button
                      className="secondary compact"
                      onClick={() =>
                        setSelected({
                          building: r.building_id,
                          location: r.location_id,
                        })
                      }
                    >
                      Compare latest two
                    </button>
                  )}
                  {r.local && onViewScan && (
                    <button
                      className="secondary compact"
                      onClick={() => onViewScan(r.local!)}
                    >
                      Open full inspection
                    </button>
                  )}
                </div>
                {r.raw_sensor_measurements?.length ? (
                  <Radar points={r.raw_sensor_measurements} active={false} />
                ) : null}
                {r.sponsor_context && (
                  <div className="info-note">
                    <div>
                      <strong>{r.sponsor_context.title}</strong>
                      <p>
                        {r.sponsor_context.property_name} ·{" "}
                        {r.sponsor_context.target_location}
                      </p>
                      <p>
                        Plan {r.sponsor_context.plan_id} · Sources:{" "}
                        {r.sponsor_context.sources.join(" + ")}
                      </p>
                      <p>
                        {r.sponsor_context.execution_site === "local_fixture"
                          ? "Local fixture demonstration; not measurements of the sponsor property."
                          : "Property site confirmed by operator."}
                      </p>
                    </div>
                  </div>
                )}
                <h3>Measurements</h3>
                {r.measurements.length ? (
                  <ul>
                    {r.measurements.map((m) => (
                      <li key={m.key}>
                        {m.key}: {reading(m)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No measurements recorded.</p>
                )}
                <h3>Findings</h3>
                {r.findings.length ? (
                  <ul>
                    {r.findings.map((f) => (
                      <li key={f.key}>
                        <strong>
                          {f.key}: {status(f.status)}
                        </strong>{" "}
                        · {f.category || "uncategorized"}{" "}
                        {f.detail && <p>{f.detail}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No findings recorded. This does not establish a pass.</p>
                )}
                {!r.id.startsWith("local-") && (
                  <ReviewInspection
                    key={r.id + r.review_status}
                    record={r}
                    onSaved={() => setRefresh((v) => v + 1)}
                  />
                )}
                {!!r.photo_references?.length && (
                  <div className="history-photos">
                    {r.photo_references
                      .filter((url) => url.startsWith("/api/images/"))
                      .map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt="Inspection evidence"
                          loading="lazy"
                        />
                      ))}
                  </div>
                )}
                {r.agent_actions?.map((a, i) => (
                  <p key={i}>
                    {a.name}: {a.detail}
                  </p>
                ))}
              </div>
            </details>
          ))}
          <div className="history-filters">
            <button
              className="secondary"
              disabled={offset === 0}
              onClick={() => {
                setOffset((v) => Math.max(0, v - 50));
                setSelected(null);
              }}
            >
              Previous
            </button>
            <span>Page {offset / 50 + 1}</span>
            <button
              className="secondary"
              disabled={records.length < 50}
              onClick={() => {
                setOffset((v) => v + 50);
                setSelected(null);
              }}
            >
              Next
            </button>
          </div>
          {selected && (
            <section className="panel settings-card">
              <div className="panel-heading">
                <h2>
                  Latest comparison: {selected.building} / {selected.location}
                </h2>
              </div>
              <div className="settings-body">
                {compareError && <p role="status">{compareError}</p>}
                {!comparison && !compareError && <p>Loading comparison…</p>}
                {comparison && (
                  <>
                    <p>
                      Previous: {date(comparison.before_timestamp)} → Current:{" "}
                      {date(comparison.after_timestamp)}
                    </p>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Measurement</th>
                            <th>Previous ± uncertainty</th>
                            <th>Current ± uncertainty</th>
                            <th>Difference ± bound</th>
                            <th>Change result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.measurement_changes.map((m) => (
                            <tr key={m.key}>
                              <td>{m.key}</td>
                              <td>{reading(m.before)}</td>
                              <td>{reading(m.after)}</td>
                              <td>
                                {m.delta == null
                                  ? "Unavailable"
                                  : `${Number(m.delta.toFixed(4))} ± ${m.combined_uncertainty} ${m.after?.unit}`}
                              </td>
                              <td>
                                {m.status === "changed"
                                  ? "Change exceeds uncertainty"
                                  : "Inconclusive / recheck"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!comparison.measurement_changes.length && (
                      <p>No measurements to compare; recheck required.</p>
                    )}
                    <h3>Finding changes</h3>
                    {comparison.finding_changes.map((f) => (
                      <p key={f.key}>
                        {f.key}: {status(f.before?.status)} →{" "}
                        {status(f.after?.status)} (
                        {f.change.replaceAll("_", " ")})
                      </p>
                    ))}
                    <p>
                      Overlapping uncertainty, missing readings, or different
                      units are inconclusive. Absent findings are not
                      automatically resolved. A measurable change alone does not
                      establish a pass.
                    </p>
                  </>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
