// Shared bits for SANT's robot-demo pages: a load hook, and the
// error card every page shows instead of a blank screen.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GlassCard } from "../components";
import { describeError, PmApiError } from "./api";

export type Load<T> =
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "error"; error: unknown };

/** Runs `fn` on mount and whenever `key` changes; `reload` runs it again. */
export function useLoad<T>(fn: () => Promise<T>, key: string): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    fn().then(
      (data) => live && setLoad({ state: "ok", data }),
      (error) => live && setLoad({ state: "error", error }),
    );
    return () => {
      live = false;
    };
    // fn is recreated every render; key says when its inputs changed.
  }, [key, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [load, reload];
}

function errorTitle(err: unknown): string {
  if (err instanceof PmApiError) {
    if (err.kind === "unreachable") return "The backend isn't running";
    if (err.kind === "sim_down") return "The sim worker isn't running";
    if (err.kind === "not_found") return "Not found";
    if (err.kind === "route_missing") return "Not on this backend yet";
  }
  return "Something went wrong";
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <GlassCard variant="provisional" className="empty-state pm-error" as="section">
      <h2>{errorTitle(error)}</h2>
      <p className="muted" role="alert">
        {describeError(error)}
      </p>
      {onRetry && (
        <button type="button" className="ghost-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </GlassCard>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="muted pm-loading" aria-live="polite">
      Loading {what}…
    </p>
  );
}

export function PageTitle({ title, isId = false, children }: { title: string; isId?: boolean; children?: ReactNode }) {
  return (
    <div className={`hero-copy pm-title${isId ? " pm-title--id" : ""}`}>
      <h1>{title}</h1>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export const fmtSeconds = (s: number) => `${s.toFixed(1)} s`;
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
