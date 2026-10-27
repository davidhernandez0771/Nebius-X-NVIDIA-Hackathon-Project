// The way out of a place in the workshop: a real button, where you are, a hint with Escape.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StationBar } from "./StationBar";

describe("the station bar", () => {
  afterEach(cleanup);

  it("is a real Back to room button, with where you are and how to get out", () => {
    const back = vi.fn();
    render(<StationBar on title="The machine" hint="Watch it plug in" back={back} />);
    const group = screen.getByRole("group", { name: "The machine: the way out" });
    expect(group.textContent).toContain("The machine");
    expect(group.textContent).toContain("Watch it plug in");
    expect(group.querySelector("kbd")?.textContent).toBe("Esc");
    const button = screen.getByRole("button", { name: "Back to room" });
    expect(button.tagName).toBe("BUTTON");
    fireEvent.click(button);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("puts a step back inside the place first, and says Escape steps back", () => {
    const step = vi.fn();
    render(<StationBar on title="The robot wall" hint="Click a robot" back={() => {}} step={{ label: "All robots", onClick: step }} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["← All robots", "← Back to room"]);
    fireEvent.click(buttons[0]);
    expect(step).toHaveBeenCalled();
    expect(screen.getByRole("group").textContent).toContain("Esc steps back");
  });

  it("is not there while the place is closed", () => {
    render(<StationBar on={false} title="The machine" hint="" back={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
