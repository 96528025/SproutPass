// prop_tree — 32x32 round tree: blobby grass canopy with dithered grass-dark shade, mint highlights, pink blossoms.
import { blank, blitOutlined, get, set } from "../lib";
import { disc, rect } from "../shapes";

const trunk = blank(32, 32);
rect(trunk, 13, 21, 6, 8, "path");
rect(trunk, 12, 27, 8, 2, "path");
rect(trunk, 13, 21, 2, 8, "cream");
for (let y = 22; y < 29; y += 2) set(trunk, 17, y, "peach");

const crown = blank(32, 32);
disc(crown, 16, 13, 10.5, "grass");
disc(crown, 9, 16, 6.5, "grass");
disc(crown, 23, 16, 6.5, "grass");
disc(crown, 16, 18, 8, "grass");
for (let y = 0; y < 32; y++)
  for (let x = 0; x < 32; x++) {
    if (get(crown, x, y) !== "grass") continue;
    const lowRight = x + y * 1.2 > 40;
    if (lowRight && (x + y) % 2 === 0) set(crown, x, y, "grass-dark");
    if (x + y * 1.1 > 47) set(crown, x, y, "grass-dark");
    if (x + y < 24 && (x + y) % 2 === 1 && x > 7 && y > 3) set(crown, x, y, "mint");
  }
for (const [x, y] of [[11, 10], [19, 8], [22, 15], [8, 17], [15, 18], [18, 12]]) { set(crown, x, y, "pink"); set(crown, x + 1, y, "white"); }

const f = blank(32, 32);
blitOutlined(f, trunk, 0, 0);
blitOutlined(f, crown, 0, 0);
export const frames = [f];
