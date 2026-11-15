import { StrictMode } from "react";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import App from "./App";

const settings = {
  gemini_api_key_configured: false,
  google_vision_api_key_configured: false,
  gemini_model: "gemini-3.8-flash",
  serial_port: "",
  camera_index: 0,
  turret_offset_cm: 0,
  alignment_deg: 0,
  pitch_bias_deg: 0,
  roll_bias_deg: 0,
  width_error_cm: 1.2,
  slope_error_deg: 0.15,
  calibration_verified: false,
  button_enabled: false,
  button_building_id: "demo",
  button_profile: "doorway",
  button_use_ai: false,
};
const twin = {
  id: "princeton-demo",
  name: "Test entrance",
  location: "Local fixture",
  source: "demo",
  source_reference: "Illustrative",
  width_in: 36,
  running_slope_deg: 3.5,
  cross_slope_deg: 0.4,
  captured_at: "2026-11-13",
};
const pending = {
  id: "scan-one",
  created_at: "2026-11-13T12:00:00Z",
  status: "queued",
  request: {
    mode: "demo",
    scenario: "obstructed",
    profile: "doorway",
    building_id: twin.id,
    use_ai: false,
  },
  twin,
  points: [],
  images: [],
  agent_provider: "deterministic",
};
let store: any[] = [];
let requests: { path: string; body: any; method: string }[] = [];
let streams: FakeStream[] = [];
class FakeStream {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, () => void> = {};
  closed = false;
  constructor(public url: string) {
    streams.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    this.listeners[name] = fn;
  }
  close() {
    this.closed = true;
  }
  message(kind: string, data: unknown, id = 1) {
    this.onmessage?.({
      data: JSON.stringify({
        id,
        kind,
        data,
        created_at: "2026-11-13T12:00:00Z",
      }),
    });
  }
}
beforeEach(() => {
  store = [];
  requests = [];
  streams = [];
  vi.stubGlobal("EventSource", FakeStream);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options: RequestInit = {}) => {
      const path = String(input);
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ path, body, method });
      let value: unknown;
      if (path === "/api/status")
        value = {
          settings,
          device: { connected: false, port: null, error: null },
          active_scan_id: null,
        };
      else if (path === "/api/twins") value = [twin];
      else if (path === "/api/scans" && method === "GET") value = store;
      else if (path === "/api/scans" && method === "POST") {
        value = { ...pending, request: body };
        store = [value];
      } else if (path.endsWith("/timeline")) value = [];
      else if (path === "/api/scans/scan-one") value = store[0];
      else if (path === "/api/scans/scan-one/cancel") {
        store[0] = { ...store[0], status: "cancelled" };
        value = store[0];
      } else if (path === "/api/hardware/camera-preview") value = null;
      else if (path === "/api/hardware/test-camera")
        value = {
          camera_index: body.camera_index,
          url: "/api/images/test-frame.jpg",
          captured_at: "2026-11-15T12:00:00Z",
        };
      else if (path === "/api/hardware/ports") value = [];
      else if (path === "/api/settings" && method === "PATCH")
        value = { ...settings, ...body };
      else if (path === "/api/settings") value = settings;
      else if (path === "/api/validation")
        value = {
          trials: [],
          summary: {
            width_cm: {
              count: 0,
              mean_absolute_error: null,
              max_absolute_error: null,
            },
          },
        };
      else value = { ok: true };
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
async function loaded() {
  render(<App />);
  await screen.findByRole("heading", {
    name: "See what the blueprint missed.",
  });
}

describe("Inspection workspace", () => {
  it("renders an honest empty dashboard and opens a configured scan", async () => {
    const user = userEvent.setup();
    await loaded();
    expect(screen.getByText("Awaiting scan")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New inspection" }));
    const modal = screen.getByRole("dialog");
    expect(
      (
        within(modal).getByRole("checkbox", {
          name: /Use DeepAgent/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    await user.selectOptions(
      within(modal).getByLabelText("Inspection profile"),
      "ramp",
    );
    await user.click(
      within(modal).getByRole("button", { name: "Start inspection" }),
    );
    await waitFor(() =>
      expect(
        requests.some((r) => r.path === "/api/scans" && r.method === "POST"),
      ).toBe(true),
    );
    expect(
      requests.find((r) => r.path === "/api/scans" && r.method === "POST")
        ?.body,
    ).toMatchObject({
      mode: "demo",
      scenario: "obstructed",
      profile: "ramp",
      use_ai: false,
    });
    expect(
      await screen.findByRole("button", { name: "Cancel inspection" }),
    ).toBeTruthy();
    expect(streams).toHaveLength(1);
  });
  it("streams measurements, handles completion, and retains the result", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "New inspection" }));
    await user.click(screen.getByRole("button", { name: "Start inspection" }));
    await waitFor(() => expect(streams.length).toBe(1));
    act(() => {
      streams[0].message("point", {
        angle_deg: 0,
        distance_cm: 40,
        spread_cm: 0.4,
        valid_pings: 15,
      });
    });
    expect(screen.getByRole("img", { name: /1 measured angles/ })).toBeTruthy();
    const result = {
      verdict: "FAIL",
      width_in: 29.1,
      width_cm: 73.914,
      running_slope_deg: 3.5,
      cross_slope_deg: 2.1,
      checks: [],
      drift: [],
      issues: [],
      noisy_angles: [40],
      scope: "Measured scope",
    };
    act(() => {
      streams[0].message("result", result, 2);
    });
    expect(screen.getByText("29.1")).toBeTruthy();
    store[0] = { ...store[0], status: "completed", result };
    await act(async () => {
      streams[0].listeners.end();
    });
    expect(await screen.findByText("Action needed")).toBeTruthy();
    expect(streams[0].closed).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Cancel inspection" }),
    ).toBeNull();
  });
  it("cancels a running scan", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "New inspection" }));
    await user.click(screen.getByRole("button", { name: "Start inspection" }));
    await user.click(
      await screen.findByRole("button", { name: "Cancel inspection" }),
    );
    await waitFor(() =>
      expect(
        requests.some((r) => r.path === "/api/scans/scan-one/cancel"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel inspection" }),
      ).toBeNull(),
    );
  });
  it("navigates to keys, baselines, work orders, and calibration", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByLabelText("Gemini API key")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Site baselines" }));
    expect(screen.getByRole("button", { name: "Add baseline" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Work orders" }));
    expect(screen.getByText("The next step, already organized.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Calibration lab" }));
    expect(
      await screen.findByText("No physical validation trials recorded yet."),
    ).toBeTruthy();
  });
  it("shows backend errors and unlocks the start button for retry", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options?: RequestInit) =>
        path === "/api/scans" && options?.method === "POST"
          ? new Response(JSON.stringify({ detail: "Arduino disconnected" }), {
              status: 400,
            })
          : original(path, options),
      ),
    );
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole("button", { name: "New inspection" }));
    await user.click(screen.getByRole("button", { name: "Start inspection" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Arduino disconnected").length,
      ).toBeGreaterThan(0),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Start inspection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

it("authenticates the launcher token once under React StrictMode", async () => {
  history.replaceState(null, "", "/#token=local-test-key");
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("heading", {
    name: "See what the blueprint missed.",
  });
  expect(requests.filter((r) => r.path === "/api/auth")).toHaveLength(1);
  expect(location.hash).toBe("");
});

it("closes the new inspection dialog with Escape", async () => {
  const user = userEvent.setup();
  await loaded();
  await user.click(screen.getByRole("button", { name: "New inspection" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("captures calibration positions from hardware and keeps relative tare separate", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/calibration/read-imu") {
        requests.push({ path, body: {}, method: "POST" });
        return new Response(
          JSON.stringify({ pitch_deg: 1.25, roll_deg: -0.5, still: true }),
          { status: 200 },
        );
      }
      return original(path, options);
    }),
  );
  const user = userEvent.setup();
  await loaded();
  await user.click(screen.getByRole("button", { name: "Calibration lab" }));
  await user.click(
    screen.getByRole("button", { name: "Capture forward position" }),
  );
  expect(
    (screen.getByLabelText("forward pitch (°)") as HTMLInputElement).value,
  ).toBe("1.25");
  expect(
    (screen.getByLabelText("forward roll (°)") as HTMLInputElement).value,
  ).toBe("-0.5");
  await user.click(
    screen.getByRole("button", { name: "Tare relative display here" }),
  );
  expect(
    await screen.findByText(/Relative display: pitch 0.000°/),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Save known-level zero",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    requests.some(
      (r) =>
        r.path === "/api/calibration/level" ||
        r.path === "/api/calibration/flip",
    ),
  ).toBe(false);
});

it("captures and displays a test frame beside the camera setting", async () => {
  const user = userEvent.setup();
  await loaded();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const index = screen.getByLabelText("Camera index");
  await user.clear(index);
  await user.type(index, "2");
  await user.click(screen.getByRole("button", { name: "Capture test frame" }));
  expect(await screen.findByAltText("Test frame from camera 2")).toBeTruthy();
  expect(
    requests.some(
      (r) =>
        r.path === "/api/hardware/test-camera" && r.body.camera_index === 2,
    ),
  ).toBe(true);
});
