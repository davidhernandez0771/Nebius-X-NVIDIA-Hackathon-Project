// "Save camera video" (Camera mode, on by default): the webcam is recorded with each take, for an offline hand refine
// later (WiLoR / HaMeR re-run on the video for a more accurate hand path). MediaRecorder records the camera's own
// stream as webm from record_start to record_stop, and every hand frame's timestamp in the take is logged on the clock
// of the HandPoseMsg t_ms (performance.now()). When the sim names the demo it saved, the video and its timing go to
// PUT /demos/{id}/camera on the local backend: demos/<id>/camera.webm and demos/<id>/camera.json. Nothing leaves the
// machine. A discarded take, a take the sim didn't save, and a take still open when the camera stops save nothing.
//
// Lining up: a hand message with t_ms is at video_s = (t_ms - start_ms) / 1000 in camera.webm, where start_ms is the
// recorder's start event (its first frame, to within a frame or so). camera.json lists each hand frame's t_ms and
// video_s, and record_start_ms / record_stop_ms (when the page sent them) for lining up with the sim's steps.
//
// Which demo: the sim's status names its last saved demo. While a take records, that id is the take's baseline; after
// record_stop, the first status that has moved on (not recording, or recording again with another id) names the
// take's demo if the id is new, or says it saved nothing. A take that never saw a "recording" status, or whose status
// never comes, is dropped rather than risk landing on another demo.

import type { SimStatus } from "./recordLink";

export const TIMESLICE_MS = 1000; // a chunk a second, so a long take never sits in one buffer
export const SAVED_ID_WAIT_MS = 20_000; // after record_stop, how long to wait for the sim to name the saved demo
const MIME_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

/** camera.json: how camera.webm lines up with the hand messages. */
export interface CameraTiming {
  version: 1;
  clock: "performance.now"; // milliseconds, the HandPoseMsg t_ms clock
  mime: string;
  start_ms: number; // the recorder started: video time 0
  stop_ms: number; // the recorder was told to stop
  record_start_ms: number; // the page sent record_start
  record_stop_ms: number; // the page sent record_stop
  frame_w: number | null;
  frame_h: number | null;
  t_ms: number[]; // each hand frame in the take (its HandPoseMsg t_ms)
  video_s: number[]; // the same frame's place in camera.webm, seconds
}

/** The hand frames between start and stop, each with its place in the video (t_ms to 0.1 ms, video_s to 0.1 ms). */
export function alignFrames(tMs: readonly number[], startMs: number, stopMs: number): Pick<CameraTiming, "t_ms" | "video_s"> {
  const kept = tMs.filter((t) => t >= startMs && t <= stopMs);
  return { t_ms: kept.map(round), video_s: kept.map((t) => Math.round((t - startMs) * 10) / 10_000) };
}

/** The part of MediaRecorder this uses (a fake in tests). */
export interface Recorder {
  readonly mimeType: string;
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((e: BlobEvent) => void) | null;
  onstart: ((e: Event) => void) | null;
  onstop: ((e: Event) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export interface CameraTakeDeps {
  stream(): MediaStream | null; // the camera's stream, or null when it isn't running
  recorder(stream: MediaStream): Recorder;
  upload(id: string, video: Blob, timing: CameraTiming): Promise<void>;
  report(note: string): void; // one line for the page: saved, or why not
  now(): number; // performance.now()
}

/** A MediaRecorder for the stream, webm (vp9, else vp8, else the browser's webm). */
export function webmRecorder(stream: MediaStream): Recorder {
  if (typeof MediaRecorder === "undefined") throw new Error("this browser can't record video");
  const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
  return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
}

type Take = {
  rec: Recorder;
  chunks: Blob[];
  frames: number[];
  frameSize: [number, number] | null;
  recordStartMs: number;
  startMs: number | null; // the recorder's start event
  failed: string | null;
  demoBefore: string | null; // the sim's last saved demo while this take records
  sawRecording: boolean; // a status said "recording" during the take
};

type Finishing = {
  demoBefore: string | null;
  sawRecording: boolean;
  savedId: string | null | undefined; // undefined: the sim hasn't said yet; null: it saved nothing
  video: { blob: Blob; timing: CameraTiming } | null; // null until the recorder hands over its last chunk
  timer: ReturnType<typeof setTimeout>;
};

/** Each take's camera video, from record_start to the upload. */
export class CameraTake {
  private take: Take | null = null;
  private finishing: Finishing[] = [];

  constructor(private readonly deps: CameraTakeDeps) {}

  /** record_start was sent: start recording the camera. `demoBefore`: the sim's last saved demo, as last seen. */
  begin(demoBefore: string | null) {
    this.discard();
    const fail = (e: unknown) => this.deps.report(`camera video not saved: ${e instanceof Error ? e.message : String(e)}`);
    const stream = this.deps.stream();
    if (!stream) return fail("no camera stream");
    let rec: Recorder;
    try {
      rec = this.deps.recorder(stream);
    } catch (e) {
      return fail(e);
    }
    const settings = stream.getVideoTracks?.()[0]?.getSettings?.();
    const take: Take = {
      rec,
      chunks: [],
      frames: [],
      frameSize: settings?.width && settings?.height ? [settings.width, settings.height] : null,
      recordStartMs: this.deps.now(),
      startMs: null,
      failed: null,
      demoBefore,
      sawRecording: false,
    };
    rec.onstart = () => {
      take.startMs ??= this.deps.now();
    };
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) take.chunks.push(e.data);
    };
    rec.onerror = (e) => {
      take.failed = e.error?.message ?? (e.message || "the recorder failed");
    };
    try {
      rec.start(TIMESLICE_MS);
    } catch (e) {
      return fail(e);
    }
    this.take = take;
  }

  /** A hand frame (its HandPoseMsg t_ms, and the frame's size); kept while a take records. */
  frame(tMs: number, size?: [number, number]) {
    if (!this.take) return;
    this.take.frames.push(tMs);
    this.take.frameSize ??= size ?? null;
  }

  /** record_stop was sent: stop the recorder, then upload once the sim names the saved demo. */
  end() {
    const take = this.take;
    if (!take) return;
    this.take = null;
    const recordStopMs = this.deps.now();
    const f: Finishing = {
      demoBefore: take.demoBefore,
      sawRecording: take.sawRecording,
      savedId: undefined,
      video: null,
      timer: setTimeout(() => {
        if (!this.finishing.includes(f)) return;
        this.forget(f);
        this.deps.report("camera video not saved: the sim didn't say which demo it saved");
      }, SAVED_ID_WAIT_MS),
    };
    this.finishing.push(f);
    take.rec.onstop = () => {
      take.rec.onstop = null;
      if (!this.finishing.includes(f)) return;
      if (take.failed || take.chunks.length === 0) {
        this.forget(f);
        this.deps.report(`camera video not saved: ${take.failed ?? "the recorder gave no video"}`);
        return;
      }
      const startMs = take.startMs ?? take.recordStartMs;
      const [frameW, frameH] = take.frameSize ?? [null, null];
      const timing: CameraTiming = {
        version: 1,
        clock: "performance.now",
        mime: take.rec.mimeType || "video/webm",
        start_ms: round(startMs),
        stop_ms: round(recordStopMs),
        record_start_ms: round(take.recordStartMs),
        record_stop_ms: round(recordStopMs),
        frame_w: frameW,
        frame_h: frameH,
        ...alignFrames(take.frames, startMs, recordStopMs),
      };
      f.video = { blob: new Blob(take.chunks, { type: "video/webm" }), timing };
      this.settle(f);
    };
    try {
      take.rec.stop();
    } catch {
      take.rec.onstop?.(new Event("stop"));
    }
  }

  /** record_discard was sent (or a new take began): drop the take in progress, nothing is saved. */
  discard() {
    const take = this.take;
    this.take = null;
    if (!take) return;
    take.rec.onstop = null;
    take.rec.ondataavailable = null;
    try {
      take.rec.stop();
    } catch {
      /* already inactive */
    }
  }

  /** Each sim status. */
  sim(status: SimStatus | null) {
    if (!status) return;
    if (this.take && status.recording) {
      this.take.demoBefore = status.demoId;
      this.take.sawRecording = true;
    }
    for (const f of [...this.finishing]) {
      if (f.savedId !== undefined) continue;
      if (status.recording && status.demoId === f.demoBefore) {
        f.sawRecording = true; // still this take, before the sim got record_stop
        continue;
      }
      if (!f.sawRecording) continue; // too short to have seen its own recording: never guess
      f.savedId = status.demoId && status.demoId !== f.demoBefore ? status.demoId : null;
      this.settle(f);
    }
  }

  /** The camera stopped: a take in progress and anything waiting are dropped. */
  close() {
    this.discard();
    for (const f of [...this.finishing]) this.forget(f);
  }

  private settle(f: Finishing) {
    if (f.savedId === undefined) return;
    if (f.savedId === null) {
      this.forget(f);
      this.deps.report("camera video not saved: the sim saved no demo");
      return;
    }
    if (!f.video) return;
    this.forget(f);
    const id = f.savedId;
    this.deps.upload(id, f.video.blob, f.video.timing).then(
      () => this.deps.report(`camera video saved: demos/${id}/camera.webm`),
      (e: unknown) => this.deps.report(`camera video not saved: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  private forget(f: Finishing) {
    clearTimeout(f.timer);
    this.finishing = this.finishing.filter((x) => x !== f);
  }
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
