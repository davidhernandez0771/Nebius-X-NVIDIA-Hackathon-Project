import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fixtureClient, RECORDED } from "./client";
import { SettingsDrawer } from "./SettingsDrawer";

afterEach(cleanup);

const robot = { client: fixtureClient(), upload: RECORDED.openarm.upload, parts: RECORDED.openarm.parts, file: null };

describe("SettingsDrawer", () => {
  it("holds the mount, the robot's facts with their sources, and what data the page is on", () => {
    render(<SettingsDrawer open={false} onClose={() => {}} robot={robot} mount={[0.2, 0, 0.25]} onMount={() => {}} recorded report={null} />);
    expect((screen.getByLabelText("z (m)") as HTMLInputElement).value).toBe("0.25");
    expect(screen.getByText(/link openarm_ee_tcp: a fixed child of the hand/)).toBeTruthy();
    expect(screen.getByText(/^Recorded data: the backend/)).toBeTruthy();
  });

  it("lists every source on the card, including that it is recorded data", () => {
    render(
      <SettingsDrawer open={false} tab="sources" onClose={() => {}} robot={robot} mount={[0, 0, 0]} onMount={() => {}} recorded report={RECORDED.openarm.report} />,
    );
    expect(screen.getByText(/T1 web fixture, not a BYOR run/)).toBeTruthy();
    expect(screen.getByText(/openarm_joint6 upper: 15 scenes, 1214 steps/)).toBeTruthy();
  });
});
