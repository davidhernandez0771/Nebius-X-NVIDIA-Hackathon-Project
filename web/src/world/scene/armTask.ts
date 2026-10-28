// What the arm is doing for the cartridge in the hand, shared between the drag (which choreographs
// it: stations/workshop/Dragged.tsx) and the arm (which puts its fingertips where it is told, and
// lifts the spiral out of its way when asked: Arm.tsx, lift.ts). Mutated in place, like plug.ts.
import * as THREE from "three";

export const armTask = {
  /** The drag is steering the arm: its fingertips go to `grip`, exactly. Else it looks about on its own. */
  active: false,
  /** Where the fingertips are to be (world), and the hand's turn about the vertical (world yaw). */
  grip: new THREE.Vector3(),
  handYaw: 0,
  /** 0 open, 1 closed on a cartridge's top edge. */
  closed: 0,
  /** Whether the spiral is to be up out of the way (1) or in place (0): the arm moves it there (lift.ts). */
  liftWant: 0,
  /** The hand's light: 0 resting, 1 over a drop target. */
  glow: 0,
  /** Written by the arm every frame: where its fingertips are now, so a task starts from there. */
  hand: new THREE.Vector3(0, 6, 1.5),
  handYawNow: 0,
};

export function resetArmTask(): void {
  armTask.active = false;
  armTask.closed = 0;
  armTask.glow = 0;
  armTask.liftWant = 0;
}
