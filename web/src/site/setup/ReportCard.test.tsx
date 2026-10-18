import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import frankaParts from "./fixtures/franka.parts.json";
import frankaReport from "./fixtures/franka.report.json";
import openarmParts from "./fixtures/openarm.parts.json";
import openarmReport from "./fixtures/openarm.report.json";
import { ReportCard } from "./ReportCard";
import type { Parts, ReportCard as Card } from "./types";

afterEach(cleanup);

const openarm = () => render(<ReportCard report={openarmReport as unknown as Card} parts={openarmParts as unknown as Parts} />);

describe("ReportCard", () => {
  it("shows the OpenArm's 0/30, why, and the design flaw", () => {
    openarm();
    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.getByRole("list", { name: "0 of 30 scenes done" }).children).toHaveLength(30);
    const flaw = screen.getByRole("region", { name: "Design flaw found" });
    expect(within(flaw).getByText("openarm_joint6")).toBeTruthy();
    expect(flaw.textContent).toContain("−45° to +45°");
    expect(flaw.textContent).toContain("17 of 30");
    expect(screen.getByText("Couldn't follow the path")).toBeTruthy();
  });

  it("draws the reach map with every scene's cube and a hatched unreachable cell", () => {
    const { container } = openarm();
    expect(container.querySelectorAll(".byor-reach__cell")).toHaveLength(6 * 13);
    expect(container.querySelectorAll(".byor-reach__scene")).toHaveLength(30);
    // the hatch is an inline style so the stylesheet's teal fill can't cover it
    expect(container.querySelector<SVGElement>('.byor-reach__cell[data-count="0"]')?.style.fill).toMatch(/^url\(/);
    expect(screen.getByText("The tool reaches 51% of the cells in all 5 poses.")).toBeTruthy();
  });

  it("says where every number comes from, including that it is recorded data", () => {
    openarm();
    expect(screen.getByText(/T1 web fixture, not a BYOR run/)).toBeTruthy();
  });

  it("finds no flaw on the Franka's 30/30", () => {
    render(<ReportCard report={frankaReport as unknown as Card} parts={frankaParts as unknown as Parts} />);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Design flaw found" })).toBeNull();
    expect(screen.getByText("No scene failed.")).toBeTruthy();
  });
});
