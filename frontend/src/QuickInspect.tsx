import scoutLogo from "./assets/scout-logo.svg";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Plug,
  LoaderCircle,
  Download,
  RotateCcw,
  ArrowRight,
  ArrowUpRight,
  Check as CheckIcon,
  FlaskConical,
} from "lucide-react";
import { api, post, patch } from "./api";
import type { Check, Device, Point, Scan, Settings, Twin } from "./types";
import "./quick.css";

type Space = "doorway" | "corridor" | "ramp";
const spaces: { id: Space; title: string; hint: string }[] = [
  { id: "doorway", title: "Doorway", hint: "Entrances, interior doors" },
  { id: "corridor", title: "Hallway", hint: "Corridors, walkways" },
  { id: "ramp", title: "Ramp", hint: "Ramps, sloped paths" },
];
const SWEEP_POINTS = 37; // firmware sweeps 0–180° in 5° steps
const busyStatuses = ["queued", "running"];
const likelyScout = /arduino|usbmodem|usbserial|ch340|ch910|wch|uno/i;
type ScanSummary = Pick<
  Scan,
  "id" | "created_at" | "status" | "request" | "twin" | "result"
>;

const isDeg = (unit: string) => unit === "°" || unit === "deg";
const fmt = (v: number | null | undefined, unit: string) =>
  v === null || v === undefined
    ? "—"
    : isDeg(unit)
      ? `${v.toFixed(2)}°`
      : `${v.toFixed(1)} ${unit}`;
const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const spaceName = (p: string) =>
  spaces.find((s) => s.id === p)?.title ?? "Space";

// One plain-English sentence per check. The verdict itself always comes from the backend rules.
function why(c: Check) {
  if (c.value === null) return "";
  const slope = isDeg(c.unit);
  const reason = c.key.includes("cross")
    ? "Side-to-side tilt pulls a wheelchair toward the edge."
    : slope
      ? "Steeper slopes are hard to climb in a wheelchair and unsafe to descend."
      : c.key.includes("width")
        ? "A wheelchair needs this much clear room to pass."
        : "";
  const limit = c.minimum ?? c.maximum;
  if (limit === null) return reason;
  const gap = fmt(Math.abs(c.value - limit), c.unit);
  if (c.status === "FAIL")
    return c.minimum !== null
      ? `${gap} short of the ${fmt(c.minimum, c.unit)} minimum. ${reason}`
      : `${gap} over the ${fmt(c.maximum, c.unit)} limit. ${reason}`;
  if (c.status === "VERIFY")
    return `Within the sensor's ±${fmt(c.error, c.unit)} margin of the limit, so it's too close to call. Confirm with a tape or level.`;
  return `Clears the limit by ${gap}.`;
}

export default function QuickInspect({
  onOpenWorkspace,
}: {
  onOpenWorkspace: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "locked" | "ready">("loading");
  const [key, setKey] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [device, setDevice] = useState<Device>({
    connected: false,
    port: null,
    error: null,
  });
  const [twins, setTwins] = useState<Twin[]>([]);
  const [recent, setRecent] = useState<ScanSummary[]>([]);
  const [inspectionLocation, setInspectionLocation] = useState("entrance-door");
  const [property, setProperty] = useState("");
  const [space, setSpace] = useState<Space>("doorway");
  const [demo, setDemo] = useState(false);
  const [ports, setPorts] = useState<{ device: string; description: string }[]>(
    [],
  );
  const [connecting, setConnecting] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const poll = useRef<number | null>(null);

  async function load() {
    const res = await fetch("/api/status", { credentials: "same-origin" });
    if (res.status === 401) {
      setPhase("locked");
      return;
    }
    if (!res.ok) throw new Error(`Scout isn't responding (${res.status}).`);
    const status = (await res.json()) as {
      settings: Settings;
      device: Device;
      active_scan_id: string | null;
    };
    const [t, s] = await Promise.all([
      api<Twin[]>("/twins"),
      api<ScanSummary[]>("/scans"),
    ]);
    setSettings(status.settings);
    setDevice(status.device);
    setTwins(t);
    setRecent(s);
    setProperty((p) => p || t[0]?.id || "");
    setPhase("ready");
    if (status.active_scan_id)
      follow(await api<Scan>("/scans/" + status.active_scan_id));
  }

  useEffect(() => {
    (async () => {
      try {
        // The launcher opens the app with #token=<access key>; trade it for a session cookie.
        const token = new URLSearchParams(location.hash.slice(1)).get("token");
        if (token) {
          history.replaceState(null, "", location.pathname);
          await post("/auth", { key: token });
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
        setPhase("locked");
      }
    })();
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  function follow(s: Scan) {
    setScan(s);
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    if (!busyStatuses.includes(s.status)) return;
    poll.current = window.setInterval(async () => {
      try {
        const next = await api<Scan>("/scans/" + s.id);
        setScan(next);
        if (!busyStatuses.includes(next.status) && poll.current) {
          clearInterval(poll.current);
          poll.current = null;
          api<ScanSummary[]>("/scans")
            .then(setRecent)
            .catch(() => {});
        }
      } catch {
        /* the next tick usually works */
      }
    }, 700);
  }

  async function connect(port?: string) {
    setError("");
    setConnecting(true);
    try {
      let chosen = port;
      if (!chosen) {
        const found =
          await api<{ device: string; description: string }[]>(
            "/hardware/ports",
          );
        const scouts = found.filter((p) =>
          likelyScout.test(p.device + " " + p.description),
        );
        if (scouts.length === 1) chosen = scouts[0].device;
        else {
          setPorts(scouts.length ? scouts : found);
          if (!found.length)
            setError(
              "No Scout found. Check that the USB cable is plugged into this laptop, then try again.",
            );
          return;
        }
      }
      await patch("/settings", { serial_port: chosen });
      setDevice(await post<Device>("/hardware/connect"));
      setPorts([]);
      setDemo(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function analyze() {
    setError("");
    setStarting(true);
    try {
      const body: Record<string, unknown> = {
        mode: demo || !device.connected ? "demo" : "hardware",
        scenario: "obstructed",
        profile: space,
        location_id: inspectionLocation,
        use_ai: !!settings?.gemini_api_key_configured,
      };
      if (property) body.building_id = property;
      follow(await post<Scan>("/scans", body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function open(id: string) {
    try {
      follow(await api<Scan>("/scans/" + id));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (phase === "loading")
    return (
      <div className="qi qi-center">
        <LoaderCircle className="spin" size={26} />
        <p className="qi-quiet">Opening Scout…</p>
      </div>
    );

  if (phase === "locked")
    return (
      <div className="qi qi-center">
        <div className="qi-unlock">
          <Brand />
          <h1 className="qi-display">Welcome back.</h1>
          <p className="qi-quiet">
            Enter the access key from this laptop to open Scout.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                await post("/auth", { key });
                setKey("");
                setPhase("loading");
                await load();
              } catch (err) {
                setError((err as Error).message);
                setPhase("locked");
              }
            }}
          >
            <input
              type="password"
              aria-label="Access key"
              placeholder="Access key"
              autoComplete="current-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <button className="qi-btn qi-btn-primary">
              Open Scout <ArrowRight size={18} />
            </button>
          </form>
          {error && <p className="qi-error">{error}</p>}
          <small className="qi-quiet">
            Saved on this laptop in <code>.scout/access-key</code>.
          </small>
        </div>
      </div>
    );

  const running = !!scan && busyStatuses.includes(scan.status);
  const finished = !!scan && !running;
  const ready = device.connected || demo;
  const twin = twins.find((t) => t.id === property);

  return (
    <div className="qi">
      <header className="qi-top">
        <Brand />
        <nav className="qi-top-nav">
          <span
            className={
              "qi-device " + (device.connected ? "on" : demo ? "demo" : "")
            }
          >
            <i />
            {device.connected
              ? "Scout connected"
              : demo
                ? "Demo mode"
                : "No device"}
          </span>
          <button className="qi-textlink" onClick={onOpenWorkspace}>
            Full workspace <ArrowUpRight size={15} />
          </button>
        </nav>
      </header>

      {error && (
        <div className="qi-banner" role="alert">
          <b>Something needs attention.</b> {error}
          <button className="qi-textlink" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}

      {!scan && (
        <main className="qi-setup">
          <section className="qi-instrument" aria-label="Scout radar">
            <div className="qi-instrument-head">
              <span className="qi-kicker">Live radar</span>
              <span className="qi-mono qi-quiet">0°–180° · 37 readings</span>
            </div>
            <Dial points={[]} idle />
            <p className="qi-instrument-foot">
              Place Scout on the floor, centered in the opening, with its edge
              against the frame. It measures width and slope, then photographs
              anything in the way.
            </p>
          </section>

          <section className="qi-panel">
            <span className="qi-kicker">ADA accessibility inspection</span>
            <h1 className="qi-display">
              Is this space <em>accessible?</em>
            </h1>
            <p className="qi-lede">
              One scan measures the opening and the slope, checks them against
              the 2010 ADA Standards, and hands you a report with fixes and
              costs.
            </p>

            <Field n="01" label="Device">
              {device.connected ? (
                <div className="qi-chip-row">
                  <span className="qi-status-pill on">
                    <CheckIcon size={15} /> Connected
                  </span>
                  <span className="qi-mono qi-quiet qi-ellipsis">
                    {device.port}
                  </span>
                </div>
              ) : demo ? (
                <div className="qi-chip-row">
                  <span className="qi-status-pill demo">
                    <FlaskConical size={15} /> Demo: sample doorway
                  </span>
                  <button
                    className="qi-textlink"
                    onClick={() => setDemo(false)}
                  >
                    Use my Scout
                  </button>
                </div>
              ) : (
                <>
                  <div className="qi-chip-row">
                    <button
                      className="qi-btn qi-btn-ghost"
                      onClick={() => connect()}
                      disabled={connecting}
                    >
                      {connecting ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Plug size={17} />
                      )}
                      {connecting ? "Looking for Scout…" : "Connect Scout"}
                    </button>
                    <button
                      className="qi-textlink"
                      onClick={() => setDemo(true)}
                    >
                      No device? Run a demo
                    </button>
                  </div>
                  {ports.length > 0 && (
                    <div
                      className="qi-ports"
                      role="group"
                      aria-label="Choose your Scout"
                    >
                      <span className="qi-quiet">Which one is your Scout?</span>
                      {ports.map((p) => (
                        <button
                          key={p.device}
                          className="qi-port"
                          onClick={() => connect(p.device)}
                        >
                          <b>{p.description || "USB device"}</b>
                          <span className="qi-mono">{p.device}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Field>

            <Field n="02" label="What are you checking?">
              <label>
                Location ID
                <input
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  maxLength={120}
                  value={inspectionLocation}
                  onChange={(e) => setInspectionLocation(e.target.value)}
                />
              </label>
              <p>
                Completed live and demo inspections save to Atlas automatically.
                Reuse the location ID for repeat inspections.
              </p>
              <div
                className="qi-spaces"
                role="radiogroup"
                aria-label="Type of space"
              >
                {spaces.map(({ id, title, hint }) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={space === id}
                    className={"qi-space" + (space === id ? " is-on" : "")}
                    onClick={() => setSpace(id)}
                  >
                    <SpaceArt kind={id} />
                    <b>{title}</b>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            </Field>

            {twins.length > 0 && (
              <Field n="03" label="Property on record">
                {twins.length > 1 ? (
                  <select
                    className="qi-select"
                    value={property}
                    onChange={(e) => setProperty(e.target.value)}
                  >
                    {twins.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.location ? ` · ${t.location}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="qi-record">
                    <b>{twin?.name}</b>
                    <span className="qi-quiet">
                      Records say {fmt(twin?.width_in, "in")} wide ·{" "}
                      {fmt(twin?.running_slope_deg, "°")} slope
                    </span>
                  </div>
                )}
              </Field>
            )}

            <button
              className="qi-btn qi-btn-primary qi-analyze"
              onClick={analyze}
              disabled={!ready || starting}
            >
              {starting ? <LoaderCircle className="spin" size={20} /> : null}
              {starting ? "Starting" : "Analyze"}
              {!starting && <ArrowRight size={20} />}
            </button>
            <p className="qi-quiet qi-small">
              {ready
                ? "About a minute. Keep Scout still while it sweeps."
                : "Connect Scout, or run the demo, to begin."}
            </p>
          </section>

          {recent.length > 0 && (
            <section className="qi-recent" aria-label="Recent inspections">
              <div className="qi-recent-head">
                <span className="qi-kicker">Recent inspections</span>
              </div>
              <ul>
                {recent.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => open(s.id)}>
                      <VerdictDot verdict={s.result?.verdict} />
                      <span className="qi-recent-name">
                        <b>{s.twin.name}</b>
                        <small>
                          {spaceName(s.request.profile)} · {when(s.created_at)}
                          {s.request.mode === "demo" ? " · demo" : ""}
                        </small>
                      </span>
                      <span className="qi-recent-verdict">
                        {verdictWord(s.result?.verdict, s.status)}
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      )}

      {running && scan && <Progress scan={scan} />}

      {finished && scan && (
        <Report
          scan={scan}
          onAgain={() => {
            setScan(null);
            window.scrollTo({ top: 0 });
          }}
          onOpenWorkspace={onOpenWorkspace}
        />
      )}

      <footer className="qi-foot">
        Screens the measured items against the 2010 ADA Standards for Accessible
        Design. Scout flags issues for follow-up and does not replace a
        certified accessibility inspection.
      </footer>
    </div>
  );
}

function Progress({ scan }: { scan: Scan }) {
  const n = scan.points.length;
  const ai = scan.request.use_ai;
  const steps: {
    label: string;
    state: "done" | "now" | "next";
    detail?: string;
  }[] = [
    {
      label: "Check that Scout is level and still",
      state: n > 0 || scan.result ? "done" : "now",
    },
    {
      label: "Sweep the opening",
      state: scan.result ? "done" : n > 0 ? "now" : "next",
      detail: scan.result
        ? "37 of 37"
        : n
          ? `${n} of ${SWEEP_POINTS}`
          : undefined,
    },
    {
      label: "Compare with ADA limits and your records",
      state: scan.result ? "done" : "next",
    },
    ...(ai
      ? [
          {
            label: "Photograph and identify what's in the way",
            state: (scan.diagnosis ? "done" : scan.result ? "now" : "next") as
              "done" | "now" | "next",
          },
        ]
      : []),
    {
      label: "Write the work order",
      state: scan.work_order
        ? "done"
        : scan.result && (!ai || scan.diagnosis)
          ? "now"
          : "next",
    },
  ];
  const last = [...scan.points]
    .sort((a, b) => a.angle_deg - b.angle_deg)
    .at(-1);
  return (
    <main className="qi-progress" aria-live="polite">
      <section className="qi-instrument qi-instrument-live">
        <div className="qi-instrument-head">
          <span className="qi-kicker">Scanning</span>
          <span className="qi-mono qi-quiet">
            {last ? `${last.angle_deg.toFixed(0)}°` : "0°"}
          </span>
        </div>
        <Dial
          points={scan.points}
          sweep={scan.result ? null : (last?.angle_deg ?? 0)}
        />
      </section>
      <section className="qi-panel">
        <span className="qi-kicker">{scan.twin.name}</span>
        <h1 className="qi-display">
          Inspecting the{" "}
          <em>{spaceName(scan.request.profile).toLowerCase()}</em>…
        </h1>
        <ol className="qi-steps">
          {steps.map((s) => (
            <li key={s.label} className={s.state}>
              <span className="qi-step-mark">
                {s.state === "done" ? (
                  <CheckIcon size={14} strokeWidth={3} />
                ) : s.state === "now" ? (
                  <i />
                ) : null}
              </span>
              <span>{s.label}</span>
              {s.detail && <span className="qi-mono qi-quiet">{s.detail}</span>}
            </li>
          ))}
        </ol>
        <p className="qi-quiet qi-small">
          Keep Scout still until the sweep finishes.
        </p>
      </section>
    </main>
  );
}

function Report({
  scan,
  onAgain,
  onOpenWorkspace,
}: {
  scan: Scan;
  onAgain: () => void;
  onOpenWorkspace: () => void;
}) {
  const r = scan.result;
  if (scan.error || !r)
    return (
      <main className="qi-report">
        <section className="qi-sheet qi-failed">
          <span className="qi-kicker">Inspection stopped</span>
          <h1 className="qi-display">The scan didn't finish.</h1>
          <p className="qi-lede">
            {scan.error ||
              "Something interrupted the scan. Check Scout's cable and try again."}
          </p>
          <button className="qi-btn qi-btn-primary" onClick={onAgain}>
            <RotateCcw size={18} /> Try again
          </button>
        </section>
      </main>
    );
  const tone =
    r.verdict === "PASS" ? "pass" : r.verdict === "FAIL" ? "fail" : "verify";
  const space = spaceName(scan.request.profile).toLowerCase();
  const measured = r.checks.filter((c) => c.status !== "NOT_MEASURED");
  const notMeasured = r.checks.filter((c) => c.status === "NOT_MEASURED");
  const failed = measured.filter((c) => c.status === "FAIL").length;
  const actions = scan.work_order?.actions ?? [];
  const priced = actions.filter(
    (a) => a.estimate_low !== null && a.estimate_high !== null,
  );
  const low = priced.reduce((s, a) => s + (a.estimate_low ?? 0), 0);
  const high = priced.reduce((s, a) => s + (a.estimate_high ?? 0), 0);
  const drift = r.drift.filter((d) => d.measured !== null);

  return (
    <main className="qi-report">
      <section className={"qi-sheet qi-cover " + tone}>
        <div className="qi-cover-text">
          <div className="qi-meta qi-mono">
            <span>Report {scan.id.slice(0, 8).toUpperCase()}</span>
            <span>{when(scan.completed_at || scan.created_at)}</span>
            {scan.request.mode === "demo" && <span>Demo data</span>}
          </div>
          <span className={"qi-stamp " + tone}>
            {tone === "pass"
              ? "Meets ADA limits"
              : tone === "fail"
                ? "Action needed"
                : "Verify on site"}
          </span>
          <h1 className="qi-display">
            {tone === "pass" ? (
              <>
                This {space} <em>passes</em> every check we measured.
              </>
            ) : tone === "fail" ? (
              <>
                This {space} <em>needs work</em> before it's accessible.
              </>
            ) : (
              <>
                This {space} is <em>too close to call.</em>
              </>
            )}
          </h1>
          <p className="qi-lede">
            {scan.twin.name}
            {scan.twin.location ? ` · ${scan.twin.location}` : ""}
          </p>
          {scan.atlas_status && (
            <p role="status" className="qi-quiet">
              {scan.atlas_status === "saved"
                ? "Saved to Atlas · " +
                  (scan.request.location_id || scan.request.profile)
                : scan.atlas_status === "failed"
                  ? scan.atlas_error
                  : "Saving to Atlas…"}
            </p>
          )}
          {scan.request.mode === "demo" && (
            <p className="qi-quiet">Simulation · local fixture demonstration</p>
          )}
          <div className="qi-tally">
            <span>
              <b>{measured.length}</b> measured
            </span>
            <span className={failed ? "fail" : ""}>
              <b>{failed}</b> failed
            </span>
            {high > 0 && (
              <span>
                <b>
                  {money(low)}–{money(high)}
                </b>{" "}
                est. fixes
              </span>
            )}
          </div>
        </div>
        <figure className="qi-cover-dial">
          <Dial points={scan.points} compact />
          <figcaption className="qi-mono">
            Scan silhouette · 37 readings
          </figcaption>
        </figure>
      </section>

      <section className="qi-sheet">
        <SheetHead
          kicker="Measurements"
          title="What Scout measured, and why it matters"
        />
        <div className="qi-checks">
          {measured.map((c) => (
            <article
              key={c.key}
              className={"qi-check " + c.status.toLowerCase()}
            >
              <header>
                <div>
                  <h3>{c.label}</h3>
                  <p>{why(c)}</p>
                </div>
                <div className="qi-check-value">
                  <span className="qi-num">{fmt(c.value, c.unit)}</span>
                  <span className={"qi-badge " + c.status.toLowerCase()}>
                    {c.status === "PASS"
                      ? "Pass"
                      : c.status === "FAIL"
                        ? "Fail"
                        : "Verify"}
                  </span>
                </div>
              </header>
              <Gauge c={c} />
            </article>
          ))}
        </div>
        {measured.length > 0 && (
          <p className="qi-gauge-legend">
            <span>
              <i className="k-needle" /> Measured
            </span>
            <span>
              <i className="k-err" /> Sensor margin
            </span>
            <span>
              <i className="k-ok" /> Within ADA limit
            </span>
            <span>
              <i className="k-bad" /> Outside limit
            </span>
          </p>
        )}
        {notMeasured.length > 0 && (
          <p className="qi-note">
            <b>Not measured by Scout:</b>{" "}
            {notMeasured.map((c) => c.label.toLowerCase()).join(", ")}. Check
            these by hand.
          </p>
        )}
      </section>

      {drift.length > 0 && (
        <section className="qi-sheet">
          <SheetHead
            kicker="Blueprint vs. reality"
            title="Your records, next to what's actually there"
          />
          <div className="qi-drift">
            {drift.map((d) => (
              <div
                key={d.key}
                className={"qi-drift-row" + (d.changed ? " changed" : "")}
              >
                <span className="qi-drift-label">{d.label}</span>
                <span className="qi-drift-cell">
                  <small>On record</small>
                  <span className="qi-num">{fmt(d.expected, d.unit)}</span>
                </span>
                <ArrowRight size={18} className="qi-drift-arrow" />
                <span className="qi-drift-cell">
                  <small>Measured</small>
                  <span className="qi-num">{fmt(d.measured, d.unit)}</span>
                </span>
                <span className="qi-drift-delta qi-mono">
                  {d.delta === null
                    ? "—"
                    : `${d.delta > 0 ? "+" : ""}${isDeg(d.unit) ? d.delta.toFixed(2) + "°" : d.delta.toFixed(1) + " " + d.unit}`}
                </span>
              </div>
            ))}
          </div>
          <p className="qi-quiet qi-small">
            Source: {scan.twin.source_reference || scan.twin.source}
          </p>
        </section>
      )}

      {(actions.length > 0 || scan.diagnosis) && (
        <section className="qi-sheet">
          <SheetHead kicker="Work order" title="Recommended fixes" />
          {scan.diagnosis && (
            <div className="qi-finding">
              {scan.images.length > 0 && (
                <img
                  src={scan.images[scan.images.length - 1].url}
                  alt="What Scout's camera saw"
                />
              )}
              <div>
                <small className="qi-kicker">Found in the opening</small>
                <p className="qi-finding-title">{scan.diagnosis.obstruction}</p>
                {scan.diagnosis.classification && (
                  <span className="qi-quiet">
                    {scan.diagnosis.classification.replaceAll("_", " ")}
                  </span>
                )}
              </div>
            </div>
          )}
          <ol className="qi-quote">
            {actions.map((a, i) => (
              <li key={i}>
                <span className="qi-quote-n qi-mono">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <b>{a.title}</b>
                  <p>{a.detail}</p>
                </div>
                <span className="qi-quote-cost qi-mono">
                  {a.estimate_low !== null && a.estimate_high !== null
                    ? `${money(a.estimate_low)}–${money(a.estimate_high)}`
                    : "—"}
                </span>
              </li>
            ))}
          </ol>
          {high > 0 && (
            <div className="qi-quote-total">
              <span>Estimated total</span>
              <span className="qi-num">
                {money(low)}–{money(high)}
              </span>
            </div>
          )}
          {scan.work_order?.cost_note && (
            <p className="qi-quiet qi-small">{scan.work_order.cost_note}</p>
          )}
        </section>
      )}

      <div className="qi-actions-bar">
        <a
          className="qi-btn qi-btn-primary"
          href={`/api/scans/${scan.id}/report.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          <Download size={18} /> Download PDF report
        </a>
        <button className="qi-btn qi-btn-ghost" onClick={onAgain}>
          <RotateCcw size={17} /> Inspect another space
        </button>
        <button className="qi-textlink" onClick={onOpenWorkspace}>
          Open in full workspace <ArrowUpRight size={15} />
        </button>
      </div>
    </main>
  );
}

/* ---------- Visual building blocks ---------- */

const MAX_CM = 250;
function Dial({
  points,
  sweep = null,
  idle = false,
  compact = false,
}: {
  points: Point[];
  sweep?: number | null;
  idle?: boolean;
  compact?: boolean;
}) {
  const cx = 200,
    cy = 200,
    R = 180;
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx - r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const valid = [...points]
    .filter((p) => p.distance_cm !== null)
    .sort((a, b) => a.angle_deg - b.angle_deg);
  const pts = valid.map((p) => {
    const [x, y] = at(
      p.angle_deg,
      (Math.min(p.distance_cm!, MAX_CM) / MAX_CM) * R,
    );
    return { x, y, noisy: p.valid_pings < 8 || p.spread_cm > 6 };
  });
  const shape =
    pts.length > 1
      ? `M${cx} ${cy} ` +
        pts.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
        " Z"
      : "";
  const wedge = () => {
    const [x1, y1] = at(0, R);
    const [x2, y2] = at(-16, R);
    return `M${cx} ${cy} L${x1} ${y1} A${R} ${R} 0 0 0 ${x2} ${y2} Z`;
  };
  return (
    <svg
      className={"qi-dial" + (compact ? " compact" : "")}
      viewBox="0 0 400 214"
      role="img"
      aria-label={
        pts.length ? `Radar sweep with ${pts.length} readings` : "Radar ready"
      }
    >
      <defs>
        <clipPath id="qi-half">
          <path
            d={`M${cx - R - 2} ${cy} A${R + 2} ${R + 2} 0 0 1 ${cx + R + 2} ${cy} Z`}
          />
        </clipPath>
        <radialGradient id="qi-wash" cx="50%" cy="100%" r="100%">
          <stop offset="0" stopColor="var(--qi-honey)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--qi-honey)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy} Z`}
        fill="url(#qi-wash)"
      />
      {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
        <path
          key={f}
          d={`M${cx - R * f} ${cy} A${R * f} ${R * f} 0 0 1 ${cx + R * f} ${cy}`}
          className="qi-dial-ring"
        />
      ))}
      {Array.from({ length: 13 }, (_, i) => i * 15).map((deg) => {
        const [x1, y1] = at(deg, R * 0.2);
        const [x2, y2] = at(deg, R);
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className="qi-dial-spoke"
          />
        );
      })}
      {Array.from({ length: 37 }, (_, i) => i * 5).map((deg) => {
        const [x1, y1] = at(deg, R);
        const [x2, y2] = at(deg, R + (deg % 45 === 0 ? 9 : 4));
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className="qi-dial-tick"
          />
        );
      })}
      {!compact &&
        [0, 45, 90, 135, 180].map((deg) => {
          const [x, y] = at(deg, R + 20);
          return (
            <text
              key={deg}
              x={x}
              y={Math.min(y + 4, 211)}
              className="qi-dial-label"
              textAnchor="middle"
            >
              {deg}°
            </text>
          );
        })}
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} className="qi-dial-base" />
      {shape && <path d={shape} className="qi-dial-shape" />}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.noisy ? 4.2 : 3.2}
          className={p.noisy ? "qi-dial-pt noisy" : "qi-dial-pt"}
        />
      ))}
      {(idle || sweep !== null) && (
        <g clipPath="url(#qi-half)">
          <g
            className={"qi-dial-sweep" + (idle ? " idle" : "")}
            style={idle ? undefined : { transform: `rotate(${sweep}deg)` }}
          >
            <path d={wedge()} className="qi-dial-wedge" />
            <line
              x1={cx}
              y1={cy}
              x2={cx - R}
              y2={cy}
              className="qi-dial-beam"
            />
          </g>
        </g>
      )}
      <circle cx={cx} cy={cy} r={6} className="qi-dial-hub" />
    </svg>
  );
}

function Gauge({ c }: { c: Check }) {
  if (c.value === null || (c.minimum === null && c.maximum === null))
    return null;
  const bounds = [
    c.value - c.error,
    c.value + c.error,
    c.minimum,
    c.maximum,
  ].filter((v): v is number => v !== null);
  const a = Math.min(...bounds),
    b = Math.max(...bounds);
  const pad = Math.max(b - a, Math.abs(b) * 0.12, 0.5) * 0.45;
  const lo = Math.max(0, a - pad),
    hi = b + pad;
  const pct = (v: number) =>
    Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const v = pct(c.value);
  return (
    <div className="qi-gauge" aria-hidden="true">
      <div className="qi-gauge-track">
        {c.minimum !== null && (
          <span
            className="qi-gauge-bad"
            style={{ left: 0, width: pct(c.minimum) + "%" }}
          />
        )}
        {c.maximum !== null && (
          <span
            className="qi-gauge-bad"
            style={{ left: pct(c.maximum) + "%", right: 0 }}
          />
        )}
        <span
          className="qi-gauge-err"
          style={{
            left: pct(c.value - c.error) + "%",
            width: pct(c.value + c.error) - pct(c.value - c.error) + "%",
          }}
        />
        <span className="qi-gauge-needle" style={{ left: v + "%" }} />
      </div>
      <div className="qi-gauge-scale">
        {c.minimum !== null && (
          <span
            className="qi-gauge-limit"
            style={{ left: pct(c.minimum) + "%" }}
          >
            ADA min {fmt(c.minimum, c.unit)}
          </span>
        )}
        {c.maximum !== null && (
          <span
            className="qi-gauge-limit"
            style={{ left: pct(c.maximum) + "%" }}
          >
            ADA max {fmt(c.maximum, c.unit)}
          </span>
        )}
      </div>
    </div>
  );
}

function SpaceArt({ kind }: { kind: Space }) {
  return (
    <svg className="qi-space-art" viewBox="0 0 72 52" aria-hidden="true">
      {kind === "doorway" && (
        <>
          <path d="M6 46H66" />
          <path d="M20 46V8H52V46" />
          <path d="M20 8L31 12V49L20 46" className="fill" />
          <path d="M34 38H50M34 35V41M50 35V41" className="dim" />
        </>
      )}
      {kind === "corridor" && (
        <>
          <path d="M6 6L26 18H46L66 6" />
          <path d="M6 46L26 32H46L66 46" />
          <path d="M26 18V32M46 18V32" />
          <path d="M26 32H46V18H26Z" className="fill" />
          <path d="M14 40H58M14 37V43M58 37V43" className="dim" />
        </>
      )}
      {kind === "ramp" && (
        <>
          <path d="M6 46H66" />
          <path d="M10 46L62 22V46Z" className="fill" />
          <path d="M10 46L62 22V46" />
          <path d="M24 46A14 14 0 0 0 22.8 40.3" className="dim" />
          <path d="M10 36L62 12" className="dim dash" />
        </>
      )}
    </svg>
  );
}

function Field({
  n,
  label,
  children,
}: {
  n: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="qi-field">
      <div className="qi-field-label">
        <span className="qi-mono">{n}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function SheetHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <header className="qi-sheet-head">
      <span className="qi-kicker">{kicker}</span>
      <h2>{title}</h2>
    </header>
  );
}

function VerdictDot({ verdict }: { verdict?: string }) {
  return (
    <span className={"qi-vdot " + (verdict ? verdict.toLowerCase() : "none")} />
  );
}
const verdictWord = (v: string | undefined, status: string) =>
  v === "PASS"
    ? "Pass"
    : v === "FAIL"
      ? "Action needed"
      : v === "VERIFY"
        ? "Verify"
        : status === "failed"
          ? "Stopped"
          : "—";

function Brand() {
  return (
    <div className="qi-brand">
      <img
        className="scout-logo"
        src={scoutLogo}
        alt="Scout Radar"
        width="820"
        height="296"
      />
    </div>
  );
}
