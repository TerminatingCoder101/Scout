import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Radar as RadarIcon,
  Plug,
  CheckCircle2,
  TriangleAlert,
  CircleHelp,
  LoaderCircle,
  DoorOpen,
  MoveHorizontal,
  TrendingUp,
  Download,
  RotateCcw,
  LayoutDashboard,
  FlaskConical,
  Wrench,
} from "lucide-react";
import { api, post, patch } from "./api";
import type { Check, Device, Scan, Settings, Twin } from "./types";
import "./quick.css";

type Space = "doorway" | "corridor" | "ramp";
const spaces: {
  id: Space;
  title: string;
  hint: string;
  icon: typeof DoorOpen;
}[] = [
  {
    id: "doorway",
    title: "Doorway",
    hint: "Entrances and interior doors",
    icon: DoorOpen,
  },
  {
    id: "corridor",
    title: "Hallway",
    hint: "Corridors and walkways",
    icon: MoveHorizontal,
  },
  {
    id: "ramp",
    title: "Ramp",
    hint: "Ramps and sloped paths",
    icon: TrendingUp,
  },
];
const SWEEP_POINTS = 37; // the firmware sweeps 0–180° in 5° steps
const busyStatuses = ["queued", "running"];
// Boards that usually show up when the Scout Arduino is plugged in over USB.
const likelyScout = /arduino|usbmodem|usbserial|ch340|ch910|wch|uno/i;

const fmt = (v: number | null | undefined, unit: string) => {
  if (v === null || v === undefined) return "—";
  const deg = unit === "°" || unit === "deg";
  return deg ? `${v.toFixed(2)}°` : `${v.toFixed(1)} ${unit}`;
};

function requirement(c: Check) {
  if (c.minimum !== null && c.maximum !== null)
    return `needs ${fmt(c.minimum, c.unit)} to ${fmt(c.maximum, c.unit)}`;
  if (c.minimum !== null) return `needs at least ${fmt(c.minimum, c.unit)}`;
  if (c.maximum !== null) return `needs at most ${fmt(c.maximum, c.unit)}`;
  return "";
}

const ratio = (deg: number) =>
  `about 1:${Math.round(1 / Math.tan((deg * Math.PI) / 180))}`;

// One plain-English sentence explaining each result. The verdict itself comes from the backend rules.
function why(c: Check) {
  if (c.value === null) return "";
  const isSlope = c.unit === "deg" || c.unit === "°";
  const what = c.key.includes("cross")
    ? "Side-to-side tilt makes wheelchairs drift toward one side."
    : isSlope
      ? "Steeper slopes are hard to push a wheelchair up, and unsafe to come down."
      : c.key.includes("width")
        ? "A wheelchair needs this much room to pass through."
        : "";
  const limit = c.minimum ?? c.maximum;
  if (limit === null) return what;
  const gap = Math.abs(c.value - limit);
  const g = isSlope ? `${gap.toFixed(2)}°` : `${gap.toFixed(1)} ${c.unit}`;
  if (c.status === "FAIL")
    return c.minimum !== null
      ? `${g} narrower than the ${fmt(c.minimum, c.unit)} minimum. ${what}`
      : `${g} over the ${fmt(c.maximum, c.unit)} limit${isSlope ? ` (${ratio(c.maximum!)})` : ""}. ${what}`;
  if (c.status === "VERIFY")
    return `Within ${isSlope ? c.error.toFixed(2) + "°" : c.error.toFixed(1) + " " + c.unit} of the limit, which is too close for the sensor to be sure. Measure by hand to confirm.`;
  return `Within the limit, with ${g} to spare.`;
}

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

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
    const t = await api<Twin[]>("/twins");
    setSettings(status.settings);
    setDevice(status.device);
    setTwins(t);
    setProperty((p) => p || t[0]?.id || "");
    setPhase("ready");
    if (status.active_scan_id)
      follow(await api<Scan>("/scans/" + status.active_scan_id));
  }

  useEffect(() => {
    (async () => {
      try {
        // The launcher opens the page with #token=<access key>; trade it for a session cookie.
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
        }
      } catch {
        /* keep trying; the next tick usually works */
      }
    }, 1000);
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
              "We couldn't find your Scout. Check that the USB cable is plugged into this laptop, then try again.",
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

  if (phase === "loading")
    return (
      <div className="qi qi-center">
        <LoaderCircle className="spin" size={28} />
        <p>Opening Scout…</p>
      </div>
    );

  if (phase === "locked")
    return (
      <div className="qi qi-center">
        <div className="qi-card qi-unlock">
          <Brand />
          <h1>Welcome back</h1>
          <p>Enter the access key from this laptop to open Scout.</p>
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
            <button className="qi-primary">Open Scout</button>
          </form>
          {error && <p className="qi-error">{error}</p>}
          <small>
            It's saved in <code>.scout/access-key</code>.
          </small>
        </div>
      </div>
    );

  const running = !!scan && busyStatuses.includes(scan.status);
  const finished = !!scan && !running;
  const ready = device.connected || demo;
  const progress = !scan
    ? 0
    : finished
      ? 100
      : scan.result
        ? 85
        : Math.min(
            80,
            8 + Math.round((scan.points.length / SWEEP_POINTS) * 72),
          );
  const stepText = !scan
    ? ""
    : !scan.result
      ? scan.points.length
        ? `Measuring the space… ${scan.points.length} of ${SWEEP_POINTS} readings`
        : "Getting ready. Keep the device still…"
      : scan.request.use_ai
        ? "Looking closer at anything in the way and writing your report…"
        : "Checking the measurements against ADA rules…";

  return (
    <div className="qi">
      <header className="qi-top">
        <Brand />
        <button className="qi-link" onClick={onOpenWorkspace}>
          <LayoutDashboard size={16} /> Full workspace
        </button>
      </header>

      <main className="qi-main">
        {scan ? (
          <div className="qi-eyebrow">
            {finished ? "Inspection report" : "Inspection in progress"}
          </div>
        ) : (
          <section className="qi-hero">
            <div className="qi-eyebrow">ADA accessibility check</div>
            <h1>Check a space for accessibility in one click.</h1>
            <p>
              Set the Scout device in the doorway, hallway, or ramp, then press{" "}
              <b>Analyze</b>. You'll get a plain-English result and a report you
              can share.
            </p>
          </section>
        )}

        {error && (
          <div className="qi-alert" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
          </div>
        )}

        {!scan && (
          <>
            <Step n={1} title="Connect your Scout">
              {device.connected ? (
                <div className="qi-status ok">
                  <CheckCircle2 size={20} />
                  <div>
                    <b>Scout is connected</b>
                    <small>{device.port}</small>
                  </div>
                </div>
              ) : demo ? (
                <div className="qi-status demo">
                  <FlaskConical size={20} />
                  <div>
                    <b>Demo mode</b>
                    <small>
                      We'll use a sample space, so no device is needed.
                    </small>
                  </div>
                  <button className="qi-link" onClick={() => setDemo(false)}>
                    Use my device instead
                  </button>
                </div>
              ) : (
                <>
                  <p className="qi-muted">
                    Plug the Scout into this laptop with its USB cable, then
                    press the button.
                  </p>
                  <div className="qi-row">
                    <button
                      className="qi-secondary"
                      onClick={() => connect()}
                      disabled={connecting}
                    >
                      {connecting ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <Plug size={18} />
                      )}
                      {connecting ? "Connecting…" : "Find my Scout"}
                    </button>
                    <button className="qi-link" onClick={() => setDemo(true)}>
                      No device? Try a demo
                    </button>
                  </div>
                  {ports.length > 0 && (
                    <div className="qi-ports">
                      <p className="qi-muted">Which one is your Scout?</p>
                      {ports.map((p) => (
                        <button
                          key={p.device}
                          className="qi-port"
                          onClick={() => connect(p.device)}
                        >
                          <b>{p.description || "USB device"}</b>
                          <small>{p.device}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Step>

            <Step n={2} title="What are you checking?">
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
                {spaces.map(({ id, title, hint, icon: Icon }) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={space === id}
                    className={"qi-space" + (space === id ? " selected" : "")}
                    onClick={() => setSpace(id)}
                  >
                    <Icon size={26} />
                    <b>{title}</b>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
              {twins.length > 1 && (
                <label className="qi-field">
                  <span>Property</span>
                  <select
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
                </label>
              )}
            </Step>

            <Step n={3} title="Analyze">
              <button
                className="qi-analyze"
                onClick={analyze}
                disabled={!ready || starting}
              >
                {starting ? (
                  <LoaderCircle className="spin" size={22} />
                ) : (
                  <RadarIcon size={22} />
                )}
                {starting ? "Starting…" : "Analyze"}
              </button>
              <p className="qi-muted qi-centered">
                {ready
                  ? "Takes about a minute. Keep the device still while it scans."
                  : "Connect your Scout or choose the demo first."}
              </p>
            </Step>
          </>
        )}

        {running && scan && (
          <section className="qi-card qi-progress" aria-live="polite">
            <RadarIcon className="qi-pulse" size={40} />
            <h2>
              Analyzing your{" "}
              {spaces
                .find((s) => s.id === scan.request.profile)
                ?.title.toLowerCase() || "space"}
              …
            </h2>
            <div
              className="qi-bar"
              role="progressbar"
              aria-label="Scan progress"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: progress + "%" }} />
            </div>
            <p>{stepText}</p>
          </section>
        )}

        {finished && scan && (
          <Report
            scan={scan}
            onAgain={() => setScan(null)}
            onOpenWorkspace={onOpenWorkspace}
          />
        )}
      </main>

      <footer className="qi-foot">
        Measurements are checked against the 2010 ADA Standards. Scout flags
        issues for review. It doesn't replace a certified inspector.
      </footer>
    </div>
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
      <section className="qi-card qi-verdict verify">
        <TriangleAlert size={36} />
        <h2>The scan didn't finish</h2>
        <p>
          {scan.error ||
            "Something interrupted the scan. Check the device and try again."}
        </p>
        <button className="qi-primary" onClick={onAgain}>
          <RotateCcw size={18} /> Try again
        </button>
      </section>
    );
  const tone =
    r.verdict === "PASS" ? "pass" : r.verdict === "FAIL" ? "fail" : "verify";
  const headline =
    r.verdict === "PASS"
      ? "Meets ADA requirements"
      : r.verdict === "FAIL"
        ? "Needs attention"
        : "Needs a second look";
  const sub =
    r.verdict === "PASS"
      ? "Everything Scout measured is within the ADA limits."
      : r.verdict === "FAIL"
        ? "At least one measurement is outside the ADA limits. See the fixes below."
        : "Some readings were too close to the limit to call. Re-scan, or have someone measure by hand.";
  const Icon =
    tone === "pass"
      ? CheckCircle2
      : tone === "fail"
        ? TriangleAlert
        : CircleHelp;
  const measured = r.checks.filter((c) => c.status !== "NOT_MEASURED");
  const actions = scan.work_order?.actions ?? [];
  const low = actions.reduce((s, a) => s + (a.estimate_low ?? 0), 0);
  const high = actions.reduce((s, a) => s + (a.estimate_high ?? 0), 0);

  return (
    <>
      <section className={"qi-card qi-verdict " + tone}>
        <Icon size={44} />
        <h2>{headline}</h2>
        <p>{sub}</p>
        <div className="qi-tally">
          {(["PASS", "FAIL", "VERIFY"] as const).map((v) => {
            const n = measured.filter((c) => c.status === v).length;
            return n ? (
              <span key={v} className={v.toLowerCase()}>
                {n}{" "}
                {v === "PASS"
                  ? "passed"
                  : v === "FAIL"
                    ? "failed"
                    : "to verify"}
              </span>
            ) : null;
          })}
        </div>
        <small>
          {scan.atlas_status === "saved"
            ? "Saved to Atlas · "
            : scan.atlas_status === "failed"
              ? scan.atlas_error + " · "
              : ""}
          {scan.twin.name}
          {scan.request.mode === "demo" ? " · demo data" : ""}
        </small>
      </section>

      <section className="qi-card">
        <h3>What we measured</h3>
        <ul className="qi-checks">
          {measured.map((c) => (
            <li key={c.key} className={c.status.toLowerCase()}>
              {c.status === "PASS" ? (
                <CheckCircle2 size={20} />
              ) : c.status === "FAIL" ? (
                <TriangleAlert size={20} />
              ) : (
                <CircleHelp size={20} />
              )}
              <div>
                <b>{c.label}</b>
                <small>{requirement(c)}</small>
                {why(c) && <p className="qi-why">{why(c)}</p>}
              </div>
              <span className="qi-value">{fmt(c.value, c.unit)}</span>
            </li>
          ))}
          {measured.length === 0 && (
            <li className="qi-muted">No measurements were recorded.</li>
          )}
        </ul>
        {r.drift.some((d) => d.changed) && (
          <p className="qi-note">
            <b>Different from your records:</b>{" "}
            {r.drift
              .filter((d) => d.changed)
              .map(
                (d) =>
                  `${d.label} is ${fmt(d.measured, d.unit)} (records say ${fmt(d.expected, d.unit)})`,
              )
              .join("; ")}
            .
          </p>
        )}
      </section>

      {(actions.length > 0 || scan.diagnosis) && (
        <section className="qi-card">
          <h3>
            <Wrench size={18} /> Recommended fixes
          </h3>
          {scan.diagnosis && (
            <p className="qi-note">
              <b>What's in the way:</b> {scan.diagnosis.obstruction}
            </p>
          )}
          <ol className="qi-actions">
            {actions.map((a, i) => (
              <li key={i}>
                <b>{a.title}</b>
                <span>{a.detail}</span>
                {a.estimate_low !== null && a.estimate_high !== null && (
                  <small className="qi-cost">
                    {money(a.estimate_low)}–{money(a.estimate_high)}
                  </small>
                )}
              </li>
            ))}
          </ol>
          {high > 0 && (
            <p className="qi-total">
              <span>Estimated total</span>
              <b>
                {money(low)}–{money(high)}
              </b>
            </p>
          )}
        </section>
      )}

      <div className="qi-row qi-end">
        <a
          className="qi-primary"
          href={`/api/scans/${scan.id}/report.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          <Download size={18} /> Download report (PDF)
        </a>
        <button className="qi-secondary" onClick={onAgain}>
          <RotateCcw size={18} /> Analyze another space
        </button>
        <button className="qi-link" onClick={onOpenWorkspace}>
          See full details
        </button>
      </div>
    </>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="qi-card qi-step">
      <h2>
        <span className="qi-num">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Brand() {
  return (
    <div className="qi-brand">
      <RadarIcon size={24} />
      <span>
        Scout<b>RADAR</b>
      </span>
    </div>
  );
}
