// Camera lifecycle for the hand-tracking pipeline (Agent 1).
//
// Owns getUserMedia acquisition and a detached <video> element that MediaPipe
// reads frames from. Not attached to visible layout -- positioned off-screen
// rather than `display:none` so browsers keep decoding frames into it.

export interface CameraHandle {
  readonly video: HTMLVideoElement;
  readonly stream: MediaStream;
  /** Stops all tracks and removes the video element. Idempotent. */
  stop(): void;
}

/** Requests the front-facing camera and returns a playing, ready video element. */
export async function startCamera(): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("aria-hidden", "true");
  video.style.position = "fixed";
  video.style.top = "0";
  video.style.left = "-10000px";
  video.style.width = "1px";
  video.style.height = "1px";
  document.body.appendChild(video);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    video.remove();
  };

  try {
    await video.play();
    await waitUntilReady(video);
  } catch (err) {
    stop();
    throw err;
  }

  return { video, stream, stop };
}

function waitUntilReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onLoaded = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      resolve();
    };
    video.addEventListener("loadedmetadata", onLoaded);
  });
}
