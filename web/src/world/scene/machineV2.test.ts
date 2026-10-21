import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readPublic } from "../../twin/testFiles";
import { MACHINE_ANCHOR } from "../core/layout";
import { BAKED_BODY_KEEP, HOLO_ABOVE_LENS, cutBakedBody, splitMachineV2, type MachineV2 } from "./machineV2";
import { PORT_LOCAL, SLOT_TOP_LOCAL } from "./plugSequence";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

/**
 * A GLB from web/public, parsed without its images (jsdom can't decode them, and only the geometry is
 * tested), in this realm's ArrayBuffer (GLTFLoader tells a GLB from JSON with instanceof).
 */
async function glb(path: string): Promise<GLTF> {
  const bytes = new Uint8Array(await readPublic(path));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete m.emissiveTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
  }
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const head = new TextEncoder().encode(text);
  const rest = bytes.subarray(20 + jsonLen);
  const out = new Uint8Array(20 + head.length + rest.length);
  const ov = new DataView(out.buffer);
  out.set(bytes.subarray(0, 8));
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, head.length, true);
  ov.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(head, 20);
  out.set(rest, 20 + head.length);
  return new Promise((resolve, reject) => new GLTFLoader().parse(out.buffer, "", resolve, reject));
}

let v2: GLTF;
let m: MachineV2;
beforeAll(async () => {
  v2 = await glb("world/models/machine_v2.glb");
  m = splitMachineV2(v2.scene);
});

describe("the machine, v2 (docs/design/blender/machine-v2.blend)", () => {
  it("splits the model into the body, the glow, the slot, the lens and two fans, losing no triangle", () => {
    let file = 0;
    v2.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) file += tris((o as THREE.Mesh).geometry);
    });
    expect(file).toBe(13952);
    const parts = [m.body, m.glow, m.slot, m.lens, ...m.fans.flatMap((f) => [f.body, f.mark])];
    expect(parts.reduce((s, g) => s + tris(g), 0)).toBe(file);
  });

  it("puts every non-glowing material in one body with its colour, metalness and roughness per vertex", () => {
    expect(m.body.getAttribute("color")).toBeTruthy();
    const mr = m.body.getAttribute("aMR");
    expect(mr.itemSize).toBe(2);
    // The graphite shroud (metal 0.85, rough 0.32) and the PCB (metal 0, rough 0.55) are both in it.
    const pairs = new Set<string>();
    for (let i = 0; i < mr.count; i++) pairs.add(`${mr.getX(i).toFixed(2)},${mr.getY(i).toFixed(2)}`);
    expect(pairs).toContain("0.85,0.32");
    expect(pairs).toContain("0.00,0.55");
  });

  it("finds the two fans at the hub marks, each 11 blades and a hub that turn together, with the teal mark", () => {
    expect(m.fans).toHaveLength(2);
    const centres = m.fans.map((f) => [f.centre.x, f.centre.z].map((v) => +v.toFixed(2)));
    expect(centres).toEqual([
      [-1.28, 0.68],
      [1.28, -0.68],
    ]);
    for (const f of m.fans) {
      expect(tris(f.body)).toBe(11 * 52 + 572);
      expect(tris(f.mark)).toBe(188);
      // Local to its axis: every vertex within the fan's opening.
      for (const g of [f.body, f.mark]) {
        const p = g.getAttribute("position");
        for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThan(1.0);
      }
    }
  });

  it("has the dock's slot where the plug-in seats the cartridge", () => {
    m.slot.computeBoundingBox();
    const c = m.slot.boundingBox!.getCenter(new THREE.Vector3());
    expect(Math.hypot(c.x - PORT_LOCAL.x, c.z - PORT_LOCAL.z)).toBeLessThan(0.01);
    expect(Math.abs(m.slotTop - SLOT_TOP_LOCAL)).toBeLessThan(0.03);
  });

  it("stands the hologram where it stood, just above the new lens", () => {
    expect(m.lensTop.y + HOLO_ABOVE_LENS).toBeCloseTo(3.44 + 0.35, 2);
    expect(Math.hypot(m.lensTop.x - 3.18, m.lensTop.z + 1.69)).toBeLessThan(0.02);
  });
});

describe("the baked machine body under the new machine", () => {
  it("keeps only the power cable and its plug: the old card's baked parts go", async () => {
    const baked = (await glb("world/models/machine_body.glb")).scene.getObjectByName("baked_machine_body") as THREE.Mesh;
    const cut = cutBakedBody(baked.geometry);
    expect(tris(baked.geometry)).toBe(4368);
    // machine.glb's M_Cable (864 triangles) and M_PowerPlug (108), baked.
    expect(tris(cut)).toBe(864 + 108);
    expect(cut.getAttribute("uv")).toBeTruthy();
    // The keep boxes are the old nodes' own (machine.glb, in the machine's frame).
    const old = (await glb("world/models/machine.glb")).scene;
    old.updateMatrixWorld(true);
    for (const [name, box] of Object.entries(BAKED_BODY_KEEP)) {
      const node = old.getObjectByName(`mx_M_${name}`)!;
      const b = new THREE.Box3().setFromObject(node, true);
      expect(box.containsBox(b), name).toBe(true);
      expect(box.clone().expandByScalar(-0.05).containsBox(b), `${name}: the box is loose`).toBe(false);
    }
    // Every kept vertex lies in one of them (back in the machine's frame).
    const anchor = new THREE.Vector3(...MACHINE_ANCHOR);
    const p = cut.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 7) {
      v.fromBufferAttribute(p as never, i).sub(anchor);
      expect(Object.values(BAKED_BODY_KEEP).some((b) => b.clone().expandByScalar(0.3).containsPoint(v))).toBe(true);
    }
  });
});
