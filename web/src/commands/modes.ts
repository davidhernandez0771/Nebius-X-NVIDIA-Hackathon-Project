// Mode-execution logic: launching a Mode's ordered ModeLink list. A voice
// recognition callback (and, on some browsers, even a stale click handler)
// does not reliably count as a "user gesture" that authorizes window.open(),
// so every launch produces a per-link result instead of a single boolean --
// callers (ModesPage, registerActions.ts's mode.activate) report honestly
// which links actually opened and which need a manual retry. This module
// never closes or otherwise touches a tab it did not itself just open.

import type { Mode, ModeLink, ModeLinkKind } from "./types";

export type LinkLaunchStatus = "opened" | "blocked" | "error";

export interface LinkLaunchResult {
  linkId: string;
  label: string;
  kind: ModeLinkKind;
  url: string;
  status: LinkLaunchStatus;
  /** Human-readable detail for "blocked"/"error" -- shown next to the retry control. */
  message?: string;
}

export interface ModeLaunchResult {
  modeId: string;
  results: LinkLaunchResult[];
  /** True only when every link actually opened -- never inferred, always the AND of per-link results. */
  allOpened: boolean;
}

/** Returns null when the link is safe to launch, otherwise a human-readable
 * reason it was rejected. External links must be http(s) -- "javascript:",
 * "data:", "file:", etc. are all rejected here, not just at save time, so a
 * link that somehow got into storage some other way still can't execute. */
export function validateModeLink(link: Pick<ModeLink, "kind" | "url">): string | null {
  if (link.kind === "internal") {
    if (!link.url.startsWith("/")) return "Internal links must start with \"/\"";
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(link.url);
  } catch {
    return "Not a valid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Unsupported link scheme "${parsed.protocol}"`;
  }
  return null;
}

/** Launches exactly one link, independent of the mode-level duplicate guard
 * below -- this is what ModesPage's per-link "retry" button calls. */
export function launchLink(link: ModeLink, navigate: (to: string) => void): LinkLaunchResult {
  const base = { linkId: link.id, label: link.label, kind: link.kind, url: link.url };

  const invalidReason = validateModeLink(link);
  if (invalidReason) {
    return { ...base, status: "error", message: invalidReason };
  }

  if (link.kind === "internal") {
    try {
      navigate(link.url);
      return { ...base, status: "opened" };
    } catch (err) {
      return { ...base, status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  let win: Window | null;
  try {
    win = window.open(link.url, "_blank", "noopener,noreferrer");
  } catch (err) {
    return { ...base, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (!win) {
    return { ...base, status: "blocked", message: "Popup blocked by the browser -- open it manually" };
  }
  return { ...base, status: "opened" };
}

const DUPLICATE_LAUNCH_WINDOW_MS = 1500;
const lastLaunchAt = new Map<string, number>();

/** Launches every link in order. A second call for the same modeId within
 * DUPLICATE_LAUNCH_WINDOW_MS is treated as a duplicate (repeated speech
 * recognition final event, double click, etc.) and short-circuits to a
 * "blocked" result per link instead of re-opening everything. */
export function launchMode(mode: Mode, navigate: (to: string) => void, now: () => number = Date.now): ModeLaunchResult {
  const ts = now();
  const last = lastLaunchAt.get(mode.id);
  if (last !== undefined && ts - last < DUPLICATE_LAUNCH_WINDOW_MS) {
    return {
      modeId: mode.id,
      results: mode.links.map((link) => ({
        linkId: link.id,
        label: link.label,
        kind: link.kind,
        url: link.url,
        status: "blocked",
        message: "Skipped -- this mode was just activated",
      })),
      allOpened: false,
    };
  }
  lastLaunchAt.set(mode.id, ts);

  const results = mode.links.map((link) => launchLink(link, navigate));
  return { modeId: mode.id, results, allOpened: results.length > 0 && results.every((r) => r.status === "opened") };
}

export function __resetLaunchGuardForTests(): void {
  lastLaunchAt.clear();
}
