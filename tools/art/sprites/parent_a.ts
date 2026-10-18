// parent_a — Mina (palette peach): short ink-black bob, peach overalls over a white tee, carries a lav tote.
// Strip: idle(2) walk(4) cheer(2), 32x32 frames.
import { blitOutlined, grid, type Legend } from "../lib";
import { armUpGrid, buildParent, makeLegs } from "./parent-rig";

// legend — .=clear k=ink W=white a=peach n=pink y=gold l=lav f=cream(skin) d=path(skin shade) h=ink(hair) i=lav(hair shine)
// b=pink(blush) e=ink(eye) m=red(mouth) s=red(shoe)
const L: Legend = {
  k: "ink", W: "white", a: "peach", n: "pink", y: "gold", l: "lav", f: "cream", d: "path",
  h: "ink", i: "lav", b: "pink", e: "ink", m: "red", s: "red", c: "cream",
};

const head = grid(
  [
    "...hhhhhhhh...",
    "..hhiihhhhhh..",
    ".hhihhhhhhhhh.",
    "hhhhhhhhhhhhhh",
    "hhhhhhhhhhhhhh",
    "hffffffffffffh",
    "hffeffffffeffh",
    "hffeffffffeffh",
    "hfbfffmmfffbfh",
    "hffffffffffffh",
    ".hhffffffffhh.",
    "..hhhffffhhh..",
  ],
  L, "parent_a.head",
);
const torso = grid(
  [
    "WWWWWWWW",
    "WaWWWWaW",
    "aaaaaaaa",
    "ayaaaaya",
    "aaaaaaaa",
    "aanaanaa",
    "aaaaaaaa",
    "nananana",
  ],
  L, "parent_a.torso",
);
const armDown = [
  grid(["WW", "WW", "WW", "WW", "ff", "ff"], L, "parent_a.armL"),
  grid(["WW", "WW", "WW", "WW", "ff", "ff"], L, "parent_a.armR"),
] as [ReturnType<typeof grid>, ReturnType<typeof grid>];
const arm = armUpGrid("W", "f", L, "parent_a.armUp");

const tote = grid(
  [
    "..kkk..",
    ".k...k.",
    "lllllll",
    "lWlWlWl",
    "lllllll",
    "lWlWlWl",
    "lllllll",
  ],
  L, "parent_a.tote",
);

export const frames = buildParent({
  head,
  torso,
  armDown,
  armUp: [arm, arm],
  legs: makeLegs("a", "s", L, "parent_a.legs"),
  hand: (f, dy, cheer) => {
    if (cheer) return;
    // tote hangs from the left hand
    blitOutlined(f, tote, 4, 19 + dy);
  },
});
