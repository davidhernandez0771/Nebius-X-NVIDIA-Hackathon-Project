// /design sections for the app-page parts: tracking HUD, status glyphs, count-up tiles,
// countdown, dials, glyph loader and pill nav. Each is drawn in the mode it will live in, mostly
// Volt. Inspiration (our own versions, nothing copied): docs/design/ui-motion-research.md §10.
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  CountUpTiles,
  Dial,
  DottedCountdown,
  GLYPH_STATES,
  GlyphLoader,
  PillNav,
  StatusGlyph,
  TrackingHUD,
  type Detection,
  type GlyphState,
} from "../components";
import { Section } from "./Section";

const STATES = Object.keys(GLYPH_STATES) as GlyphState[];

/* ------------------------------------------------------------ tracking */

const FRAMES = 30;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A sample track: the hand moves to the cube and the gripper closes (amber) for the last frames. */
function sampleFrame(f: number): Detection[] {
  const t = f / (FRAMES - 1);
  const e = 1 - (1 - t) ** 3;
  const closed = f >= FRAMES - 6;
  return [
    {
      id: "hand",
      label: closed ? "hand closed" : "hand",
      score: 0.97,
      box: [lerp(0.1, 0.46, e), lerp(0.24, 0.3, e), lerp(0.22, 0.14, e), lerp(0.36, 0.27, e)],
      tone: closed ? "issue" : "live",
    },
    { id: "cube", label: "cube", box: [0.58, 0.58, 0.08, 0.11], tone: "info" },
    { id: "bin", label: "bin", box: [0.77, 0.5, 0.17, 0.32] },
  ];
}

function TrackingDemo() {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setFrame((f) => {
        if (f >= FRAMES - 1) {
          setPlaying(false);
          return f;
        }
        return f + 1;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [playing]);
  return (
    <div className="sant-design-panel" data-mode="volt">
      <div className="sant-design-row">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFrame(0);
            setPlaying(true);
          }}
        >
          Play a sample track
        </Button>
        <Badge>Sample detections, not a recording</Badge>
      </div>
      <TrackingHUD
        detections={sampleFrame(frame)}
        label="Sample webcam tracking: a hand reaching for the cube"
        readout={`frame ${String(frame + 1).padStart(2, "0")}/${FRAMES}`}
      />
    </div>
  );
}

/* -------------------------------------------------------------- glyphs */

const PIPELINE: { state: GlyphState; busy: boolean }[][] = [
  [{ state: "recorded", busy: false }],
  [{ state: "recorded", busy: false }, { state: "diagnosed", busy: true }],
  [{ state: "recorded", busy: false }, { state: "diagnosed", busy: false }],
  [{ state: "recorded", busy: false }, { state: "diagnosed", busy: false }, { state: "repaired", busy: true }],
  [{ state: "recorded", busy: false }, { state: "diagnosed", busy: false }, { state: "repaired", busy: false }],
  [{ state: "recorded", busy: false }, { state: "diagnosed", busy: false }, { state: "repaired", busy: false }, { state: "verified", busy: true }],
  [{ state: "recorded", busy: false }, { state: "diagnosed", busy: false }, { state: "repaired", busy: false }, { state: "verified", busy: false }],
];

function PipelineDemo() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= PIPELINE.length - 1) {
          setRunning(false);
          return s;
        }
        return s + 1;
      });
    }, 700);
    return () => window.clearInterval(id);
  }, [running]);
  return (
    <div className="sant-design-glyph-run">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setStep(0);
          setRunning(true);
        }}
      >
        Run a demo through
      </Button>
      <ul className="sant-design-strip" aria-label="One demo through the pipeline">
        {PIPELINE[step].map((g) => (
          <li key={g.state}>
            <StatusGlyph state={g.state} busy={g.busy} />
            <span aria-hidden="true">{g.busy ? GLYPH_STATES[g.state].busy : GLYPH_STATES[g.state].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------- countdown */

function CountdownDemo() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div className="sant-design-panel sant-design-center" data-mode="volt">
      <DottedCountdown
        running={running}
        onDone={() => {
          setRunning(false);
          setDone(true);
        }}
      />
      <div className="sant-design-row">
        {running ? (
          <Button variant="secondary" size="sm" onClick={() => setRunning(false)}>
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setDone(false);
              setRunning(true);
            }}
          >
            Start the countdown
          </Button>
        )}
        <span className="sant-design-card-text" aria-live="polite">
          {done ? "Recording would start now." : ""}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- dials */

function DialDemo() {
  const [t, setT] = useState(35);
  const k = t / 100;
  return (
    <div className="sant-design-panel" data-mode="volt">
      <div className="sant-design-row">
        <label className="sant-design-slider">
          <span>Sample grasp</span>
          <input type="range" min={0} max={100} value={t} onChange={(e) => setT(Number(e.target.value))} />
        </label>
        <Badge>Sample values</Badge>
      </div>
      {/* Ranges: the Franka Panda's gripper stroke (0–80 mm), reach (0.855 m) and joint 1 limits (±166°). */}
      <div className="sant-design-dials">
        <Dial label="Gripper" value={Math.round(80 - 74 * k)} min={0} max={80} unit="mm" step={5} major={20} tone={k > 0.7 ? "issue" : "live"} />
        <Dial label="Reach" value={0.32 + 0.3 * k} min={0} max={0.855} unit="m" step={0.05} major={0.2} decimals={2} />
        <Dial label="Joint 1" value={Math.round(-40 + 70 * k)} min={-166} max={166} unit="°" step={10} major={90} sweep={300} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- loader */

function LoaderDemo() {
  const [progress, setProgress] = useState(1);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!starting) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        const next = Math.min(1, p + 0.04);
        if (next >= 1) setStarting(false);
        return next;
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [starting]);
  const isaacDone = !starting && progress >= 1;
  return (
    <div className="sant-design-panel" data-mode="volt">
      <div className="sant-design-row">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setProgress(0);
            setStarting(true);
          }}
        >
          Simulate a start
        </Button>
        <Badge>Sample progress</Badge>
      </div>
      <div className="sant-design-loaders">
        <GlyphLoader
          label={isaacDone ? "Isaac Sim is ready" : "Starting Isaac Sim"}
          progress={progress}
          done={isaacDone}
          detail={isaacDone ? "The sim worker answers on its port." : "Loading the scene"}
        />
        <GlyphLoader label={starting ? "Starting MediaPipe" : "MediaPipe is ready"} done={!starting} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ sections */

export function HudSections() {
  return (
    <>
      <Section
        title="Tracking HUD"
        lede="What Record sees, drawn the way a detector draws it: corner brackets, a label tab with the score, the box centre in frame coordinates."
        note="Fed by props, so MediaPipe or the sim decides what is tracked. Boxes glide for 80 ms between frames; with effects off they jump."
      >
        <TrackingDemo />
      </Section>

      <Section
        title="Status glyphs"
        lede="One rounded square per pipeline state, each with its own mark and name. A new state fills the square and draws its mark; a step still running has a dash circling its edge."
      >
        <div className="sant-design-pair">
          {(["volt", "paper"] as const).map((mode) => (
            <div key={mode} className="sant-design-panel" data-mode={mode}>
              <ul className="sant-design-glyphs">
                {STATES.map((s) => (
                  <li key={s}>
                    <StatusGlyph state={s} showLabel />
                  </li>
                ))}
              </ul>
              {mode === "volt" && <PipelineDemo />}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Count-up tiles"
        lede="The headline change as rolling digit tiles. The digits turn like an odometer, so every frame shows a value between the two measurements."
        note="The count runs once, when the tiles come into view, with the same ease-out as every counter. With effects off it shows 42.5% at once."
      >
        {/* src: docs/superpowers/notes/2026-10-15-t3-status.md (sprint 7 Tasks 3–4): 3/40 vs 17/40. */}
        <div className="sant-design-pair">
          {(["volt", "paper"] as const).map((mode) => (
            <div key={mode} className="sant-design-panel" data-mode={mode}>
              <CountUpTiles
                from={7.5}
                to={42.5}
                decimals={1}
                suffix="%"
                label="success on 40 new scenes"
                note="3 of 40 with the 10 demos alone, 17 of 40 with 100 verified copies added"
                source="T3 status note, 2026-10-17 13:15"
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Countdown"
        lede="Three seconds to get your hand in place before Record starts. The ring empties once a second around a dot-matrix digit."
        note="The timing is the point, so it still counts with effects off; only the ring and the dots stop moving. Screen readers hear each number."
      >
        <CountdownDemo />
      </Section>

      <Section
        title="Dials"
        lede="Gripper, reach and joint angle. The scale rolls under a fixed index mark, so the value always reads at the top, with the exact number in the middle."
        note="Amber means the gripper is closed. Drag the slider to see the scales roll."
      >
        <DialDemo />
      </Section>

      <Section
        title="Glyph loader"
        lede="For the slow starts, Isaac Sim and MediaPipe. The label resolves out of loader glyphs over a band that fills with the progress."
        note="With a known progress it is a progress bar; without, a status message. Effects off shows the plain label."
      >
        <LoaderDemo />
      </Section>

      <Section
        title="Pill nav"
        lede="The app pages' nav: a glass pill whose joins light up to the current page, because the pages are steps in order."
        note="On the app pages these are Record, Review and Dataset. Here they are this page and the app shell, so the links work."
      >
        <div className="sant-design-panel sant-design-pill-stage" data-mode="volt">
          <PillNav
            items={[
              { to: "/design", label: "Design system" },
              { to: "/design/app", label: "App shell" },
            ]}
            label="Design pages"
          />
        </div>
      </Section>
    </>
  );
}
