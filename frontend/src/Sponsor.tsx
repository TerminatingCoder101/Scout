import { useEffect, useRef, useState } from "react";
import { api, patch, post } from "./api";
import type { Settings } from "./types";
import "./sponsor.css";

type Property = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  kind: string;
  model_ids: string[];
  latitude: number | null;
  longitude: number | null;
  facts: Record<string, unknown>;
  provenance: { imported_at: string; dataset: string };
};
type Room = {
  id: string;
  floor?: { id: string };
  classifications?: { label: string }[];
  dimensions?: { areaFloor?: number; width?: number; depth?: number };
};
type Floor = {
  id: string;
  label: string;
  vertices: { id: string; position: { x: number; y: number } }[];
  edges: { id: string; vertices: { id: string }[] }[];
};
type Review = {
  id: string;
  created_at: string;
  status: string;
  property: Property;
  model_id: string;
  layers: string[];
  layer_errors: Record<string, string>;
  error?: string;
  match_warnings?: string[];
  events: { at: string; message: string }[];
  matterport?: {
    name: string;
    created: string;
    image?: string;
    geometry_error?: string;
    address?: { address: string };
    geometry?: { floors: Floor[]; rooms: Room[] };
  };
  vexcel?: { image: string; retrieved_at: string; extent: string };
  visual_observations?: Record<string, string>;
  plan?: {
    id: string;
    summary: string;
    scope: string;
    actions: {
      title: string;
      location: string;
      reason: string;
      next_action: string;
      sources: string[];
    }[];
    limitations: string[];
  };
};
const keyLabels = {
  matterport_api_key: "Matterport API key / token ID",
  matterport_api_token: "Matterport API token / token secret",
  matterport_sdk_key: "Matterport browser SDK key",
  vexcel_api_key: "Vexcel API key",
};
const emptyKeys = {
  matterport_api_key: "",
  matterport_api_token: "",
  matterport_sdk_key: "",
  vexcel_api_key: "",
};

function FloorMap({ floors }: { floors: Floor[] }) {
  const [id, setId] = useState(floors[0]?.id || "");
  const f = floors.find((f) => f.id === id) || floors[0];
  if (!f?.vertices?.length)
    return <p>No floor geometry returned for this model.</p>;
  const vertices = new Map(f.vertices.map((v) => [v.id, v.position]));
  const xs = f.vertices.map((v) => v.position.x),
    ys = f.vertices.map((v) => -v.position.y);
  const x = Math.min(...xs) - 1,
    y = Math.min(...ys) - 1,
    w = Math.max(...xs) - x + 1,
    h = Math.max(...ys) - y + 1;
  return (
    <>
      <label>
        Floor
        <select value={f.id} onChange={(e) => setId(e.target.value)}>
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label || f.id}
            </option>
          ))}
        </select>
      </label>
      <svg
        className="sponsor-floor"
        viewBox={`${x} ${y} ${w} ${h}`}
        role="img"
        aria-label="Matterport floor geometry in meters"
      >
        {f.edges?.map((e) => {
          const a = vertices.get(e.vertices[0]?.id),
            b = vertices.get(e.vertices[1]?.id);
          return a && b ? (
            <line
              key={e.id}
              x1={a.x}
              y1={-a.y}
              x2={b.x}
              y2={-b.y}
              stroke="currentColor"
              strokeWidth={0.06}
            />
          ) : null;
        })}
      </svg>
      <small>
        Model coordinates, meters. Room outlines do not establish door
        clearance.
      </small>
    </>
  );
}

function Viewer({ reviewId }: { reviewId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [view, setView] = useState<{
    model_id: string;
    sdk_key: string;
  } | null>(null);
  const [message, setMessage] = useState("Loading viewer configuration…");
  useEffect(() => {
    let stopped = false;
    api<{ model_id: string; sdk_key: string }>(`/sponsor/viewer/${reviewId}`)
      .then((v) => {
        if (!stopped) {
          setView(v);
          setMessage(
            v.sdk_key
              ? "Connecting SDK…"
              : "Public tour; save an SDK key to enable SDK connection.",
          );
        }
      })
      .catch(() => setMessage("Viewer configuration unavailable."));
    return () => {
      stopped = true;
    };
  }, [reviewId]);
  async function connect() {
    if (!view?.sdk_key || !frame.current) return;
    try {
      const url =
        "https://static.matterport.com/showcase-sdk/bootstrap/3.1.0-0-g1cd7e0997a/sdk.es6.js?applicationKey=" +
        encodeURIComponent(view.sdk_key);
      const sdkModule = await import(/* @vite-ignore */ url);
      const sdk = await sdkModule.connect(frame.current);
      const model = await sdk.Model.getData();
      setMessage(`SDK connected · model ${model.sid || view.model_id}`);
    } catch {
      setMessage(
        "SDK connection failed. Check the key’s allowed domains and model access. The public tour may still work.",
      );
    }
  }
  return (
    <div>
      <p>{message}</p>
      {view && (
        <iframe
          ref={frame}
          title="Linked Matterport 3D space"
          onLoad={connect}
          referrerPolicy="origin"
          allow="fullscreen; xr-spatial-tracking"
          allowFullScreen
          src={`https://my.matterport.com/show?m=${encodeURIComponent(view.model_id)}&play=1&applicationKey=${encodeURIComponent(view.sdk_key)}`}
        />
      )}
    </div>
  );
}

export default function Sponsor({
  settings,
  onChange,
  onCreateInspection,
  onViewInspection,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onCreateInspection?: (
    reviewId: string,
    actionIndex: number,
    title: string,
  ) => void;
  onViewInspection?: (scanId: string) => void;
}) {
  const [keys, setKeys] = useState(emptyKeys),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<Property[]>([]),
    [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Property | null>(null),
    [model, setModel] = useState("");
  const [review, setReview] = useState<Review | null>(null),
    [history, setHistory] = useState<Review[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [showViewer, setShowViewer] = useState(false);
  const [linked, setLinked] = useState<
    {
      id: string;
      status: string;
      mode: string;
      atlas_status?: string;
      verdict?: string;
      context: { title: string; execution_site: string };
    }[]
  >([]);
  useEffect(() => {
    let live = true;
    if (!review?.id) {
      setLinked([]);
      return;
    }
    const load = () =>
      api<typeof linked>(`/sponsor/reviews/${review.id}/inspections`)
        .then((d) => {
          if (live) setLinked(d);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [review?.id]);
  const active = review?.status === "loading" || review?.status === "planning";
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    const d = await api<{ items: Property[]; total: number }>(
      `/sponsor/properties?q=${encodeURIComponent(query)}&offset=${offset}`,
    );
    setItems(d.items);
    setTotal(d.total);
  }
  useEffect(() => {
    let stopped = false;
    const timer = setTimeout(() => {
      api<{ items: Property[]; total: number }>(
        `/sponsor/properties?q=${encodeURIComponent(query)}&offset=${offset}`,
      )
        .then((d) => {
          if (!stopped) {
            setItems(d.items);
            setTotal(d.total);
          }
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    }, 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [query, offset]);
  useEffect(() => {
    api<Review[]>("/sponsor/reviews")
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!active || !review) return;
    let stopped = false;
    const timer = setInterval(() => {
      api<Review>(`/sponsor/reviews/${review.id}`)
        .then((d) => {
          if (!stopped) {
            setReview(d);
            if (!["loading", "planning"].includes(d.status))
              api<Review[]>("/sponsor/reviews").then(setHistory);
          }
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [review?.id, active]);
  return (
    <div className="sponsor-workspace">
      <section className="panel sponsor-hero">
        <small>COSTAR × MATTERPORT × VEXCEL</small>
        <h2>From property context to an inspection plan.</h2>
        <p>
          Join the inside, outside, and property record. Use the agent to decide
          what a site visit should verify.
        </p>
        <p className="muted">
          Remote evidence review. Your local radar scans are separate and are
          never assigned to these properties automatically.
        </p>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-text" role="status">
          {notice}
        </p>
      )}
      <details
        className="panel sponsor-card"
        open={
          !(
            settings.matterport_api_key_configured &&
            settings.matterport_api_token_configured &&
            settings.vexcel_api_key_configured
          )
        }
      >
        <summary>Connect sponsor accounts</summary>
        <p>
          API keys stay in owner-only local settings. The separate SDK key is
          browser-visible by design. Existing saved values are preserved when
          fields are blank.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            task(async () => {
              const updates = Object.fromEntries(
                Object.entries(keys)
                  .filter(([, v]) => v.trim())
                  .map(([k, v]) => [k, v.trim()]),
              );
              onChange(await patch<Settings>("/settings", updates));
              setKeys(emptyKeys);
              setNotice(
                "Sponsor credentials saved locally. Load evidence to test access to your selected model and region.",
              );
            });
          }}
        >
          <div className="form-grid">
            {Object.entries(keyLabels).map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  type="password"
                  autoComplete="off"
                  value={keys[name as keyof typeof keys]}
                  onChange={(e) => setKeys({ ...keys, [name]: e.target.value })}
                  placeholder={
                    (settings as unknown as Record<string, unknown>)[
                      name + "_configured"
                    ]
                      ? "Saved · enter to replace"
                      : "Not configured"
                  }
                />
              </label>
            ))}
          </div>
          <button className="primary" disabled={busy || active}>
            Save sponsor credentials
          </button>
        </form>
      </details>
      <div className="sponsor-columns">
        <section className="panel sponsor-card">
          <h3>1. Choose a property</h3>
          <button
            className="secondary"
            disabled={busy || active}
            onClick={() =>
              task(async () => {
                const r = await post<{ imported: number }>("/sponsor/import");
                setNotice(
                  `Imported ${r.imported.toLocaleString()} CoStar records.`,
                );
                await search();
              })
            }
          >
            Import local CoStar kit
          </button>
          <label>
            Search address, city, or property ID
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder="Houston, Los Angeles, street name…"
            />
          </label>
          <small>{total.toLocaleString()} matching records</small>
          <div className="sponsor-property-list">
            {items.map((p) => (
              <button
                key={p.id}
                disabled={active}
                className={selected?.id === p.id ? "selected" : ""}
                onClick={() => {
                  setSelected(p);
                  setModel(p.model_ids[0] || "");
                }}
              >
                <strong>{p.name}</strong>
                <span>
                  {p.address} · {p.city}, {p.state}
                </span>
                <small>
                  {p.kind} · {p.model_ids.length} linked models · {p.id}
                </small>
              </button>
            ))}
          </div>
          {!items.length && (
            <p>Import the kit or change the search to find properties.</p>
          )}
          <div className="card-actions">
            <button
              className="secondary compact"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 40))}
            >
              Previous
            </button>
            <button
              className="secondary compact"
              disabled={offset + 40 >= total}
              onClick={() => setOffset(offset + 40)}
            >
              Next
            </button>
          </div>
        </section>
        <section className="panel sponsor-card">
          <h3>2. Load linked evidence</h3>
          {selected ? (
            <>
              <h4>{selected.name}</h4>
              <p>
                {selected.address}, {selected.city} {selected.state}
              </p>
              <small>
                CoStar source: {selected.provenance.dataset} · {selected.id}
              </small>
              <label>
                Matterport model
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {selected.model_ids.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
              <p className="muted">
                One model may cover a single apartment or floor plan, not the
                entire property. Choose the intended space and review coverage.
              </p>
              <button
                className="primary"
                disabled={busy || active || !model}
                onClick={() =>
                  task(async () => {
                    setConfirmed(false);
                    setShowViewer(false);
                    setReview(
                      await post<Review>("/sponsor/reviews", {
                        property_id: selected.id,
                        model_id: model,
                      }),
                    );
                  })
                }
              >
                Load Matterport + Vexcel evidence
              </button>
            </>
          ) : (
            <p>Select a property to view its linked models.</p>
          )}
          <hr />
          <h4>Recent reviews</h4>
          {history.map((r) => (
            <button
              className="sponsor-history"
              key={r.id}
              disabled={active}
              onClick={() => {
                setReview(r);
                setConfirmed(false);
                setShowViewer(false);
              }}
            >
              {r.property.name} · {r.status}
            </button>
          ))}
        </section>
      </div>
      {review && (
        <section className="panel sponsor-card">
          <div className="sponsor-review-heading">
            <div>
              <small>{review.layers.join(" + ").toUpperCase()}</small>
              <h3>{review.property.name}</h3>
              <p>
                Model {review.model_id} · {review.status.replaceAll("_", " ")}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => {
                const blob = new Blob([JSON.stringify(review, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `scout-property-${review.id}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export evidence & plan
            </button>
          </div>
          {review.error && <p className="error">{review.error}</p>}
          {review.match_warnings?.map((warning, i) => (
            <p className="info-note" key={i}>
              {warning}
            </p>
          ))}
          {Object.entries(review.layer_errors).map(([k, v]) => (
            <p className="error" key={k}>
              {k}: {v}
            </p>
          ))}
          <div className="sponsor-columns">
            <div>
              <h4>Matterport · inside</h4>
              {review.matterport ? (
                <>
                  <p>
                    {review.matterport.address?.address ||
                      review.matterport.name}
                  </p>
                  <small>
                    Model created {review.matterport.created || "unknown"};
                    capture date not verified.
                  </small>
                  {review.matterport.image && (
                    <img
                      className="sponsor-image"
                      src={`/api/sponsor/images/${review.matterport.image}`}
                      alt="Retrieved Matterport model preview"
                    />
                  )}
                  {review.matterport.geometry_error && (
                    <p className="error">{review.matterport.geometry_error}</p>
                  )}
                  {review.matterport.geometry?.floors && (
                    <FloorMap floors={review.matterport.geometry.floors} />
                  )}
                  <details>
                    <summary>
                      Room measurements (
                      {review.matterport.geometry?.rooms?.length || 0})
                    </summary>
                    {review.matterport.geometry?.rooms?.map((room) => (
                      <p key={room.id}>
                        {room.classifications?.[0]?.label ||
                          "Unclassified room"}
                        : {room.dimensions?.areaFloor?.toFixed(1) ?? "—"} m² ·
                        width {room.dimensions?.width?.toFixed(2) ?? "—"} m ·
                        depth {room.dimensions?.depth?.toFixed(2) ?? "—"} m
                      </p>
                    ))}
                  </details>
                  <button
                    className="secondary"
                    onClick={() => setShowViewer(!showViewer)}
                  >
                    {showViewer ? "Close" : "Open"} interactive 3D model
                  </button>
                  {showViewer && (
                    <Viewer key={review.id} reviewId={review.id} />
                  )}
                </>
              ) : (
                <p>
                  {active
                    ? "Retrieving interior evidence…"
                    : "Interior evidence unavailable."}
                </p>
              )}
            </div>
            <div>
              <h4>Vexcel · outside</h4>
              {review.vexcel ? (
                <>
                  <img
                    className="sponsor-image"
                    src={`/api/sponsor/images/${review.vexcel.image}`}
                    alt="Vexcel aerial context around the selected CoStar property"
                  />
                  <p>{review.vexcel.extent}</p>
                  <small>
                    Retrieved{" "}
                    {new Date(review.vexcel.retrieved_at).toLocaleString()}.
                    Capture date unavailable; imagery may be older.
                  </small>
                </>
              ) : (
                <p>
                  {active
                    ? "Retrieving aerial imagery…"
                    : "Aerial evidence unavailable."}
                </p>
              )}
            </div>
          </div>
          <div className="sponsor-plan-controls">
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked that the selected space and available aerial context
              correspond to this property.
            </label>
            <p className="muted">
              The DeepAgent uses retrieved records, room geometry and images to
              prioritize site checks. Gemini receives this evidence when you
              start planning.
            </p>
            <button
              className="primary"
              disabled={
                busy || active || !confirmed || review.layers.length < 2
              }
              onClick={() =>
                task(async () => {
                  setReview(
                    await post<Review>(`/sponsor/reviews/${review.id}/plan`, {
                      location_confirmed: true,
                    }),
                  );
                })
              }
            >
              {review.status === "planning"
                ? "Agent is reviewing evidence…"
                : "Run DeepAgent inspection planner"}
            </button>
          </div>
          <details open={active}>
            <summary>Agent & retrieval activity</summary>
            <ol>
              {review.events.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ol>
          </details>
          {review.plan && (
            <div className="sponsor-plan">
              <small>{review.plan.id} · REQUIRES SITE VERIFICATION</small>
              <h3>Recommended inspection plan</h3>
              <p>{review.plan.summary}</p>
              <p className="muted">{review.plan.scope}</p>
              {review.plan.actions.map((a, i) => (
                <article key={i}>
                  <h4>
                    {i + 1}. {a.title}
                  </h4>
                  <p>
                    <strong>Where:</strong> {a.location}
                  </p>
                  <p>{a.reason}</p>
                  <p>
                    <strong>Next action:</strong> {a.next_action}
                  </p>
                  <small>Evidence: {a.sources.join(" + ")}</small>
                  {onCreateInspection && (
                    <button
                      className="secondary compact"
                      onClick={() => onCreateInspection(review.id, i, a.title)}
                    >
                      Create site inspection from this plan
                    </button>
                  )}
                </article>
              ))}
              <h4>Site verification progress</h4>
              <p className="muted">
                Remote evidence prioritizes checks. Local fixture demonstrations
                do not verify conditions at the sponsor property.
              </p>
              {!linked.length && (
                <p>
                  No linked site inspections yet. Select a plan action above to
                  begin.
                </p>
              )}
              {linked.map((s) => (
                <article key={s.id}>
                  <strong>{s.context.title}</strong>
                  <p>
                    {s.context.execution_site === "local_fixture"
                      ? "LOCAL FIXTURE · not the sponsor property"
                      : "PROPERTY SITE · operator confirmed"}{" "}
                    · {s.mode} · {s.status} ·{" "}
                    {s.verdict || "Awaiting measurement"} · Atlas:{" "}
                    {s.atlas_status || "pending"}
                  </p>
                  {onViewInspection && (
                    <button
                      className="text-button"
                      onClick={() => onViewInspection(s.id)}
                    >
                      Open linked inspection
                    </button>
                  )}
                </article>
              ))}
              <h4>Limitations</h4>
              <ul>
                {review.plan.limitations.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
