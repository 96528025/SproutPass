// Non-strip images: ui_frame.png (24x24, 8-px 9-slice borders) and icon-180.png (home-screen icon).
import { blank, blit, blitOutlined, out, scale, set, writePng } from "./lib";
import { disc, ellipse, rect } from "./shapes";
import { frames as grass } from "./sprites/tile_grass";
import { frames as petA } from "./sprites/pet_a";
import { frames as petB } from "./sprites/pet_b";
import { frames as sparkle } from "./sprites/fx_sparkle";
import { frames as flower } from "./sprites/fx_flower";
import { ITEMS } from "./items";

function uiFrame() {
  const f = blank(24, 24);
  rect(f, 0, 0, 24, 24, "ink");
  rect(f, 2, 2, 20, 20, "gold");
  rect(f, 3, 3, 18, 18, "paper");
  // dithered cream inner rim, 2 px
  for (let y = 3; y < 21; y++)
    for (let x = 3; x < 21; x++) if ((x < 5 || y < 5 || x > 18 || y > 18) && (x + y) % 2 === 0) set(f, x, y, "cream");
  // stepped outer corners (transparent) and gold corner studs
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [23, 0, -1, 1], [0, 23, 1, -1], [23, 23, -1, -1]])
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) set(f, cx + dx * sx, cy + dy * sy, null);
  for (const [x, y] of [[5, 5], [18, 5], [5, 18], [18, 18]]) { set(f, x, y, "gold"); set(f, x + 1, y, "gold"); set(f, x, y + 1, "gold"); set(f, x + 1, y + 1, "gold"); }
  writePng(out("public/sprites/ui_frame.png"), f);
}

function icon180() {
  const W = 45;
  const img = blank(W, W);
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) blit(img, grass[0], tx * 16, ty * 16);
  // soft ground patches + shadows
  const shadow = (cx: number, cy: number, rx: number) => ellipse(img, cx, cy, rx, 2.2, "grass-dark");
  shadow(12, 27, 8); shadow(34, 27, 8); shadow(22.5, 41, 8);
  blitOutlined(img, petA[0], 4, 11);
  blitOutlined(img, petB[0], 25, 11);
  // romper on a patch of path in front
  disc(img, 22.5, 39, 7, "path");
  const romper = ITEMS.find((i) => i.name === "item_romper")!.img;
  blit(img, romper, 15, 24);
  blit(img, sparkle[1], 20, 4);
  blit(img, flower[3], 0, 28);
  blit(img, flower[2], 29, 29);
  writePng(out("public/icon-180.png"), scale(img, 4));
}

export default function build() {
  uiFrame();
  icon180();
  console.log("extras: ui_frame.png, icon-180.png written");
}
if (process.argv[1]?.endsWith("extras.ts")) build();
