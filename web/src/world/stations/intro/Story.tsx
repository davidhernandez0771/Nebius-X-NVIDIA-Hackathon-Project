// The intro's words, over the places the camera descends through, like Active Theory's "CREATIVE
// DIGITAL EXPERIENCES": huge mono type on one side, a small mono column on the other, straight on the
// dark with nothing behind them. One beat per place (storyPlan.ts): the hero by the logo, the problem on
// the forest floor, then S·A·N·T, the proof and Nemotron as the reactor powers up; none on the way down.
// Its lines slide up out of a mask and scramble into place as it scrolls in, the column follows line by
// line, and it fades before the next drop. A small mono readout counts the reactor's power. Everything
// moves through useStationFrame (no React state per frame). Honest numbers only, and none typed here: they come
// from the Results page's data (./proof.ts): raw vs SANT-multiplied (3/40 vs 17/40, p = 0.0005 today), the user's
// webcam demos (0/10 passed physics → 3 repaired → 24 verified variants; 9 pressed into the bin at up to 927 N),
// Nemotron's labels (40/40).
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LEAD } from "../../../site/results/proofData";
import sceneData from "../../../site/results/scenes.json";
import { useStationFrame, useWorld } from "../../core/WorldContext";
import { scramble } from "../../ui/scramble";
import { PROOF } from "./proof";
import { ProofBeats } from "./ProofBeats";
import { beatState, INTRO_VH, placeLights, power, ringLift, span } from "./storyPlan";

interface BeatCopy {
  kicker: string;
  /** The big lines, each its own mask. */
  head: string[];
  /** Which side the big type sits on; the column takes the other. */
  side: "left" | "right";
  items: ReactNode[];
  className?: string;
}

const COPY: BeatCopy[] = [
  {
    kicker: "S·A·N·T · perfect, then multiply",
    head: ["Show a robot", "once."],
    side: "left",
    // The tesseract is the hero: the copy stacks on the left (on phones, under it), the right half is its.
    className: "intro-beat--hero",
    items: [
      <p key="a">One human demo, by webcam or keyboard teleop, becomes robot training data.</p>,
      <p key="b">Physics-checked. Repaired. Multiplied. Labelled by Nemotron.</p>,
      // Straight to the proof, for whoever wants it now (site-nav, 2026-10-26): quiet, under the copy. The number is
      // the Results page's lead (proofData.ts LEAD), not typed here.
      <p key="c" className="intro-proof">
        <Link className="intro-proof__link world-u" to="/site/results#proof">
          See the result
          <span className="intro-proof__what">
            {" "}
            · {LEAD.result.k}/{LEAD.result.n} on unseen scenes, pre-registered
          </span>
          <span aria-hidden="true"> →</span>
          {/* The test itself, one cell per scene, lit if the cube ended in the bin (Results' SceneGrid data). */}
          <span className="intro-proof__strip" aria-hidden="true">
            {sceneData.scenes.map((sc, i) => (
              <i key={sc.seed} data-ok={sc.success || undefined} style={{ "--i": i } as CSSProperties} />
            ))}
          </span>
        </Link>
      </p>,
    ],
  },
  {
    kicker: "01 / The problem",
    head: ["Robots", "need demos."],
    side: "right",
    items: [
      <p key="a">A robot learns a task from demonstrations, and it takes hundreds of them.</p>,
      <p key="b">Teleoperation is expensive: the rig, and an operator's time for every demo.</p>,
      <p key="c">
        Human demos are sloppy: placing the cube, {PROOF.pressed.split("/")[0]} of our {PROOF.webcam.demos} webcam demos pressed the gripper
        into the bin, up to <b>{PROOF.peak}</b> against a 5 N limit.
      </p>,
    ],
  },
  {
    kicker: "02 / S·A·N·T",
    head: ["Simulate", "Augment", "Neaten", "Train"],
    side: "left",
    className: "intro-beat--sant",
    items: [
      <p key="s">
        <b>S</b> Replay the demo in Isaac Lab, with physics on.
      </p>,
      <p key="a">
        <b>A</b> Multiply it into variants: new positions, new seeds.
      </p>,
      <p key="n">
        <b>N</b> Neaten what physics rejects: find the slip, repair it, keep only what passes.
      </p>,
      <p key="t">
        <b>T</b> Train a robot on the result. If it learns, the data works.
      </p>,
    ],
  },
  {
    // The first result, from scripted demos (the Results page's "earlier result"); the proof beats after the reactor
    // (ProofBeats.tsx) carry the pre-registered climb from human mouse demos.
    kicker: "03 / First result · scripted demos",
    head: [PROOF.raw, `→ ${PROOF.multiplied}`],
    side: "right",
    className: "intro-beat--proof",
    items: [
      <p key="a">
        The same ACT policy on 40 unseen seeds: trained on raw demos, <b>{PROOF.raw}</b>. Trained on SANT-multiplied demos,{" "}
        <b>{PROOF.multiplied}</b> (p = {PROOF.p}).
      </p>,
      <p key="b">
        {PROOF.webcam.demos} webcam demos: <b>{PROOF.webcam.passed}</b> passed physics → <b>{PROOF.webcam.repaired}</b> repaired →{" "}
        <b>{PROOF.webcam.copies}</b> verified variants.
      </p>,
      <p key="c">
        Nemotron labels: <b>{PROOF.labels}</b>.
      </p>,
    ],
  },
  {
    kicker: "04 / Nemotron",
    head: ["Nemotron", "proposes.", "Physics", "verifies."],
    side: "left",
    items: [
      <p key="a">
        <b>Creates</b> the task.
      </p>,
      <p key="b">
        <b>Understands</b> the demo.
      </p>,
      <p key="c">
        <b>Repairs</b> it where physics says no.
      </p>,
      <p key="d">
        <b>Labels</b> every verified variant.
      </p>,
      <p key="e" className="intro-beat__foot">
        Strict physics check, forgiving repair.
      </p>,
    ],
  },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (u: number) => 1 - (1 - u) ** 3;

export function Story() {
  const { store, reduced } = useWorld();
  const beats = useRef<(HTMLElement | null)[]>([]);
  const live = useRef<boolean[]>([]);
  const hint = useRef<HTMLParagraphElement>(null);
  const down = useRef<HTMLParagraphElement>(null);
  const meter = useRef<HTMLParagraphElement>(null);

  useStationFrame("intro", (f) => {
    const ready = store.getCoarse().ready;
    const vh = f.t * INTRO_VH;
    COPY.forEach((_, i) => {
      const el = beats.current[i];
      if (!el) return;
      const s = beatState(vh, i);
      const shown = ready ? s.shown : 0;
      el.style.opacity = String(shown);
      el.style.visibility = shown > 0.001 ? "visible" : "hidden";
      el.style.transform = reduced ? "" : `translate3d(0, ${(1 - shown) * -2.5}vh, 0)`;
      // The lines rise out of their masks one after another; the column follows.
      el.querySelectorAll<HTMLElement>(".intro-line__in").forEach((line, j) => {
        const k = reduced ? 1 : easeOut(clamp01(s.reveal * 1.5 - j * 0.16));
        line.style.transform = `translate3d(0, ${(1 - k) * 108}%, 0)`;
      });
      el.querySelectorAll<HTMLElement>(".intro-item").forEach((item, j) => {
        const k = reduced ? 1 : easeOut(clamp01(s.reveal * 1.6 - 0.3 - j * 0.14));
        item.style.opacity = String(k);
        item.style.transform = `translate3d(0, ${(1 - k) * 14}px, 0)`;
      });
      // Scramble the big lines in, once per entry.
      const on = shown > 0.02;
      if (on !== !!live.current[i]) {
        live.current[i] = on;
        el.querySelectorAll<HTMLElement>("[data-scramble]").forEach((t) => {
          const final = (t.dataset.final ??= t.textContent ?? "");
          if (on) scramble(t, final, { reduced, duration: 700 });
          else t.textContent = final;
        });
      }
    });
    // "Scroll down" leaves in the first half viewport; "into the workshop" shows as the top ring lifts into THE RING.
    if (hint.current) hint.current.style.opacity = String(ready ? 1 - clamp01(vh * 2) : 0);
    if (down.current) down.current.style.opacity = String(f.current ? clamp01(ringLift(vh) * 3) : 0);
    // The reactor's power, while it is lit (not with reduced motion: the camera holds the hero), and not under the proof
    // beats' panels: it is full by then, and it fades back for the ring.
    if (meter.current) {
      const [pa, pb] = span("proof");
      const underProof = clamp01((vh - pa) / 0.15) * (1 - clamp01((vh - pb + 0.15) / 0.15));
      const lit = reduced ? 0 : placeLights(vh).reactor * (1 - underProof);
      meter.current.style.opacity = String(f.current ? lit : 0);
      if (lit > 0) meter.current.textContent = `// core power · ${String(Math.round(power(vh) * 100)).padStart(2, "0")}%`;
    }
  });

  return (
    <div className="intro-story">
      {COPY.map((b, i) => (
        <section
          key={i}
          ref={(el) => (beats.current[i] = el)}
          className={`intro-beat ${b.className ?? ""}`}
          data-side={b.side}
          style={{ opacity: 0, visibility: "hidden" }}
        >
          <div className="intro-beat__main">
            <p className="intro-beat__kicker world-u">{b.kicker}</p>
            {/* Read as words: the scramble only changes what is drawn. */}
            <h2 className="intro-beat__head" aria-label={b.head.join(" ")}>
              {b.head.map((line, j) => (
                <span key={j} className="intro-line" aria-hidden="true">
                  <span className="intro-line__in" data-scramble>
                    {line}
                  </span>
                </span>
              ))}
            </h2>
          </div>
          <div className="intro-beat__col">
            {b.items.map((item, j) => (
              <div key={j} className="intro-item">
                {item}
              </div>
            ))}
          </div>
        </section>
      ))}
      <ProofBeats />
      <p ref={hint} className="world-hint world-u">
        Scroll down
      </p>
      <p ref={meter} className="intro-power world-u" aria-hidden="true" />
      <p ref={down} className="intro-down world-u" aria-hidden="true">
        Into the workshop ↓
      </p>
    </div>
  );
}
