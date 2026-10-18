// public/fx/flowers.gif — 3 s @ 12 fps (36 frames), 390x300, paper background: golden flowers bloom (fx_flower),
// petals fall (fx_petal) and sparkles twinkle (fx_sparkle). Loops seamlessly. C sends this over iMessage.
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import gifenc from "gifenc";
import { blank, blit, out, PALETTE, scale, toRGBA, TOKENS, type Img } from "./lib";
import { frames as flower } from "./sprites/fx_flower";
import { frames as petal } from "./sprites/fx_petal";
import { frames as sparkle } from "./sprites/fx_sparkle";

const { GIFEncoder, applyPalette } = gifenc as unknown as {
  GIFEncoder: () => { writeFrame(i: Uint8Array, w: number, h: number, o: object): void; finish(): void; bytes(): Uint8Array };
  applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
};

const W = 390, H = 300, N = 36;
const flowerS = flower.map((f) => scale(f, 4));
const petalS = petal.map((f) => scale(f, 2));
const sparkleS = sparkle.map((f) => scale(f, 3));

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// 4 x 3 jittered grid of flowers, each on its own bloom schedule
const flowers = Array.from({ length: 12 }, (_, n) => ({
  x: 8 + (n % 4) * 94 + Math.round((rnd() - 0.5) * 20),
  y: 6 + Math.floor(n / 4) * 96 + Math.round((rnd() - 0.5) * 18),
  s: Math.floor(rnd() * 20),
}));
const petals = Array.from({ length: 16 }, () => ({ x: Math.round(rnd() * (W - 32)), y0: Math.round(rnd() * 180), sway: rnd() * 6, ph: Math.floor(rnd() * 2) }));
const sparks = Array.from({ length: 10 }, () => ({ x: Math.round(rnd() * (W - 48)), y: Math.round(rnd() * (H - 48)), ph: Math.floor(rnd() * 6) }));

function frame(f: number): Img {
  const img = blank(W, H);
  img.d.fill("paper");
  for (const fl of flowers) {
    const c = (f - fl.s + N * 2) % N;
    let idx: number | null;
    if (c < 4) idx = c; else if (c < 28) idx = 3; else if (c < 32) idx = 31 - c; else idx = null;
    if (idx === null) continue;
    const bob = c >= 4 && c < 28 ? ((c >> 2) % 2) * 4 : 0; // hold = a gentle 4-px bob
    blit(img, flowerS[idx], fl.x, fl.y - bob);
  }
  for (const p of petals) {
    const y = (p.y0 + 5 * f) % 180;
    const sw = Math.round(Math.sin(((f + p.sway * 6) / N) * Math.PI * 4) * 8);
    for (const dy of [0, 180]) if (y + dy < H) blit(img, petalS[(f + p.ph) % 2], Math.max(0, Math.min(W - 32, p.x + sw)), y + dy);
  }
  for (const s of sparks) blit(img, sparkleS[Math.floor(((f + s.ph) % 6) / 2)], s.x, s.y);
  return img;
}

export default function build() {
  const palette = [...TOKENS.map((t) => PALETTE[t]), PALETTE.ink, PALETTE.ink].slice(0, 16) as number[][];
  const gif = GIFEncoder();
  for (let f = 0; f < N; f++) {
    const index = applyPalette(new Uint8Array(toRGBA(frame(f))), palette);
    gif.writeFrame(index, W, H, { palette: f === 0 ? palette : undefined, delay: 83, repeat: 0 });
  }
  gif.finish();
  mkdirSync(out("public/fx"), { recursive: true });
  writeFileSync(out("public/fx/flowers.gif"), gif.bytes());
  console.log(`gif: flowers.gif ${N} frames, ${(statSync(out("public/fx/flowers.gif")).size / 1024).toFixed(0)} KB`);
}
if (process.argv[1]?.endsWith("gif.ts")) build();
