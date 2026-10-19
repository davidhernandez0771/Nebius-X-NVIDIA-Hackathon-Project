// The two pendant lamps over the bench and the machine. Their light is in the bake (the pools on the
// floor) but the fittings weren't exported, so they are drawn here: a cord, a dark shade and the warm
// disc of the bulb under it, which follows the lamps. Two draw calls for both (shared geometry).
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SHAFTS } from "./Haze";
import { addGlow } from "./power";

const CEILING = 14.4;
export const BULB = "#FFE3B8";

export function Pendants() {
  const { shade, bulb, shadeMat, bulbMat } = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    for (const s of SHAFTS.slice(0, 2)) {
      const cone = new THREE.CylinderGeometry(0.16, 0.62, 0.55, 28, 1, true).translate(s.top.x, s.top.y + 0.27, s.top.z);
      const cord = new THREE.CylinderGeometry(0.015, 0.015, CEILING - s.top.y - 0.55, 6).translate(s.top.x, (CEILING + s.top.y + 0.55) / 2, s.top.z);
      parts.push(cone.toNonIndexed(), cord.toNonIndexed());
      bulbs.push(new THREE.CircleGeometry(0.5, 28).rotateX(Math.PI / 2).translate(s.top.x, s.top.y + 0.04, s.top.z).toNonIndexed());
    }
    const merge = (gs: THREE.BufferGeometry[]) => {
      const n = gs.reduce((k, g) => k + g.getAttribute("position").count, 0);
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      let o = 0;
      for (const g of gs) {
        pos.set(g.getAttribute("position").array as Float32Array, o);
        nor.set(g.getAttribute("normal").array as Float32Array, o);
        o += g.getAttribute("position").count * 3;
        g.dispose();
      }
      const m = new THREE.BufferGeometry();
      m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      m.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      return m;
    };
    return {
      shade: merge(parts),
      bulb: merge(bulbs),
      shadeMat: new THREE.MeshLambertMaterial({ color: "#121417", side: THREE.DoubleSide }),
      bulbMat: new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }),
    };
  }, []);
  useEffect(() => {
    const off = addGlow(bulbMat, BULB);
    return () => {
      off();
      [shade, bulb, shadeMat, bulbMat].forEach((x) => x.dispose());
    };
  }, [shade, bulb, shadeMat, bulbMat]);
  return (
    <group name="pendants">
      <mesh geometry={shade} material={shadeMat} raycast={() => null} />
      <mesh geometry={bulb} material={bulbMat} raycast={() => null} />
    </group>
  );
}
