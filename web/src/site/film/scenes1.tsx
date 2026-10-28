// Scenes 1-3: the open (10 mouse demos → 0/40 copied, 30/40 through SANT), the problem (cheap demos are sloppy; the
// webcam demo's 927 N), and where SANT sits in NVIDIA's stack.
import { useMemo } from "react";
import type { Vec3 } from "../../twin/types";
import { FilmTwin, stepOf } from "./FilmTwin";
import { enter, ramp, wordAt, window_ } from "./model";
import { CamTile, Check, Kicker, TopPlot, demoRow, local, rise, type SceneProps } from "./ui";

const MOUSE_IDS = [
  "human_20261020183738_00ab",
  "human_20261020183801_da08",
  "human_20261020184043_be76",
  "human_20261020184117_dc3e",
  "human_20261020184146_ee42",
  "human_20261020184211_3cd0",
  "human_20261020184230_b27d",
  "human_20261020184247_68ce",
  "human_20261020184302_848e",
  "human_20261020184318_4c66",
];
const WEBCAM_ID = "human_20261019185902_c045";

export function OpenScene(p: SceneProps) {
  const { lt, L, dur } = local(p);
  const { data } = p;
  const runs = data.final.runs;
  const pc = Math.max(0, lt - L[2]);
  const rt = pc * 2.6; // seconds of each run shown
  const done = (r: (typeof runs)[number]) => r.success && (r.durationS ?? 99) <= rt;
  const failShown = (i: number) => pc > 4.3 + (i % 10) * 0.04;
  const count = runs.filter(done).length;
  const a = window_(lt, 0, L[1] + 0.1, 0.6);
  const b = window_(lt, L[1], L[2] + 0.1, 0.5);
  const c = enter(lt, L[2], 0.6);
  return (
    <div className="fm-scene fm-open">
      {a > 0 && (
        <div className="fm-open__a" style={{ opacity: a }}>
          <Kicker style={rise(lt, 0.2)}>Ten human demos · driven with a mouse · recorded in NVIDIA Isaac Lab</Kicker>
          <h1 className="fm-title fm-title--xl" style={rise(lt, 0.5, 30, 0.9)}>
            Ten sloppy mouse demos.
          </h1>
          <div className="fm-open__tiles">
            {MOUSE_IDS.map((id, i) => (
              <div key={id} style={rise(lt, 1.0 + i * 0.09, 40)}>
                <CamTile atlas="demos.jpg" row={demoRow(data, id)} col={Math.floor((lt * 5 + i * 2.3) % 24)} cols={24} rows={data.demoRows.length} size={150} />
              </div>
            ))}
          </div>
          <Kicker tone="dim" style={rise(lt, 2.0)}>
            Isaac Sim&rsquo;s front camera, during each take
          </Kicker>
        </div>
      )}
      {b > 0 && (
        <div className="fm-open__b" style={{ opacity: b }}>
          <Kicker tone="fail" style={rise(lt, L[1] + 0.1)}>
            Copied directly · a policy trained on the 10 raw demos
          </Kicker>
          <p className="fm-big fm-big--fail" style={rise(lt, L[1] + 0.3, 40)}>
            0<span> / 40</span>
          </p>
          <div className="fm-open__x">
            {Array.from({ length: 40 }, (_, i) => (
              <span key={i} className="fm-cell" data-state="fail" style={{ opacity: enter(lt, L[1] + 0.9 + i * 0.035, 0.25) }} />
            ))}
          </div>
          <Kicker tone="dim" style={rise(lt, L[1] + 1.4)}>
            40 scenes it had never seen
          </Kicker>
        </div>
      )}
      {c > 0 && (
        <div className="fm-open__c" style={{ opacity: c }}>
          <div className="fm-open__grid">
            {runs.map((r, i) => {
              const run = data.finalRuns[r.id];
              const upto = run ? stepOf(run, rt) : 0;
              const verdict = done(r) ? "ok" : !r.success && failShown(i) ? "fail" : null;
              return (
                <div key={r.id} className="fm-open__cell" style={rise(lt, L[2] + 0.05 + (i % 10) * 0.03 + Math.floor(i / 10) * 0.05, 18, 0.5)}>
                  {run && <TopPlot hand={run.handPos ?? []} cube={run.cubePos} bin={run.bin.pos as Vec3} upto={upto} verdict={verdict} size={150} />}
                  {verdict && <Check ok={verdict === "ok"} style={{ opacity: verdict === "ok" ? 1 : enter(pc, 4.3, 0.3) }} />}
                </div>
              );
            })}
          </div>
          <div className="fm-open__count">
            <Kicker tone="teal" style={rise(lt, L[2] + 0.2)}>
              Through SANT · the final test
            </Kicker>
            <p className="fm-big fm-big--teal fm-big--count">
              {count}
              <span> / 40</span>
            </p>
            <p className="fm-note" style={rise(lt, L[2] + 2.6)}>
              Real runs of the camera policy, seen from above.
              <br />
              40 fresh scenes, pre-registered, run once.
            </p>
          </div>
        </div>
      )}
      <div className="fm-open__fade" style={{ opacity: ramp(lt, dur - 0.2, dur) }} />
    </div>
  );
}

/** The hand's speed, m/s, each step (from the recorded hand path at 50 Hz). */
function speeds(hand: Vec3[], fps: number) {
  return hand.map((p, i) => {
    const q = hand[Math.max(0, i - 1)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * fps;
  });
}

function SpeedTrace({ hand, fps, upto }: { hand: Vec3[]; fps: number; upto: number }) {
  const v = useMemo(() => speeds(hand, fps), [hand, fps]);
  const W = 960;
  const H = 120;
  const max = 0.6;
  const x = (i: number) => (i / (v.length - 1)) * W;
  const y = (s: number) => H - (Math.min(s, max) / max) * H;
  const line = v.slice(0, upto + 1).map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
  // the stretches where the hand all but stopped (under 1 cm/s for at least 0.2 s)
  const bands: [number, number][] = [];
  let from = -1;
  v.forEach((s, i) => {
    if (s < 0.01 && from < 0) from = i;
    if ((s >= 0.01 || i === v.length - 1) && from >= 0) {
      if (i - from >= fps * 0.2) bands.push([from, i]);
      from = -1;
    }
  });
  return (
    <svg className="fm-speed" viewBox={`0 0 ${W} ${H + 24}`} width={W} height={H + 24} aria-hidden="true">
      {bands
        .filter(([a]) => a <= upto)
        .map(([a, b]) => (
          <rect key={a} className="fm-speed__pause" x={x(a)} y={0} width={x(Math.min(b, upto)) - x(a)} height={H} />
        ))}
      <line className="fm-speed__axis" x1={0} x2={W} y1={H} y2={H} />
      <polyline className="fm-speed__line" points={line} />
      <text className="fm-speed__label" x={0} y={H + 20}>
        HAND SPEED · AMBER = STOPPED
      </text>
    </svg>
  );
}

function ForceGauge({ force, upto, lt, at }: { force: number[]; upto: number; lt: number; at: number }) {
  const peakSoFar = useMemo(() => {
    const out: number[] = [];
    let m = 0;
    for (const f of force) out.push((m = Math.max(m, f)));
    return out;
  }, [force]);
  const now = peakSoFar[Math.min(upto, peakSoFar.length - 1)] ?? 0;
  const H = 520;
  const top = 1000;
  const h = (n: number) => (Math.min(n, top) / top) * H;
  return (
    <div className="fm-gauge" style={rise(lt, at)}>
      <Kicker tone={now > 5 ? "fail" : "dim"}>Peak contact force</Kicker>
      <p className="fm-gauge__num" data-over={now > 5 || undefined}>
        {Math.round(now)}
        <span> N</span>
      </p>
      <div className="fm-gauge__bar" style={{ height: H }}>
        <div className="fm-gauge__fill" style={{ height: h(now) }} />
        <div className="fm-gauge__limit" style={{ bottom: Math.max(2, h(5)) }}>
          <span>limit 5 N</span>
        </div>
      </div>
    </div>
  );
}

export function ProblemScene(p: SceneProps) {
  const { lt, L } = local(p);
  const { data, span } = p;
  const l0 = span.lines[0];
  const l1 = span.lines[1];
  const l2 = span.lines[2];
  const w = (line: typeof l0, s: string) => wordAt(line, s) - span.start;
  const a = window_(lt, 0, L[1] + 0.2, 0.5);
  const b = window_(lt, L[1], L[2] + 0.2, 0.5);
  const c = enter(lt, L[2], 0.5);
  const sloppy = data.demos["human_20261020184211_3cd0"];
  const webcam = data.demos[WEBCAM_ID];
  const sloppyTime = Math.max(0, lt - L[1] - 0.2);
  const peakStep = useMemo(() => webcam.force.indexOf(Math.max(...webcam.force)), [webcam]);
  const at927 = w(l2, "nine");
  const webTime = Math.max(0, peakStep / webcam.fps + (lt - at927) * 0.9 + 0.15);
  const webStep = stepOf(webcam, webTime);
  const failed = lt > at927 + 0.4;
  const cards = [
    ["01", "A teleoperation rig", w(l0, "teleoperation")],
    ["02", "A trained operator", w(l0, "trained")],
    ["03", "Take after take", w(l0, "take after")],
  ] as const;
  return (
    <div className="fm-scene fm-problem">
      {a > 0 && (
        <div className="fm-problem__a" style={{ opacity: a }}>
          <div className="fm-col">
            <Kicker style={rise(lt, 0.3)}>The problem</Kicker>
            <h2 className="fm-title fm-title--lg" style={rise(lt, 0.5, 30, 0.9)}>
              Robots learn new skills by copying people.
            </h2>
            <p className="fm-lede" style={rise(lt, w(l0, "good"), 20)}>
              Good demonstrations are <em>expensive</em>.
            </p>
          </div>
          <div className="fm-cards">
            {cards.map(([n, text, at]) => (
              <div key={n} className="fm-card" style={rise(lt, at - 0.1, 30)}>
                <span className="fm-card__n">{n}</span>
                <span className="fm-card__text">{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {b > 0 && (
        <div className="fm-split" style={{ opacity: b }}>
          <div className="fm-col fm-col--narrow">
            <Kicker style={rise(lt, L[1] + 0.1)}>Cheap demos · mouse · keyboard · webcam</Kicker>
            <h2 className="fm-title fm-title--lg" style={rise(lt, L[1] + 0.3, 30)}>
              Easy to get.
              <br />
              <em>Sloppy.</em>
            </h2>
            <div className="fm-chips">
              {[
                ["They pause", w(l1, "pause")],
                ["They wobble", w(l1, "wobble")],
                ["They grab off centre", w(l1, "grab")],
              ].map(([text, at]) => (
                <span key={text as string} className="fm-chip" style={rise(lt, (at as number) - 0.1, 16, 0.4)}>
                  {text}
                </span>
              ))}
            </div>
          </div>
          <div className="fm-stage fm-stage--trace" style={rise(lt, L[1] + 0.2, 30)}>
            <FilmTwin ep={sloppy} time={sloppyTime} className="fm-twin" />
            <SpeedTrace hand={sloppy.hand} fps={sloppy.fps} upto={stepOf(sloppy, sloppyTime)} />
            <p className="fm-caption">A real mouse demo (one of the ten) · replayed from Isaac Lab, 50 Hz</p>
          </div>
        </div>
      )}
      {c > 0 && (
        <div className="fm-split" style={{ opacity: c }}>
          <div className="fm-col fm-col--narrow">
            <Kicker style={rise(lt, L[2] + 0.1)}>Our ten webcam demos</Kicker>
            <p className="fm-stat" style={rise(lt, L[2] + 0.3)}>
              <b>10 / 10</b> put the cube in the bin
            </p>
            <p className="fm-stat fm-stat--fail" style={rise(lt, w(l2, "rejected") - 0.1)}>
              <b>0 / 10</b> passed the physics check
            </p>
            <div className="fm-stamp" data-on={failed || undefined} style={{ opacity: enter(lt, at927 + 0.4, 0.3), transform: `scale(${1.25 - 0.25 * enter(lt, at927 + 0.4, 0.35)})` }}>
              Physics check · fail
            </div>
          </div>
          <div className="fm-stage fm-stage--gauge" style={rise(lt, L[2] + 0.2, 30)}>
            <FilmTwin ep={webcam} time={webTime} className="fm-twin" />
            <ForceGauge force={webcam.force} upto={webStep} lt={lt} at={L[2] + 0.6} />
            <p className="fm-caption">A real webcam demo, replayed in Isaac Lab with contact forces</p>
          </div>
        </div>
      )}
    </div>
  );
}

const CHAIN = [
  { id: "cheap", title: "Cheap, sloppy demos", sub: "mouse · keyboard · webcam" },
  { id: "sant", title: "SANT", sub: "check · repair · multiply · teach" },
  { id: "work", title: "Demos that work", sub: "verified in physics" },
  { id: "mimic", title: "Isaac Lab Mimic", sub: "multiplies them" },
  { id: "train", title: "Robot training", sub: "policies learn from them" },
];

export function StackScene(p: SceneProps) {
  const { lt, L } = local(p);
  const { span } = p;
  const l0 = span.lines[0];
  const l1 = span.lines[1];
  const w = (line: typeof l0, s: string, n = 0) => wordAt(line, s, n) - span.start;
  const ins = enter(lt, w(l0, "sant") - 0.2, 0.9); // SANT steps in before the rest
  const a = window_(lt, 0, L[1] + 0.3, 0.5);
  const b = enter(lt, L[1], 0.5);
  const NODE = 290;
  const GAP = 62;
  const x0 = (1920 - (CHAIN.length * NODE + (CHAIN.length - 1) * GAP)) / 2;
  const shift = (1 - ins) * -2 * (NODE + GAP) * 0.5;
  const letters = [
    ["S", "Simulate", w(l1, "simulate")],
    ["A", "Augment", w(l1, "augment")],
    ["N", "Neaten", w(l1, "neaten")],
    ["T", "Train", w(l1, "train")],
  ] as const;
  const stack = [
    ["NVIDIA Isaac Sim 6.2", "the physics", w(l1, "isaac sim")],
    ["NVIDIA Isaac Lab 3.0", "teleop · checks · RL · tests", w(l1, "isaac lab")],
    ["NVIDIA Nemotron", "the language side", w(l1, "nemotron")],
    ["Nebius Token Factory", "hosts Nemotron", w(l1, "token")],
  ] as const;
  return (
    <div className="fm-scene fm-stack">
      {a > 0 && (
        <div className="fm-stack__a" style={{ opacity: a }}>
          <Kicker style={rise(lt, 0.2)}>Where SANT fits</Kicker>
          <h2 className="fm-title fm-title--md" style={rise(lt, 0.4)}>
            NVIDIA&rsquo;s tools multiply demos that already work.
            <br />
            <em style={{ opacity: ins }}>SANT is the step before.</em>
          </h2>
          <div className="fm-chain">
            {CHAIN.map((n, i) => {
              const early = i < 2;
              const op = early ? ins : enter(lt, 0.9 + (i - 2) * 0.25, 0.5);
              const x = x0 + i * (NODE + GAP) + (early ? 0 : shift);
              return (
                <div key={n.id} className="fm-node" data-id={n.id} style={{ left: x, width: NODE, opacity: op, transform: `translateY(${(1 - op) * 20}px)` }}>
                  <p className="fm-node__title">{n.title}</p>
                  <p className="fm-node__sub">{n.sub}</p>
                </div>
              );
            })}
            {CHAIN.slice(0, -1).map((_, i) => {
              const early = i < 2;
              const op = early ? ins : enter(lt, 1.2 + (i - 2) * 0.25, 0.5);
              const x = x0 + i * (NODE + GAP) + NODE + (early && i < 1 ? 0 : i < 2 ? 0 : shift);
              return (
                <div key={i} className="fm-link" style={{ left: x + 8, width: GAP - 16, opacity: op }}>
                  {Array.from({ length: 3 }, (_, k) => (
                    <span key={k} className="fm-link__dot" style={{ left: `${((lt * 0.9 + k / 3) % 1) * 100}%` }} />
                  ))}
                </div>
              );
            })}
          </div>
          <p className="fm-note fm-stack__foot" style={rise(lt, w(l0, "multiplying") - 0.2)}>
            When we ran Isaac Lab Mimic on our demos, SANT&rsquo;s check also rejected <b>9 of its 100</b> self-reported successes.
          </p>
        </div>
      )}
      {b > 0 && (
        <div className="fm-stack__b" style={{ opacity: b }}>
          <div className="fm-sant">
            {letters.map(([ch, word, at]) => {
              const on = enter(lt, at - 0.05, 0.35);
              return (
                <div key={ch} className="fm-sant__unit" style={{ opacity: 0.25 + 0.75 * on }}>
                  <span className="fm-sant__ch" style={{ color: on > 0.5 ? "var(--fm-teal)" : undefined }}>
                    {ch}
                  </span>
                  <span className="fm-sant__word">{word}</span>
                </div>
              );
            })}
          </div>
          <div className="fm-platform">
            {stack.map(([name, role, at]) => (
              <div key={name} className="fm-plat" style={rise(lt, at - 0.15, 20, 0.5)}>
                <p className="fm-plat__name">{name}</p>
                <p className="fm-plat__role">{role}</p>
              </div>
            ))}
          </div>
          <Kicker tone="dim" style={rise(lt, L[1] + 5.5)}>
            One Windows PC · one RTX 5080 · Nemotron in the cloud
          </Kicker>
        </div>
      )}
    </div>
  );
}
