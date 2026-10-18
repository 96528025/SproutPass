// Pixel-art helpers for the A2 pipeline. Sprites are string grids; this file turns them into
// token matrices (Img) and writes PNGs. Colours are palette *tokens*; hex values are read from
// src/pixel/tokens.css so the art can never drift from the design system.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const TOKENS = [
  "ink", "paper", "cream", "grass", "grass-dark", "path", "sky",
  "peach", "pink", "gold", "lav", "red", "mint", "white",
] as const;
export type Tok = (typeof TOKENS)[number];

function loadPalette(): Record<Tok, [number, number, number]> {
  const css = readFileSync(resolve(ROOT, "src/pixel/tokens.css"), "utf8");
  const out = {} as Record<Tok, [number, number, number]>;
  for (const t of TOKENS) {
    const m = css.match(new RegExp(`--${t}:\\s*#([0-9a-fA-F]{6})`));
    if (!m) throw new Error(`palette token --${t} missing from tokens.css`);
    const n = parseInt(m[1], 16);
    out[t] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return out;
}
export const PALETTE = loadPalette();

/** A picture: one palette token (or null = transparent) per pixel. */
export interface Img {
  w: number;
  h: number;
  d: (Tok | null)[];
}
export type Legend = Record<string, Tok>;

export const blank = (w: number, h: number): Img => ({ w, h, d: new Array(w * h).fill(null) });
export const clone = (i: Img): Img => ({ w: i.w, h: i.h, d: i.d.slice() });
export const get = (i: Img, x: number, y: number): Tok | null =>
  x < 0 || y < 0 || x >= i.w || y >= i.h ? null : i.d[y * i.w + x];
export const set = (i: Img, x: number, y: number, t: Tok | null) => {
  if (x >= 0 && y >= 0 && x < i.w && y < i.h) i.d[y * i.w + x] = t;
};

/** Grid rows -> Img. `.` is transparent. Throws on ragged rows or unknown characters. */
export function grid(rows: string[], legend: Legend, name = "grid"): Img {
  const w = rows[0].length;
  const img = blank(w, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`${name}: row ${y} has ${row.length} chars, expected ${w}: "${row}"`);
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const t = legend[ch];
      if (!t) throw new Error(`${name}: char "${ch}" at ${x},${y} is not in the legend`);
      img.d[y * w + x] = t;
    });
  });
  return img;
}

/** Copy non-transparent pixels of src onto dst at (x, y). */
export function blit(dst: Img, src: Img, x: number, y: number) {
  for (let sy = 0; sy < src.h; sy++)
    for (let sx = 0; sx < src.w; sx++) {
      const t = src.d[sy * src.w + sx];
      if (t) set(dst, x + sx, y + sy, t);
    }
}

/** Draw src with a 1-px ink outline (4-neighbour) around it, then src itself. Later parts overlap earlier ones. */
export function blitOutlined(dst: Img, src: Img, x: number, y: number, ink: Tok = "ink") {
  for (let sy = 0; sy < src.h; sy++)
    for (let sx = 0; sx < src.w; sx++) {
      if (!src.d[sy * src.w + sx]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!get(src, sx + dx, sy + dy)) set(dst, x + sx + dx, y + sy + dy, ink);
      }
    }
  blit(dst, src, x, y);
}

export function flipH(i: Img): Img {
  const o = blank(i.w, i.h);
  for (let y = 0; y < i.h; y++) for (let x = 0; x < i.w; x++) o.d[y * i.w + x] = i.d[y * i.w + (i.w - 1 - x)];
  return o;
}

/** Replace one token with another across the picture. */
export function recolor(i: Img, map: Partial<Record<Tok, Tok>>): Img {
  return { ...i, d: i.d.map((t) => (t && map[t] ? (map[t] as Tok) : t)) };
}

/** Horizontal strip from equally sized frames. */
export function strip(frames: Img[]): Img {
  const { w, h } = frames[0];
  const out = blank(w * frames.length, h);
  frames.forEach((f, n) => {
    if (f.w !== w || f.h !== h) throw new Error(`strip: frame ${n} is ${f.w}x${f.h}, expected ${w}x${h}`);
    blit(out, f, n * w, 0);
  });
  return out;
}

/** Integer-scale a picture (nearest neighbour). */
export function scale(i: Img, k: number): Img {
  const o = blank(i.w * k, i.h * k);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) o.d[y * o.w + x] = i.d[Math.floor(y / k) * i.w + Math.floor(x / k)];
  return o;
}

/** Composite an Img over a solid background token into RGB bytes (for GIF). */
export function toRGBA(i: Img): Buffer {
  const buf = Buffer.alloc(i.w * i.h * 4);
  i.d.forEach((t, n) => {
    if (!t) return;
    const [r, g, b] = PALETTE[t];
    buf[n * 4] = r; buf[n * 4 + 1] = g; buf[n * 4 + 2] = b; buf[n * 4 + 3] = 255;
  });
  return buf;
}

export function writePng(path: string, i: Img) {
  const png = new PNG({ width: i.w, height: i.h });
  toRGBA(i).copy(png.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

export const out = (...p: string[]) => resolve(ROOT, ...p);
