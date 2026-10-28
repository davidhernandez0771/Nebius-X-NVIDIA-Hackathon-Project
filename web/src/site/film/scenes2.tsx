// Scenes 4-5: what SANT does to a demo (record, check, repair, multiply), and Nemotron on Nebius Token Factory.
import type { Vec3 } from "../../twin/types";
import { FilmTwin } from "./FilmTwin";
import { clamp, enter, wordAt, window_ } from "./model";
import { CamTile, Check, Kicker, TopPlot, demoRow, local, rise, type SceneProps } from "./ui";

const DEMO = "human_20261020183738_00ab";

const STEPS = [
  ["01", "Record", "in the browser, live in Isaac Lab"],
  ["02", "Check", "replayed with real contact forces"],
  ["03", "Repair", "tested rules, or Nemotron's edits"],
  ["04", "Multiply", "keep only the copies that pass"],
] as const;

export function PipelineScene(p: SceneProps) {
  const { lt, L } = local(p);
  const { data, span } = p;
  const w = (i: number, s: string) => wordAt(span.lines[i], s) - span.start;
  const active = lt < L[1] ? 0 : lt < L[2] ? 1 : lt < L[3] ? 2 : 3;
  const demo = data.demos[DEMO];
  const rec = window_(lt, 0, L[1] + 0.25, 0.5);
  const chk = window_(lt, L[1], L[2] + 0.25, 0.5);
  const rep = window_(lt, L[2], L[3] + 0.25, 0.5);
  const mul = enter(lt, L[3], 0.5);
  const checks = [
    ["The cube ends in the bin", L[1] + 2.4],
    ["It was never dropped", L[1] + 3.2],
    ["No collision: contact under 5 N", L[1] + 4.0],
    ["The gripper let go", L[1] + 4.8],
  ] as const;
  const passAt = L[1] + 5.6;
  const variants = data.variants;
  const mt = lt - L[3];
  const tileDone = (i: number) => mt > 1.2 + (i % 10) * 0.06 + Math.floor(i / 10) * 0.12 + 2.6;
  const passed = variants.filter((v, i) => v.success && tileDone(i)).length;
  return (
    <div className="fm-scene fm-pipe">
      <aside className="fm-rail" style={rise(lt, 0.1, 0, 0.5)}>
        <Kicker>What SANT does</Kicker>
        <ol>
          {STEPS.map(([n, name, sub], i) => (
            <li key={n} data-on={i === active || undefined} data-done={i < active || undefined}>
              <span className="fm-rail__n">{n}</span>
              <span className="fm-rail__name">{name}</span>
              <span className="fm-rail__sub">{sub}</span>
            </li>
          ))}
        </ol>
      </aside>
      <div className="fm-pipe__main">
        {rec > 0 && (
          <div className="fm-pipe__panel" style={{ opacity: rec }}>
            <div className="fm-stage fm-stage--wide">
              <FilmTwin ep={demo} time={Math.max(0, lt - 0.3)} className="fm-twin" />
              <p className="fm-caption">
                <span className="fm-rec" /> Recording · a mouse drives the Franka arm in Isaac Lab
              </p>
            </div>
            <div className="fm-pipe__cams" style={rise(lt, 1.2)}>
              <Kicker tone="dim">Isaac&rsquo;s front camera</Kicker>
              <CamTile atlas="demos.jpg" row={demoRow(data, DEMO)} col={Math.min(23, Math.floor(clamp((lt - 0.3) / 8.4) * 23))} cols={24} rows={data.demoRows.length} size={256} />
            </div>
          </div>
        )}
        {chk > 0 && (
          <div className="fm-pipe__panel" style={{ opacity: chk }}>
            <div className="fm-stage fm-stage--wide">
              <FilmTwin ep={demo} time={Math.max(0, (lt - L[1] - 0.2) * 1.25)} className="fm-twin" />
              <p className="fm-caption">Replayed in Isaac Lab physics · code decides</p>
            </div>
            <div className="fm-checks">
              <Kicker tone="dim" style={rise(lt, L[1] + 1.4)}>
                SANT&rsquo;s physics check
              </Kicker>
              {checks.map(([text, at]) => (
                <p key={text} className="fm-checkrow" style={rise(lt, at, 14, 0.4)}>
                  <Check ok /> {text}
                </p>
              ))}
              <div className="fm-stamp fm-stamp--ok" data-on={lt > passAt || undefined} style={{ opacity: enter(lt, passAt, 0.3), transform: `scale(${1.25 - 0.25 * enter(lt, passAt, 0.35)})` }}>
                Pass
              </div>
              <p className="fm-stat" style={rise(lt, passAt + 0.6)}>
                <b>10 / 10</b> mouse demos passed as recorded
              </p>
            </div>
          </div>
        )}
        {rep > 0 && (
          <div className="fm-pipe__panel fm-repair" style={{ opacity: rep }}>
            <div className="fm-repair__in" style={rise(lt, L[2] + 0.1)}>
              <Kicker tone="fail">A demo that failed</Kicker>
              <TopPlot hand={data.demos["human_20261019185902_c045"].hand} cube={data.demos["human_20261019185902_c045"].cubePos} bin={data.demos["human_20261019185902_c045"].bin.pos as Vec3} upto={9999} verdict="fail" size={300} />
            </div>
            <div className="fm-repair__lanes">
              <div className="fm-lane" style={rise(lt, w(2, "tested") - 0.1)}>
                <p className="fm-lane__title">Tested rules</p>
                <p className="fm-lane__sub">trim · smooth · re-centre the grasp</p>
              </div>
              <div className="fm-lane fm-lane--nemo" style={rise(lt, w(2, "nemotron") - 0.1)}>
                <p className="fm-lane__title">Nemotron proposes edits</p>
                <p className="fm-lane__sub">small changes to the path</p>
              </div>
            </div>
            <div className="fm-repair__out" style={rise(lt, w(2, "checked") - 0.2)}>
              <p className="fm-lane__title">Physics check, again</p>
              <p className="fm-lane__sub">a fix is kept only if Isaac Lab says it worked</p>
              <Check ok style={{ fontSize: 64, marginTop: 16 }} />
            </div>
            <svg className="fm-repair__wires" viewBox="0 0 1200 600" aria-hidden="true">
              {[205, 425].map((y, i) => (
                <g key={y} style={{ opacity: enter(lt, (i ? w(2, "nemotron") : w(2, "tested")) - 0.1, 0.5) }}>
                  <path d={`M300 362 C 360 362, 360 ${y}, 420 ${y}`} />
                  <path d={`M840 ${y} C 870 ${y}, 870 320, 900 320`} />
                </g>
              ))}
            </svg>
          </div>
        )}
        {mul > 0 && (
          <div className="fm-pipe__panel fm-mult" style={{ opacity: mul }}>
            <div className="fm-mult__grid">
              {variants.map((v, i) => {
                const start = 0.6 + (i % 10) * 0.06 + Math.floor(i / 10) * 0.12;
                const col = Math.min(15, Math.floor(clamp((mt - start - 0.6) / 2.6) * 15.99));
                return (
                  <div key={v.id} className="fm-mult__cell" style={{ opacity: enter(mt, start, 0.4) }}>
                    <CamTile atlas="variants.jpg" row={i} col={col} cols={16} rows={variants.length} size={66} />
                    {tileDone(i) && <Check ok={v.success} />}
                  </div>
                );
              })}
            </div>
            <div className="fm-mult__side">
              <Kicker tone="teal">Multiplied · cube and bin moved</Kicker>
              <p className="fm-big fm-big--teal fm-big--md">
                {passed}
                <span> / 100</span>
              </p>
              <p className="fm-note">
                copies of the ten demos passed physics and were kept.
                <br />
                Every tile is Isaac Sim&rsquo;s own camera.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = { green: "#5BD38A", yellow: "#F2C94C", white: "#E6EEEC", red: "#FF8A5C", blue: "#4AA3FF" };

export function NemotronScene(p: SceneProps) {
  const { lt, L } = local(p);
  const { data, span } = p;
  const w = (i: number, s: string) => wordAt(span.lines[i], s) - span.start;
  const plan = data.plan;
  const a = window_(lt, 0, L[1] + 0.25, 0.5);
  const b = enter(lt, L[1], 0.5);
  const typed = plan.text.slice(0, Math.floor(clamp((lt - 0.6) / 2.6) * plan.text.length));
  const objs = plan.plan.objects;
  const json = [
    `"model": "${plan.model}",`,
    ...objs.map((o) => `{ "id": "${o.id}", "kind": "${o.kind}", "x": ${o.pose.x}, "y": ${o.pose.y} }`),
    `"goals": [green → bin_big, yellow → bin_big]`,
  ];
  const roles = [
    ["Labels demos", w(0, "labels")],
    ["Turns a sentence into a scene", w(0, "sentence")],
    ["Proposes repairs", w(0, "proposes")],
  ] as const;
  const rules = [
    ["It never moves the robot.", w(0, "never")],
    ["Code checks every answer.", w(0, "code")],
    ["Physics has the final word.", w(0, "physics")],
  ] as const;
  // the plan from above: x 0.3..0.8 up, y -0.4..0.4 left
  const px = (x: number, y: number) => [(0.4 - y) * 400, (0.8 - x) * 400] as const;
  const calls = Math.round(483 * enter(lt, w(1, "four") - 0.1, 1.4));
  return (
    <div className="fm-scene fm-nemo">
      {a > 0 && (
        <div style={{ opacity: a }}>
          <Kicker style={rise(lt, 0.1)}>The language side · NVIDIA Nemotron on Nebius Token Factory</Kicker>
          <div className="fm-roles">
            {roles.map(([text, at]) => (
              <span key={text} className="fm-chip fm-chip--lg" style={rise(lt, at - 0.15, 14, 0.4)}>
                {text}
              </span>
            ))}
          </div>
          <div className="fm-nemo__flow">
            <div className="fm-prompt" style={rise(lt, 0.4)}>
              <Kicker tone="dim">A sentence</Kicker>
              <p className="fm-prompt__text">
                &ldquo;{typed}
                <span className="fm-caret" style={{ opacity: lt < 3.4 ? (Math.floor(lt * 2.5) % 2 ? 1 : 0.2) : 0 }}>
                  ▍
                </span>
                {typed.length === plan.text.length ? "”" : ""}
              </p>
            </div>
            <div className="fm-arrow" style={{ opacity: enter(lt, 3.2, 0.4) }} />
            <div className="fm-json" style={rise(lt, 3.4)}>
              <Kicker tone="dim">Nemotron&rsquo;s scene plan (as logged)</Kicker>
              {json.map((line, i) => (
                <p key={i} style={{ opacity: enter(lt, 3.7 + i * 0.3, 0.3) }}>
                  {line}
                </p>
              ))}
              <p className="fm-json__ok" style={{ opacity: enter(lt, 5.4, 0.3) }}>
                <Check ok /> validated by code · {plan.calls} calls · ${plan.est_cost_usd.toFixed(4)}
              </p>
            </div>
            <div className="fm-arrow" style={{ opacity: enter(lt, 5.8, 0.4) }} />
            <svg className="fm-plan" viewBox="0 0 320 200" style={rise(lt, 6.0)} aria-hidden="true">
              <rect className="fm-plan__reach" x={px(0.65, 0.3)[0]} y={px(0.65, 0.3)[1]} width={0.6 * 400} height={0.25 * 400} />
              {objs.map((o) => {
                const [x, y] = px(o.pose.x, o.pose.y);
                const s = (o.kind === "bin" ? (o.inner?.[0] ?? 0.2) : (o.size ?? 0.05)) * 400;
                return <rect key={o.id} className={o.kind === "bin" ? "fm-plan__bin" : "fm-plan__cube"} x={x - s / 2} y={y - s / 2} width={s} height={s} style={{ stroke: PLAN_COLORS[o.color], fill: o.kind === "bin" ? "none" : PLAN_COLORS[o.color] }} />;
              })}
              <text x={160} y={196} className="fm-plan__label">
                the robot
              </text>
            </svg>
          </div>
          <div className="fm-rules">
            {rules.map(([text, at]) => (
              <p key={text} style={rise(lt, at - 0.1, 14, 0.45)}>
                {text}
              </p>
            ))}
          </div>
        </div>
      )}
      {b > 0 && (
        <div className="fm-nemo__b" style={{ opacity: b }}>
          <div className="fm-hosts">
            <div className="fm-host" style={rise(lt, L[1] + 0.2)}>
              <Kicker tone="teal">Nebius Token Factory · cloud</Kicker>
              <p className="fm-host__name">NVIDIA Nemotron</p>
              <p className="fm-host__sub">Nemotron 3 Super 120B · Nemotron 3.5 Super VL</p>
            </div>
            <div className="fm-host__link" style={{ opacity: enter(lt, L[1] + 0.8, 0.5) }}>
              {Array.from({ length: 4 }, (_, k) => (
                <span key={k} className="fm-link__dot" style={{ left: `${((lt * 0.6 + k / 4) % 1) * 100}%` }} />
              ))}
            </div>
            <div className="fm-host" style={rise(lt, w(1, "gpu") - 0.2)}>
              <Kicker>Our PC · one RTX 5080</Kicker>
              <p className="fm-host__name">Isaac Sim + Isaac Lab</p>
              <p className="fm-host__sub">the GPU stays free for physics and RL</p>
            </div>
          </div>
          <div className="fm-nemo__stats" style={rise(lt, w(1, "four") - 0.2)}>
            <p className="fm-big fm-big--md">
              {calls}
              <span> calls</span>
            </p>
            <p className="fm-big fm-big--md fm-big--teal" style={{ opacity: enter(lt, w(1, "dollar") - 0.2, 0.4) }}>
              ≈ $1.14<span> in all</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
