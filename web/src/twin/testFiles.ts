// Tests only: read a file the page serves from web/public, as the dev server would. The web app has no Node types,
// so node:fs is loaded by name and process is read off globalThis. Vitest runs from web/ (npm --prefix web test).
type Fs = { readFileSync(path: string): Uint8Array };

export async function readPublic(path: string): Promise<ArrayBuffer> {
  const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
  const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  const bytes = fs.readFileSync(`${cwd}/public/${path.replace(/^\//, "")}`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
