// The Record page's hand-art cue: a counter bumped whenever something happens that the style
// change should mark (grab, release, Reset scene, recording start/stop). The overlay (trigger
// "events") crossfades to the next style on each change, with a cooldown. Display only: nothing
// here feeds the control or the gripper.

export interface ArtCueInput {
  gripper: 0 | 1;
  recording: boolean;
  resets: number; // Reset scene presses so far
}

export class ArtCue {
  private last: ArtCueInput | null = null;
  private count = 0;

  update(x: ArtCueInput): number {
    const p = this.last;
    if (p && (x.gripper !== p.gripper || x.recording !== p.recording || x.resets !== p.resets)) this.count++;
    this.last = { ...x };
    return this.count;
  }
}
