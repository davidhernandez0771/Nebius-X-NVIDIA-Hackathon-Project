// Writes the byte size of every model the world streams in the background (web/public/world/models/**)
// to web/src/world/core/assetSizes.json: the loader's and the in-place "loading" state's denominators,
// known before the first byte arrives. waiting.test.ts checks them against the files; re-run this when a
// model changes.
//
//   node web/scripts/asset-sizes.mjs
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(WEB, "public");
const ROOT = join(PUBLIC, "world", "models");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

const sizes = Object.fromEntries(
  walk(ROOT)
    .filter((f) => f.endsWith(".glb"))
    .map((f) => [relative(PUBLIC, f).split("\\").join("/"), statSync(f).size])
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);
writeFileSync(join(WEB, "src", "world", "core", "assetSizes.json"), `${JSON.stringify(sizes, null, 2)}\n`);
console.log(`wrote ${Object.keys(sizes).length} sizes`);
