// /film: SANT's demo film, drawn live in the page from the project's own data (web/public/film, the test track's
// replays) and the voice track (video/tts.py, video/build_timeline.py). The whole picture is a function of one clock,
// so video/render.mjs can step it frame by frame (?render=1 exposes window.__film.seek) and encode it with the voice.
// Without ?render it plays in real time with the voice, for checking: Space plays, the arrows step, ?t= starts there.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { LOGO_SYMBOL } from "../../sant/components/logoSymbol";
import { filmAsset, loadFilm, type FilmData } from "./data";
import { captionAt, enter, scenesAt } from "./model";
import { CloseScene, TestScene, TeacherScene } from "./scenes3";
import { NemotronScene, PipelineScene } from "./scenes2";
import { OpenScene, ProblemScene, StackScene } from "./scenes1";
import type { SceneProps } from "./ui";
import "./film.css";

const SCENES: Record<string, { C: ComponentType<SceneProps>; title: string }> = {
  open: { C: OpenScene, title: "" },
  problem: { C: ProblemScene, title: "The problem" },
  stack: { C: StackScene, title: "Where SANT fits" },
  pipeline: { C: PipelineScene, title: "How it works" },
  nemotron: { C: NemotronScene, title: "Nemotron on Nebius" },
  teacher: { C: TeacherScene, title: "Why it works" },
  test: { C: TestScene, title: "The test" },
  close: { C: CloseScene, title: "" },
};

declare global {
  interface Window {
    __film?: { ready: boolean; duration: number; fps: number; seek: (t: number) => Promise<void> };
  }
}

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Every twin on the page has its robot loaded and a canvas drawn. */
async function settled() {
  for (let i = 0; i < 600; i++) {
    const busy = document.querySelectorAll(".twin3d[aria-busy='true'], .twin3d__wait").length;
    const twins = document.querySelectorAll(".fm-film .twin3d").length;
    const canvases = document.querySelectorAll(".fm-film .twin3d canvas").length;
    if (!busy && canvases >= twins) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function preload(src: string) {
  return new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => res();
    im.onerror = () => res();
    im.src = src;
  });
}

export default function FilmPage() {
  const [params] = useSearchParams();
  const render = params.get("render") === "1";
  const [data, setData] = useState<FilmData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(Number(params.get("t") ?? 0));
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    Promise.all([loadFilm(), preload(filmAsset("demos.jpg")), preload(filmAsset("variants.jpg")), document.fonts.ready])
      .then(([d]) => setData(d))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const fit = () => setScale(render ? 1 : Math.min(window.innerWidth / 1920, (window.innerHeight - 56) / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [render]);

  // the renderer's handle: seek, wait for the twins, two frames, done
  const seen = useRef(new WeakSet<Element>());
  useEffect(() => {
    if (!data) return;
    window.__film = {
      ready: true,
      duration: data.timeline.duration,
      fps: data.timeline.fps,
      seek: async (to: number) => {
        flushSync(() => setT(to));
        await raf();
        await settled();
        // a twin that just appeared needs a few frames to size its canvas and draw
        let fresh = false;
        for (const c of document.querySelectorAll(".fm-film .twin3d canvas"))
          if (!seen.current.has(c)) {
            seen.current.add(c);
            fresh = true;
          }
        if (fresh) await new Promise((r) => setTimeout(r, 250));
        for (let i = 0; i < (fresh ? 12 : 2); i++) await raf();
      },
    };
    return () => {
      delete window.__film;
    };
  }, [data]);

  // real-time playback follows the voice track
  useEffect(() => {
    if (!playing || !audio.current) return;
    let id = 0;
    const tick = () => {
      setT(audio.current!.currentTime);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      a.currentTime = t;
      void a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  }, [t]);

  useEffect(() => {
    if (render) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "ArrowRight") setT((v) => v + (e.shiftKey ? 5 : 1 / 30));
      if (e.key === "ArrowLeft") setT((v) => Math.max(0, v - (e.shiftKey ? 5 : 1 / 30)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [render, toggle]);

  const shown = useMemo(() => (data ? scenesAt(data.timeline, t) : []), [data, t]);
  const caption = data ? captionAt(data.timeline, t) : null;
  if (error) return <p className="fm-error">The film's data didn't load: {error}</p>;
  if (!data) return <div className="fm-film fm-film--loading" />;
  const tl = data.timeline;
  const current = shown[shown.length - 1]?.span;
  const idx = current ? tl.scenes.indexOf(current) : 0;
  const chapter = current ? SCENES[current.id].title : "";
  const chromeOn = chapter ? enter(t, current!.start, 0.6) : 0;

  return (
    <div className={render ? "fm-root fm-root--render" : "fm-root"}>
      <div className="fm-film" style={{ transform: `scale(${scale})` }}>
        <div className="fm-bg" />
        {shown.map(({ span, alpha }) => {
          const { C } = SCENES[span.id];
          return (
            <div key={span.id} className="fm-layer" style={{ opacity: alpha }}>
              <C t={t} span={span} data={data} />
            </div>
          );
        })}
        <header className="fm-chrome" style={{ opacity: chromeOn }}>
          <span className="fm-chrome__brand">
            <svg viewBox={LOGO_SYMBOL.viewBox} aria-hidden="true">
              {LOGO_SYMBOL.units.map((d, i) => (
                <path key={i} d={d} data-accent={LOGO_SYMBOL.accent.includes(i) || undefined} style={{ strokeWidth: LOGO_SYMBOL.stroke }} />
              ))}
            </svg>
            SANT
          </span>
          <span className="fm-chrome__chapter">
            <span>{String(idx).padStart(2, "0")}</span> {chapter}
          </span>
        </header>
        {caption && (
          <p className="fm-sub" key={caption}>
            <span>{caption}</span>
          </p>
        )}
      </div>
      {!render && (
        <div className="fm-controls">
          <button type="button" onClick={toggle}>
            {playing ? "Pause" : "Play"}
          </button>
          <input type="range" min={0} max={tl.duration} step={1 / 30} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Time" />
          <span>
            {t.toFixed(2)} / {tl.duration.toFixed(2)} s · {current?.id}
          </span>
          <audio ref={audio} src={filmAsset("voice.mp3")} preload="auto" onEnded={() => setPlaying(false)} />
        </div>
      )}
    </div>
  );
}
