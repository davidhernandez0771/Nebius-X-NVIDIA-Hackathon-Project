// "Save camera video": the take's webcam recording, its timing against the hand messages, and which demo it is
// uploaded with (only the one the sim saved for this take; discarded or unsaved takes save nothing).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraTake, SAVED_ID_WAIT_MS, TIMESLICE_MS, alignFrames, type CameraTiming, type Recorder } from "./cameraTake";
import type { SimStatus } from "./recordLink";

describe("alignFrames", () => {
  it("puts each hand frame at (t_ms - start_ms) / 1000 in the video, keeping only the take's frames", () => {
    const out = alignFrames([990, 1000, 1033.36, 1066.71, 1100, 1133.4], 1000, 1100);
    expect(out.t_ms).toEqual([1000, 1033.4, 1066.7, 1100]);
    expect(out.video_s).toEqual([0, 0.0334, 0.0667, 0.1]);
    out.t_ms.forEach((t, i) => expect(Math.abs(out.video_s[i] - (t - 1000) / 1000)).toBeLessThan(0.001)); // the backend's check
  });

  it("is empty for no frames", () => {
    expect(alignFrames([], 0, 10)).toEqual({ t_ms: [], video_s: [] });
  });
});

class FakeRecorder implements Recorder {
  mimeType = "video/webm;codecs=vp9";
  state: "inactive" | "recording" = "inactive";
  timeslice?: number;
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  stop() {
    this.state = "inactive";
  }
  // What the browser does, later: start event, chunks, then the last chunk and stop.
  fireStart() {
    this.onstart?.();
  }
  chunk(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) } as BlobEvent);
  }
  fireStop() {
    this.chunk("last");
    this.onstop?.();
  }
}

const status = (over: Partial<SimStatus> = {}): SimStatus => ({ recording: false, steps: 0, demoId: null, lastResult: null, paused: false, ...over });

describe("CameraTake", () => {
  let now: number;
  let rec: FakeRecorder;
  let uploads: { id: string; video: Blob; timing: CameraTiming }[];
  let notes: string[];
  let stream: MediaStream | null;
  let take: CameraTake;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 5000;
    uploads = [];
    notes = [];
    stream = { getVideoTracks: () => [{ getSettings: () => ({ width: 640, height: 480 }) }] } as unknown as MediaStream;
    take = new CameraTake({
      stream: () => stream,
      recorder: () => (rec = new FakeRecorder()),
      upload: async (id, video, timing) => void uploads.push({ id, video, timing }),
      report: (n) => notes.push(n),
      now: () => now,
    });
  });
  afterEach(() => vi.useRealTimers());

  /** One take: record_start at 5000, the recorder's first frame at 5010, hand frames every 33 ms, record_stop at 6000. */
  function record(demoBefore: string | null = "human_old") {
    take.begin(demoBefore);
    take.sim(status({ recording: true, demoId: demoBefore }));
    now = 5010;
    rec.fireStart();
    for (let t = 5000; t <= 6000; t += 33) take.frame(t);
    rec.chunk("a");
    now = 6000;
    take.end();
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("records with a timeslice, and uploads the video with its timing once the sim names the new demo", async () => {
    record();
    expect(rec.timeslice).toBe(TIMESLICE_MS);
    rec.fireStop();
    expect(uploads).toEqual([]); // the sim hasn't said which demo yet
    take.sim(status({ demoId: "human_new" }));
    await flush();
    expect(uploads.map((u) => u.id)).toEqual(["human_new"]);
    const { timing, video } = uploads[0];
    expect(await video.text()).toBe("alast");
    expect(video.type).toBe("video/webm");
    expect(timing).toMatchObject({ version: 1, clock: "performance.now", mime: "video/webm;codecs=vp9", start_ms: 5010, stop_ms: 6000, record_start_ms: 5000, record_stop_ms: 6000, frame_w: 640, frame_h: 480 });
    // Frames before the recorder's first frame are dropped; the rest line up: 5010 is video time 0.
    expect(timing.t_ms[0]).toBe(5033);
    expect(timing.video_s[0]).toBeCloseTo(0.023, 6);
    expect(timing.t_ms.length).toBe(timing.video_s.length);
    expect(notes[notes.length - 1]).toBe("camera video saved: demos/human_new/camera.webm");
  });

  it("works the other way round too: the sim names the demo before the recorder hands over the video", async () => {
    record();
    take.sim(status({ demoId: "human_new" }));
    rec.fireStop();
    await flush();
    expect(uploads.map((u) => u.id)).toEqual(["human_new"]);
  });

  it("waits out statuses sent before the sim got record_stop", async () => {
    record();
    rec.fireStop();
    take.sim(status({ recording: true, steps: 90, demoId: "human_old" }));
    await flush();
    expect(uploads).toEqual([]);
    take.sim(status({ demoId: "human_new" }));
    await flush();
    expect(uploads.map((u) => u.id)).toEqual(["human_new"]);
  });

  it("a discarded take saves nothing", async () => {
    take.begin("human_old");
    take.sim(status({ recording: true, demoId: "human_old" }));
    rec.fireStart();
    take.frame(5100);
    const discarded = rec;
    take.discard();
    expect(discarded.state).toBe("inactive");
    discarded.onstop?.();
    take.sim(status({ demoId: "human_old", lastResult: "discarded: 40 step(s) not saved" }));
    await vi.advanceTimersByTimeAsync(SAVED_ID_WAIT_MS * 2);
    expect(uploads).toEqual([]);
  });

  it("a take the sim didn't save (too short, save failed) uploads nothing and says so", async () => {
    record();
    rec.fireStop();
    take.sim(status({ demoId: null, lastResult: "only 3 step(s) recorded; not saved" }));
    await flush();
    expect(uploads).toEqual([]);
    expect(notes[notes.length - 1]).toBe("camera video not saved: the sim saved no demo");
  });

  it("never guesses: a take that saw no recording status of its own is dropped after the wait", async () => {
    take.begin("human_old");
    rec.fireStart();
    now = 5100;
    take.end();
    rec.fireStop();
    take.sim(status({ demoId: "human_other" }));
    await vi.advanceTimersByTimeAsync(SAVED_ID_WAIT_MS);
    expect(uploads).toEqual([]);
    expect(notes[notes.length - 1]).toMatch(/didn't say which demo/);
  });

  it("the take's baseline is the sim's id while it records, not a stale one from the page", async () => {
    take.begin(null); // the page hadn't seen a status yet
    take.sim(status({ recording: true, demoId: "human_prev" }));
    rec.fireStart();
    now = 6000;
    take.end();
    rec.fireStop();
    take.sim(status({ recording: true, demoId: "human_prev" })); // before the sim got record_stop: not a new id
    await flush();
    expect(uploads).toEqual([]);
    take.sim(status({ demoId: "human_this" }));
    await flush();
    expect(uploads.map((u) => u.id)).toEqual(["human_this"]);
  });

  it("a new take started before the last one's id came still gets the right ids for both", async () => {
    record();
    const first = rec;
    take.begin("human_old"); // the page's id is stale: the sim already saved human_a
    take.sim(status({ recording: true, demoId: "human_a" })); // the second take recording: names the first's demo
    first.fireStop();
    await flush();
    expect(uploads.map((u) => u.id)).toEqual(["human_a"]);
    rec.fireStart();
    now = 7000;
    take.end();
    rec.fireStop();
    take.sim(status({ demoId: "human_b" }));
    await flush();
    expect(uploads.map((u) => u.id)).toEqual(["human_a", "human_b"]);
  });

  it("the camera stopping drops a take in progress and one waiting for its id", async () => {
    record();
    rec.fireStop();
    take.close();
    take.sim(status({ demoId: "human_new" }));
    await flush();
    expect(uploads).toEqual([]);
  });

  it("no camera stream or a recorder that fails: nothing is recorded, and the note says why", async () => {
    stream = null;
    take.begin("human_old");
    expect(notes).toEqual(["camera video not saved: no camera stream"]);
    stream = {} as MediaStream;
    take = new CameraTake({
      stream: () => stream,
      recorder: () => {
        throw new Error("NotSupportedError");
      },
      upload: async () => {},
      report: (n) => notes.push(n),
      now: () => now,
    });
    take.begin("human_old");
    expect(notes[notes.length - 1]).toBe("camera video not saved: NotSupportedError");
  });

  it("a failed upload is reported, not thrown", async () => {
    take = new CameraTake({
      stream: () => stream,
      recorder: () => (rec = new FakeRecorder()),
      upload: async () => {
        throw new Error("Can't reach the backend");
      },
      report: (n) => notes.push(n),
      now: () => now,
    });
    record();
    rec.fireStop();
    take.sim(status({ demoId: "human_new" }));
    await flush();
    expect(notes[notes.length - 1]).toBe("camera video not saved: Can't reach the backend");
  });
});
