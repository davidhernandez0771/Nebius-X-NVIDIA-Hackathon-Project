// Scenes 6-8: why it works (copying stalls; the RL teacher; 113/128 vs 0/128; the teacher caught speeding), the final
// test (the climb to 30/40; every failure a drop), and the close.
import { useEffect, useRef } from "react";
import { LOGO_SYMBOL } from "../../sant/components/logoSymbol";
import type { Vec3 } from "../../twin/types";
import { FilmTwin, stepOf } from "./FilmTwin";
import { clamp, easeInOut, enter, lerp, ramp, wordAt, window_ } from "./model";
import { CountBar, Kicker, TopPlot, local, rise, type SceneProps } from "./ui";

/** 4,096 dots, one per parallel arm: each runs short episodes that light teal when its cube is lifted. */
function ArmField({ t, opacity }: { t: number; opacity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    const n = 64;
    const s = c.width / n;
    for (let i = 0; i < n * n; i++) {
      const x = i % n;
      const y = Math.floor(i / n);
      const h = Math.sin(i * 12.9898) * 43758.5453;
      const r = h - Math.floor(h);
      const phase = (t * (0.35 + r * 0.3) + r * 7) % 1;
      const lit = phase > 0.62 && phase < 0.9;
      g.fillStyle = lit ? `rgba(25,245,194,${0.55 + 0.4 * r})` : `rgba(143,163,160,${0.1 + 0.12 * r})`;
      g.fillRect(x * s + s * 0.3, y * s + s * 0.3, s * 0.4, s * 0.4);
    }
  }, [t]);
  return <canvas ref={ref} className="fm-field" width={900} height={900} style={{ opacity }} aria-hidden="true" />;
}

function SpeedDial({ v, cap, capOn }: { v: number; cap: number; capOn: number }) {
  const MAX = 2;
  const ang = (s: number) => -120 + (Math.min(s, MAX) / MAX) * 240;
  const pt = (s: number, r: number) => {
    const a = ((ang(s) - 90) * Math.PI) / 180;
    return [250 + r * Math.cos(a), 250 + r * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number, r: number) => {
    const [x1, y1] = pt(a, r);
    const [x2, y2] = pt(b, r);
    return `M${x1} ${y1} A${r} ${r} 0 ${ang(b) - ang(a) > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const [nx, ny] = pt(v, 170);
  const over = v > cap + 0.05;
  return (
    <svg className="fm-dial" viewBox="0 0 500 420" aria-hidden="true">
      <path className="fm-dial__track" d={arc(0, MAX, 200)} />
      <path className="fm-dial__ok" d={arc(0, cap, 200)} style={{ opacity: capOn }} />
      {[0, 0.5, 1, 1.5, 2].map((s) => {
        const [x, y] = pt(s, 228);
        return (
          <text key={s} x={x} y={y} className="fm-dial__tick">
            {s}
          </text>
        );
      })}
      {capOn > 0 && (
        <line className="fm-dial__cap" x1={pt(cap, 175)[0]} y1={pt(cap, 175)[1]} x2={pt(cap, 222)[0]} y2={pt(cap, 222)[1]} style={{ opacity: capOn }} />
      )}
      <line className="fm-dial__needle" data-over={over || undefined} x1={250} y1={250} x2={nx} y2={ny} />
      <circle cx={250} cy={250} r={10} className="fm-dial__hub" />
      <text x={250} y={340} className="fm-dial__num" data-over={over || undefined}>
        {v.toFixed(1)} m/s
      </text>
      <text x={250} y={378} className="fm-dial__unit">
        the teacher&rsquo;s top hand speed
      </text>
    </svg>
  );
}

export function TeacherScene(p: SceneProps) {
  const { lt, L } = local(p);
  const { data, span } = p;
  const w = (i: number, s: string) => wordAt(span.lines[i], s) - span.start;
  const a = window_(lt, 0, L[1] + 0.25, 0.5);
  const b = window_(lt, L[1], L[2] + 0.25, 0.5);
  const c = window_(lt, L[2], L[3] + 0.25, 0.5);
  const d = enter(lt, L[3], 0.5);
  const fast = w(3, "one point seven");
  const capped = w(3, "capped");
  const v = lt < fast - 0.6 ? lerp(0, 1.7, easeInOut(ramp(lt, L[3] + 0.4, fast))) : lt < capped ? 1.7 : lerp(1.7, 0.5, easeInOut(ramp(lt, capped - 0.1, capped + 0.8)));
  const teacher = data.teacherRuns["5350"];
  const capped50 = data.teacherRuns["5351"];
  return (
    <div className="fm-scene fm-teacher">
      {a > 0 && (
        <div className="fm-panel-c" style={{ opacity: a }}>
          <Kicker style={rise(lt, 0.1)}>Copying alone · 40 unseen scenes (seeds 5020–5059)</Kicker>
          <div className="fm-bars">
            <CountBar label="Imitating the 10 raw mouse demos" k={0} n={40} fill={enter(lt, 0.6, 0.8)} tone="dim" style={rise(lt, 0.4)} />
            <CountBar label="Imitating SANT's verified, multiplied demos" k={3} n={40} fill={enter(lt, w(0, "three") - 0.1, 0.8)} style={rise(lt, 0.7)} />
          </div>
          <h2 className="fm-title fm-title--md" style={rise(lt, w(0, "stalled") - 0.1)}>
            Better data, but it <em>stalled</em>.
          </h2>
        </div>
      )}
      {b > 0 && (
        <div className="fm-split fm-teacher__b" style={{ opacity: b }}>
          <div className="fm-col fm-col--narrow">
            <Kicker style={rise(lt, L[1] + 0.1)}>Reinforcement learning · PPO in Isaac Lab</Kicker>
            <h2 className="fm-title fm-title--lg" style={rise(lt, L[1] + 0.3)}>
              A teacher <em>practises</em>.
            </h2>
            <p className="fm-stat" style={rise(lt, w(1, "four") - 0.1)}>
              <b>4,096</b> arms at once
            </p>
            <p className="fm-stat" style={rise(lt, w(1, "starting") - 0.1)}>
              starting from the <b>human demos</b>
            </p>
          </div>
          <div className="fm-stage fm-stage--field" style={rise(lt, L[1] + 0.2, 30)}>
            <ArmField t={lt} opacity={0.9} />
            <div className="fm-stage__inset">
              <FilmTwin ep={teacher} time={Math.max(0, lt - L[1] - 0.6)} className="fm-twin" />
              <p className="fm-caption">The teacher, a real gate run · replayed from Isaac</p>
            </div>
          </div>
        </div>
      )}
      {c > 0 && (
        <div className="fm-panel-c" style={{ opacity: c }}>
          <Kicker style={rise(lt, L[2] + 0.1)}>Did the human demos matter? Same teacher, code, budget and seed</Kicker>
          <div className="fm-bars fm-bars--big">
            <CountBar label="Starting from home · no demos" k={0} n={128} fill={enter(lt, w(2, "never"), 0.6)} tone="dim" note="never lifted the cube" style={rise(lt, L[2] + 0.3)} />
            <CountBar label="Starting from the human demos" k={113} n={128} fill={enter(lt, w(2, "against") - 0.1, 1.4)} style={rise(lt, w(2, "zero"))} />
          </div>
        </div>
      )}
      {d > 0 && (
        <div className="fm-split fm-teacher__d" style={{ opacity: d }}>
          <div className="fm-col fm-col--narrow">
            <Kicker tone="teal" style={rise(lt, L[3] + 0.1)}>
              SANT checks the teacher too
            </Kicker>
            <p className="fm-stat fm-stat--fail" style={rise(lt, fast + 0.3)}>
              <b>3 / 50</b> runs held up in SANT&rsquo;s physics replay
            </p>
            <p className="fm-stat" style={rise(lt, capped + 0.4)}>
              capped at <b>0.5 m/s</b>: <b>50 / 50</b>
            </p>
          </div>
          <div className="fm-stage fm-stage--side" style={rise(lt, L[3] + 0.4, 30)}>
            <FilmTwin ep={capped50} time={Math.max(0, lt - L[3] - 0.5)} className="fm-twin" />
            <p className="fm-caption">The capped teacher · a real gate run · replayed from Isaac</p>
          </div>
          <div className="fm-stage fm-stage--dial" style={rise(lt, L[3] + 0.2, 30)}>
            <SpeedDial v={v} cap={0.5} capOn={enter(lt, capped - 0.2, 0.5)} />
          </div>
        </div>
      )}
    </div>
  );
}

const CLIMB = [
  { label: "Raw mouse demos, copied", k: 0, note: "seeds 5020–5059" },
  { label: "SANT-verified demos, copied", k: 3, note: "seeds 5020–5059" },
  { label: "v1 · teacher → camera policy", k: 15, note: "seeds 5020–5059" },
  { label: "v2 · trained 3× longer + gripper fix", k: 30, note: "fresh seeds 5400–5439, run once" },
];

export function TestScene(p: SceneProps) {
  const { lt, L } = local(p);
  const { data, span } = p;
  const w = (i: number, s: string) => wordAt(span.lines[i], s) - span.start;
  const a = window_(lt, 0, L[1] + 0.25, 0.5);
  const b = window_(lt, L[1], L[2] + 0.25, 0.5);
  const c = enter(lt, L[2], 0.5);
  const run = data.finalRuns["5401"];
  const fails = data.final.runs.filter((r) => !r.success);
  const H = 470;
  const y = (k: number) => (k / 40) * H;
  const thirty = w(1, "thirty");
  return (
    <div className="fm-scene fm-test">
      {a > 0 && (
        <div className="fm-split" style={{ opacity: a }}>
          <div className="fm-stage fm-stage--big" style={rise(lt, 0.1, 30)}>
            <FilmTwin ep={run} time={Math.max(0, (lt - 0.3) * 1.05)} className="fm-twin" />
            <p className="fm-caption">The final test · seed 5401 · replayed from what Isaac recorded</p>
          </div>
          <div className="fm-col fm-col--narrow">
            <Kicker style={rise(lt, 0.3)}>Distilled · a LeRobot ACT policy</Kicker>
            <h2 className="fm-title fm-title--lg" style={rise(lt, 0.5)}>
              It sees only through its <em>cameras</em>.
            </h2>
            <p className="fm-note" style={rise(lt, w(0, "real") - 0.1)}>
              Trained on the teacher&rsquo;s runs mixed with our verified human demos.
            </p>
          </div>
        </div>
      )}
      {b > 0 && (
        <div className="fm-panel-c fm-climb" style={{ opacity: b }}>
          <Kicker style={rise(lt, L[1] + 0.1)}>Success on 40 unseen scenes</Kicker>
          <div className="fm-climb__chart" style={{ height: H + 120 }}>
            <div className="fm-climb__goal" style={{ bottom: 120 + y(24), opacity: enter(lt, w(1, "goal") - 0.1, 0.5) }}>
              <span>goal 24 / 40 · written down before the run</span>
            </div>
            {CLIMB.map((bar, i) => {
              const at = i < 3 ? L[1] + 0.3 + i * 0.35 : thirty - 0.15;
              const v = enter(lt, at, 0.9);
              const last = i === 3;
              return (
                <div key={bar.label} className="fm-climb__col" data-last={last || undefined} style={{ opacity: enter(lt, at - 0.2, 0.3) }}>
                  <p className="fm-climb__num">
                    {Math.round(bar.k * v)}
                    <span>/40</span>
                  </p>
                  <div className="fm-climb__bar" style={{ height: Math.max(3, y(bar.k) * v) }} />
                  <p className="fm-climb__label">{bar.label}</p>
                  <p className="fm-climb__note">{bar.note}</p>
                </div>
              );
            })}
          </div>
          <p className="fm-note fm-climb__foot" style={rise(lt, thirty + 0.6)}>
            Different seed blocks, so the steps compare descriptively. 30/40: Wilson 95% CI 60–86%.
          </p>
        </div>
      )}
      {c > 0 && (
        <div className="fm-panel-c" style={{ opacity: c }}>
          <Kicker tone="fail" style={rise(lt, L[2] + 0.1)}>
            The 10 failures · every one dropped the cube
          </Kicker>
          <div className="fm-fails">
            {fails.map((r, i) => {
              const tr = data.finalRuns[r.id];
              return (
                <div key={r.id} className="fm-fails__cell" style={rise(lt, L[2] + 0.2 + i * 0.07, 16, 0.4)}>
                  {tr && <TopPlot hand={tr.handPos ?? []} cube={tr.cubePos} bin={tr.bin.pos as Vec3} upto={stepOf(tr, (lt - L[2]) * 9)} verdict="fail" size={250} />}
                  <span className="fm-tag">dropped · {r.seed}</span>
                </div>
              );
            })}
          </div>
          <h2 className="fm-title fm-title--md" style={rise(lt, w(2, "fix") - 0.2)}>
            That&rsquo;s what we fix <em>next</em>.
          </h2>
        </div>
      )}
    </div>
  );
}

export function CloseScene(p: SceneProps) {
  const { lt, L, dur } = local(p);
  const a = window_(lt, 0, L[1] + 0.2, 0.5);
  const b = enter(lt, L[1], 0.5);
  const draw = (i: number) => clamp((lt - L[1] - 0.1 - i * 0.18) / 0.7);
  return (
    <div className="fm-scene fm-close">
      {a > 0 && (
        <div className="fm-panel-c" style={{ opacity: a }}>
          <Kicker style={rise(lt, 0.1)}>What it doesn&rsquo;t show</Kicker>
          <ul className="fm-limits">
            {[
              ["Everything here is simulation.", "No real robot has run it yet.", 0.4],
              ["One task, one arm.", "A 5 cm cube into a bin, with a Franka.", 1.6],
              ["A real robot is next.", "The same recipe on an SO-101 or a Franka, from webcam demos.", 3.0],
            ].map(([head, sub, at]) => (
              <li key={head as string} style={rise(lt, at as number)}>
                <b>{head}</b> {sub}
              </li>
            ))}
          </ul>
        </div>
      )}
      {b > 0 && (
        <div className="fm-close__b" style={{ opacity: b * (1 - ramp(lt, dur - 0.9, dur - 0.1)) }}>
          <svg className="fm-logo" viewBox={LOGO_SYMBOL.viewBox} aria-hidden="true">
            {LOGO_SYMBOL.units.map((d, i) => (
              <path
                key={i}
                d={d}
                pathLength={1}
                data-accent={LOGO_SYMBOL.accent.includes(i) || undefined}
                style={{ strokeDasharray: 1, strokeDashoffset: 1 - draw(i), strokeWidth: LOGO_SYMBOL.stroke }}
              />
            ))}
          </svg>
          <p className="fm-word" style={rise(lt, L[1] + 0.9, 20, 0.8)}>
            SANT
          </p>
          <p className="fm-tagline" style={rise(lt, L[1] + 1.4)}>
            Ten sloppy demos in. A robot that works out.
          </p>
          <div className="fm-credits" style={rise(lt, L[1] + 3.6)}>
            <p>Simulate · Augment · Neaten · Train</p>
            <p>Built on NVIDIA Isaac Sim, Isaac Lab and Nemotron, on Nebius Token Factory</p>
            <p className="fm-credits__url">github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project</p>
          </div>
        </div>
      )}
    </div>
  );
}
