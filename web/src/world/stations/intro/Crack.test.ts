import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makeCrack } from "./Crack";
import { CRACK_YAW, crackToWorld } from "./crackSlot";
import { placeUniforms } from "./placeShaders";

const u = () => placeUniforms({ k: 0.045, mistY: 0, mistK: 0.5, fog: "#141b20", mist: "#25313a" });

/** A minimal binary glTF 2: one node named "crack", no meshes. */
function tinyGlb(): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "crack" }] }));
  const pad = (4 - (json.length % 4)) % 4;
  const jsonLen = json.length + pad;
  const total = 12 + 8 + jsonLen;
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonLen, true);
  v.setUint32(16, 0x4e4f534a, true); // "JSON"
  new Uint8Array(buf, 20).set(json);
  for (let i = 0; i < pad; i++) v.setUint8(20 + json.length + i, 0x20);
  return buf;
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const respond = (body: BodyInit | null, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("the crack's slot", () => {
  it("stays procedural while there is no crack.glb (404)", async () => {
    const c = makeCrack(u(), { value: 0 }, respond(null, 404));
    await settle();
    expect(c.source()).toBe("procedural");
    expect(c.group.getObjectByName("forest:fissure")).toBeTruthy();
  });

  it("stays procedural when the dev server answers the missing file with its index.html", async () => {
    const c = makeCrack(u(), { value: 0 }, respond("<!doctype html><html></html>"));
    await settle();
    expect(c.source()).toBe("procedural");
  });

  it("keeps the procedural crack without fetching the model where the tier asks it to (low: phones)", async () => {
    let fetched = 0;
    const c = makeCrack(u(), { value: 0 }, (async () => {
      fetched++;
      return new Response(tinyGlb());
    }) as unknown as typeof fetch, false);
    await settle();
    expect(fetched).toBe(0);
    expect(c.source()).toBe("procedural");
  });

  it("puts a real crack.glb in the slot's frame, in place of the fissure", async () => {
    const c = makeCrack(u(), { value: 0 }, respond(tinyGlb()));
    await settle();
    expect(c.source()).toBe("glb");
    expect(c.group.getObjectByName("forest:fissure")).toBeUndefined();
    const model = c.group.children[0];
    expect(model.position.toArray()).toEqual(crackToWorld([0, 0, 0]).map((v) => expect.closeTo(v, 5)));
    expect(model.rotation.y).toBeCloseTo(CRACK_YAW, 9);
    expect(model.getObjectByName("crack")).toBeInstanceOf(THREE.Object3D);
  });
});
