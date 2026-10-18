// Tiny drawing primitives for sprites that are rounder than a hand-typed grid wants to be.
import { blank, set, type Img, type Tok } from "./lib";

/** Filled disc centred on (cx, cy) with radius r (pixel centres at +0.5). */
export function disc(i: Img, cx: number, cy: number, r: number, t: Tok) {
  for (let y = 0; y < i.h; y++)
    for (let x = 0; x < i.w; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) set(i, x, y, t);
}
export function ellipse(i: Img, cx: number, cy: number, rx: number, ry: number, t: Tok) {
  for (let y = 0; y < i.h; y++)
    for (let x = 0; x < i.w; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(i, x, y, t);
}
export function rect(i: Img, x: number, y: number, w: number, h: number, t: Tok) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(i, xx, yy, t);
}
/** Checkerboard dither: paints `t` on every other pixel inside the already-painted area matching `only`. */
export function dither(i: Img, t: Tok, only: Tok, region: (x: number, y: number) => boolean) {
  for (let y = 0; y < i.h; y++)
    for (let x = 0; x < i.w; x++) if (i.d[y * i.w + x] === only && region(x, y) && (x + y) % 2 === 0) set(i, x, y, t);
}
export const canvas = blank;
