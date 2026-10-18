// Dev helper: tsx tools/art/preview.ts <name> [scale] [outfile] -> a zoomed PNG of one sheet on a grass backdrop.
import { blank, blit, scale, writePng, type Img } from "./lib";
import { SHEETS } from "./registry";

const [name, k = "8", file = `/tmp/preview_${name}.png`] = process.argv.slice(2);
const sh = SHEETS.find((s) => s.name === name);
if (!sh) throw new Error(`unknown sheet ${name}`);
const bg = (w: number, h: number): Img => { const i = blank(w, h); i.d.fill("grass"); return i; };
const gap = 2;
const W = sh.frames.length * (sh.frame + gap) + gap;
const img = bg(W, sh.frame + gap * 2);
sh.frames.forEach((f, n) => blit(img, f, gap + n * (sh.frame + gap), gap));
writePng(file, scale(img, Number(k)));
console.log(file);
