// The files hand tracking loads from web/public: MediaPipe's wasm loader and binary, and the hand model.
// They are git-ignored, and web/scripts/hand-assets.mjs (npm's predev) puts them there. When one is missing,
// MediaPipe's own failure is a bare DOM Event ("[object Event]"), so the tracker checks them first and says
// which file failed.

export const HAND_ASSETS_FIX = "Run `node web/scripts/hand-assets.mjs` (npm --prefix web run dev does it first), then reload.";

export class HandAssetError extends Error {
  constructor(
    readonly path: string,
    why: string,
  ) {
    super(`Hand tracking couldn't load ${path} (${why}). ${HAND_ASSETS_FIX}`);
    this.name = "HandAssetError";
  }
}

/** Why `path` can't be loaded, or null when it can. A dev server answers a missing file with its index page. */
async function problem(path: string, fetchImpl: typeof fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method: "HEAD", cache: "no-store" });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (res.status === 405 || res.status === 501) return null; // no HEAD here; let the real load decide
  if (!res.ok) return `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  if ((res.headers.get("content-type") ?? "").includes("text/html")) return "not found: the server sent a web page instead";
  return null;
}

/** Throws a HandAssetError naming the first file that can't be loaded. */
export async function checkHandAssets(paths: readonly string[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const found = await Promise.all(paths.map((p) => problem(p, fetchImpl)));
  const i = found.findIndex((p) => p !== null);
  if (i >= 0) throw new HandAssetError(paths[i], found[i]!);
}

/** A readable message for a failed load: a script or fetch failure arrives as an Event, not an Error. */
export function loadFailureMessage(err: unknown, fallbackPath?: string): string {
  if (err instanceof Error) return err.message;
  if (typeof Event !== "undefined" && err instanceof Event) {
    const target = err.target as { src?: unknown } | null;
    const src = typeof target?.src === "string" && target.src ? new URL(target.src, window.location.href).pathname : fallbackPath;
    return src ? `Hand tracking couldn't load ${src} (${err.type}). ${HAND_ASSETS_FIX}` : `Hand tracking failed to load a file (${err.type}). ${HAND_ASSETS_FIX}`;
  }
  return String(err);
}
