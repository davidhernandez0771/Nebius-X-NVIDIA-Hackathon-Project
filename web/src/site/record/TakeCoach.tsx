// The take review on /record: right after the sim saves a take, GET /demos/{id}/take-review (the rules' lines, which
// always work) and show PASS or FAIL and its 2-4 coaching lines quietly in the bottom strip's wide cell, where the
// live trace is while you record. A deleted take's review goes with it.

import { useEffect, useState } from "react";
import { describeError, pmApi } from "../../pm/api";
import type { TakeReview } from "../../pm/types";

export type TakeCoachState =
  | { id: string; state: "loading" }
  | { id: string; state: "ready"; review: TakeReview }
  | { id: string; state: "error"; message: string };

/** The review of the take `id` (the sim's last saved demo); null without one. A new id fetches again. */
export function useTakeReview(id: string | null): TakeCoachState | null {
  const [coach, setCoach] = useState<TakeCoachState | null>(null);
  useEffect(() => {
    if (!id) {
      setCoach(null);
      return;
    }
    let live = true;
    setCoach({ id, state: "loading" });
    pmApi.takeReview(id).then(
      (review) => live && setCoach({ id, state: "ready", review }),
      (e: unknown) => live && setCoach({ id, state: "error", message: describeError(e) }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return coach && coach.id === id ? coach : null;
}

export function TakeCoach({ coach }: { coach: TakeCoachState }) {
  const verdict = coach.state === "ready" ? coach.review.verdict : null;
  return (
    <>
      <p className="rg-key">
        <span>take review · {coach.id}</span>
        {verdict ? (
          <span className="rg-verdict" data-verdict={verdict}>
            {verdict}
          </span>
        ) : (
          <span>{coach.state === "loading" ? "reviewing…" : "no review"}</span>
        )}
      </p>
      {coach.state === "ready" && (
        <ul className="rg-coach" aria-label="Coaching">
          {coach.review.lines.map((line) => (
            <li key={line} title={line}>
              {line}
            </li>
          ))}
        </ul>
      )}
      {coach.state === "error" && (
        <p className="rg-coach rg-coach--error" title={coach.message}>
          {coach.message}
        </p>
      )}
    </>
  );
}
