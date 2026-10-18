// pet_b — Pip, a "hanger-bird": a round sky bird with a wire-hanger hook on its head and hanger-wire legs.
// Strip (16x16): idle(2) talk(2) hop(3). Faces right.
// legend — .=clear k=ink s=sky W=white y=gold n=pink e=ink(eye)
import { blank, blitOutlined, grid, set, type Img, type Legend } from "../lib";

const L: Legend = { k: "ink", s: "sky", W: "white", y: "gold", n: "pink", e: "ink" };

const body = grid(
  [
    "...ssss...",
    "..ssssss..",
    ".ssssssss.",
    "sssssseWss",
    "sWsssseWss",
    "WsWssssnss",
    "sWsWssssss",
    ".ssWsssss.",
    "..ssssss..",
  ],
  L, "pet_b.body",
);
const wingUp = grid(["W.", "WW", ".W"], L, "pet_b.wingUp");
const beakClosed = grid(["yy", "yy"], L, "pet_b.beak");
const beakTop = grid(["yy"], L, "pet_b.beakTop");

function frame(dy: number, o: { flap?: boolean; open?: boolean; legs?: boolean } = {}): Img {
  const f = blank(16, 16);
  const legs = o.legs ?? true;
  if (legs) {
    // hanger-wire legs: two diverging wires and a base bar
    for (const [x, y] of [[7, 13], [6, 14], [5, 14], [9, 13], [10, 14], [11, 14]]) set(f, x, y + Math.max(0, dy), "ink");
    for (const [x, y] of [[7, 12], [9, 12]]) set(f, x, y + Math.max(0, dy), "gold");
  }
  blitOutlined(f, body, 3, 3 + dy);
  if (o.flap) blitOutlined(f, wingUp, 1, 2 + dy);
  if (o.open) {
    blitOutlined(f, beakTop, 13, 6 + dy);
    blitOutlined(f, beakTop, 13, 9 + dy);
  } else blitOutlined(f, beakClosed, 13, 7 + dy);
  // hanger hook on top of the head
  for (const [x, y] of [[8, 2], [8, 1], [9, 0], [10, 0], [11, 1]]) set(f, x, y + dy, "ink");
  return f;
}

export const frames = [
  frame(1),
  frame(2, { legs: true }),
  frame(1, { open: true }),
  frame(1, { open: false, flap: true }),
  frame(2),
  frame(-1, { flap: true, open: true, legs: false }),
  frame(1),
];
