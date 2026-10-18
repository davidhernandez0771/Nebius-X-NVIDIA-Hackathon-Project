import { describe, expect, it } from "vitest";
import { INITIAL_PINCH_INPUT, reducePinchInput, type PinchInputEvent, type PinchInputState } from "./pinchInput";

const P = (x: number, y: number) => ({ x, y });

function play(events: PinchInputEvent[], from: PinchInputState = INITIAL_PINCH_INPUT) {
  let state = from;
  const commands = [];
  for (const e of events) {
    const r = reducePinchInput(state, e);
    state = r.state;
    commands.push(...r.commands);
  }
  return { state, commands };
}

describe("pinch input: mouse, touch and an optional hand, one owner at a time", () => {
  it("pointer down grabs, moves drag, up releases", () => {
    const { state, commands } = play([
      { type: "pointerdown", id: 1, point: P(10, 20) },
      { type: "pointermove", id: 1, point: P(15, 25) },
      { type: "pointerup", id: 1 },
    ]);
    expect(commands).toEqual([
      { type: "grab", source: "pointer", point: P(10, 20) },
      { type: "drag", point: P(15, 25) },
      { type: "release" },
    ]);
    expect(state.owner).toBeNull();
  });

  it("ignores moves with no button down, and a second finger while one is dragging", () => {
    const { commands } = play([
      { type: "pointermove", id: 1, point: P(1, 1) },
      { type: "pointerdown", id: 1, point: P(10, 20) },
      { type: "pointerdown", id: 2, point: P(50, 50) },
      { type: "pointermove", id: 2, point: P(60, 60) },
      { type: "pointerup", id: 2 },
      { type: "pointermove", id: 1, point: P(11, 21) },
    ]);
    expect(commands).toEqual([
      { type: "grab", source: "pointer", point: P(10, 20) },
      { type: "drag", point: P(11, 21) },
    ]);
  });

  it("a hand grabs when it starts pinching, drags while pinched, releases when it opens", () => {
    const { commands, state } = play([
      { type: "hand", hand: { point: P(100, 100), pinching: false } },
      { type: "hand", hand: { point: P(100, 100), pinching: true } },
      { type: "hand", hand: { point: P(110, 105), pinching: true } },
      { type: "hand", hand: { point: P(110, 105), pinching: false } },
    ]);
    expect(commands).toEqual([
      { type: "grab", source: "hand", point: P(100, 100) },
      { type: "drag", point: P(110, 105) },
      { type: "release" },
    ]);
    expect(state.owner).toBeNull();
  });

  it("a hand that arrives already pinched does not grab until it opens and pinches again", () => {
    const { commands } = play([
      { type: "hand", hand: { point: P(100, 100), pinching: true } },
      { type: "hand", hand: { point: P(120, 100), pinching: true } },
      { type: "hand", hand: { point: P(120, 100), pinching: false } },
      { type: "hand", hand: { point: P(120, 100), pinching: true } },
    ], { ...INITIAL_PINCH_INPUT, handPinching: true });
    expect(commands).toEqual([{ type: "grab", source: "hand", point: P(120, 100) }]);
  });

  it("losing the hand (no point, or no hand at all) releases what it held", () => {
    for (const lost of [null, { point: null, pinching: true }]) {
      const { commands, state } = play([
        { type: "hand", hand: { point: P(5, 5), pinching: true } },
        { type: "hand", hand: lost },
      ]);
      expect(commands).toEqual([{ type: "grab", source: "hand", point: P(5, 5) }, { type: "release" }]);
      expect(state.owner).toBeNull();
    }
  });

  it("the mouse wins: pressing during a hand drag takes over", () => {
    const { commands, state } = play([
      { type: "hand", hand: { point: P(5, 5), pinching: true } },
      { type: "pointerdown", id: 7, point: P(40, 40) },
      { type: "hand", hand: { point: P(9, 9), pinching: true } },
    ]);
    expect(commands).toEqual([
      { type: "grab", source: "hand", point: P(5, 5) },
      { type: "release" },
      { type: "grab", source: "pointer", point: P(40, 40) },
    ]);
    expect(state.owner).toBe("pointer");
  });

  it("a hand pinch during a mouse drag is ignored, and still has to reopen afterwards", () => {
    const { commands } = play([
      { type: "pointerdown", id: 1, point: P(0, 0) },
      { type: "hand", hand: { point: P(5, 5), pinching: true } },
      { type: "pointerup", id: 1 },
      { type: "hand", hand: { point: P(6, 6), pinching: true } }, // still the same pinch
      { type: "hand", hand: { point: P(6, 6), pinching: false } },
      { type: "hand", hand: { point: P(7, 7), pinching: true } },
    ]);
    expect(commands).toEqual([
      { type: "grab", source: "pointer", point: P(0, 0) },
      { type: "release" },
      { type: "grab", source: "hand", point: P(7, 7) },
    ]);
  });

  it("a stray pointer up from a pointer it never saw does nothing", () => {
    expect(play([{ type: "pointerup", id: 3 }]).commands).toEqual([]);
  });

  it("does not mutate the state it is given", () => {
    const s = { ...INITIAL_PINCH_INPUT };
    reducePinchInput(s, { type: "pointerdown", id: 1, point: P(0, 0) });
    expect(s).toEqual(INITIAL_PINCH_INPUT);
  });
});
