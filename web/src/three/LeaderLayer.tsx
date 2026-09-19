import { useEffect, useRef } from "react";
import { scroll } from "./scrollStore";
import { seg, reviewState, type ReviewState } from "./sceneMath";
import { LEADERS, anchors, onSceneFrame, type LeaderDef, type LeaderGroup } from "./labels";

const REVIEW_ORDER = ["r-mug", "r-charger", "r-book"];
const STATE_TEXT: Record<ReviewState, string> = {
  unknown: "UNKNOWN",
  organize: "ORGANIZE",
  trash: "TRASH",
};

// When each group of leaders is on screen, as a function of chapter float.
function groupVisibility(group: LeaderGroup, c: number, i: number): number {
  const stagger = i * 0.035;
  switch (group) {
    case "parts":
      return seg(c, 2.2 + stagger, 2.5 + stagger) * (1 - seg(c, 2.85, 3.1));
    case "review":
      return seg(c, 3.05 + stagger, 3.3 + stagger) * (1 - seg(c, 3.92, 4.1));
    case "shelf":
      return seg(c, 4.85 + stagger, 5.05 + stagger) * (1 - seg(c, 5.12, 5.3));
  }
}

function LeaderView({ l }: { l: LeaderDef }) {
  return (
    <div className="leader" data-id={l.id} style={{ opacity: 0 }}>
      <svg className="leader-svg" width="1" height="1" aria-hidden="true">
        <polyline className="leader-line" pathLength={1} points="0,0 0,0" />
        <circle className="leader-dot" r="3" />
      </svg>
      {l.kind === "card" ? (
        <div className="leader-label leader-card">
          <span className="leader-card-title">{l.text}</span>
          <span className="leader-card-sub">{l.sub}</span>
          <span className="leader-chip" data-chip data-state="unknown">UNKNOWN</span>
        </div>
      ) : (
        <div className="leader-label leader-mono">
          <span>{l.text}</span>
          {l.sub && <span className="leader-sub">{l.sub}</span>}
        </div>
      )}
    </div>
  );
}

export default function LeaderLayer() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current!;
    const cache = LEADERS.map((l) => ({
      l,
      el: host.querySelector<HTMLElement>(`[data-id="${l.id}"]`)!,
      label: host.querySelector<HTMLElement>(`[data-id="${l.id}"] .leader-label`)!,
      line: host.querySelector<SVGPolylineElement>(`[data-id="${l.id}"] .leader-line`)!,
      chip: host.querySelector<HTMLElement>(`[data-id="${l.id}"] [data-chip]`),
      scale: -1,
      state: "" as string,
      groupIndex: LEADERS.filter((o) => o.group === l.group).indexOf(l),
    }));

    const off = onSceneFrame(() => {
      const c = scroll.c;
      const m = window.innerWidth < 820 ? 0.6 : 1;
      for (const it of cache) {
        const a = anchors[it.l.id];
        const v = a && a.on ? groupVisibility(it.l.group, c, it.groupIndex) : 0;
        if (v < 0.002) {
          if (it.el.style.opacity !== "0") it.el.style.opacity = "0";
          continue;
        }
        const dx = it.l.dx * m;
        const dy = it.l.dy * m;
        if (it.scale !== m) {
          it.scale = m;
          const s = Math.sign(dx) || 1;
          it.line.setAttribute("points", `0,0 ${dx - s * 22},${dy} ${dx},${dy}`);
          it.label.style.left = `${dx}px`;
          it.label.style.top = `${dy}px`;
          it.label.style.transform = dx < 0 ? "translate(-100%, -50%)" : "translate(0, -50%)";
        }
        it.el.style.opacity = String(v);
        it.el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
        it.line.style.strokeDashoffset = String(1 - v);

        if (it.chip) {
          const ri = REVIEW_ORDER.indexOf(it.l.id);
          const st = reviewState(ri, c);
          if (st !== it.state) {
            it.state = st;
            it.chip.dataset.state = st;
            it.chip.textContent = STATE_TEXT[st];
          }
        }
      }
    });
    return () => {
      off();
    };
  }, []);

  return (
    <div className="leader-layer" ref={root} aria-hidden="true">
      {LEADERS.map((l) => (
        <LeaderView key={l.id} l={l} />
      ))}
    </div>
  );
}
