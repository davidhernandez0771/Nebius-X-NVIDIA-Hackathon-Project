import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Lenis from "lenis";
import { animate, stagger } from "animejs";
import "../three/landing.css";
import { ensureFonts } from "../three/fonts";
import { prefersReducedMotion, shouldRun3D } from "../three/capability";
import { CHAPTER_COUNT, CHAPTER_NAMES, scroll, setProgress } from "../three/scrollStore";
import { seg } from "../three/sceneMath";
import { Headline, Reveal } from "../three/Reveal";
import LeaderLayer from "../three/LeaderLayer";
import StaticRoom from "../three/StaticRoom";

// The whole 3D bundle (three, fiber, drei-free scene) loads only when needed.
const RoomScene = lazy(() => import("../three/RoomScene"));

// Warm-dark tone per chapter: [bg rgb], [bloom A rgba], [bloom B rgba].
type Tone = { bg: number[]; a: number[]; b: number[] };
const TONES: Tone[] = [
  { bg: [11, 8, 7], a: [255, 120, 50, 0.2], b: [80, 30, 10, 0.35] }, // intro: ember
  { bg: [6, 13, 13], a: [53, 240, 208, 0.16], b: [20, 80, 70, 0.26] }, // scan: cold teal-black
  { bg: [26, 19, 15], a: [255, 154, 46, 0.2], b: [120, 50, 20, 0.3] }, // photograph: warm charcoal
  { bg: [12, 8, 8], a: [255, 90, 95, 0.1], b: [255, 154, 46, 0.14] }, // review
  { bg: [34, 25, 19], a: [255, 190, 120, 0.16], b: [53, 240, 208, 0.1] }, // organize: lightest
  { bg: [8, 10, 11], a: [53, 240, 208, 0.12], b: [255, 154, 46, 0.1] }, // ask
  { bg: [11, 8, 7], a: [255, 120, 50, 0.24], b: [53, 240, 208, 0.14] }, // enter
];
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (v: number[]) => `rgb(${v[0] | 0}, ${v[1] | 0}, ${v[2] | 0})`;
const rgba = (v: number[]) => `rgba(${v[0] | 0}, ${v[1] | 0}, ${v[2] | 0}, ${v[3].toFixed(3)})`;

interface ChapterCopy {
  eyebrow: string;
  title: string;
  body: string;
  side: "left" | "right" | "bottom";
}

const COPY: ChapterCopy[] = [
  { eyebrow: "Scan", title: "Light becomes geometry.", body: "Walk the room once with a LiDAR scan. Every surface becomes a point in space, then a solid you can turn in your hands.", side: "right" },
  { eyebrow: "Photograph", title: "Every item, found and pinned.", body: "Photograph a shelf, a drawer, a desk. SANT finds each object and pins it to the place where it lives.", side: "left" },
  { eyebrow: "Review", title: "You decide.", body: "The AI only proposes. Every item waits for you: organize it, mark it unknown, or send it to trash.", side: "right" },
  { eyebrow: "Organize", title: "Everything in its place.", body: "Approved items glide to a home of their own, on a shelf you can see. Nothing moves until you say so.", side: "left" },
  { eyebrow: "Ask", title: "Just say it.", body: "Talk to your room in plain words. It answers with actions you can undo.", side: "bottom" },
];

const CHAT_TEXT = "send the lamp to trash";

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const FLOATERS = [
  { left: "58%", top: "16%", size: 92, depth: 0.5 },
  { left: "82%", top: "30%", size: 54, depth: 1.1 },
  { left: "70%", top: "64%", size: 120, depth: 0.3 },
  { left: "44%", top: "74%", size: 44, depth: 1.4 },
  { left: "90%", top: "78%", size: 70, depth: 0.8 },
];

function Chapter({ i, children, copyRef }: { i: number; children: (s: React.RefObject<HTMLElement>) => ReactNode; copyRef: (el: HTMLElement | null) => void }) {
  const section = useRef<HTMLElement>(null);
  return (
    <section className="chapter" data-i={i} ref={section} id={`ch-${i}`} aria-label={CHAPTER_NAMES[i]}>
      <div className="chapter-pin" ref={copyRef as never}>
        {children(section)}
      </div>
    </section>
  );
}

export default function Landing() {
  const rm = useMemo(() => prefersReducedMotion(), []);
  const run3d = useMemo(() => shouldRun3D(), []);
  const root = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const copies = useRef<(HTMLElement | null)[]>([]);
  const chatTyped = useRef<HTMLSpanElement>(null);
  const chatChip = useRef<HTMLSpanElement>(null);
  const floaters = useRef<(HTMLDivElement | null)[]>([]);
  const [ticks, setTicks] = useState<number[]>(scroll.starts);

  useEffect(() => {
    ensureFonts();
    const prevTitle = document.title;
    document.title = "SANT";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  useEffect(() => {
    const el = root.current!;
    const sections = Array.from(el.querySelectorAll<HTMLElement>(".chapter"));
    let lastP = -1;
    let lastNum = -1;
    let lastTyped = -1;
    let lastChip = "";

    const measure = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scroll.starts = sections.map((s) => Math.min(1, s.offsetTop / max));
      setTicks(scroll.starts);
    };

    const update = (p: number) => {
      if (Math.abs(p - lastP) < 1e-5) return;
      lastP = p;
      setProgress(p);
      const c = scroll.c;

      // tone shift between chapters, easing in as the next one approaches
      const i = Math.min(Math.floor(c), CHAPTER_COUNT - 2);
      const t = seg(c - i, 0.5, 1);
      const a = TONES[i];
      const b = TONES[i + 1];
      el.style.setProperty("--tone", rgb(mix(a.bg, b.bg, t)));
      el.style.setProperty("--bloom-a", rgba(mix(a.a, b.a, t)));
      el.style.setProperty("--bloom-b", rgba(mix(a.b, b.b, t)));

      // scrub bar
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      const n = Math.min(CHAPTER_COUNT - 1, Math.floor(c + 0.35));
      if (n !== lastNum) {
        lastNum = n;
        if (numRef.current) numRef.current.innerHTML = `<b>${String(n + 1).padStart(2, "0")}</b> / ${String(CHAPTER_COUNT).padStart(2, "0")}`;
        if (nameRef.current) nameRef.current.textContent = CHAPTER_NAMES[n];
      }

      // copy fades in as its chapter arrives and out as it leaves
      if (!rm) {
        copies.current.forEach((node, idx) => {
          if (!node) return;
          const inn = seg(c, idx - 0.35, idx + 0.02);
          const out = idx === CHAPTER_COUNT - 1 ? 0 : seg(c, idx + 0.72, idx + 0.96);
          const v = inn * (1 - out);
          const inner = node.querySelector<HTMLElement>(".chapter-copy");
          if (!inner) return;
          inner.style.opacity = v.toFixed(3);
          inner.style.transform = `translate3d(0, ${((1 - inn) * 28 - out * 20).toFixed(1)}px, 0)`;
          inner.style.pointerEvents = v < 0.3 ? "none" : "auto";
        });
      }

      // hero floaters: parallax at different depths
      floaters.current.forEach((f, idx) => {
        if (!f) return;
        const d = FLOATERS[idx].depth;
        f.style.setProperty("--fy", `${(-p * 2400 * d * 0.25).toFixed(1)}px`);
        f.style.opacity = String(1 - seg(c, 0.2, 0.8));
      });

      // chat: typed by scroll, then confirmed, then the lamp goes
      const typed = Math.round(seg(c, 5.1, 5.55) * CHAT_TEXT.length);
      if (typed !== lastTyped && chatTyped.current) {
        lastTyped = typed;
        chatTyped.current.textContent = rm ? CHAT_TEXT : CHAT_TEXT.slice(0, typed);
      }
      const chip = rm ? "done" : c > 5.72 ? "done" : typed === CHAT_TEXT.length ? "sent" : "idle";
      if (chip !== lastChip && chatChip.current) {
        lastChip = chip;
        chatChip.current.dataset.state = chip;
        chatChip.current.textContent =
          chip === "done" ? "Moved to trash · Undo" : chip === "sent" ? "Sending…" : "Press enter";
      }
    };

    measure();
    const ro = new ResizeObserver(() => {
      measure();
      lastP = -1;
      update(currentP());
    });
    ro.observe(document.body);

    const currentP = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return Math.min(1, Math.max(0, window.scrollY / max));
    };

    let lenis: Lenis | undefined;
    let raf = 0;
    let onScrollEvt: (() => void) | undefined;
    if (rm) {
      onScrollEvt = () => update(currentP());
      window.addEventListener("scroll", onScrollEvt, { passive: true });
      update(currentP());
    } else {
      lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
      const loop = (t: number) => {
        lenis!.raf(t);
        update(lenis!.limit > 0 ? Math.min(1, Math.max(0, lenis!.scroll / lenis!.limit)) : 0);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;

    // hero intro + floater drift, with anime.js
    const anims: ReturnType<typeof animate>[] = [];
    if (!rm) {
      anims.push(
        animate(".glass-nav", { opacity: [0, 1], translateY: [-14, 0], duration: 900, ease: "outExpo", delay: 200 }),
        animate(".hero-mark span", { translateY: ["110%", "0%"], duration: 1400, ease: "outExpo", delay: stagger(90, { start: 250 }) }),
        animate(".hero-sub, .hero-actions, .hero-eyebrow", { opacity: [0, 1], translateY: [16, 0], duration: 1000, ease: "outQuad", delay: stagger(120, { start: 900 }) }),
      );
      floaters.current.forEach((f, i) => {
        const inner = f?.firstElementChild;
        if (!inner) return;
        anims.push(
          animate(inner, {
            translateY: [0, i % 2 ? 22 : -22],
            rotate: [0, i % 2 ? 14 : -14],
            duration: 4200 + i * 700,
            ease: "inOutSine",
            alternate: true,
            loop: true,
          }),
        );
      });
    }

    return () => {
      cancelAnimationFrame(raf);
      lenis?.destroy();
      if (onScrollEvt) window.removeEventListener("scroll", onScrollEvt);
      ro.disconnect();
      anims.forEach((a) => a.revert());
      delete (window as unknown as { __lenis?: Lenis }).__lenis;
    };
  }, [rm]);

  const goTo = (i: number) => {
    const target = document.getElementById(`ch-${i}`);
    if (!target) return;
    const lenis = (window as unknown as { __lenis?: Lenis }).__lenis;
    if (lenis) lenis.scrollTo(target, { duration: 1.6 });
    else target.scrollIntoView({ behavior: "auto" });
  };

  const setCopy = (i: number) => (el: HTMLElement | null) => {
    copies.current[i] = el;
  };

  return (
    <div ref={root} className={`landing ${rm ? "" : "is-motion"} ${run3d ? "" : "no-3d"}`}>
      <div className="stage" aria-hidden="true">
        {run3d ? (
          <SceneBoundary fallback={<StaticRoom />}>
            <Suspense fallback={null}>
              <RoomScene mode="landing" />
            </Suspense>
          </SceneBoundary>
        ) : (
          <StaticRoom />
        )}
      </div>
      {run3d && <LeaderLayer />}

      <header className="glass-nav" style={rm ? undefined : { opacity: 0 }}>
        <Link className="wordmark" to="/welcome" aria-label="SANT">SANT</Link>
        <span className="nav-divider" />
        <Link className="nav-cta" to="/enter">Enter app</Link>
      </header>

      <div className="scrub" role="navigation" aria-label="Story progress">
        <span className="scrub-num" ref={numRef}><b>01</b> / {String(CHAPTER_COUNT).padStart(2, "0")}</span>
        <div className="scrub-track">
          <div className="scrub-fill" ref={fill} />
          {ticks.map((p, i) => (
            <button
              key={i}
              className="scrub-tick"
              style={{ left: `${p * 100}%` }}
              onClick={() => goTo(i)}
              aria-label={`Go to ${CHAPTER_NAMES[i]}`}
            />
          ))}
        </div>
        <span className="scrub-name" ref={nameRef}>{CHAPTER_NAMES[0]}</span>
      </div>

      <main className="scroll-root">
        {/* 0 · hero */}
        <Chapter i={0} copyRef={setCopy(0)}>
          {() => (
            <>
              <div className="floaters" aria-hidden="true">
                {FLOATERS.map((f, i) => (
                  <div
                    key={i}
                    className="floater"
                    ref={(el) => (floaters.current[i] = el)}
                    style={{ left: f.left, top: f.top, width: f.size, height: f.size }}
                  >
                    <i />
                  </div>
                ))}
              </div>
              <div className="chapter-copy">
                <p className="eyebrow hero-eyebrow"><b>SANT</b>LiDAR · vision · your room</p>
                <h1 className="hero-mark" aria-label="SANT">
                  {"SANT".split("").map((ch, i) => (
                    <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}>
                      <span style={{ display: "inline-block" }}>{ch}</span>
                    </span>
                  ))}
                </h1>
                <p className="hero-sub">Know what is in every room.</p>
                <div className="hero-actions">
                  <Link className="btn" to="/enter">Enter SANT <span aria-hidden="true">&gt;&gt;&gt;</span></Link>
                  <span className="scroll-hint">Scroll</span>
                </div>
              </div>
            </>
          )}
        </Chapter>

        {/* 1–5 · story chapters */}
        {COPY.map((c, k) => (
          <Chapter key={c.eyebrow} i={k + 1} copyRef={setCopy(k + 1)}>
            {(section) => (
              <div className={`chapter-copy ${c.side}`}>
                <p className="eyebrow"><b>{String(k + 1).padStart(2, "0")}</b>{c.eyebrow}</p>
                <Headline text={c.title} />
                <Reveal text={c.body} section={section} />
                {c.side === "bottom" && (
                  <div className="chat-bar" aria-label="Example command">
                    <span className="chat-prompt" aria-hidden="true">&gt;</span>
                    <span className="chat-typed" ref={chatTyped}>{rm ? CHAT_TEXT : ""}</span>
                    <span className="chat-chip" ref={chatChip} data-state={rm ? "done" : "idle"}>
                      {rm ? "Moved to trash · Undo" : "Press enter"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </Chapter>
        ))}

        {/* 6 · closing */}
        <Chapter i={6} copyRef={setCopy(6)}>
          {(section) => (
            <div className="chapter-copy center">
              <p className="eyebrow"><b>SANT</b>Ready when your room is</p>
              <Headline text="A room that knows what is in it." />
              <Reveal text="Scan once, review in minutes, and never lose a thing again." section={section} />
              <div className="hero-actions" style={{ marginTop: "2rem", justifyContent: "center" }}>
                <Link className="btn" to="/enter">Enter SANT <span aria-hidden="true">&gt;&gt;&gt;</span></Link>
                <Link className="btn ghost" to="/">Skip to app</Link>
              </div>
            </div>
          )}
        </Chapter>
      </main>
    </div>
  );
}
