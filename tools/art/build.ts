// npm run art — rebuilds every generated asset from source: sprite strips, item icons, sounds, GIF, app icon.
// Anything the registry doesn't draw yet gets a placeholder (lav box) so every name exists on disk.
import { existsSync } from "node:fs";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { SPRITES, ITEM_ICONS, frameCount } from "../../src/pixel/sprites";
import { blank, blitOutlined, out, set, strip, writePng, type Img } from "./lib";
import { SHEETS, ICONS } from "./registry";

const placeholder = (frame: number, n: number): Img => {
  const f = blank(frame, frame);
  const inner = blank(frame - 4, frame - 4);
  inner.d.fill("lav");
  blitOutlined(f, inner, 2, 2);
  set(f, frame / 2, frame / 2, "white");
  return strip(Array.from({ length: n }, () => f));
};

const placeholders: string[] = [];
const publicPath = (src: string) => out("public", src.replace(/^\//, ""));

// 1. sprite strips
for (const [name, def] of Object.entries(SPRITES)) {
  const sh = SHEETS.find((s) => s.name === name);
  const n = frameCount(def);
  if (!sh) {
    placeholders.push(name);
    writePng(publicPath(def.src), placeholder(def.frame, n));
    continue;
  }
  if (sh.frame !== def.frame) throw new Error(`${name}: sheet frame ${sh.frame} != manifest ${def.frame}`);
  if (sh.frames.length !== n) throw new Error(`${name}: ${sh.frames.length} frames drawn, sprites.ts expects ${n}`);
  writePng(publicPath(def.src), strip(sh.frames));
}
// 2. item icons
for (const [name, src] of Object.entries(ITEM_ICONS)) {
  const ic = ICONS.find((i) => i.name === name);
  if (!ic) {
    placeholders.push(name);
    writePng(publicPath(src), placeholder(16, 1));
    continue;
  }
  writePng(publicPath(src), ic.img);
}
console.log(`sprites: ${Object.keys(SPRITES).length} strips, ${Object.keys(ITEM_ICONS).length} icons written`);
if (placeholders.length) console.log(`PLACEHOLDERS (not drawn yet): ${placeholders.join(", ")}`);

// 3. everything else (optional modules appear as they're written)
for (const step of ["./sfx-build", "./extras", "./gif"]) {
  if (existsSync(new URL(`${step}.ts`, import.meta.url))) await (await import(step)).default();
}

// 4. palette check
(await import("./check")).default();
void PNG; void readFileSync;
