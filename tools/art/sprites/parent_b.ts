// parent_b — Jo (palette sky): tall red-gold bun, sky cardigan over a white tee, lav baby carrier on the front
// with a little cream-faced baby peeking out. Strip: idle(2) walk(4) cheer(2), 32x32 frames.
// legend — .=clear k=ink W=white s=sky l=lav n=pink c=cream(baby) f=path(skin) h=red(hair) i=gold(hair shine)
// e=ink(eye) b=pink(blush) m=red(mouth) u=path(chinos) z=white(shoe)
import { blitOutlined, grid, type Legend } from "../lib";
import { armUpGrid, buildParent, makeLegs } from "./parent-rig";

const L: Legend = {
  k: "ink", W: "white", s: "sky", l: "lav", n: "pink", c: "cream", f: "path", h: "red", i: "gold",
  e: "ink", b: "pink", m: "red", u: "path", z: "white", d: "peach",
};

const head = grid(
  [
    "...hhhhhhhh...",
    "..hhhiihhhhh..",
    ".hhhhihhhhhhh.",
    ".hhhffffffhhh.",
    ".hhffffffffhh.",
    ".hffffffffffh.",
    ".hffeffffeffh.",
    ".hffeffffeffh.",
    ".hfbfffmmfbfh.",
    ".hffffffffffh.",
    "..hffffffffh..",
    ".....ffff.....",
  ],
  L, "parent_b.head",
);
const bun = grid(
  [
    "..hhhh..",
    ".hiihhh.",
    ".hihhhh.",
    "hhhhhhhh",
    ".hhhhhh.",
  ],
  L, "parent_b.bun",
);
const torso = grid(
  [
    "ssWWWWss",
    "ssWWWWss",
    "ssWWWWss",
    "ssWWWWss",
    "ssWWWWss",
    "ssWWWWss",
    "snssssns",
    "ssssssss",
  ],
  L, "parent_b.torso",
);
const carrier = grid(
  [
    "l.cccc.l",
    "lceccecl",
    "lcnccncl",
    "llllllll",
    "llWllWll",
    "lWllWllW",
    "llllllll",
    ".llllll.",
  ],
  L, "parent_b.carrier",
);
const arm = grid(["ss", "ss", "ss", "ss", "ff", "ff"], L, "parent_b.arm");

export const frames = buildParent({
  yoff: 1,
  hop: -1,
  head,
  torso,
  armDown: [arm, arm],
  armUp: [armUpGrid("s", "f", L, "parent_b.armUp"), armUpGrid("s", "f", L, "parent_b.armUp")],
  legs: makeLegs("u", "z", L, "parent_b.legs"),
  back: (f, dy) => blitOutlined(f, bun, 12, Math.max(1, dy)),
  front: (f, dy) => blitOutlined(f, carrier, 12, 17 + dy),
});
