// The room view's three things to click, in 3D: a tag floating over each (the shelf, the machine, the
// bench) and an invisible box round the machine and the bench that takes the click (the machine's is
// also where a dragged cartridge drops, drag.ts DROP_ZONE). The spiral takes
// its own clicks (Helix). Tags show only in the room view; the first visit numbers them as a mini
// tutorial ("start here" on the shelf), and later visits show them plain.
import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { inHub } from "../../core/CameraRig";
import { useWorld } from "../../core/WorldContext";
import { BENCH_PIVOT, MACHINE_PIVOT } from "../../scene/layout";
import { DROP_ZONE, hiddenInstance, subscribeDrag, wasDrag } from "./drag";
import { openHubItem, type HubItem } from "./hubItems";

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

const TAGS: { id: TagId; n: string; title: string; line: string }[] = [
  { id: "shelf", n: "01", title: "The shelf", line: "Every cartridge is a job. Pick one." },
  { id: "machine", n: "02", title: "The machine", line: "Drag a cartridge here. It projects the robot." },
  { id: "bench", n: "03", title: "The bench", line: "Make a new cartridge: name, look, robot." },
];

const up = (p: readonly number[], y: number) => new THREE.Vector3(p[0], p[1] + y, p[2]);

export function HubTags() {
  const { store, goTo } = useWorld();
  const wrap = useRef<HTMLDivElement[]>([]);
  const [tutorial] = useState(() => !seenBefore());
  const at = useMemo(
    () => ({
      // Under the hub bar at the top of the view (1280×720), not behind it.
      shelf: new THREE.Vector3(0, 11.5, 0),
      machine: up(MACHINE_PIVOT.position, 6.2),
      bench: up(BENCH_PIVOT.position, 5.4),
    }),
    [],
  );

  // Show the tags only in the room view (written on the DOM, never through React per frame).
  useEffect(() => {
    let shown = false;
    return store.onFrame(() => {
      const on = inHub(store);
      if (on === shown) return;
      shown = on;
      wrap.current.forEach((el) => el && (el.dataset.on = String(on)));
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
      {TAGS.map((t, i) => (
        <Html key={t.id} position={at[t.id]} center zIndexRange={[20, 10]}>
          <div ref={(el) => el && (wrap.current[i] = el)} className="world-hubtag" data-on="false" data-first={tutorial && t.id === "shelf"}>
            <button type="button" onClick={() => open(t.id)} aria-label={`${t.title}: ${t.line}`}>
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
