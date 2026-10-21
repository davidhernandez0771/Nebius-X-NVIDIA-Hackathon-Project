// One view of a demo, in the robot twin and the simulator's own camera, with its physics verdict.
import { RobotTwin } from "../../twin";
import { stateAt, type Episode } from "../../twin/replay";
import { FootageView } from "./FootageView";
import type { Async } from "./hooks";
import { KIND_TEXT, stepAt, type Footage, type Verdict, type View } from "./model";

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <span className="data-badge data-badge--none">Not judged: the human's own take</span>;
  return (
    <span className={`data-badge ${verdict.pass ? "data-badge--pass" : "data-badge--fail"}`}>
      <span aria-hidden="true">{verdict.pass ? "✓" : "✕"}</span> {verdict.text}
    </span>
  );
}

export function Pane({
  side,
  views,
  view,
  onPick,
  episode,
  footage,
  t,
}: {
  side: string;
  views: View[];
  view: View;
  onPick: (key: string) => void;
  episode: Async<Episode>;
  footage: Async<Footage>;
  t: number;
}) {
  const ep = episode.state === "ok" ? episode.value : null;
  const step = ep ? stepAt(t, ep.nSteps, ep.fps) : 0;
  const twin = ep ? stateAt(ep, step) : null;
  const id = `data-pane-${side}`;
  return (
    <section className="data-pane" aria-labelledby={`${id}-title`} data-kind={view.kind}>
      <header className="data-pane__head">
        <h3 id={`${id}-title`} className="data-pane__title">
          {view.label}
        </h3>
        <label className="data-pane__pick">
          <span className="sant-sr-only">Show in the {side} view</span>
          <select value={view.key} onChange={(e) => onPick(e.target.value)}>
            {views.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
                {v.verdict ? (v.verdict.pass ? " · verified" : " · failed") : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      <p className="data-pane__what">{KIND_TEXT[view.kind]}</p>
      <div className="data-pane__stage">
        <div className="data-pane__twin">
          {twin && ep ? (
            <RobotTwin {...twin} base={ep.base} interactive caption={`Robot twin · step ${step + 1} of ${ep.nSteps}`} />
          ) : (
            <div className="data-pane__wait">{episode.state === "error" ? `The episode didn't load: ${episode.message}` : "Loading the episode…"}</div>
          )}
        </div>
        <figure className="data-pane__cam">
          <FootageView footage={footage.state === "ok" ? footage.value : null} t={t} label={`Isaac Sim front camera, ${view.label}`} />
          <figcaption>{footage.state === "error" ? "No camera frames for this one" : "Isaac Sim · front camera"}</figcaption>
        </figure>
      </div>
      <VerdictBadge verdict={view.verdict} />
    </section>
  );
}
