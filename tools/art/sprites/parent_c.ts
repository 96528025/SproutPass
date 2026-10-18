// parent_c — Sam (palette mint): red cap with a gold brim, mint hoodie with a kangaroo pocket, hands in pockets.
// Strip: idle(2) walk(4) cheer(2), 32x32 frames.
// legend — .=clear k=ink W=white m=mint g=grass(hoodie shade) r=red(cap) n=pink(cap shine) Y=gold(brim)
// h=ink(hair) f=peach(skin) e=ink(eye) b=pink(blush) o=red(mouth) z=sky(jeans) s=white(shoe)
import { grid, type Legend } from "../lib";
import { armUpGrid, buildParent, makeLegs } from "./parent-rig";

const L: Legend = {
  k: "ink", W: "white", m: "mint", g: "grass", r: "red", n: "pink", Y: "gold",
  h: "ink", f: "peach", e: "ink", b: "pink", o: "red", z: "sky", s: "white",
};

const head = grid(
  [
    "...rrrrrrrr...",
    "..rrrnnrrrrr..",
    ".rrnrrrrrrrrr.",
    "rrrrrrrrrrrrrr",
    "YYYYYYYYYYYYYY",
    "hffffffffffffh",
    "hffeffffffeffh",
    "hffeffffffeffh",
    "hfbfffooffbffh",
    "hffffffffffffh",
    ".hffffffffffh.",
    "...hhffffhh...",
  ],
  L, "parent_c.head",
);
const torso = grid(
  [
    "gggmmggg",
    "mmgWWgmm",
    "mmmWWmmm",
    "mmmmmmmm",
    "mkkkkkkm",
    "mggggggm",
    "mggggggm",
    "mmmmmmmm",
  ],
  L, "parent_c.torso",
);
// arms are tucked into the pocket: sleeve only, grass cuff
const arm = grid(["mm", "mm", "mm", "mm", "gg", "gg"], L, "parent_c.arm");

export const frames = buildParent({
  head,
  torso,
  armDown: [arm, arm],
  armUp: [armUpGrid("m", "f", L, "parent_c.armUp"), armUpGrid("m", "f", L, "parent_c.armUp")],
  legs: makeLegs("z", "s", L, "parent_c.legs"),
});
