// pet_c — Moss, a "sock bunny": a mint bean body with a white sock-cuff stripe, one up ear and one floppy ear.
// Strip (16x16): idle(2) talk(2) hop(3).
// legend — .=clear k=ink m=mint n=pink W=white e=ink(eye)
import { blank, blitOutlined, grid, set, type Img, type Legend } from "../lib";

const L: Legend = { k: "ink", m: "mint", n: "pink", W: "white", e: "ink" };

const body = grid(
  [
    "..mmmmmm..",
    ".mmmmmmmm.",
    "mmemmmmemm",
    "mmemmmmemm",
    "mnmmnnmmnm",
    "WWWWWWWWWW",
    ".mmmmmmmm.",
  ],
  L, "pet_c.body",
);
const earUp = grid([".m.", "mnm", "mnm", "mnm", "mmm"], L, "pet_c.earUp");
const earFlop = grid(["...", "mm.", "mnm", "mnm", ".mm"], L, "pet_c.earFlop");
const tail = grid(["WW", "WW"], L, "pet_c.tail");
const paw = grid(["nn"], L, "pet_c.paw");

function frame(dy: number, o: { flop?: boolean; talk?: boolean; wiggle?: number } = {}): Img {
  const f = blank(16, 16);
  const w = o.wiggle ?? 0;
  blitOutlined(f, o.flop ? earFlop : earUp, 4 + w, 1 + dy + (o.flop ? 1 : 0));
  blitOutlined(f, earFlop, 10 - w, 2 + dy);
  blitOutlined(f, tail, 1, 9 + dy);
  blitOutlined(f, paw, 4, 13 + Math.max(0, dy) - (dy > 1 ? 0 : 0));
  blitOutlined(f, paw, 10, 13 + Math.max(0, dy));
  blitOutlined(f, body, 3, 6 + dy);
  if (o.talk) { set(f, 7, 11 + dy, "ink"); set(f, 8, 11 + dy, "ink"); }
  return f;
}

export const frames = [
  frame(0),
  frame(1, { wiggle: 1 }),
  frame(0, { talk: true }),
  frame(0, { talk: true, flop: true, wiggle: 1 }),
  frame(1),
  frame(-2, { wiggle: 1 }),
  frame(0),
];
