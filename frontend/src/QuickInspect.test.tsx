import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import QuickInspect from "./QuickInspect";
afterEach(() => vi.unstubAllGlobals());
it("retains the location and sends it through the redesigned Business form", async () => {
  const requests: { path: string; body: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : null;
      requests.push({ path, body });
      const result =
        path === "/api/status"
          ? {
              settings: { gemini_api_key_configured: false },
              device: { connected: true },
              active_scan_id: null,
            }
          : path === "/api/twins"
            ? [{ id: "fixture", name: "Reference", location: "Test" }]
            : options.method === "POST"
              ? {
                  id: "scan-test",
                  status: "queued",
                  request: body,
                  points: [],
                  twin: { name: "Reference" },
                }
              : [];
      return new Response(JSON.stringify(result), { status: 200 });
    }),
  );
  render(<QuickInspect onOpenWorkspace={vi.fn()} />);
  const input = await screen.findByLabelText("Location ID");
  await userEvent.clear(input);
  await userEvent.type(input, "east-door");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await waitFor(() =>
    expect(
      requests.find((r) => r.path === "/api/scans" && r.body)?.body,
    ).toMatchObject({
      location_id: "east-door",
      building_id: "fixture",
      mode: "hardware",
    }),
  );
});
