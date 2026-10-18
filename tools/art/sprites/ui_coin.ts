// ui_coin — 16x16 gold coin with an inner ring, glint and a star stamp.
import { blank, blitOutlined, set } from "../lib";
import { disc } from "../shapes";

const raw = blank(16, 16);
disc(raw, 8, 8, 6.4, "gold");
// inner ring (path) = a circle outline at r~4.4
for (let y = 0; y < 16; y++)
  for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    if (d > 3.9 && d <= 4.9) set(raw, x, y, "path");
    else if (d > 5.6 && d <= 6.4 && x + y > 15 && (x + y) % 2 === 0) set(raw, x, y, "path");
  }
// star stamp
for (const [x, y] of [[8, 5], [8, 6], [7, 7], [8, 7], [9, 7], [8, 8], [8, 9], [7, 10], [9, 10]]) set(raw, x, y, "path");
// glint
for (const [x, y] of [[4, 5], [5, 4], [4, 6]]) set(raw, x, y, "white");
const f = blank(16, 16);
blitOutlined(f, raw, 0, 0);
export const frames = [f];
