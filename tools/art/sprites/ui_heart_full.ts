// ui_heart_full / ui_heart_empty — 16x16 hearts from an implicit heart curve, then outlined.
import { blank, blitOutlined, get, set, type Img, type Tok } from "../lib";

export function heart(fill: Tok, shine: Tok, shade: Tok | null): Img {
  const raw = blank(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const u = ((x + 0.5 - 8) / 5.6), v = -((y + 0.5 - 7.4) / 5.6);
      if ((u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0) set(raw, x, y, fill);
    }
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (get(raw, x, y) !== fill) continue;
      if (shade && x + y > 19 && (x + y) % 2 === 0) set(raw, x, y, shade);
    }
  for (const [x, y] of [[4, 4], [5, 3], [4, 5]]) if (get(raw, x, y)) set(raw, x, y, shine);
  const out = blank(16, 16);
  blitOutlined(out, raw, 0, 0);
  return out;
}
export const frames = [heart("red", "white", "pink")];
