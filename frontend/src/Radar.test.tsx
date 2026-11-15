import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import Radar from "./Radar";
it("uses the simple red and green radar without attention controls", () => {
  render(
    <Radar
      active={false}
      points={[
        { angle_deg: 90, distance_cm: 80, spread_cm: 0.5, valid_pings: 15 },
        { angle_deg: 95, distance_cm: 90, spread_cm: 8, valid_pings: 15 },
      ]}
    />,
  );
  const svg = screen.getByRole("img");
  const colors = [...svg.querySelectorAll("circle")].map((c) =>
    c.getAttribute("fill"),
  );
  expect(colors).toContain("#b7ec8c");
  expect(colors).toContain("#ef827c");
  expect(screen.queryByLabelText("Radar view")).toBeNull();
});
