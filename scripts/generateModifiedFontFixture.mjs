import opentype from "opentype.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sourcePath = path.join(root, "tests/fixtures/Basic-Regular.ttf");
const outPath = path.join(root, "tests/fixtures/Basic-Modified.ttf");

const buffer = fs.readFileSync(sourcePath);
const font = opentype.parse(buffer);

// Modify the glyph for 'S' (unicode 83) slightly so the outline changes while
// the font's family/weight metadata stays identical. This gives us a controlled
// fixture where the parsed font fingerprint changes but exposed family/weight
// fields remain equivalent.
const sGlyph = font.glyphs.glyphs[64];
if (sGlyph && sGlyph.path && sGlyph.path.commands.length > 0) {
  const firstCommand = sGlyph.path.commands[0];
  if (typeof firstCommand.x === "number") firstCommand.x += 1;
  if (typeof firstCommand.y === "number") firstCommand.y += 1;
}

const arrayBuffer = font.toArrayBuffer();
fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
console.log(`Wrote ${outPath} (${arrayBuffer.byteLength} bytes)`);
