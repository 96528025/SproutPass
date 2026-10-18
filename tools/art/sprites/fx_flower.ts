// fx_flower — golden flower, bloom(4): bud -> opening -> open -> full. 16x16, drawn with discs then outlined.
import { blank, blitOutlined, set, type Img } from "../lib";
import { disc } from "../shapes";

function flower(d: number, r: number, rc: number, petals = 8): Img {
  const raw = blank(16, 16);
  for (let k = 0; k < petals; k++) {
    const a = (k / petals) * Math.PI * 2 - Math.PI / 2;
    disc(raw, 8 + Math.cos(a) * d, 8 + Math.sin(a) * d, r, "gold");
  }
  disc(raw, 8, 8, rc, "gold");
  // highlight the upper-left petals, dither a darker rim on the lower-right
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (raw.d[y * 16 + x] !== "gold") continue;
      if (x + y < 14 && (x + y) % 2 === 0 && d > 0) set(raw, x, y, "white");
      else if (x + y > 17 && (x + y) % 2 === 0) set(raw, x, y, "path");
    }
  disc(raw, 8, 8, rc * 0.62, "red");
  const out = blank(16, 16);
  blitOutlined(out, raw, 0, 0);
  return out;
}
export const frames = [flower(0, 0, 2.6), flower(2, 2, 2), flower(3, 2.3, 2.3), flower(4, 2.6, 2.7)];
