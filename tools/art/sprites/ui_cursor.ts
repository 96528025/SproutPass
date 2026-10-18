// ui_cursor — 16x16 right-pointing menu cursor (the ▶), gold with ink outline and a white glint.
import { blank, blitOutlined, set } from "../lib";

const raw = blank(16, 16);
const widths = [2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2];
widths.forEach((w, row) => { for (let x = 0; x < w; x++) set(raw, 3 + x, 2 + row, "gold"); });
set(raw, 3, 3, "white"); set(raw, 3, 4, "white"); set(raw, 4, 4, "white");
for (let row = 6; row < 11; row++) if (row % 2 === 0) for (let x = 3; x < 3 + widths[row]; x++) if ((x + row) % 2 === 0) set(raw, x, 2 + row, "path");
const f = blank(16, 16);
blitOutlined(f, raw, 0, 0);
export const frames = [f];
