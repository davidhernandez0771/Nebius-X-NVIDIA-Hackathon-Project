// The room view's five things to click, in 3D: a tag floating over each (the shelf, the machine, the
// bench, the robot wall, the proof wall) and an invisible box round the machine and the bench that takes the click (the
// machine's is also where a dragged cartridge drops, drag.ts DROP_ZONE). The spiral and the wall take
// their own clicks (Helix, RobotWall). Tags show only in the room view; the first visit numbers them as a
// mini tutorial ("start here" on the shelf), and later visits show them plain. They are portalled into the
// workshop's overlay (hubTagLayer), so Tab reaches them in order.
// On high and ultra (holoTags.ts holoMode) the tags are small holographic labels beside the objects
// (HubHolograms): the HTML buttons stay, see-through, laid over each label from its bottom-left
// corner, so the clicks, the focus, the names and the Tab order are the same; their hover and focus
// light a label and unfold it. Elsewhere (low,
// reduced motion, a phone) they are the HTML cards.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { inHub } from "../../core/CameraRig";
import { useWorld } from "../../core/WorldContext";
import { BENCH_PIVOT, MACHINE_PIVOT } from "../../scene/layout";
import { PROOF_WALL } from "../../scene/proofWallPlan";
import { DROP_ZONE, hiddenInstance, subscribeDrag, wasDrag } from "./drag";
import { HUB_TAGS, openHubItem, type HubItem } from "./hubItems";
import { hubTagLayer } from "./hubTagLayer";
import { HubHolograms, type HoloText } from "./HubHolograms";
import { holoMode, holoTag, setHot } from "./holoTags";

const SEEN_KEY = "world.hub.seen";

function seenBefore(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the tutorial shows again next time */
  }
}

type TagId = HubItem;

const TAGS = HUB_TAGS;

const up = (p: readonly number[], y: number) => new THREE.Vector3(p[0], p[1] + y, p[2]);

function useWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function HubTags() {
  const { store, goTo, quality, reduced, mode } = useWorld();
  const wrap = useRef<HTMLDivElement[]>([]);
  const [tutorial] = useState(() => !seenBefore());
  const holo = holoMode({ mode, tier: quality.name, reduced, width: useWidth() });
  const texts = useMemo<HoloText[]>(() => TAGS.map((t) => ({ id: t.id, n: t.n, title: t.title, line: t.line, start: tutorial && t.id === "shelf" })), [tutorial]);
  // Back to the cards: they size themselves again.
  useEffect(() => {
    if (holo) return;
    wrap.current.forEach((el) => el && ((el.style.width = ""), (el.style.height = "")));
  }, [holo]);
  const at = useMemo(
    () => ({
      // Under the hub bar at the top of the view (1280×720), not behind it.
      shelf: new THREE.Vector3(0, 11.5, 0),
      machine: up(MACHINE_PIVOT.position, 6.2),
      bench: up(BENCH_PIVOT.position, 5.4),
      // The left wall runs along the screen's edge from the room view: the tag floats in front of it,
      // toward the back, clear of the bench's tag and left of the proof wall's.
      wall: new THREE.Vector3(-19.5, 9.5, -13),
      // Over the proof wall's screen, on the back wall: its stem points down at the board.
      proof: new THREE.Vector3(PROOF_WALL.center[0], 12.0, PROOF_WALL.center[2] + 0.2),
    }),
    [],
  );

  // Show the tags only in the room view (written on the DOM, never through React per frame).
  useEffect(() => {
    let shown = false;
    return store.onFrame(() => {
      const on = inHub(store);
      // Each element, every frame (a string compare): drei makes them anew when the cards and the
      // holograms swap, and a new one starts hidden.
      const v = String(on);
      wrap.current.forEach((el) => el && el.dataset.on !== v && (el.dataset.on = v));
      if (on === shown) return;
      shown = on;
      if (on && tutorial) markSeen();
    });
  }, [store, tutorial]);

  // A cartridge in the hand: the tags step back, so the machine's port (where it drops) stays in view.
  useEffect(
    () =>
      subscribeDrag(() => {
        const on = String(hiddenInstance() >= 0);
        wrap.current.forEach((el) => el && el.dataset.drag !== on && (el.dataset.drag = on));
      }),
    [],
  );

  const open = (id: TagId) => openHubItem(id, store, goTo);

  // The invisible boxes round the machine and the bench: a click (and the pointer cursor) in the room view.
  const hit = (id: TagId) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      // Not the pointerup of a drag that started on the spiral.
      if (!inHub(store) || wasDrag()) return;
      e.stopPropagation();
      open(id);
    },
    onPointerOver: () => {
      if (inHub(store)) document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
    },
  });
  const ghost = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), []);
  useEffect(() => () => ghost.dispose(), [ghost]);

  return (
    <group name="hub">
      <mesh position={DROP_ZONE.center} rotation={[0, DROP_ZONE.yaw, 0]} material={ghost} {...hit("machine")}>
        <boxGeometry args={[DROP_ZONE.half.x * 2, DROP_ZONE.half.y * 2, DROP_ZONE.half.z * 2]} />
      </mesh>
      <mesh position={up(BENCH_PIVOT.position, 2.0)} rotation={[0, BENCH_PIVOT.yaw, 0]} material={ghost} {...hit("bench")}>
        <boxGeometry args={[7, 4.5, 4]} />
      </mesh>
      {holo ? <HubHolograms texts={texts} wraps={wrap} quality={quality} /> : null}
      {TAGS.map((t, i) => (
        <Html key={t.id} position={holo ? holoTag(t.id).anchor : at[t.id]} center={!holo} zIndexRange={[20, 10]} portal={hubTagLayer as MutableRefObject<HTMLElement>}>
          <div ref={(el) => el && (wrap.current[i] = el)} className="world-hubtag" data-on="false" data-holo={holo} data-first={tutorial && t.id === "shelf"}>
            <button
              type="button"
              onClick={() => open(t.id)}
              aria-label={`${t.title}: ${t.line}`}
              onPointerEnter={() => setHot(t.id, true, "pointer")}
              onPointerLeave={() => setHot(t.id, false, "pointer")}
              onFocus={() => setHot(t.id, true, "focus")}
              onBlur={() => setHot(t.id, false, "focus")}
            >
              <span className="world-hubtag__n">{t.n}</span>
              <span className="world-hubtag__t">{t.title}</span>
              <span className="world-hubtag__l">{t.line}</span>
              {tutorial && t.id === "shelf" ? <span className="world-hubtag__start">start here</span> : null}
            </button>
            <i className="world-hubtag__stem" aria-hidden="true" />
          </div>
        </Html>
      ))}
    </group>
  );
}
