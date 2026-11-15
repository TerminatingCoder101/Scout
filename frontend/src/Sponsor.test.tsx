import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Sponsor from "./Sponsor";
import type { Settings } from "./types";

const settings = {
  matterport_api_key_configured: true,
  matterport_api_token_configured: true,
  matterport_sdk_key_configured: true,
  vexcel_api_key_configured: true,
} as Settings;
const property = {
  id: "commercial-1",
  name: "Test property",
  address: "1 Test St",
  city: "Houston",
  state: "TX",
  kind: "commercial",
  model_ids: ["model123"],
  latitude: 29.7,
  longitude: -95.4,
  facts: {},
  provenance: { dataset: "synthetic", imported_at: "2026-01-01" },
};
const review = {
  id: "review123",
  created_at: "2026-01-01",
  status: "ready",
  property,
  model_id: "model123",
  layers: ["costar", "matterport", "vexcel"],
  layer_errors: {},
  events: [],
  vexcel: {
    image: "aerial.jpg",
    extent: "120m context",
    retrieved_at: "2026-01-01",
  },
  matterport: {
    name: "Test space",
    created: "2026-01-01",
    image: "interior.jpg",
    geometry: { rooms: [], floors: [] },
  },
  match_warnings: ["Verify unit coverage."],
};
let requests: { path: string; body: any }[] = [];
beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : null;
      requests.push({ path, body });
      let result: unknown = {};
      if (path.startsWith("/api/sponsor/properties"))
        result = { items: [property], total: 1 };
      else if (path === "/api/sponsor/reviews")
        result = options.method === "POST" ? review : [];
      else if (path.endsWith("/inspections")) result = [];
      else if (path === "/api/settings") result = settings;
      else if (path.endsWith("/plan"))
        result = {
          ...review,
          status: "completed",
          plan: {
            id: "PLAN-TEST",
            summary: "Inspect the route.",
            scope: "Remote review",
            actions: [
              {
                title: "Inspect entrance",
                location: "East door",
                reason: "Joined property and interior evidence",
                next_action: "Measure clearance",
                sources: ["costar", "matterport"],
              },
            ],
            limitations: ["Verify on site."],
          },
        };
      return new Response(JSON.stringify(result), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("saves only newly entered sponsor keys and clears secret inputs", async () => {
  const user = userEvent.setup();
  render(<Sponsor settings={settings} onChange={vi.fn()} />);
  await user.click(screen.getByText("Connect sponsor accounts"));
  const key = screen.getByLabelText("Vexcel API key");
  await user.type(key, "new-local-secret");
  await user.click(
    screen.getByRole("button", { name: "Save sponsor credentials" }),
  );
  await screen.findByRole("status");
  expect(requests.find((r) => r.path === "/api/settings")?.body).toEqual({
    vexcel_api_key: "new-local-secret",
  });
  expect((key as HTMLInputElement).value).toBe("");
});

it("loads linked layers and requires location confirmation before planning", async () => {
  const user = userEvent.setup();
  const createInspection = vi.fn();
  render(
    <Sponsor
      settings={settings}
      onChange={vi.fn()}
      onCreateInspection={createInspection}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: /Test property.*1 Test St/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Load Matterport + Vexcel evidence" }),
  );
  expect(
    await screen.findByAltText(
      "Vexcel aerial context around the selected CoStar property",
    ),
  ).toBeTruthy();
  expect(screen.getByText("Verify unit coverage.")).toBeTruthy();
  const plan = screen.getByRole("button", {
    name: "Run DeepAgent inspection planner",
  }) as HTMLButtonElement;
  expect(plan.disabled).toBe(true);
  await user.click(screen.getByRole("checkbox"));
  expect(plan.disabled).toBe(false);
  await user.click(plan);
  await waitFor(() =>
    expect(
      requests.some(
        (r) => r.path.endsWith("/plan") && r.body.location_confirmed,
      ),
    ).toBe(true),
  );
  expect(await screen.findByText("Recommended inspection plan")).toBeTruthy();
  await user.click(screen.getByText("Create site inspection from this plan"));
  expect(createInspection).toHaveBeenCalledWith(
    "review123",
    0,
    "Inspect entrance",
  );
});
