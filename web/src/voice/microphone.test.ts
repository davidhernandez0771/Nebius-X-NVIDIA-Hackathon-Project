// jsdom has no real getUserMedia/MediaStream -- these tests fake just
// enough of the surface (EventTarget-based tracks, a getUserMedia stub) to
// exercise microphone.ts's own decisions: error classification,
// release-stops-every-track, and the interruption callback. See
// SANT_VOICE_MODES_PLAN.md §5/§7 -- no physical mic is available here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MicError, queryMicPermissionState, requestMicrophone } from "./microphone";

class FakeTrack extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

function makeFakeStream(trackCount = 1) {
  const tracks = Array.from({ length: trackCount }, () => new FakeTrack());
  return {
    tracks,
    stream: { getTracks: () => tracks } as unknown as MediaStream,
  };
}

describe("requestMicrophone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws an 'unsupported' MicError when getUserMedia doesn't exist", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestMicrophone()).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("classifies permission denial as 'permission-denied'", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(requestMicrophone()).rejects.toMatchObject({ kind: "permission-denied" });
  });

  it("classifies a missing device as 'device-not-found'", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotFoundError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(requestMicrophone()).rejects.toMatchObject({ kind: "device-not-found" });
  });

  it("falls back to 'unknown' for an unrecognized failure", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(requestMicrophone()).rejects.toMatchObject({ kind: "unknown" });
  });

  it("returns a handle whose release() stops every track exactly once", async () => {
    const { tracks, stream } = makeFakeStream(2);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const mic = await requestMicrophone();
    expect(mic.stream).toBe(stream);
    mic.release();
    mic.release(); // idempotent

    expect(tracks.every((t) => t.stopped)).toBe(true);
  });

  it("fires onInterrupted when a held track ends on its own, but not after our own release()", async () => {
    const { tracks, stream } = makeFakeStream(1);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const onInterrupted = vi.fn();

    const mic = await requestMicrophone({ onInterrupted });
    tracks[0].dispatchEvent(new Event("ended"));
    expect(onInterrupted).toHaveBeenCalledTimes(1);

    mic.release();
    tracks[0].dispatchEvent(new Event("ended"));
    expect(onInterrupted).toHaveBeenCalledTimes(1); // release() detaches the listener
  });
});

describe("queryMicPermissionState", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 'unknown' when the Permissions API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(queryMicPermissionState()).resolves.toBe("unknown");
  });

  it("returns 'unknown' if the Permissions API rejects (e.g. unsupported query name)", async () => {
    vi.stubGlobal("navigator", { permissions: { query: vi.fn().mockRejectedValue(new Error("nope")) } });
    await expect(queryMicPermissionState()).resolves.toBe("unknown");
  });

  it("passes through the reported state", async () => {
    vi.stubGlobal("navigator", { permissions: { query: vi.fn().mockResolvedValue({ state: "granted" }) } });
    await expect(queryMicPermissionState()).resolves.toBe("granted");
  });
});

describe("MicError", () => {
  it("carries its kind alongside the message", () => {
    const err = new MicError("device-not-found", "No microphone was found");
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("device-not-found");
    expect(err.message).toBe("No microphone was found");
  });
});
