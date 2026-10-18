// Who is holding the sheet: the mouse/touch pointer or a webcam hand, one at a time.
//
// Pure reducer: events in, grab/drag/release commands out. The component turns a "grab" into a
// pick on the cloth (which may miss), so the reducer only tracks ownership, never the cloth.
//
// Rules:
// - The pointer wins: pressing while a hand holds the sheet releases the hand's hold and grabs.
// - A hand grabs only on the frame its pinch STARTS. A hand that is already pinched when it
//   arrives (or while the mouse was dragging) has to open and pinch again, so sweeping a closed
//   hand across the sheet never picks it up by accident.
// - Losing the hand (no point) or opening it releases.
// - Only the pointer that pressed can drag or release (a second finger is ignored).

/** CSS pixels relative to the viewport (clientX/Y), the same space as the app's hand cursor. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A hand-pinch input sample; `point` is null when the hand isn't tracked. */
export interface HandPinch {
  point: ScreenPoint | null;
  pinching: boolean;
}

export type PinchSource = "pointer" | "hand";

export type PinchInputEvent =
  | { type: "pointerdown"; id: number; point: ScreenPoint }
  | { type: "pointermove"; id: number; point: ScreenPoint }
  /** pointerup or pointercancel */
  | { type: "pointerup"; id: number }
  | { type: "hand"; hand: HandPinch | null };

export type PinchCommand =
  | { type: "grab"; source: PinchSource; point: ScreenPoint }
  | { type: "drag"; point: ScreenPoint }
  | { type: "release" };

export interface PinchInputState {
  owner: PinchSource | null;
  pointerId: number | null;
  /** Whether the hand was pinched on its last sample (for the rising edge). */
  handPinching: boolean;
}

export const INITIAL_PINCH_INPUT: PinchInputState = { owner: null, pointerId: null, handPinching: false };

export function reducePinchInput(
  state: PinchInputState,
  event: PinchInputEvent,
): { state: PinchInputState; commands: PinchCommand[] } {
  switch (event.type) {
    case "pointerdown": {
      if (state.owner === "pointer") return { state, commands: [] };
      const commands: PinchCommand[] = state.owner === "hand" ? [{ type: "release" }] : [];
      commands.push({ type: "grab", source: "pointer", point: event.point });
      return { state: { ...state, owner: "pointer", pointerId: event.id }, commands };
    }
    case "pointermove":
      if (state.owner !== "pointer" || state.pointerId !== event.id) return { state, commands: [] };
      return { state, commands: [{ type: "drag", point: event.point }] };
    case "pointerup":
      if (state.owner !== "pointer" || state.pointerId !== event.id) return { state, commands: [] };
      return { state: { ...state, owner: null, pointerId: null }, commands: [{ type: "release" }] };
    case "hand": {
      const point = event.hand?.point ?? null;
      const pinching = !!event.hand?.pinching && point !== null;
      const next = { ...state, handPinching: pinching };
      if (state.owner === "pointer") return { state: next, commands: [] };
      if (state.owner === "hand") {
        if (pinching && point) return { state: next, commands: [{ type: "drag", point }] };
        return { state: { ...next, owner: null }, commands: [{ type: "release" }] };
      }
      if (pinching && point && !state.handPinching)
        return { state: { ...next, owner: "hand" }, commands: [{ type: "grab", source: "hand", point }] };
      return { state: next, commands: [] };
    }
  }
}
