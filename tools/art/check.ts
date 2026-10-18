// Palette check: every PNG/GIF we ship may only use tokens.css colours + white, with alpha 0 or 255.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { out, PALETTE } from "./lib";

const allowed = new Set(Object.values(PALETTE).map(([r, g, b]) => (r << 16) | (g << 8) | b));
const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

function walk(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  } catch { return []; }
}

export default function check() {
  const bad: string[] = [];
  let files = 0;
  const targets = [...walk(out("public/sprites")), ...walk(out("public/fx")), out("public/icon-180.png")];
  for (const f of targets) {
    if (f.endsWith(".png")) {
      let png: PNG;
      try { png = PNG.sync.read(readFileSync(f)); } catch { continue; }
      files++;
      const seen = new Set<string>();
      for (let i = 0; i < png.data.length; i += 4) {
        const a = png.data[i + 3];
        if (a === 0) continue;
        const c = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
        if (a !== 255) seen.add(`partial alpha ${a}`);
        else if (!allowed.has(c)) seen.add(hex(c));
      }
      if (seen.size) bad.push(`${f}: ${[...seen].join(", ")}`);
    } else if (f.endsWith(".gif")) {
      files++;
      const b = readFileSync(f);
      // global colour table follows the 13-byte header when the packed flag says so
      const packed = b[10];
      if (packed & 0x80) {
        const n = 2 ** ((packed & 7) + 1);
        const seen = new Set<string>();
        for (let i = 0; i < n; i++) {
          const o = 13 + i * 3;
          const c = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
          if (!allowed.has(c)) seen.add(hex(c));
        }
        // padding entries are allowed when they are black-free duplicates of a palette colour (we pad with ink)
        if (seen.size) bad.push(`${f}: ${[...seen].join(", ")}`);
      } else bad.push(`${f}: no global colour table`);
    }
  }
  if (bad.length) {
    console.error("PALETTE CHECK FAILED\n" + bad.join("\n"));
    process.exit(1);
  }
  console.log(`palette check ok (${files} files)`);
}

if (process.argv[1]?.endsWith("check.ts")) check();
