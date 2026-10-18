// fx_sparkle — 4-point star, loop(3): small -> big -> medium. White core, gold tips, no outline.
import { blank, set, type Img } from "../lib";

function star(len: number, diag = false): Img {
  const f = blank(16, 16);
  set(f, 8, 8, "white"); set(f, 7, 8, "white"); set(f, 8, 7, "white"); set(f, 7, 7, "white");
  for (let k = 1; k <= len; k++) {
    const t = k >= len ? "gold" : "white";
    set(f, 8 + k, 8, t); set(f, 7 - k, 7, t); set(f, 8, 8 + k, t); set(f, 7, 7 - k, t);
    set(f, 8 + k, 7, k >= len - 1 ? "gold" : "white"); set(f, 7 - k, 8, k >= len - 1 ? "gold" : "white");
  }
  if (diag) for (const [dx, dy] of [[2, 2], [-3, 2], [2, -3], [-3, -3]]) set(f, 8 + dx, 8 + dy, "gold");
  return f;
}
export const frames = [star(1), star(5, true), star(3)];
