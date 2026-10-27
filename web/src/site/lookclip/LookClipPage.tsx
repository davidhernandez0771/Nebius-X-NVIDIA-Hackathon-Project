// /look: the LOOK clip alone. ?seed=<seed> picks the pair (the scene buttons keep it in the URL); ?embed=1 drops the
// holo frame, for an iframe or a screen capture of the clip (the video's opening shot).
import { useSearchParams } from "react-router-dom";
import { HoloPage } from "../holo/Holo";
import type { Fetch } from "./api";
import { LookClip } from "./LookClip";
import "./lookclip.css";

export default function LookClipPage({ fetchImpl }: { fetchImpl?: Fetch }) {
  const [params, setParams] = useSearchParams();
  const seed = Number(params.get("seed")) || null;
  const onSeed = (s: number) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("seed", String(s));
        return next;
      },
      { replace: true },
    );
  const clip = <LookClip fetchImpl={fetchImpl} seed={seed} onSeed={onSeed} interactive />;
  if (params.get("embed") === "1") return <main className="lc-page">{clip}</main>;
  return (
    // a replay viewer of finished runs, like the test track: its place in the nav
    <HoloPage title="Same scene, two robots" here="test-track">
      {clip}
    </HoloPage>
  );
}
