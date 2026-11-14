import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import {
  Radar as RadarIcon,
  LayoutDashboard,
  Layers3,
  History,
  ClipboardList,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowRight,
  Play,
  Square,
  Check,
  TriangleAlert,
  Download,
  ChevronRight,
  Activity,
  Radio,
  ScanLine,
  Eye,
  Plug,
  Zap,
  Plus,
  X,
  RefreshCw,
  FileJson,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  LoaderCircle,
  Menu,
  LogOut,
  ExternalLink,
  FlaskConical,
  LockKeyhole,
  Camera,
  Briefcase,
} from "lucide-react";
import { api, post, patch } from "./api";
import Radar from "./Radar";
import type {
  Scan,
  Twin,
  Settings,
  Device,
  Event,
  Validation,
  Check as RuleCheck,
} from "./types";

type Page =
  "overview" | "twins" | "history" | "orders" | "validation" | "settings";
const pages: { id: Page; label: string; icon: typeof RadarIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "twins", label: "Digital twins", icon: Layers3 },
  { id: "history", label: "Inspections", icon: History },
  { id: "orders", label: "Work orders", icon: ClipboardList },
  { id: "validation", label: "Calibration lab", icon: FlaskConical },
];
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const num = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : v.toFixed(d);
const label = (s: string) => s.replaceAll("_", " ");
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value.toLowerCase()}>
      <i />
      {label(
        value === "PASS"
          ? "PASS"
          : value === "NOT_MEASURED"
            ? "unmeasured"
            : value,
      )}
    </span>
  );
}
function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof RadarIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({
  label: caption,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>
        <span>{caption}</span>
        {children}
      </label>
      {hint && <small>{hint}</small>}
    </div>
  );
}
function dialogKeys(event: KeyboardEvent<HTMLElement>) {
  const dialog = event.currentTarget;
  if (event.key === "Escape") {
    event.preventDefault();
    dialog
      .querySelector<HTMLButtonElement>('button[aria-label^="Close"]')
      ?.click();
  }
  if (event.key === "Tab") {
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary",
      ),
    );
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
function App() {
  const [ready, setReady] = useState(false),
    [locked, setLocked] = useState(false),
    [key, setKey] = useState("");
  const [page, setPage] = useState<Page>("overview"),
    [mobile, setMobile] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null),
    [device, setDevice] = useState<Device>({
      connected: false,
      port: null,
      error: null,
    });
  const [twins, setTwins] = useState<Twin[]>([]),
    [scans, setScans] = useState<Scan[]>([]),
    [scan, setScan] = useState<Scan | null>(null),
    [events, setEvents] = useState<Event[]>([]);
  const [building, setBuilding] = useState("princeton-demo"),
    [mode, setMode] = useState("demo"),
    [scenario, setScenario] = useState("obstructed"),
    [profile, setProfile] = useState("doorway"),
    [useAI, setUseAI] = useState(false);
  const [scanDialog, setScanDialog] = useState(false),
    [manual, setManual] = useState({
      opening_depth_in: "12",
      threshold_in: "",
      handle_height_in: "",
    });
  const bootstrap = useRef<Promise<void> | null>(null);
  const stream = useRef<EventSource | null>(null),
    selectedId = useRef<string | null>(null);
  const active = scan?.status === "running" || scan?.status === "queued";
  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 4500);
  };
  async function load() {
    const [status, t, s] = await Promise.all([
      api<{
        settings: Settings;
        device: Device;
        active_scan_id: string | null;
      }>("/status"),
      api<Twin[]>("/twins"),
      api<Scan[]>("/scans"),
    ]);
    setSettings(status.settings);
    setDevice(status.device);
    setTwins(t);
    setScans(s);
    setLocked(false);
    setReady(true);
    const latest = s.find((x) => x.id === status.active_scan_id) || s[0];
    if (latest && !selectedId.current) selectScan(latest);
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!bootstrap.current) {
          bootstrap.current = (async () => {
            const token = new URLSearchParams(location.hash.slice(1)).get(
              "token",
            );
            if (token) {
              history.replaceState(null, "", location.pathname);
              await post("/auth", { key: token });
            }
          })();
        }
        await bootstrap.current;
        if (live) await load();
      } catch {
        if (live) {
          setLocked(true);
          setReady(true);
        }
      }
    })();
    return () => {
      live = false;
      stream.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!ready || locked) return;
    const timer = setInterval(() => {
      api<{ active_scan_id: string | null; device: Device }>("/status")
        .then((s) => {
          setDevice(s.device);
          if (s.active_scan_id && s.active_scan_id !== selectedId.current) {
            api<Scan>("/scans/" + s.active_scan_id)
              .then(selectScan)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [ready, locked]);
  function selectScan(s: Scan) {
    selectedId.current = s.id;
    setScan(s);
    setEvents([]);
    stream.current?.close();
    api<Event[]>("/scans/" + s.id + "/timeline")
      .then((history) => {
        if (selectedId.current === s.id)
          setEvents((current) =>
            [
              ...new Map(
                [...history, ...current].map((event) => [event.id, event]),
              ).values(),
            ].sort((a, b) => a.id - b.id),
          );
      })
      .catch(() => {});
    if (["running", "queued"].includes(s.status)) subscribe(s.id);
  }
  function subscribe(id: string) {
    stream.current?.close();
    const es = new EventSource("/api/scans/" + id + "/events");
    stream.current = es;
    es.onmessage = (message) => {
      const event = JSON.parse(message.data) as Event;
      if (selectedId.current !== id) return;
      setEvents((old) =>
        old.some((e) => e.id === event.id) ? old : [...old, event],
      );
      setScan((old) => {
        if (!old || old.id !== id) return old;
        const d = event.data;
        switch (event.kind) {
          case "point":
            return {
              ...old,
              status: "running",
              points: [
                ...old.points.filter((p) => p.angle_deg !== d.angle_deg),
                d as unknown as Scan["points"][number],
              ],
            };
          case "tilt":
            return { ...old, tilt: d as unknown as Scan["tilt"] };
          case "result":
            return { ...old, result: d as unknown as Scan["result"] };
          case "capture":
            return {
              ...old,
              images: [
                ...old.images.filter((i) => i.id !== d.id),
                d as unknown as Scan["images"][number],
              ],
            };
          case "diagnosis":
            return { ...old, diagnosis: d as unknown as Scan["diagnosis"] };
          case "work_order":
            return { ...old, work_order: d as unknown as Scan["work_order"] };
          default:
            return old;
        }
      });
    };
    es.addEventListener("end", () => {
      es.close();
      Promise.all([api<Scan>("/scans/" + id), api<Scan[]>("/scans")])
        .then(([s, all]) => {
          if (selectedId.current === id) setScan(s);
          setScans(all);
        })
        .catch((e) => setError(e.message));
    });
    es.onerror = () => {
      api<Scan>("/scans/" + id)
        .then((s) => {
          if (!["running", "queued"].includes(s.status)) {
            es.close();
            if (selectedId.current === id) setScan(s);
          }
        })
        .catch(() => {});
    };
  }
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    await action(async () => {
      const body = {
        building_id: building,
        mode,
        scenario,
        profile,
        use_ai: useAI,
        opening_depth_in: Number(manual.opening_depth_in),
        threshold_in:
          manual.threshold_in === "" ? null : Number(manual.threshold_in),
        handle_height_in:
          manual.handle_height_in === ""
            ? null
            : Number(manual.handle_height_in),
      };
      const s = await post<Scan>("/scans", body);
      selectScan(s);
      setPage("overview");
      setScanDialog(false);
      setScans((old) => [s, ...old]);
    });
  }
  const navigate = (id: Page) => {
    setPage(id);
    setMobile(false);
    setError("");
  };
  if (!ready)
    return (
      <div className="loading-screen">
        <RadarIcon className="spin" />
        <p>Opening Scout workspace…</p>
      </div>
    );
  if (locked)
    return (
      <main className="unlock">
        <div className="brand">
          <RadarIcon size={35} />
          <span>
            scout<span className="brand-radar">RADAR</span>
          </span>
        </div>
        <div className="unlock-card">
          <LockKeyhole size={30} />
          <h1>Your inspection workspace.</h1>
          <p>
            Open Scout using the launcher, or enter the access key stored on
            this laptop in <code>.scout/access-key</code>.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await post("/auth", { key });
                setKey("");
                await load();
              });
            }}
          >
            <Field label="Local access key">
              <input
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
              />
            </Field>
            <button className="primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ArrowRight size={16} />
              )}
              Open workspace
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
        <small>Local by design. Your evidence stays on your laptop.</small>
      </main>
    );
  const result = scan?.result;
  const latestStage = events.filter((e) => e.kind === "stage").at(-1);
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <RadarIcon size={30} />
          </span>
          <span>
            scout<span className="brand-radar">RADAR</span>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-avatar">S</div>
          <div>
            <strong>Scout workspace</strong>
            <small>HackPrinceton / 2026</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {pages.map(({ id, label: caption, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{caption}</span>
              {id === "orders" &&
                scans.filter((s) => s.work_order?.status === "open").length >
                  0 && (
                  <span className="nav-count">
                    {
                      scans.filter((s) => s.work_order?.status === "open")
                        .length
                    }
                  </span>
                )}
            </button>
          ))}
          <button onClick={() => location.assign("/business")}>
            <Briefcase size={18} />
            <span>Business</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span
              className={"status-dot " + (device.connected ? "green" : "")}
            />
            <strong>
              {device.connected ? "Rig connected" : "Simulator available"}
            </strong>
            <p>
              {device.connected
                ? device.port
                : "Explore the complete flow. No hardware needed."}
            </p>
            <button onClick={() => navigate("settings")}>
              Configure device <ArrowUpRight size={14} />
            </button>
          </div>
          <nav>
            <button
              className={page === "settings" ? "selected" : ""}
              onClick={() => navigate("settings")}
            >
              <SlidersHorizontal size={18} />
              Settings
            </button>
          </nav>
          <div className="local-note">
            <ShieldCheck size={14} /> Local-first inspection workspace
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={12} />
            <span>
              {page === "settings"
                ? "Settings"
                : pages.find((p) => p.id === page)?.label}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <i />
              Local workspace
            </span>
            <span className="avatar">SC</span>
          </div>
        </header>
        <main className="content">
          {error && (
            <div role="alert" className="alert error">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div className="heading-copy">
              <div className="eyebrow">
                PHYSICAL INTELLIGENCE, GROUNDED IN REALITY
              </div>
              <h1>
                {
                  {
                    overview: "See what the blueprint missed.",
                    twins: "Your baseline, in one place.",
                    history: "Every scan. Every detail.",
                    orders: "From finding to follow-through.",
                    validation: "Measure the measurement.",
                    settings: "Make Scout yours.",
                  }[page]
                }
              </h1>
              <p>
                {
                  {
                    overview:
                      "Scan the space. Understand the drift. Know what to fix.",
                    twins:
                      "Compare what was documented with what is actually there.",
                    history:
                      "A durable record of measurements, evidence, and decisions.",
                    orders:
                      "Practical next steps, linked to the evidence that matters.",
                    validation:
                      "Calibrate your rig and build an honest record of its accuracy.",
                    settings:
                      "Connect your hardware and bring your own Google credentials.",
                  }[page]
                }
              </p>
            </div>
            {page !== "settings" && (
              <button
                className="primary"
                onClick={() => setScanDialog(true)}
                disabled={active || busy}
              >
                <Plus size={17} />
                New inspection
              </button>
            )}
          </div>
          {page === "overview" && (
            <>
              <div className="context-strip">
                <div className="context-place">
                  <div className="place-icon">
                    <MapPin size={19} />
                  </div>
                  <div>
                    <strong>
                      {scan?.twin.name ||
                        twins.find((t) => t.id === building)?.name ||
                        "Select a digital twin"}
                    </strong>
                    <span>
                      {scan
                        ? date(scan.created_at)
                        : "Ready for your first inspection"}
                      <b>·</b>
                      {scan?.request.profile || "Doorway"} inspection
                    </span>
                  </div>
                </div>
                <div className="context-badges">
                  <span className="subtle-tag">
                    <FlaskConical size={13} />
                    {(scan?.request.mode || mode) === "demo"
                      ? "Demo data"
                      : "Live hardware"}
                  </span>
                  <span className="subtle-tag">
                    <Zap size={13} />
                    {scan?.agent_provider === "deepagents"
                      ? "DeepAgent + Gemini"
                      : "Deterministic workflow"}
                  </span>
                </div>
              </div>
              <div className="metrics">
                <Metric
                  title="CLEAR WIDTH"
                  value={num(result?.width_in)}
                  unit="in"
                  check={result?.checks.find((c) => c.key === "width")}
                  baseline={scan?.twin.width_in ?? 36}
                />
                <Metric
                  title="RUNNING SLOPE"
                  value={num(result?.running_slope_deg, 2)}
                  unit="°"
                  check={result?.checks.find((c) => c.key === "running_slope")}
                />
                <Metric
                  title="CROSS SLOPE"
                  value={num(result?.cross_slope_deg, 2)}
                  unit="°"
                  check={result?.checks.find((c) => c.key === "cross_slope")}
                />
                <div className="metric verdict-metric">
                  <div className="metric-label">
                    MEASURED-CHECK VERDICT <ShieldCheck size={15} />
                  </div>
                  <div
                    className={
                      "verdict-value " + (result?.verdict.toLowerCase() || "")
                    }
                  >
                    {active ? (
                      <>
                        <Activity size={24} />
                        Inspecting
                      </>
                    ) : result ? (
                      <>
                        {result.verdict === "PASS" ? (
                          <CheckCircle2 size={26} />
                        ) : (
                          <TriangleAlert size={26} />
                        )}{" "}
                        {result.verdict === "PASS"
                          ? "Pass"
                          : result.verdict === "FAIL"
                            ? "Action needed"
                            : "Verify"}
                      </>
                    ) : (
                      <>Awaiting scan</>
                    )}
                  </div>
                  <small>
                    {result
                      ? `${result.checks.filter((c) => c.status === "FAIL").length} flagged · ${result.checks.filter((c) => c.status === "NOT_MEASURED").length} unmeasured`
                      : "Your first scan starts here"}
                  </small>
                </div>
              </div>
              <div className="inspection-grid">
                <section className="panel radar-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <RadarIcon size={18} />
                        Live radar
                      </h2>
                      <p>A spatial view of the real world.</p>
                    </div>
                    <span
                      className={"live-indicator " + (active ? "running" : "")}
                    >
                      <i />
                      {active ? "SCANNING" : scan ? "SCAN COMPLETE" : "STANDBY"}
                    </span>
                  </div>
                  <Radar
                    points={scan?.points || []}
                    active={!!active}
                    angle={latestStage?.data.angle_deg as number | undefined}
                  />
                  <div className="radar-footer">
                    <div className="legend">
                      <span>
                        <i className="point-dot" />
                        Valid return
                      </span>
                      <span>
                        <i className="point-dot amber" />
                        Acoustic noise
                      </span>
                    </div>
                    <span className="mono">
                      {scan?.points.length || 0} / 37 POINTS <b>·</b> 0–180°
                    </span>
                  </div>
                  <div className="scan-progress">
                    <div
                      style={{
                        width: `${((scan?.points.length || 0) / 37) * 100}%`,
                      }}
                    />
                  </div>
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <Zap size={18} />
                        Inspection activity
                      </h2>
                      <p>
                        {scan?.agent_provider === "deepagents"
                          ? "LangChain DeepAgent tool activity"
                          : "Every decision, visible."}
                      </p>
                    </div>
                    <span className="tiny-tag">{active ? "LIVE" : "LOG"}</span>
                  </div>
                  <div className="timeline">
                    {events.filter((e) => !["point", "tilt"].includes(e.kind))
                      .length ? (
                      events
                        .filter((e) => !["point", "tilt"].includes(e.kind))
                        .map((e, i) => (
                          <div className="timeline-item" key={e.id}>
                            <span
                              className={
                                "timeline-icon " +
                                (e.kind === "complete" ? "done" : "")
                              }
                            >
                              {e.kind === "capture" ? (
                                <Camera size={13} />
                              ) : e.kind === "diagnosis" ? (
                                <Eye size={13} />
                              ) : e.kind === "complete" ? (
                                <Check size={13} />
                              ) : (
                                <Zap size={13} />
                              )}
                            </span>
                            <div>
                              <div className="timeline-title">
                                {eventTitle(e)}
                              </div>
                              <p>{eventText(e)}</p>
                              <small>
                                {new Date(e.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                                <span>
                                  STEP {String(i + 1).padStart(2, "0")}
                                </span>
                              </small>
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="activity-empty">
                        <div className="orbit">
                          <ScanLine size={27} />
                        </div>
                        <h3>
                          A little movement.
                          <br />A lot of insight.
                        </h3>
                        <p>
                          Scout scans, checks the baseline, and inspects
                          anomalies. Follow each step here.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setScanDialog(true)}
                        >
                          Run your first inspection <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                  {active && (
                    <button
                      className="stop-button"
                      onClick={() =>
                        action(async () => {
                          if (scan)
                            setScan(
                              await post("/scans/" + scan.id + "/cancel"),
                            );
                        })
                      }
                    >
                      <Square size={12} />
                      Cancel inspection
                    </button>
                  )}
                </section>
              </div>
              {scan?.error && (
                <div className="alert error">
                  <TriangleAlert size={18} />
                  {scan.error}
                </div>
              )}
              {scan?.ai_error && (
                <div className="alert warning">
                  <TriangleAlert size={18} />
                  {scan.ai_error}
                </div>
              )}
              {scan?.warnings?.map((w, i) => (
                <div className="alert warning" key={i}>
                  {w}
                </div>
              ))}
              <div className="lower-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <Layers3 size={18} />
                        Blueprint vs. reality
                      </h2>
                      <p>
                        {scan?.twin.source === "demo"
                          ? "Illustrative twin · no live provider connection"
                          : "Imported baseline · provenance retained"}
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="View digital twins"
                      onClick={() => navigate("twins")}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div className="comparison-head">
                    <span>DIMENSION</span>
                    <span>BASELINE</span>
                    <span>MEASURED</span>
                    <span>DRIFT</span>
                  </div>
                  {(
                    result?.drift || [
                      {
                        key: "width",
                        label: "Clear width",
                        expected: 36,
                        measured: null,
                        delta: null,
                        unit: "in",
                        changed: false,
                      },
                      {
                        key: "running_slope",
                        label: "Running slope",
                        expected: 3.5,
                        measured: null,
                        delta: null,
                        unit: "deg",
                        changed: false,
                      },
                      {
                        key: "cross_slope",
                        label: "Cross slope",
                        expected: 0.4,
                        measured: null,
                        delta: null,
                        unit: "deg",
                        changed: false,
                      },
                    ]
                  ).map((d) => (
                    <div className="comparison-row" key={d.key}>
                      <strong>{d.label}</strong>
                      <span>
                        {num(d.expected)}{" "}
                        <small>{d.unit === "deg" ? "°" : d.unit}</small>
                      </span>
                      <span>
                        {num(d.measured)}{" "}
                        <small>{d.unit === "deg" ? "°" : d.unit}</small>
                      </span>
                      <span className={d.changed ? "drift-changed" : "muted"}>
                        {d.delta === null
                          ? "—"
                          : (d.delta > 0 ? "+" : "") + d.delta.toFixed(1)}
                        {d.delta !== null && (
                          <small> {d.unit === "deg" ? "°" : d.unit}</small>
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="panel-note">
                    <span className="status-dot" />A passing measurement can
                    still differ from the blueprint.
                  </div>
                </section>
                <section className="panel evidence-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <Eye size={18} />
                        Visual evidence
                      </h2>
                      <p>
                        {scan?.diagnosis
                          ? label(scan.diagnosis.provider)
                          : "A closer look at the cause."}
                      </p>
                    </div>
                    {scan?.images.length ? (
                      <span className="tiny-tag">
                        {scan.images[0].angle_deg}° AIM
                      </span>
                    ) : null}
                  </div>
                  {scan?.images.length ? (
                    <div className="evidence-content">
                      <img
                        src={scan.images.at(-1)!.url}
                        alt={
                          scan.images.at(-1)!.simulated
                            ? "Simulated camera illustration of the inspection fixture"
                            : "Camera capture at the anomaly angle"
                        }
                      />
                      <div>
                        <span className="eyebrow">
                          {scan.images.at(-1)!.simulated
                            ? "SIMULATED EVIDENCE"
                            : "CAPTURED EVIDENCE"}
                        </span>
                        <h3>
                          {scan.diagnosis?.obstruction ||
                            "Ready for visual review"}
                        </h3>
                        <p>
                          {scan.diagnosis?.limitations ||
                            "Enable Gemini to classify this image, or review it manually."}
                        </p>
                        {scan.diagnosis && (
                          <span className="subtle-tag">
                            {label(scan.diagnosis.classification)}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="evidence-empty">
                      <Camera size={26} />
                      <div>
                        <h3>Evidence, when it matters.</h3>
                        <p>
                          Scout aims the camera when it finds a failure or
                          uncertain reading.
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              </div>
              {result && (
                <section className="panel checks-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <ShieldCheck size={18} />
                        Deterministic checks
                      </h2>
                      <p>
                        Thresholds are defined in code. AI never changes the
                        verdict.
                      </p>
                    </div>
                    {scan?.work_order && (
                      <a
                        className="secondary compact"
                        href={"/api/scans/" + scan.id + "/report.pdf"}
                      >
                        <Download size={15} />
                        Work order PDF
                      </a>
                    )}
                  </div>
                  <div className="check-list">
                    {result.checks.map((c) => (
                      <div className="check-row" key={c.key}>
                        <Badge value={c.status} />
                        <strong>{c.label}</strong>
                        <span>
                          {c.value === null
                            ? "Not measured"
                            : `${num(c.value, 2)} ± ${num(c.error, 2)} ${c.unit}`}
                        </span>
                        <span className="muted">
                          {c.minimum !== null ? `Min ${num(c.minimum, 2)}` : ""}
                          {c.minimum !== null && c.maximum !== null
                            ? " / "
                            : ""}
                          {c.maximum !== null ? `Max ${num(c.maximum, 2)}` : ""}{" "}
                          {c.unit}
                        </span>
                        <a href={c.source} target="_blank" rel="noreferrer">
                          §{c.section}
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    ))}
                  </div>
                  {result.issues.length > 0 && (
                    <div className="quality-notes">
                      {result.issues.map((i) => (
                        <p key={i}>
                          <TriangleAlert size={13} />
                          {i}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="panel-note">
                    {result.scope} Doorway threshold bevels, operating force,
                    maneuvering clearances, and other requirements need separate
                    review.
                  </div>
                </section>
              )}
              <div className="workspace-footer">
                <span>
                  <ShieldCheck size={13} /> Evidence stays local. Google
                  receives images only when AI is enabled.
                </span>
                <span>SCOUT RADAR / MVP 1.0</span>
              </div>
            </>
          )}
          {page === "twins" && (
            <Twins
              twins={twins}
              onSave={async (t) => {
                await post("/twins", t);
                setTwins(await api("/twins"));
                notify("Digital twin saved.");
              }}
              onInspect={(id) => {
                setBuilding(id);
                setScanDialog(true);
              }}
              onError={setError}
            />
          )}
          {page === "history" && (
            <section className="panel">
              {scans.length ? (
                <>
                  <div className="panel-heading">
                    <h2>
                      Inspection history{" "}
                      <span className="count">{scans.length}</span>
                    </h2>
                    <button
                      className="secondary compact"
                      onClick={() =>
                        action(async () => setScans(await api("/scans")))
                      }
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>LOCATION</th>
                          <th>INPUT</th>
                          <th>WHEN</th>
                          <th>WIDTH</th>
                          <th>RESULT</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {scans.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <strong>{s.twin.name}</strong>
                              <small>
                                {s.request.profile} · {s.id.slice(0, 8)}
                              </small>
                            </td>
                            <td>
                              <span className="subtle-tag">
                                {s.request.mode === "demo"
                                  ? "Simulation"
                                  : "Hardware"}
                              </span>
                            </td>
                            <td>{date(s.created_at)}</td>
                            <td className="mono">
                              {num(s.result?.width_in)} in
                            </td>
                            <td>
                              <Badge value={s.result?.verdict || s.status} />
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => {
                                  selectScan(s);
                                  navigate("overview");
                                }}
                              >
                                View <ArrowUpRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Empty icon={History} title="Your record starts with a scan.">
                  Run an inspection and find its measurements, evidence, and
                  timeline here.
                </Empty>
              )}
            </section>
          )}
          {page === "orders" && (
            <Orders
              scans={scans}
              onView={(s) => {
                selectScan(s);
                navigate("overview");
              }}
              onUpdate={async (s, status, assignee, notes) => {
                await patch("/scans/" + s.id + "/work-order", {
                  status,
                  assignee,
                  notes,
                });
                setScans(await api("/scans"));
                if (scan?.id === s.id) setScan(await api("/scans/" + s.id));
                notify("Work order updated.");
              }}
              onError={setError}
            />
          )}
          {page === "validation" && (
            <Calibration
              settings={settings!}
              onChange={setSettings}
              onError={setError}
              notify={notify}
            />
          )}
          {page === "settings" && (
            <SettingsPanel
              settings={settings!}
              setSettings={setSettings}
              device={device}
              setDevice={setDevice}
              twins={twins}
              onError={setError}
              notify={notify}
              busyScan={!!active}
            />
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {scanDialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setScanDialog(false);
          }}
        >
          <section
            className="modal"
            onKeyDown={dialogKeys}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-scan-title"
          >
            <div className="modal-heading">
              <div className="modal-icon">
                <ScanLine size={25} />
              </div>
              <button
                className="icon-button"
                aria-label="Close new inspection"
                onClick={() => setScanDialog(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="new-scan-title">Let’s read the room.</h2>
            <p>
              Choose a baseline and inspection mode. Scout handles the rest.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start();
              }}
            >
              <Field label="Digital twin">
                <select
                  autoFocus
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                >
                  {twins.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="segmented">
                <button
                  type="button"
                  className={mode === "demo" ? "selected" : ""}
                  onClick={() => setMode("demo")}
                >
                  <FlaskConical size={16} />
                  Demo simulator
                </button>
                <button
                  type="button"
                  className={mode === "hardware" ? "selected" : ""}
                  onClick={() => setMode("hardware")}
                >
                  <Plug size={16} />
                  Live hardware
                </button>
              </div>
              <div className="form-grid">
                <Field label="Inspection profile">
                  <select
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                  >
                    <option value="doorway">Doorway</option>
                    <option value="ramp">Ramp</option>
                    <option value="corridor">Corridor</option>
                  </select>
                </Field>
                {mode === "demo" ? (
                  <Field label="Demo scenario">
                    <select
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value)}
                    >
                      <option value="obstructed">Obstructed · fail</option>
                      <option value="clear">Clear · pass</option>
                      <option value="borderline">Borderline · verify</option>
                      <option value="noisy">Noisy returns · verify</option>
                    </select>
                  </Field>
                ) : (
                  <Field label="Serial device">
                    <input
                      value={settings?.serial_port || "Set a port in Settings"}
                      disabled
                    />
                  </Field>
                )}
              </div>
              {profile === "doorway" && (
                <details className="advanced">
                  <summary>Optional manual measurements</summary>
                  <div className="form-grid">
                    <Field label="Opening depth (in)">
                      <input
                        type="number"
                        min="0"
                        max="240"
                        step="0.01"
                        value={manual.opening_depth_in}
                        onChange={(e) =>
                          setManual({
                            ...manual,
                            opening_depth_in: e.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                    <Field label="Threshold height (in)">
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.01"
                        placeholder="Not measured"
                        value={manual.threshold_in}
                        onChange={(e) =>
                          setManual({ ...manual, threshold_in: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Handle height (in)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="Not measured"
                        value={manual.handle_height_in}
                        onChange={(e) =>
                          setManual({
                            ...manual,
                            handle_height_in: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                </details>
              )}
              <label className="toggle-card">
                <span>
                  <strong>
                    <Zap size={16} />
                    Use DeepAgent + Gemini
                  </strong>
                  <small>
                    {settings?.gemini_api_key_configured
                      ? "Google will receive the captured image and measurements."
                      : "Add a Gemini API key in Settings to enable."}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={useAI}
                  disabled={!settings?.gemini_api_key_configured}
                  onChange={(e) => setUseAI(e.target.checked)}
                />
              </label>
              <div className="info-note">
                {mode === "demo"
                  ? "Simulation uses generated measurements and an illustrated camera frame. It is always labeled as demo data."
                  : "Align the base, clear the servo sweep, and keep the rig still. Hardware must be calibrated before trusting the result."}
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-footer">
                <span>
                  <Radio size={14} />
                  37 angles · 180° sweep
                </span>
                <button className="primary" disabled={busy || active}>
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Play size={15} />
                  )}
                  Start inspection
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function Metric({
  title,
  value,
  unit,
  check,
  baseline,
}: {
  title: string;
  value: string;
  unit: string;
  check?: RuleCheck;
  baseline?: number;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {title}
        <ScanLine size={14} />
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
        {check && (
          <span className={"metric-dot " + check.status.toLowerCase()} />
        )}
      </div>
      <small>
        {check
          ? `${check.minimum !== null ? "Min " + num(check.minimum) : "Max " + num(check.maximum, 2)} ${check.unit} · ±${num(check.error, 2)}`
          : baseline
            ? `Digital twin: ${num(baseline)} in`
            : "Observed tilt · profile-dependent check"}
      </small>
    </div>
  );
}
function eventTitle(e: Event) {
  return (
    {
      agent: "Inspection plan",
      stage:
        e.data.stage === "scanning" ? "Radar sweep" : "Targeted inspection",
      tool: label(String(e.data.name || "Tool call")),
      result: "Measurements evaluated",
      capture: "Camera frame captured",
      diagnosis: "Visual diagnosis",
      work_order: "Work order published",
      complete:
        e.data.status === "completed"
          ? "Inspection complete"
          : label(String(e.data.status)),
      notice: "Operator attention",
      order_updated: "Work order updated",
    }[e.kind] || label(e.kind)
  );
}
function eventText(e: Event) {
  if (e.data.message) return String(e.data.message);
  if (e.kind === "result")
    return `${e.data.verdict} · deterministic measurement checks`;
  if (e.kind === "capture")
    return `Aimed at ${e.data.angle_deg}° · ${e.data.simulated ? "simulated frame" : "USB camera"}`;
  if (e.kind === "diagnosis") return String(e.data.obstruction);
  if (e.kind === "work_order") return String(e.data.id);
  if (e.kind === "complete")
    return String(e.data.error || "Evidence and results saved locally.");
  return "";
}
function Twins({
  twins,
  onSave,
  onInspect,
  onError,
}: {
  twins: Twin[];
  onSave: (t: Twin) => Promise<void>;
  onInspect: (id: string) => void;
  onError: (s: string) => void;
}) {
  const [editing, setEditing] = useState<Twin | null>(null),
    [saving, setSaving] = useState(false);
  const fresh: Twin = {
    id: "entrance-" + Date.now().toString(36),
    name: "",
    location: "",
    source: "manual",
    source_reference: "",
    width_in: 36,
    running_slope_deg: 0,
    cross_slope_deg: 0,
    captured_at: new Date().toISOString().slice(0, 10),
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await onSave(editing);
      setEditing(null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function importFile(file: File) {
    try {
      if (file.size > 100000)
        throw new Error("Twin JSON must be smaller than 100 KB.");
      const data = JSON.parse(await file.text());
      if (!data || Array.isArray(data) || typeof data !== "object")
        throw new Error(
          "Import a single twin object. See docs/twin.example.json.",
        );
      await onSave(data);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <>
      <div className="section-toolbar">
        <p>
          <Layers3 size={16} />
          {twins.length} baseline{twins.length !== 1 ? "s" : ""} available
        </p>
        <div>
          <label className="secondary compact file-button">
            <FileJson size={15} />
            Import JSON
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                if (e.target.files?.[0]) importFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button className="primary compact" onClick={() => setEditing(fresh)}>
            <Plus size={16} />
            Add baseline
          </button>
        </div>
      </div>
      <div className="twin-grid">
        {twins.map((t) => (
          <article className="panel twin-card" key={t.id}>
            <div className="twin-visual">
              <svg viewBox="0 0 280 110" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M45 90V20h65v70M170 90V20h65v70M45 20l22-12h65v70l-22 12M170 20l22-12h65v70l-22 12M45 90h65M170 90h65M110 90h60" />
                  <path d="M115 55h50m-50-4v8m50-8v8" />
                  <path d="M55 100h170" strokeDasharray="3 3" />
                </g>
                <text
                  x="140"
                  y="47"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="11"
                >
                  {t.width_in.toFixed(1)} IN
                </text>
              </svg>
              <span className="subtle-tag">{label(t.source)}</span>
            </div>
            <div className="twin-body">
              <h3>{t.name}</h3>
              <p>
                <MapPin size={13} />
                {t.location || "Location not specified"}
              </p>
              <div className="twin-specs">
                <div>
                  <small>CLEAR WIDTH</small>
                  <strong>
                    {num(t.width_in)} <span>in</span>
                  </strong>
                </div>
                <div>
                  <small>RUNNING SLOPE</small>
                  <strong>
                    {num(t.running_slope_deg)}
                    <span>°</span>
                  </strong>
                </div>
                <div>
                  <small>CROSS SLOPE</small>
                  <strong>
                    {num(t.cross_slope_deg)}
                    <span>°</span>
                  </strong>
                </div>
              </div>
              <p className="source-note">
                {t.source_reference || "Manual baseline"}
                <br />
                {t.captured_at && "Recorded " + t.captured_at}
              </p>
              <div className="card-actions">
                <button
                  className="text-button"
                  onClick={() => setEditing({ ...t })}
                >
                  Edit baseline
                </button>
                <button
                  className="secondary compact"
                  onClick={() => onInspect(t.id)}
                >
                  Inspect <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="info-note">
        <Layers3 size={17} />
        <span>
          Import authorized CoStar or Matterport data as a normalized JSON
          baseline. Scout preserves the source and reference; it does not claim
          a live provider connection or update external property records.
        </span>
      </div>
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal"
            onKeyDown={dialogKeys}
            role="dialog"
            aria-modal="true"
            aria-labelledby="twin-title"
          >
            <div className="modal-heading">
              <h2 id="twin-title">Digital twin baseline</h2>
              <button
                className="icon-button"
                aria-label="Close baseline editor"
                onClick={() => setEditing(null)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={save}>
              <Field label="Name">
                <input
                  autoFocus
                  value={editing.name}
                  maxLength={120}
                  required
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Location">
                <input
                  value={editing.location}
                  onChange={(e) =>
                    setEditing({ ...editing, location: e.target.value })
                  }
                />
              </Field>
              <div className="form-grid">
                <Field label="Record ID">
                  <input
                    required
                    pattern="[a-zA-Z0-9_-]{1,64}"
                    value={editing.id}
                    onChange={(e) =>
                      setEditing({ ...editing, id: e.target.value })
                    }
                  />
                </Field>
                <Field label="Source">
                  <select
                    value={editing.source}
                    onChange={(e) =>
                      setEditing({ ...editing, source: e.target.value })
                    }
                  >
                    {[
                      "manual",
                      "matterport_export",
                      "costar_export",
                      "demo",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-grid three">
                <Field label="Width (in)">
                  <input
                    type="number"
                    min=".1"
                    max="250"
                    step=".01"
                    required
                    value={editing.width_in}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        width_in: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Running slope (°)">
                  <input
                    type="number"
                    min="0"
                    max="45"
                    step=".01"
                    value={editing.running_slope_deg}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        running_slope_deg: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Cross slope (°)">
                  <input
                    type="number"
                    min="0"
                    max="45"
                    step=".01"
                    value={editing.cross_slope_deg}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        cross_slope_deg: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Source reference">
                <input
                  placeholder="Model ID, export filename, or measurement notes"
                  value={editing.source_reference}
                  onChange={(e) =>
                    setEditing({ ...editing, source_reference: e.target.value })
                  }
                />
              </Field>
              <Field label="Record date">
                <input
                  type="date"
                  value={editing.captured_at}
                  onChange={(e) =>
                    setEditing({ ...editing, captured_at: e.target.value })
                  }
                />
              </Field>
              <div className="modal-footer">
                <small>Existing scans retain their original baseline.</small>
                <button className="primary" disabled={saving}>
                  Save baseline
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
function Orders({
  scans,
  onView,
  onUpdate,
  onError,
}: {
  scans: Scan[];
  onView: (s: Scan) => void;
  onUpdate: (
    s: Scan,
    status: string,
    assignee: string,
    notes: string,
  ) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [editing, setEditing] = useState<Scan | null>(null),
    [status, setStatus] = useState("open"),
    [assignee, setAssignee] = useState(""),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false);
  const orders = scans.filter((s) => s.work_order);
  return (
    <>
      {orders.length ? (
        <div className="orders-list">
          {orders.map((s) => (
            <section className="panel order-card" key={s.id}>
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">
                    {s.work_order!.id} <b>·</b>{" "}
                    {s.request.mode === "demo" ? "DEMO" : "HARDWARE"}
                  </div>
                  <h2>{s.twin.name}</h2>
                  <p>
                    {date(s.created_at)} ·{" "}
                    {s.work_order!.assignee || "Unassigned"}
                  </p>
                </div>
                <Badge value={s.work_order!.status} />
              </div>
              <div className="order-body">
                <p>{s.work_order!.summary}</p>
                <div className="order-actions-list">
                  {s.work_order!.actions.map((a, i) => (
                    <div key={i}>
                      <span className="action-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3>{a.title}</h3>
                        <p>{a.detail}</p>
                        <small>
                          {a.estimate_low === null
                            ? "Estimate requires review"
                            : `Illustrative range: $${a.estimate_low.toLocaleString()}–$${a.estimate_high?.toLocaleString()}`}{" "}
                          <b>·</b> {a.rule}
                        </small>
                      </div>
                      <span className={"priority " + a.priority}>
                        {a.priority}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="info-note">{s.work_order!.cost_note}</div>
                {s.work_order!.notes && (
                  <p className="operator-notes">{s.work_order!.notes}</p>
                )}
                <div className="card-actions">
                  <button className="text-button" onClick={() => onView(s)}>
                    View evidence <ArrowUpRight size={14} />
                  </button>
                  <div>
                    <a
                      className="secondary compact"
                      href={"/api/scans/" + s.id + "/report.pdf"}
                    >
                      <Download size={15} />
                      PDF
                    </a>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditing(s);
                        setStatus(s.work_order!.status);
                        setAssignee(s.work_order!.assignee);
                        setNotes(s.work_order!.notes);
                      }}
                    >
                      Update status
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty icon={ClipboardList} title="The next step, already organized.">
            Finish an inspection to generate a work order with findings,
            recommendations, and planning estimates.
          </Empty>
        </section>
      )}
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal"
            onKeyDown={dialogKeys}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-title"
          >
            <div className="modal-heading">
              <h2 id="order-title">Update {editing.work_order!.id}</h2>
              <button
                className="icon-button"
                aria-label="Close work order"
                onClick={() => setEditing(null)}
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                try {
                  await onUpdate(editing, status, assignee, notes);
                  setEditing(null);
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </Field>
              <Field label="Assignee">
                <input
                  autoFocus
                  maxLength={100}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                />
              </Field>
              <Field label="Notes">
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              <div className="info-note">
                Resolving a work order records completion; it does not change
                the original inspection verdict. Run a new scan to verify the
                fix.
              </div>
              <div className="modal-footer">
                <span />
                <button className="primary" disabled={saving}>
                  Save changes
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
function SettingsPanel({
  settings,
  setSettings,
  device,
  setDevice,
  twins,
  onError,
  notify,
  busyScan,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  device: Device;
  setDevice: (d: Device) => void;
  twins: Twin[];
  onError: (s: string) => void;
  notify: (s: string) => void;
  busyScan: boolean;
}) {
  const [draft, setDraft] = useState(settings),
    [gemini, setGemini] = useState(""),
    [visionKey, setVisionKey] = useState(""),
    [ports, setPorts] = useState<{ device: string; description: string }[]>([]),
    [busy, setBusy] = useState(false),
    [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    api<typeof ports>("/hardware/ports")
      .then(setPorts)
      .catch((e) => onError(e.message));
  }, []);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await task(async () => {
      const {
        gemini_api_key_configured,
        google_vision_api_key_configured,
        ...values
      } = draft;
      const body = {
        ...values,
        ...(gemini ? { gemini_api_key: gemini } : {}),
        ...(visionKey ? { google_vision_api_key: visionKey } : {}),
      };
      const next = await patch<Settings>("/settings", body);
      setSettings(next);
      setDraft(next);
      setGemini("");
      setVisionKey("");
      notify("Settings saved locally.");
    });
  }
  return (
    <div className="settings-grid">
      <div className="settings-main">
        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <h2>
                <Zap size={18} />
                AI & vision
              </h2>
              <p>
                Real DeepAgents orchestration. Google multimodal inspection.
              </p>
            </div>
            <Badge
              value={
                settings.gemini_api_key_configured
                  ? "configured"
                  : "setup required"
              }
            />
          </div>
          <div className="settings-body">
            <Field
              label="Gemini API key"
              hint="Stored locally with owner-only file permissions. Never returned to the browser."
            >
              <input
                type="password"
                autoComplete="off"
                value={gemini}
                onChange={(e) => setGemini(e.target.value)}
                placeholder={
                  settings.gemini_api_key_configured
                    ? "Key saved · enter a new key to replace"
                    : "Paste your Gemini API key"
                }
              />
            </Field>
            <div className="inline-links">
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Create a Gemini key <ExternalLink size={12} />
              </a>
              {settings.gemini_api_key_configured && (
                <button
                  className="text-button danger-text"
                  onClick={() =>
                    task(async () => {
                      const s = await patch<Settings>("/settings", {
                        gemini_api_key: "",
                      });
                      setSettings(s);
                      setDraft(s);
                      notify("Gemini key removed.");
                    })
                  }
                >
                  Remove key
                </button>
              )}
            </div>
            <Field
              label="Gemini model"
              hint="Used for both DeepAgent reasoning and visual diagnosis. Set a model available to your account."
            >
              <input
                value={draft.gemini_model}
                onChange={(e) =>
                  setDraft({ ...draft, gemini_model: e.target.value })
                }
              />
            </Field>
            <Field
              label="Google Cloud Vision key (optional)"
              hint="Adds object localization to Gemini’s diagnosis. Enable Cloud Vision API and billing in the key’s Google Cloud project."
            >
              <input
                type="password"
                autoComplete="off"
                value={visionKey}
                onChange={(e) => setVisionKey(e.target.value)}
                placeholder={
                  settings.google_vision_api_key_configured
                    ? "Key saved · enter a new key to replace"
                    : "Optional Cloud Vision API key"
                }
              />
            </Field>
            <div className="inline-links">
              <a
                href="https://console.cloud.google.com/apis/library/vision.googleapis.com"
                target="_blank"
                rel="noreferrer"
              >
                Enable Cloud Vision <ExternalLink size={12} />
              </a>
              {settings.google_vision_api_key_configured && (
                <button
                  className="text-button danger-text"
                  onClick={() =>
                    task(async () => {
                      const s = await patch<Settings>("/settings", {
                        google_vision_api_key: "",
                      });
                      setSettings(s);
                      setDraft(s);
                      notify("Cloud Vision key removed.");
                    })
                  }
                >
                  Remove key
                </button>
              )}
            </div>
            <div className="card-actions">
              <button
                className="secondary compact"
                disabled={busy || !settings.gemini_api_key_configured}
                onClick={() =>
                  task(async () => setTest(await post("/settings/test-google")))
                }
              >
                <RefreshCw size={14} />
                Test saved Gemini key
              </button>
              <small>Save changes before testing</small>
            </div>
            {test && (
              <div
                className={"info-note " + (test.ok ? "success-text" : "error")}
              >
                {test.ok ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <TriangleAlert size={16} />
                )}
                <span>{test.message}</span>
              </div>
            )}
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <h2>
                <Plug size={18} />
                Arduino & camera
              </h2>
              <p>
                USB serial at 115200 baud. A webcam connected to this laptop.
              </p>
            </div>
            <Badge value={device.connected ? "connected" : "disconnected"} />
          </div>
          <div className="settings-body">
            <Field label="Serial port">
              <div className="input-action">
                <select
                  value={draft.serial_port}
                  onChange={(e) =>
                    setDraft({ ...draft, serial_port: e.target.value })
                  }
                >
                  <option value="">Select an Arduino port</option>
                  {draft.serial_port &&
                    !ports.find((p) => p.device === draft.serial_port) && (
                      <option value={draft.serial_port}>
                        {draft.serial_port}
                      </option>
                    )}
                  {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                      {p.device} · {p.description}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  aria-label="Refresh ports"
                  onClick={() =>
                    task(async () => setPorts(await api("/hardware/ports")))
                  }
                >
                  <RefreshCw size={17} />
                </button>
              </div>
            </Field>
            <Field
              label="Camera index"
              hint="Start with 0. Use 1 if the built-in camera occupies index 0."
            >
              <input
                type="number"
                min="0"
                max="10"
                value={draft.camera_index}
                onChange={(e) =>
                  setDraft({ ...draft, camera_index: Number(e.target.value) })
                }
              />
            </Field>
            <div className="card-actions">
              <button
                className="secondary compact"
                disabled={busy || busyScan}
                onClick={() =>
                  task(async () => {
                    if (!device.connected) {
                      const s = await patch<Settings>("/settings", {
                        serial_port: draft.serial_port,
                        camera_index: draft.camera_index,
                      });
                      setSettings(s);
                      setDraft(s);
                    }
                    setDevice(
                      await post(
                        "/hardware/" +
                          (device.connected ? "disconnect" : "connect"),
                      ),
                    );
                    notify(
                      device.connected
                        ? "Device disconnected."
                        : "Device connected.",
                    );
                  })
                }
              >
                <Plug size={14} />
                {device.connected ? "Disconnect" : "Connect device"}
              </button>
              <span className="muted">
                {device.port || "No device connected"}
              </span>
            </div>
            {device.error && <p className="error">{device.error}</p>}
            <label className="toggle-card">
              <span>
                <strong>Enable physical start button</strong>
                <small>
                  D2 button starts an inspection while the backend is running.
                </small>
              </span>
              <input
                type="checkbox"
                checked={draft.button_enabled}
                onChange={(e) =>
                  setDraft({ ...draft, button_enabled: e.target.checked })
                }
              />
            </label>
            {draft.button_enabled && (
              <>
                <div className="form-grid">
                  <Field label="Button’s baseline">
                    <select
                      value={draft.button_building_id}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          button_building_id: e.target.value,
                        })
                      }
                    >
                      {twins.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Button’s profile">
                    <select
                      value={draft.button_profile}
                      onChange={(e) =>
                        setDraft({ ...draft, button_profile: e.target.value })
                      }
                    >
                      {["doorway", "ramp", "corridor"].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={draft.button_use_ai}
                    disabled={!settings.gemini_api_key_configured}
                    onChange={(e) =>
                      setDraft({ ...draft, button_use_ai: e.target.checked })
                    }
                  />
                  Use DeepAgent + Gemini for physical-button scans
                </label>
              </>
            )}
          </div>
        </section>
        <div className="sticky-save">
          <span>Changes apply to the next inspection.</span>
          <button
            className="primary"
            disabled={busy || busyScan}
            onClick={save}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Check size={16} />
            )}
            Save settings
          </button>
        </div>
      </div>
      <aside className="settings-aside">
        <section className="panel guidance-card">
          <div className="guidance-icon">
            <ShieldCheck size={25} />
          </div>
          <h3>
            Your rig.
            <br />
            Your data.
          </h3>
          <p>
            Measurements, images, credentials, and reports stay in this
            project’s local <code>.scout</code> folder.
          </p>
          <hr />
          <h4>When AI is enabled</h4>
          <p>
            Google receives the inspection’s captured images, baseline, and
            measurements. Provider charges may apply.
          </p>
          <h4>What Scout generates</h4>
          <p>
            Your local access key is generated automatically. Gemini and Cloud
            Vision keys come from your Google account.
          </p>
          <h4>Hardware setup</h4>
          <p>
            Flash <code>firmware/scout_radar/scout_radar.ino</code>, connect
            USB, choose the port, and calibrate before your first live
            inspection.
          </p>
          <a
            className="text-button"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            Explore the API <ArrowUpRight size={14} />
          </a>
        </section>
        <button
          className="secondary logout"
          onClick={() =>
            task(async () => {
              await api("/auth", { method: "DELETE" });
              location.reload();
            })
          }
        >
          <LogOut size={15} />
          Lock workspace
        </button>
      </aside>
    </div>
  );
}
function Calibration({
  settings,
  onChange,
  onError,
  notify,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onError: (s: string) => void;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<Validation | null>(null),
    [flip, setFlip] = useState({
      forward_pitch: "",
      reverse_pitch: "",
      forward_roll: "",
      reverse_roll: "",
    }),
    [offsets, setOffsets] = useState({
      turret_offset_cm: settings.turret_offset_cm,
      alignment_deg: settings.alignment_deg,
      width_error_cm: settings.width_error_cm,
      slope_error_deg: settings.slope_error_deg,
      calibration_verified: settings.calibration_verified,
    }),
    [trial, setTrial] = useState({
      metric: "width_cm",
      reference: "",
      measured: "",
      notes: "",
    }),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Validation>("/validation")
      .then(setData)
      .catch((e) => onError(e.message));
  }, []);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="info-note">
        <FlaskConical size={18} />
        <span>
          Error bounds start as provisional targets from the project plan.
          Validate them on your assembled rig; Scout never invents trial results
          or claims measured accuracy before you record evidence.
        </span>
      </div>
      <div className="calibration-grid">
        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <h2>01 / Flip calibration</h2>
              <p>Cancel the IMU’s zero-offset bias.</p>
            </div>
            <RefreshCw size={18} />
          </div>
          <div className="settings-body">
            <p className="muted">
              Record signed pitch and roll, rotate the base 180° on the same
              plane, and record again. Bias = (forward + reverse) / 2.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                task(async () => {
                  const result = await post<{
                    pitch_bias_deg: number;
                    roll_bias_deg: number;
                  }>(
                    "/calibration/flip",
                    Object.fromEntries(
                      Object.entries(flip).map(([k, v]) => [k, Number(v)]),
                    ),
                  );
                  onChange(await api("/settings"));
                  setOffsets((o) => ({ ...o, calibration_verified: false }));
                  notify(
                    `Bias saved: pitch ${num(result.pitch_bias_deg, 2)}°, roll ${num(result.roll_bias_deg, 2)}°`,
                  );
                });
              }}
            >
              <div className="form-grid">
                {Object.entries(flip).map(([k, v]) => (
                  <Field key={k} label={label(k) + " (°)"}>
                    <input
                      type="number"
                      required
                      min="-45"
                      max="45"
                      step=".001"
                      value={v}
                      onChange={(e) =>
                        setFlip({ ...flip, [k]: e.target.value })
                      }
                    />
                  </Field>
                ))}
              </div>
              <p className="current-bias">
                Current bias{" "}
                <span>Pitch {num(settings.pitch_bias_deg, 2)}°</span>
                <span>Roll {num(settings.roll_bias_deg, 2)}°</span>
              </p>
              <button className="secondary" disabled={busy}>
                Calculate & save bias <ArrowRight size={15} />
              </button>
            </form>
          </div>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading">
            <div>
              <h2>02 / Geometry & uncertainty</h2>
              <p>Make the measurement match the mount.</p>
            </div>
            <ScanLine size={18} />
          </div>
          <form
            className="settings-body"
            onSubmit={(e) => {
              e.preventDefault();
              task(async () => {
                onChange(await patch("/settings", offsets));
                notify("Calibration settings saved.");
              });
            }}
          >
            <div className="form-grid">
              <Field label="Turret offset (cm)">
                <input
                  type="number"
                  step=".01"
                  min="-10"
                  max="20"
                  value={offsets.turret_offset_cm}
                  onChange={(e) =>
                    setOffsets({
                      ...offsets,
                      turret_offset_cm: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Alignment correction (°)">
                <input
                  type="number"
                  step=".01"
                  min="-15"
                  max="15"
                  value={offsets.alignment_deg}
                  onChange={(e) =>
                    setOffsets({
                      ...offsets,
                      alignment_deg: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Width error bound (cm)">
                <input
                  type="number"
                  step=".01"
                  min=".1"
                  max="20"
                  value={offsets.width_error_cm}
                  onChange={(e) =>
                    setOffsets({
                      ...offsets,
                      width_error_cm: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Slope error bound (°)">
                <input
                  type="number"
                  step=".01"
                  min=".05"
                  max="5"
                  value={offsets.slope_error_deg}
                  onChange={(e) =>
                    setOffsets({
                      ...offsets,
                      slope_error_deg: Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={offsets.calibration_verified}
                onChange={(e) =>
                  setOffsets({
                    ...offsets,
                    calibration_verified: e.target.checked,
                  })
                }
              />
              I verified these bounds against physical reference measurements.
            </label>
            <div className="info-note">
              Overlapping a threshold produces VERIFY. Missing calibration
              prevents a hardware PASS.
            </div>
            <button className="secondary" disabled={busy}>
              Save geometry <Check size={15} />
            </button>
          </form>
        </section>
      </div>
      <section className="panel settings-card">
        <div className="panel-heading">
          <div>
            <h2>03 / Ground-truth trials</h2>
            <p>Compare with a tape measure or calibrated inclinometer.</p>
          </div>
          <a className="secondary compact" href="/api/validation/export.csv">
            <Download size={15} />
            Export CSV
          </a>
        </div>
        <div className="settings-body">
          <div className="trial-summary">
            {Object.entries(data?.summary || {}).map(([k, v]) => (
              <div key={k}>
                <small>{label(k)}</small>
                <strong>
                  {v.count} <span>trials</span>
                </strong>
                <p>
                  MAE {num(v.mean_absolute_error, 3)} · Max{" "}
                  {num(v.max_absolute_error, 3)}
                </p>
              </div>
            ))}
          </div>
          <form
            className="trial-form"
            onSubmit={(e) => {
              e.preventDefault();
              task(async () => {
                await post("/validation", {
                  ...trial,
                  reference: Number(trial.reference),
                  measured: Number(trial.measured),
                });
                setData(await api("/validation"));
                setTrial({ ...trial, reference: "", measured: "", notes: "" });
                notify("Validation trial recorded.");
              });
            }}
          >
            <Field label="Metric">
              <select
                value={trial.metric}
                onChange={(e) => setTrial({ ...trial, metric: e.target.value })}
              >
                <option value="width_cm">Width · cm</option>
                <option value="running_slope_deg">Running slope · °</option>
                <option value="cross_slope_deg">Cross slope · °</option>
              </select>
            </Field>
            <Field label="Reference">
              <input
                type="number"
                step=".001"
                min="0"
                max="500"
                required
                value={trial.reference}
                onChange={(e) =>
                  setTrial({ ...trial, reference: e.target.value })
                }
              />
            </Field>
            <Field label="Scout reading">
              <input
                type="number"
                step=".001"
                min="0"
                max="500"
                required
                value={trial.measured}
                onChange={(e) =>
                  setTrial({ ...trial, measured: e.target.value })
                }
              />
            </Field>
            <Field label="Trial notes">
              <input
                maxLength={500}
                value={trial.notes}
                onChange={(e) => setTrial({ ...trial, notes: e.target.value })}
                placeholder="Setup, reference instrument…"
              />
            </Field>
            <button className="primary compact" disabled={busy}>
              <Plus size={15} />
              Add trial
            </button>
          </form>
          {data?.trials.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>METRIC</th>
                    <th>REFERENCE</th>
                    <th>SCOUT</th>
                    <th>ABS. ERROR</th>
                    <th>NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trials.map((t) => (
                    <tr key={t.id}>
                      <td>{label(t.metric)}</td>
                      <td className="mono">{num(t.reference, 3)}</td>
                      <td className="mono">{num(t.measured, 3)}</td>
                      <td className="mono">
                        {num(Math.abs(t.measured - t.reference), 3)}
                      </td>
                      <td>{t.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={FlaskConical}
              title="Evidence starts with a reference."
            >
              No physical validation trials recorded yet.
            </Empty>
          )}
        </div>
      </section>
    </>
  );
}
export default App;
