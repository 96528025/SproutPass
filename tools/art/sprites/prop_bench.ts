// prop_bench — 16x16 park bench seen from the front: tan slats, cream highlights, ink legs. Transparent background.
import { blank, blitOutlined, set } from "../lib";
import { rect as r2 } from "../shapes";

const raw = blank(16, 16);
r2(raw, 2, 4, 12, 4, "path");   // back
r2(raw, 2, 4, 12, 1, "cream");
r2(raw, 1, 9, 14, 2, "path");   // seat
r2(raw, 1, 9, 14, 1, "cream");
for (const x of [5, 10]) for (let y = 5; y < 8; y++) set(raw, x, y, "peach");
for (let x = 2; x < 14; x += 2) set(raw, x, 7, "peach");
const f = blank(16, 16);
blitOutlined(f, raw, 0, 0);
for (const x of [3, 4, 11, 12]) for (let y = 12; y < 15; y++) set(f, x, y, "ink");
export const frames = [f];
