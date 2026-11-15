import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, afterEach } from "vitest";
import InspectionHistory from "./InspectionHistory";
import { api, post, patch } from "./api";
vi.mock("./api", () => ({
  api: vi.fn(),
  patch: vi.fn().mockResolvedValue({}),
  post: vi.fn().mockResolvedValue({ imported: 0, failed: 0 }),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
const record = {
  id: "one",
  building_id: "building",
  location_id: "door",
  timestamp: "2026-01-01T00:00:00Z",
  measurements: [{ key: "width", value: 80, uncertainty: 2, unit: "cm" }],
  findings: [{ key: "box", status: "inconclusive", detail: "Recheck" }],
  review_status: "recheck",
};
it("shows uncertainty, filters and insufficient comparison history", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/inspections/compare"))
      throw new Error(
        "Two inspections for this building and location are required.",
      );
    return [record] as never;
  });
  render(<InspectionHistory />);
  expect(await screen.findByText("width: 80 ± 2 cm")).toBeTruthy();
  await userEvent.click(screen.getByText("Expand inspection details"));
  await userEvent.click(screen.getByText("Compare latest two"));
  expect(await screen.findByText(/Two inspections/)).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Building ID"), "building");
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([p]) => p.includes("building_id=building")),
    ).toBe(true),
  );
});
it("polls saved records and cleans up the interval", async () => {
  vi.useFakeTimers();
  vi.mocked(api).mockResolvedValue([]);
  const view = render(<InspectionHistory />);
  await act(async () => {});
  expect(api).toHaveBeenCalledTimes(2);
  vi.mocked(api).mockResolvedValue([record]);
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.getByText("width: 80 ± 2 cm")).toBeTruthy();
  view.unmount();
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(api).toHaveBeenCalledTimes(4);
});
it("renders analytics values and empty charts from the API", async () => {
  vi.mocked(api).mockResolvedValue({
    total_inspections: 0,
    open_findings: 0,
    verified_fixes: 0,
    categories: [],
    activity: [],
  });
  render(<InspectionHistory analytics />);
  expect(await screen.findByText("Verified fixes")).toBeTruthy();
  expect(screen.getAllByText("No recorded data yet.")).toHaveLength(2);
});

it("merges linked scans into expandable history rows with radar evidence", async () => {
  const scan = {
    id: "scan-one",
    request: {
      building_id: "building",
      location_id: "door",
      profile: "doorway",
      mode: "demo",
    },
    points: [{ angle_deg: 90, distance_cm: 80, spread_cm: 1, valid_pings: 15 }],
    images: [],
  };
  vi.mocked(api).mockImplementation(
    async (path) =>
      (path === "/scans"
        ? [scan]
        : [
            {
              ...record,
              scan_id: scan.id,
              raw_sensor_measurements: scan.points,
            },
          ]) as never,
  );
  const viewScan = vi.fn();
  render(<InspectionHistory onViewScan={viewScan} />);
  expect(await screen.findByText("building / door")).toBeTruthy();
  expect(screen.getAllByText("Expand inspection details")).toHaveLength(1);
  const toggle = screen
    .getByText("Expand inspection details")
    .closest("summary")!;
  expect(toggle.parentElement?.hasAttribute("open")).toBe(false);
  await userEvent.click(toggle);
  expect(toggle.parentElement?.hasAttribute("open")).toBe(true);
  expect(
    screen.getByRole("img", { name: /Polar radar with 1 measured angles/ }),
  ).toBeTruthy();
  await userEvent.click(screen.getByText("Open full inspection"));
  expect(viewScan).toHaveBeenCalledWith(scan);
});

it("renders a visible activity bar even when all inspections are on one date", async () => {
  vi.mocked(api).mockImplementation(
    async (path) =>
      (path === "/scans" ? [] : [record, { ...record, id: "two" }]) as never,
  );
  render(<InspectionHistory />);
  const chart = await screen.findByRole("img", {
    name: "Inspection activity · loaded records (UTC)",
  });
  const bar = chart.querySelector("rect")!;
  expect(Number(bar.getAttribute("height"))).toBeGreaterThan(0);
  expect(Number(bar.getAttribute("width"))).toBeGreaterThan(0);
  expect(chart.textContent).toContain("2026-01-01: 2 inspections");
});

it("loads Analytics after syncing old scans and renders category counts", async () => {
  vi.mocked(post).mockResolvedValue({ imported: 3, failed: 0 });
  vi.mocked(api).mockResolvedValue({
    total_inspections: 35,
    open_findings: 14,
    verified_fixes: 0,
    categories: [{ category: "width", count: 4 }],
    activity: [{ date: "2026-01-01", count: 35 }],
  });
  render(<InspectionHistory analytics />);
  expect(await screen.findByText("Total inspections")).toBeTruthy();
  expect(post).toHaveBeenCalledWith("/inspections/sync-local");
  expect(screen.getByRole("img", { name: "width: 4 findings" })).toBeTruthy();
  expect(
    screen.getByRole("img", { name: "Inspection activity (UTC)" }).textContent,
  ).toContain("35 inspections");
});

it("records explicit human review notes without altering measured values", async () => {
  vi.mocked(api).mockImplementation(
    async (path) => (path === "/scans" ? [] : [record]) as never,
  );
  render(<InspectionHistory />);
  await userEvent.click(await screen.findByText("Expand inspection details"));
  await userEvent.click(
    screen.getByText("Human review / record a verified resolution"),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Review box"),
    "resolved",
  );
  await userEvent.type(
    screen.getByLabelText("Review evidence and notes"),
    "Physical check completed.",
  );
  await userEvent.click(screen.getByText("Save human review"));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith("/inspections/one/review", {
      findings: [{ ...record.findings[0], status: "resolved" }],
      notes: "Physical check completed.",
    }),
  );
});
