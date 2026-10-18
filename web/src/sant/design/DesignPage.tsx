// /design: the review page for the SANT design system. Every token, component and motion, in both
// modes, using the project's real content. Spec: docs/design/design-system.md and motion.md.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Badge, Button, Card, ChartFrame, Logo, ResultBars, Stat, StepRail, useToast, type Arm } from "../components";
import { contrast } from "../contrast";
import { DURATIONS, EASINGS, STAGGER } from "../motion/tokens";
import { usePowerOn } from "../shells/PowerOn";
import { StoryShell } from "../shells/StoryShell";
import { FrameMeter } from "./FrameMeter";
import { HudSections } from "./HudSections";
import { Section } from "./Section";
import "./design.css";

// src: docs/superpowers/notes/2026-10-15-t3-status.md (2026-10-17 13:15, sprint 7 Tasks 3–4):
// confirmatory seeds 5020–5059, raw_10_30k 3/40 (CI 2.6–19.9%) vs raw_multiply_10_30k 17/40
// (CI 28.5–57.8%), two-sided Fisher exact p = 0.00055.
const RESULT: Arm[] = [
  { label: "The 10 demos alone", k: 3, n: 40, ciLow: 2.6, ciHigh: 19.9 },
  { label: "The 10 demos + 100 verified copies", k: 17, n: 40, ciLow: 28.5, ciHigh: 57.8 },
];

// Ratios are shown for colours that sit on the ground (text, accents, control borders), not for grounds.
const ON_GROUND = new Set(["text", "muted", "control", "accent", "issue", "violet", "danger"]);

const SWATCHES: { token: string; role: string }[] = [
  { token: "bg", role: "Page ground" },
  { token: "surface", role: "Cards and panels" },
  { token: "surface-2", role: "Raised or inset areas" },
  { token: "text", role: "Body text" },
  { token: "muted", role: "Secondary text" },
  { token: "line", role: "Decorative rules only" },
  { token: "control", role: "Borders that identify a control" },
  { token: "accent", role: "Brand, live state, focus" },
  { token: "accent-soft", role: "Live badge ground" },
  { token: "issue", role: "Issues and repairs" },
  { token: "issue-soft", role: "Issue badge ground" },
  { token: "violet", role: "Second data series" },
  { token: "danger", role: "Errors only" },
];

const TYPE: { token: string; spec: string; sample: string; className: string }[] = [
  { token: "--sant-fs-display", spec: "Instrument Serif, fluid 48–104 px", sample: "Perfect, then multiply", className: "sant-display" },
  { token: "--sant-fs-1", spec: "Instrument Serif, 49 px", sample: "Ten demos became three hundred", className: "sant-h1" },
  { token: "--sant-fs-2", spec: "Instrument Serif, 39 px", sample: "Multiplying helps the robot", className: "sant-h2" },
  { token: "--sant-fs-5", spec: "Geist 600, 20 px", sample: "Verified copies", className: "sant-h3" },
  {
    token: "--sant-fs-body-paper",
    spec: "Geist 400, 18 px, line height 1.6, at most 66 characters a line",
    sample:
      "A webcam demo is shaky and full of pauses. SANT measures every movement, repairs what it can, checks the result in physics, and only then makes copies.",
    className: "sant-design-type__body",
  },
  { token: "--sant-fs-stat", spec: "Geist Mono 500, tabular figures", sample: "42.5%", className: "sant-design-type__stat" },
  { token: "--sant-fs-caption", spec: "Geist 400, 13 px", sample: "Source: T3 status note, 2026-10-17 13:15", className: "sant-design-type__caption" },
];

const RADII: { token: string; use: string }[] = [
  { token: "xs", use: "Chart bars, inline code" },
  { token: "sm", use: "Buttons, inputs" },
  { token: "md", use: "Cards" },
  { token: "lg", use: "Sheets, overlays, toasts" },
  { token: "pill", use: "Badges, switches" },
];

const DURATION_USE: Record<keyof typeof DURATIONS, string> = {
  "0": "Effects off: every duration collapses to this",
  "1": "Press feedback",
  "2": "Hover, colour and state changes",
  "3": "Route cross-fade, popovers",
  "4": "Toasts, panels, a rail unit lighting",
  story: "A story reveal",
  count: "Counters and bars",
  power: "The whole power-on, dust included",
};

const EASING_USE: Record<keyof typeof EASINGS, string> = {
  out: "Entering, or answering the user",
  in: "Leaving",
  move: "Between two on-screen states",
  emph: "The story's big moments",
};

/** One mode's swatches, read from the live CSS so the page can't disagree with tokens.css. */
function Palette({ mode, title }: { mode: "paper" | "volt"; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    const style = getComputedStyle(ref.current!);
    setHex(Object.fromEntries(SWATCHES.map((s) => [s.token, style.getPropertyValue(`--sant-${s.token}`).trim()])));
  }, []);
  return (
    <div ref={ref} className="sant-design-panel" data-mode={mode}>
      <h3 className="sant-h3">{title}</h3>
      <ul className="sant-design-swatches">
        {SWATCHES.map((s) => {
          const value = hex[s.token];
          const ratio = value && hex.bg && /^#[0-9a-f]{6}$/i.test(value) ? contrast(value, hex.bg) : null;
          return (
            <li key={s.token} className="sant-design-swatch">
              <span className="sant-design-swatch__chip" style={{ background: `var(--sant-${s.token})` }} aria-hidden="true" />
              <span className="sant-design-swatch__name">
                <code className="sant-num">--sant-{s.token}</code>
                <span className="sant-design-swatch__role">{s.role}</span>
              </span>
              <span className="sant-design-swatch__value sant-num">
                {value || "—"}
                {ratio !== null && ON_GROUND.has(s.token) && <span className="sant-design-swatch__ratio">{ratio.toFixed(2)}:1</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function bezierPath([x1, y1, x2, y2]: readonly number[], w: number, h: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const u = 1 - t;
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const y = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    pts.push(`${(x * w).toFixed(1)},${(h - y * h).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

function MotionTokens() {
  const [run, setRun] = useState(false);
  const [replay, setReplay] = useState(0);
  return (
    <>
      <div className="sant-design-actions">
        <Button variant="secondary" size="sm" onClick={() => setRun((r) => !r)}>
          {run ? "Send the dots back" : "Play the durations"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setReplay((n) => n + 1)}>
          Replay the S·A·N·T stagger
        </Button>
      </div>
      <table className="sant-design-table">
        <caption className="sant-sr-only">Duration tokens</caption>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Value</th>
            <th scope="col">Use</th>
            <th scope="col">
              <span className="sant-sr-only">Demo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(DURATIONS) as (keyof typeof DURATIONS)[]).map((name) => (
            <tr key={name}>
              <td>
                <code className="sant-num">--sant-dur-{name}</code>
              </td>
              <td className="sant-num">{DURATIONS[name]} ms</td>
              <td>{DURATION_USE[name]}</td>
              <td className="sant-design-track" data-run={run}>
                <span className="sant-design-dot" style={{ transitionDuration: `var(--sant-dur-${name})` }} aria-hidden="true" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="sant-design-curves">
        {(Object.keys(EASINGS) as (keyof typeof EASINGS)[]).map((name) => (
          <li key={name} className="sant-design-curve">
            <svg viewBox="-4 -4 128 88" width="128" height="88" aria-hidden="true">
              <rect x="0" y="0" width="120" height="80" className="sant-design-curve__box" />
              <path d={bezierPath(EASINGS[name], 120, 80)} className="sant-design-curve__line" />
            </svg>
            <code className="sant-num">--sant-ease-{name}</code>
            <span className="sant-design-curve__value sant-num">cubic-bezier({EASINGS[name].join(", ")})</span>
            <span>{EASING_USE[name]}</span>
          </li>
        ))}
      </ul>
      <ul className="sant-design-staggers">
        {(Object.keys(STAGGER) as (keyof typeof STAGGER)[]).map((name) => (
          <li key={name}>
            <code className="sant-num">--sant-stagger-{name}</code> <span className="sant-num">{STAGGER[name]} ms</span>
          </li>
        ))}
      </ul>
      <div className="sant-design-logo-row" key={replay}>
        <Logo size="lg" lit="sequence" />
      </div>
    </>
  );
}

function Specimens() {
  const toast = useToast();
  const [active, setActive] = useState<number>(2);
  return (
    <div className="sant-design-specimens">
      <div className="sant-design-pair">
        {(["paper", "volt"] as const).map((mode) => (
          <div key={mode} className="sant-design-panel" data-mode={mode}>
            <h3 className="sant-h3">{mode === "paper" ? "Field Notes (story pages)" : "Volt (app pages)"}</h3>
            <div className="sant-design-row">
              <Button>Record a demo</Button>
              <Button variant="secondary">See the results</Button>
              <Button variant="ghost">Skip</Button>
              <Button disabled>Exporting…</Button>
            </div>
            <div className="sant-design-row">
              <Badge tone="live" dot>
                Sim connected
              </Badge>
              <Badge tone="issue">2 pauses</Badge>
              <Badge tone="info">Nemotron</Badge>
              <Badge>Draft</Badge>
            </div>
            <div className="sant-design-cards">
              {/* src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 7 Task 2b: 300/300 verified) */}
              <Card title="Verified copies" tone="live" aside={<Badge tone="live">Done</Badge>}>
                <p className="sant-design-card-text">
                  <span className="sant-num">300</span> of <span className="sant-num">300</span> copies passed the physics check.
                </p>
              </Card>
              {/* src: docs/media/README.md (degraded_0004: an 11.8 mm off-center grasp) */}
              <Card title="Off-center grasp" tone="issue" aside={<Badge tone="issue">Repair</Badge>}>
                <p className="sant-design-card-text">
                  The gripper closed <span className="sant-num">11.8 mm</span> from the cube's center.
                </p>
              </Card>
            </div>
            <StepRail active={active} />
            <div className="sant-design-row">
              {[0, 1, 2, 3, 4].map((i) => (
                <Button key={i} variant={i === active ? "primary" : "ghost"} size="sm" onClick={() => setActive(i)}>
                  {i === 4 ? "All done" : `Step ${i + 1}`}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="sant-notes sant-design-result">
        <ChartFrame
          title="Success on 40 new scenes"
          caption="ACT trained twice from the same 10 scripted-expert demos, 30k steps each, tested on 40 scenes fixed in advance. One task, one simulated robot, one training run per arm."
          source="T3 status note, 2026-10-17 13:15 (sprint 7 Tasks 3–4)"
        >
          <ResultBars arms={RESULT} p="0.0005" />
        </ChartFrame>
        <aside className="sant-margin-note">
          Bars grow once, at the same speed, with an ease-out that never passes the measured rate. The confidence intervals appear
          after the bars. With effects off you see the end state.
        </aside>
      </div>

      <div className="sant-design-stats">
        <Stat value={7.5} decimals={1} suffix="%" label="success with the 10 demos alone" note="3 of 40, 95% CI 2.6–19.9%" />
        <Stat
          value={42.5}
          decimals={1}
          suffix="%"
          label="success with 100 verified copies added"
          note="17 of 40, 95% CI 28.5–57.8%"
          source="T3 status note, 2026-10-17"
        />
      </div>

      <div className="sant-design-row">
        <Button variant="secondary" onClick={() => toast.show({ message: "Demo saved. Review it before perfecting.", tone: "live" })}>
          Show a saved toast
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.show({ message: "Couldn't reach the sim worker. Start it with start.ps1 -Sim, then try again.", tone: "danger" })}
        >
          Show an error toast
        </Button>
      </div>
    </div>
  );
}

export function DesignPage() {
  const powerOn = usePowerOn();
  return (
    <StoryShell home="/design" links={[{ to: "/design", label: "Design system" }]} cta={{ label: "Open the app", to: "/design/app" }}>
      <header className="sant-design-hero">
        <Logo size="lg" lit="sequence" />
        <h1 className="sant-display">Perfect, then multiply</h1>
        <div className="sant-notes">
          <p className="sant-lede">
            The review page for SANT's two modes: Field Notes for the story pages, Volt for the app. Every token, component and
            motion is live here, so they can be judged before the pages move over.
          </p>
          <aside className="sant-margin-note">
            <p>The Effects switch in the top bar turns motion off. So does your system's reduced-motion setting: every end state still shows.</p>
            <FrameMeter />
          </aside>
        </div>
      </header>

      <Section
        title="Colour"
        lede="Two grounds, one brand. Teal means live, amber means an issue or a repair, violet is a second data series."
        note="Each ratio is measured against its own ground. Text needs 4.5:1, controls 3:1; tokens.test.ts checks every pair from the CSS."
      >
        <div className="sant-design-pair">
          <Palette mode="paper" title="Field Notes" />
          <Palette mode="volt" title="Volt" />
        </div>
      </Section>

      <Section
        title="Type"
        lede="Instrument Serif for display, Geist for reading and controls, Geist Mono for numbers."
        note="Instrument Serif has one weight, so serif hierarchy comes from size and space, never fake bold."
      >
        <ul className="sant-design-type">
          {TYPE.map((t) => (
            <li key={t.token}>
              <span className="sant-design-type__meta">
                <code className="sant-num">{t.token}</code>
                <span>{t.spec}</span>
              </span>
              <span className={t.className}>{t.sample}</span>
            </li>
          ))}
        </ul>
        <div className="sant-design-panel" data-mode="volt">
          <p className="sant-app__title">Review</p>
          <p className="sant-design-volt-line">
            <span className="sant-num">s1_0002</span> runs <span className="sant-num">13.8 s</span> raw and{" "}
            <span className="sant-num">9.3 s</span> after repair.
          </p>
        </div>
      </Section>

      <Section title="Space and radius" lede="A 4 px base. Radius grows with the size of the thing, so a badge, a button and a sheet never look alike.">
        <ul className="sant-design-space">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <li key={n}>
              <code className="sant-num">--sant-space-{n}</code>
              <span className="sant-design-space__bar" style={{ width: `var(--sant-space-${n})` } as CSSProperties} aria-hidden="true" />
            </li>
          ))}
        </ul>
        <ul className="sant-design-radii">
          {RADII.map((r) => (
            <li key={r.token}>
              <span className="sant-design-radii__box" style={{ borderRadius: `var(--sant-radius-${r.token})` }} aria-hidden="true" />
              <code className="sant-num">--sant-radius-{r.token}</code>
              <span>{r.use}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Motion"
        lede="Motion shows what changed, or draws attention once. Each page gets one orchestrated moment; everything else answers the user."
        note="No overshoot on anything that shows a measured value: a bar that bounces past 42.5% would show a number nobody measured."
      >
        <MotionTokens />
      </Section>

      <Section title="Components" lede="Each specimen is drawn in both modes from the same component.">
        <Specimens />
      </Section>

      <HudSections />

      <Section
        title="Shells"
        lede="This page sits in the story shell: paper, smooth scroll, the story nav. The app shell is Volt, with native scroll, the S·A·N·T rail and a status slot."
        note="Crossing from story to app powers on: the Volt ground grows from the button you pressed, dust gathers into S·A·N·T and each letter lights as its dust lands. Escape or a click skips it. With effects off it is an instant change of page."
      >
        <div className="sant-design-row">
          <Button onClick={(e) => powerOn.start("/design/app", e.currentTarget)}>Open the app shell</Button>
        </div>
      </Section>
    </StoryShell>
  );
}
