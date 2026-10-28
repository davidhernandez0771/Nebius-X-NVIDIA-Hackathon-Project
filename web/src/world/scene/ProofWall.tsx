// The proof wall in 3D (proof-wall, 2026-10-26): the results board on the back wall (proofWallPlan.ts builds it). It is
// part of the room: it materializes with it (mounted inside the workshop's <Materialize>) and its lamps light it
// (power.ts addGlow), so it is dark until the room is. A click on it in the room view opens the place (#proof), like
// a click on the robot wall. While the place is open its panels lie over the screen as its content, so the screen
// shows only its glass and frame. Two draw calls; nothing runs per frame (a store subscription repaints the face
// when the place opens or closes).
import { useEffect, useMemo } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { inHub } from "../core/CameraRig";
import { useWorld } from "../core/WorldContext";
import { PROOF_FIGURES } from "../ui/proofFigures";
import { addGlow } from "./power";
import { makeProofWall } from "./proofWallPlan";

const FONT = '"Geist Mono"';

export function ProofWall() {
  const { store, goTo } = useWorld();
  const invalidate = useThree((s) => s.invalidate);
  const wall = useMemo(() => makeProofWall(PROOF_FIGURES.map((f) => f.name)), []);

  useEffect(() => {
    const offs = [addGlow(wall.screen.material, "#ffffff"), addGlow(wall.halo.material, "#ffffff")];
    let open: boolean | null = null;
    const follow = () => {
      const now = store.getCoarse().branch === "proof";
      if (now === open) return;
      open = now;
      if (wall.setBlank(now)) invalidate();
    };
    follow();
    offs.push(store.subscribe(follow));
    return () => {
      offs.forEach((off) => off());
      wall.dispose();
    };
  }, [wall, store, invalidate]);

  // The real font arriving prints the face again.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let live = true;
    Promise.all([fonts.load(`300 92px ${FONT}`), fonts.load(`500 22px ${FONT}`), fonts.load(`400 19px ${FONT}`)])
      .then(() => {
        if (live && wall.redraw()) invalidate();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wall, invalidate]);

  const hit = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!inHub(store)) return;
      e.stopPropagation();
      goTo("proof");
    },
    onPointerOver: () => {
      if (inHub(store)) document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
    },
  };

  return <primitive object={wall.group} {...hit} />;
}
