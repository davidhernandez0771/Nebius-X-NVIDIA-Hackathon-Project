import { describe, expect, it } from "vitest";
import { openZip } from "./zip";

type Entry = { name: string; data: string; deflate?: boolean };

async function deflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({ start: (c) => (c.enqueue(raw as Uint8Array<ArrayBuffer>), c.close()) });
  return new Uint8Array(await new Response(source.pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}

/** A minimal zip writer for the tests: local headers, the central directory, the end record. */
async function makeZip(entries: Entry[]): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.data);
    const body = e.deflate ? await deflateRaw(raw) : raw;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, e.deflate ? 8 : 0, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, e.deflate ? 8 : 0, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

describe("openZip", () => {
  it("lists files, skipping folders", async () => {
    const zip = openZip(await makeZip([{ name: "pkg/", data: "" }, { name: "pkg/robot.urdf", data: "<robot/>" }]));
    expect(zip.names).toEqual(["pkg/robot.urdf"]);
  });

  it("reads stored and deflated entries", async () => {
    const text = "<robot name='panda'>" + "x".repeat(500) + "</robot>";
    const zip = openZip(await makeZip([{ name: "a.txt", data: "stored" }, { name: "b/robot.urdf", data: text, deflate: true }]));
    expect(await zip.text("a.txt")).toBe("stored");
    expect(await zip.text("b/robot.urdf")).toBe(text);
  });

  it("normalizes backslashes in names", async () => {
    const zip = openZip(await makeZip([{ name: "meshes\\link0.stl", data: "s" }]));
    expect(zip.names).toEqual(["meshes/link0.stl"]);
  });

  it("rejects bytes that are not a zip", async () => {
    expect(() => openZip(new TextEncoder().encode("not a zip at all").buffer)).toThrow(/not a zip/);
  });

  it("throws for a missing entry", async () => {
    const zip = openZip(await makeZip([{ name: "a.txt", data: "x" }]));
    await expect(zip.bytes("b.txt")).rejects.toThrow(/b.txt/);
  });
});
