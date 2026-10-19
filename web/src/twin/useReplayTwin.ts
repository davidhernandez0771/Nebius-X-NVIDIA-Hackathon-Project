// Replay mode: plays a saved episode's joint_pos from the store, so a visitor without a sim sees real, verified
// copies move. Looped, in real time, at most REPLAY_HZ poses a second. It doesn't start by itself when motion is
// reduced (the OS setting or SANT's "Effects off"): the first step shows until play() is called.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, pmFetch } from "../pm/api";
import { useMotion } from "../sant/motion/MotionProvider";
import { parseEpisode, parseSummaries, ReplayClock, stateAt, type Episode, type EpisodeSummary } from "./replay";
import { EMPTY_TWIN, type TwinPose, type TwinState } from "./types";

export type ReplayTwin = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  episode: Episode | null;
  step: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  seek: (step: number) => void;
  twin: TwinState;
  base: TwinPose | null;
};

type Load = { id: string | null; status: ReplayTwin["status"]; episode: Episode | null; error: string | null };

export function useReplayTwin(demoId: string | null, { autoplay, fetchImpl = fetch }: { autoplay?: boolean; fetchImpl?: typeof fetch } = {}): ReplayTwin {
  const { reduced } = useMotion();
  const auto = autoplay ?? !reduced;
  const [load, setLoad] = useState<Load>({ id: null, status: "idle", episode: null, error: null });
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef<ReplayClock | null>(null);

  useEffect(() => {
    if (!demoId) {
      setLoad({ id: null, status: "idle", episode: null, error: null });
      return;
    }
    let live = true;
    setLoad({ id: demoId, status: "loading", episode: null, error: null });
    pmFetch<unknown>(`/twin/episodes/${encodeURIComponent(demoId)}`, undefined, fetchImpl).then(
      (body) => {
        if (!live) return;
        try {
          const episode = parseEpisode(body);
          clock.current = new ReplayClock(episode.nSteps, episode.fps);
          setStep(0);
          setLoad({ id: demoId, status: "ready", episode, error: null });
          setPlaying(auto);
        } catch (e) {
          setLoad({ id: demoId, status: "error", episode: null, error: (e as Error).message });
        }
      },
      (e) => live && setLoad({ id: demoId, status: "error", episode: null, error: describeError(e) }),
    );
    return () => {
      live = false;
    };
    // auto is read once per episode: turning effects off later pauses through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoId, fetchImpl]);

  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  useEffect(() => {
    if (!playing || load.status !== "ready") return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const next = clock.current?.advance(dt);
      if (next != null) setStep(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, load.status]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((k: number) => {
    if (clock.current) setStep(clock.current.seek(k));
  }, []);

  const twin = useMemo(() => (load.episode ? stateAt(load.episode, step) : EMPTY_TWIN), [load.episode, step]);
  return { status: load.status, error: load.error, episode: load.episode, step, playing, play, pause, seek, twin, base: load.episode?.base ?? null };
}

/** The verified copies the store has for a robot, newest first: what a replay can show. */
export function useVerifiedCopies(robot = "franka", { limit = 20, fetchImpl = fetch }: { limit?: number; fetchImpl?: typeof fetch } = {}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; copies: EpisodeSummary[]; error: string | null }>({
    status: "loading",
    copies: [],
    error: null,
  });
  useEffect(() => {
    let live = true;
    setState({ status: "loading", copies: [], error: null });
    pmFetch<unknown>(`/twin/episodes?verified=true&robot=${encodeURIComponent(robot)}&limit=${limit}`, undefined, fetchImpl).then(
      (body) => {
        if (!live) return;
        try {
          setState({ status: "ready", copies: parseSummaries(body), error: null });
        } catch (e) {
          setState({ status: "error", copies: [], error: (e as Error).message });
        }
      },
      (e) => live && setState({ status: "error", copies: [], error: describeError(e) }),
    );
    return () => {
      live = false;
    };
  }, [robot, limit, fetchImpl]);
  return state;
}
