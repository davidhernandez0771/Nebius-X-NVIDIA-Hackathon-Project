// Reads an uploaded robot .zip in the browser so the 3D preview can load its meshes, with no zip library:
// the central directory is parsed here and deflated entries go through the platform's DecompressionStream.
// Stored (0) and deflate (8) only; ZIP64 is not supported (the backend caps uploads at 100 MB anyway).

type Entry = { method: number; compressedSize: number; offset: number };

export type ZipReader = {
  names: string[];
  bytes(name: string): Promise<Uint8Array>;
  text(name: string): Promise<string>;
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEnd(view: DataView): number {
  // The end record is 22 bytes plus a comment of up to 65535 bytes.
  const stop = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= stop; i--) if (view.getUint32(i, true) === EOCD) return i;
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function openZip(buf: ArrayBuffer): ZipReader {
  const view = new DataView(buf);
  const end = view.byteLength >= 22 ? findEnd(view) : -1;
  if (end < 0) throw new Error("not a zip file (no end-of-archive record)");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error("not a zip file (broken central directory)");
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const name = decoder.decode(new Uint8Array(buf, at + 46, nameLen)).replace(/\\/g, "/");
    if (!name.endsWith("/")) {
      entries.set(name, {
        method: view.getUint16(at + 10, true),
        compressedSize: view.getUint32(at + 20, true),
        offset: view.getUint32(at + 42, true),
      });
    }
    at += 46 + nameLen + extraLen + commentLen;
  }

  async function bytes(name: string): Promise<Uint8Array> {
    const e = entries.get(name);
    if (!e) throw new Error(`${name} is not in the zip`);
    if (view.getUint32(e.offset, true) !== LOCAL) throw new Error(`${name}: broken local header`);
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    const data = new Uint8Array(buf, start, e.compressedSize);
    if (e.method === 0) return data.slice();
    if (e.method === 8) return inflateRaw(data);
    throw new Error(`${name}: compression method ${e.method} is not supported`);
  }

  return {
    names: [...entries.keys()],
    bytes,
    text: async (name) => decoder.decode(await bytes(name)),
  };
}
