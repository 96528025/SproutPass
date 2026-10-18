// Dev helper: tsx tools/art/sheet.ts <outfile> [scale] -> contact sheet of every built sprite (reads public/sprites).
import { readdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { out, writePng, blank, type Img, type Tok, PALETTE } from "./lib";
const [file, k = "6"] = process.argv.slice(2);
const names = readdirSync(out("public/sprites")).filter((f) => f.endsWith(".png")).sort();
const rows: { n: string; png: PNG }[] = names.map((n) => ({ n, png: PNG.sync.read(readFileSync(out("public/sprites", n))) }));
const W = Math.max(...rows.map((r) => r.png.width)) + 4;
const H = rows.reduce((a, r) => a + r.png.height + 2, 2);
const img: Img = blank(W, H); img.d.fill("grass");
const rev = new Map(Object.entries(PALETTE).map(([t, [r, g, b]]) => [(r << 16) | (g << 8) | b, t as Tok]));
let y = 2;
for (const { png } of rows) {
  for (let yy = 0; yy < png.height; yy++) for (let xx = 0; xx < png.width; xx++) {
    const o = (yy * png.width + xx) * 4;
    if (png.data[o + 3] === 0) continue;
    img.d[(y + yy) * W + 2 + xx] = rev.get((png.data[o] << 16) | (png.data[o + 1] << 8) | png.data[o + 2]) ?? "red";
  }
  y += png.height + 2;
}
const sc = Number(k);
const o = blank(W * sc, H * sc);
for (let yy = 0; yy < o.h; yy++) for (let xx = 0; xx < o.w; xx++) o.d[yy * o.w + xx] = img.d[Math.floor(yy / sc) * W + Math.floor(xx / sc)];
writePng(file, o);
console.log(names.join(" "));
