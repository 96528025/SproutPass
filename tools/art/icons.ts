// Dev helper: tsx tools/art/icons.ts <outfile> -> every item icon at x10 on a grass backdrop.
import { blank, blit, scale, writePng } from "./lib";
import { ICONS } from "./registry";
const img = blank(ICONS.length * 17 + 1, 18); img.d.fill("cream");
ICONS.forEach((ic, n) => blit(img, ic.img, 1 + n * 17, 1));
writePng(process.argv[2], scale(img, 8));
