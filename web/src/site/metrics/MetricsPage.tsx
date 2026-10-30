// /metrics: every pre-registered result of the cube-in-bin task in one place. First the results hall (HallScene, 3D:
// a pillar of light per test, its Wilson interval as a glass sleeve, the 60% goal as a plane of light), then the
// same numbers as plain charts and a table: the climb, the RL teacher with and without demo starts, Stage A's
// checkpoint selection (from the backend), what the result does not show, and Nemotron's reading of the failures.
// Fallbacks: no usable WebGL → the charts only, with one line saying so; a phone (≤ 430 px) → the 2D climb takes the
// hall's place; reduced motion → the hall starts settled and nothing draws itself.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { checkGpu } from "../../world/core/gpu";
import { useMotion } from "../../sant/motion/MotionProvider";
import { fetchAnalysis, fetchSources, type Fetch } from "../analysis/api";
import { useAsync } from "../data/hooks";
import { HoloPage } from "../holo/Holo";
import { CLIMB_FOOTNOTE, LEAD, TEACHER, proofCite, proofNoteUrl } from "../results/proofData";
import { AnalystStrip } from "./AnalystStrip";
import { ClimbChart, ClimbTable, SelectionBars, TeacherChart } from "./charts";
import { GOAL_RATE, HEADLINE, NOT_SHOWN, PILLARS, rateCi, SELECTION_NOTES, stageASelection, type Cited } from "./model";
import "./metrics.css";

const HallScene = lazy(() => import("./HallScene"));

const PHONE = "(max-width: 430px)";
const V2_INDEX = PILLARS.findIndex((p) => p.key === "v2");
const GOAL_LABEL = `${HEADLINE.goal} (${HEADLINE.goalPct})`;
const STAGE_A_SOURCE = { note: "bigtest", lines: "655–660" } as const;

/** WebGL2 that can hold a frame rate: the workshop's own one-off GPU check (cached for the session). */
function usableWebGL(): boolean {
  try {
    let store: Storage | undefined;
    try {
      store = window.sessionStorage;
    } catch {
      store = undefined;
    }
    return checkGpu(store).gpu !== "stills";
  } catch {
    return false;
  }
}

function useMedia(query: string): boolean {
  const mq = () => (typeof window.matchMedia === "function" ? window.matchMedia(query) : null);
  const [on, set] = useState(() => mq()?.matches ?? false);
  useEffect(() => {
    const m = mq();
    if (!m) return;
    const f = (e: MediaQueryListEvent) => set(e.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
    // the query is a constant per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return on;
}

/** Whether an element is on screen and the tab visible (render nothing otherwise). */
function useOnScreen(el: React.RefObject<HTMLElement>, enabled: boolean): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const node = el.current;
    if (!enabled || !node) return;
    let visible = document.visibilityState !== "hidden";
    let onScreen = true;
    const update = () => setActive(visible && onScreen);
    const onVis = () => {
      visible = document.visibilityState !== "hidden";
      update();
    };
    document.addEventListener("visibilitychange", onVis);
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => ((onScreen = e.isIntersecting), update())) : null;
    io?.observe(node);
    update();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, [el, enabled]);
  return active;
}

function Source({ c }: { c: Pick<Cited, "cite" | "href"> }) {
  return (
    <a className="mx-src" href={c.href} target="_blank" rel="noreferrer noopener">
      {c.cite}
    </a>
  );
}

function Hall({ animate }: { animate: boolean }) {
  const [selected, setSelected] = useState<number>(V2_INDEX);
  const stage = useRef<HTMLDivElement>(null);
  const active = useOnScreen(stage, true);
  const p = PILLARS[selected];
  return (
    <div className="mx-hall" ref={stage}>
      <Suspense fallback={null}>
        <HallScene pillars={PILLARS} goal={GOAL_RATE} goalLabel={`Goal ${GOAL_LABEL}`} selected={selected} onSelect={setSelected} animate={animate} active={active} />
      </Suspense>
      <div className="mx-picker">
        <div className="mx-picker__buttons" role="group" aria-label="Pillars">
          {PILLARS.map((q, i) => (
            <button
              key={q.key}
              type="button"
              className="mx-picker__btn"
              data-series={q.series}
              aria-pressed={selected === i}
              onFocus={() => setSelected(i)}
              onMouseEnter={() => setSelected(i)}
              onClick={() => setSelected(i)}
            >
              <span className="mx-picker__tag">{q.tag}</span>
              <span className="mx-picker__count">
                {q.k}/{q.n}
              </span>
            </button>
          ))}
        </div>
        <p className="mx-picker__readout" role="status" aria-label="Selected pillar">
          <span className="mx-picker__label">{p.label}</span>
          <span className="mx-picker__value">{rateCi(p)}</span>
        </p>
      </div>
    </div>
  );
}

export function MetricsPage({ fetchImpl, webgl }: { fetchImpl?: Fetch; webgl?: boolean }) {
  const { reduced } = useMotion();
  const phone = useMedia(PHONE);
  const [gl] = useState(() => webgl ?? usableWebGL());
  const showHall = gl && !phone;
  const f = fetchImpl ?? fetch;
  const sources = useAsync("sources", () => fetchSources(f));
  const final = useAsync("bigtest_final", () => fetchAnalysis("bigtest_final", f));
  const sel = stageASelection(sources.state === "ok" ? sources.value : null, final.state === "ok" ? final.value : null);
  const loading = sources.state === "loading" || final.state === "loading";

  return (
    // The page's id is new to the frame's nav (Agent C adds it); until then no nav item is marked current.
    <HoloPage title="Metrics" here={"metrics"}>
      <div className="mx" data-motion={reduced ? "still" : "full"} data-hall={showHall ? "on" : "off"}>
        <div className="mx-stage">
          {showHall && <Hall animate={!reduced} />}
          <section className="mx-headline" aria-label="The headline">
            <p className="mx-headline__figure">
              {HEADLINE.k}/{HEADLINE.n}
            </p>
            <h2 className="mx-headline__title">
              unseen scenes solved by a camera-only policy that started from {LEAD.demos} human mouse demos, through SANT and an RL teacher.
            </h2>
            <p className="mx-headline__stats">
              {HEADLINE.pct} success, past the {HEADLINE.goalPct} goal of {HEADLINE.goal}. Wilson 95% CI {HEADLINE.ci}, seeds {HEADLINE.seeds}, run once.
            </p>
            <p className="mx-headline__srcs">
              {HEADLINE.sources.map((c) => (
                <Source key={c.cite} c={c} />
              ))}
            </p>
          </section>
        </div>
        {!gl && <p className="mx-quiet mx-nogl">No WebGL here, or none fast enough, so the 3D hall is off. The charts below carry every number.</p>}

        <div className="mx-grid-sections">
          <section className="mx-section mx-section--wide" aria-labelledby="mx-climb-h">
            <h2 id="mx-climb-h" className="mx-h2">
              The climb, one pre-registered test at a time
            </h2>
            <p className="mx-lede">Each column is a policy's success on scenes it never saw; the whisker is its Wilson 95% interval.</p>
            <div className="mx-climb">
              <ClimbChart pillars={PILLARS} goal={GOAL_RATE} goalLabel={GOAL_LABEL} />
              <ClimbTable pillars={PILLARS} />
            </div>
            <p className="mx-foot">{CLIMB_FOOTNOTE} The scripted-expert pair is a reference from an earlier experiment, not part of the climb.</p>
            <p className="mx-srcs">
              {PILLARS.map((p) => (
                <span key={p.key}>
                  {p.tag}: {p.href ? <Source c={{ cite: p.cite, href: p.href }} /> : <span className="mx-src">{p.cite}</span>}
                </span>
              ))}
            </p>
          </section>

          <section className="mx-section" aria-labelledby="mx-teacher-h">
            <h2 id="mx-teacher-h" className="mx-h2">
              The RL teacher needs the human demos
            </h2>
            <p className="mx-lede">
              Home-start success out of {TEACHER.n} as the teacher trains, starting episodes partway through the human demos or not at all.
            </p>
            <TeacherChart />
            <p className="mx-foot">{TEACHER.caption}</p>
            <p className="mx-srcs">
              <Source c={{ cite: proofCite(TEACHER.source), href: proofNoteUrl(TEACHER.source) }} />
              <Source c={{ cite: proofCite(TEACHER.finalSource), href: proofNoteUrl(TEACHER.finalSource) }} />
            </p>
          </section>

          <section className="mx-section" aria-labelledby="mx-sel-h">
            <h2 id="mx-sel-h" className="mx-h2">
              Stage A checkpoint selection
            </h2>
            <p className="mx-lede">
              Three checkpoints of the final model's training, each run on the same practice seeds{sel?.seeds ? ` (${sel.seeds})` : ""}. The most successes is picked, then tested once.
            </p>
            {sel && <SelectionBars sel={sel} />}
            {!sel && loading && <p className="mx-quiet">Reading the selection runs from the analyst backend…</p>}
            {!sel && !loading && (
              <p className="mx-quiet">
                Couldn't reach the analyst backend, so the selection counts aren't shown here. They are in the{" "}
                <a href={proofNoteUrl(STAGE_A_SOURCE)} target="_blank" rel="noreferrer noopener">
                  big-test note
                </a>
                .
              </p>
            )}
            <ul className="mx-notes">
              {SELECTION_NOTES.map((n) => (
                <li key={n.cite}>
                  {n.text} <Source c={n} />
                </li>
              ))}
            </ul>
          </section>

          <section className="mx-section mx-section--wide mx-limits" aria-labelledby="mx-limits-h">
            <h2 id="mx-limits-h" className="mx-h2">
              What this does not show
            </h2>
            <ul className="mx-limits__list">
              {NOT_SHOWN.map((n) => (
                <li key={n.cite}>
                  <span>{n.text}</span> <Source c={n} />
                </li>
              ))}
            </ul>
          </section>

          <AnalystStrip final={final} />
        </div>
      </div>
    </HoloPage>
  );
}

export default MetricsPage;
