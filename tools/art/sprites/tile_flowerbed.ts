// tile_flowerbed — 16x16 lawn tile with an oval tan flower bed, pink / gold / lav blooms and grass-dark leaves.
import { clone, set } from "../lib";
import { ellipse } from "../shapes";
import { frames as grass } from "./tile_grass";

const f = clone(grass[0]);
ellipse(f, 8, 8.5, 7, 5.2, "path");
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (f.d[y * 16 + x] === "path" && (x + y) % 2 === 0 && y > 9) set(f, x, y, "peach");
const bloom = (cx: number, cy: number, petal: "pink" | "gold" | "lav") => {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) set(f, cx + dx, cy + dy, petal);
  set(f, cx, cy, "white");
};
bloom(5, 7, "pink"); bloom(10, 6, "gold"); bloom(8, 10, "lav"); bloom(12, 10, "pink"); bloom(4, 11, "gold");
for (const [x, y] of [[7, 5], [9, 8], [6, 9], [11, 8], [3, 8]]) set(f, x, y, "grass-dark");
export const frames = [f];
