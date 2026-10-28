import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import HandLockChip from "./HandLockChip";
import type { HandLockStatus } from "./teleop/handLock";

afterEach(cleanup);

const st = (over: Partial<HandLockStatus>): HandLockStatus => ({ phase: "searching", handedness: null, progress: 0, held: null, ...over });

describe("HandLockChip", () => {
  it("says which of the user's hands is locked", () => {
    render(<HandLockChip status={st({ phase: "locked", handedness: "Left", progress: 1 })} onRepick={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("locked: right hand");
    expect(screen.getByRole("status")).toHaveAttribute("data-phase", "locked");
  });

  it("shows holding, lost and searching too", () => {
    const { rerender } = render(<HandLockChip status={st({ phase: "holding", handedness: "Right", progress: 1, held: "glitch" })} onRepick={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("holding: left hand");
    rerender(<HandLockChip status={st({ phase: "lost", handedness: "Left" })} onRepick={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("lost: show your right hand");
    rerender(<HandLockChip status={st({ progress: 0.5 })} onRepick={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("hold one hand still");
  });

  it("shows nothing before the first frame", () => {
    const { container } = render(<HandLockChip status={null} onRepick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Re-pick calls onRepick; offered only once a hand is (or was) locked", () => {
    const onRepick = vi.fn();
    const { rerender } = render(<HandLockChip status={st({ phase: "locked", handedness: "Left", progress: 1 })} onRepick={onRepick} />);
    fireEvent.click(screen.getByRole("button", { name: "Re-pick hand" }));
    expect(onRepick).toHaveBeenCalledTimes(1);
    rerender(<HandLockChip status={st({})} onRepick={onRepick} />);
    expect(screen.queryByRole("button", { name: "Re-pick hand" })).toBeNull();
  });
});
