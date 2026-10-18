// pet_a — Button, a round "button-moth": a cream sewing button with two thread-hole eyes and lav wings.
// Strip (16x16): idle(2) talk(2) hop(3).
// legend — .=clear k=ink c=cream p=paper n=pink l=lav W=white
import { blank, blit, blitOutlined, flipH, grid, set, type Img, type Legend } from "../lib";

const L: Legend = { k: "ink", c: "cream", p: "paper", n: "pink", l: "lav", W: "white" };

const disc = grid(
  ["...cccc...", ".ccppppcc.", "cpkppppkpc", "cpkppppkpc", "cpnppppnpc", "cppppppppc", ".ccppppcc.", "...cccc..."],
  L, "pet_a.disc",
);
const mouth = (i: Img): Img => {
  const o = { ...i, d: i.d.slice() };
  set(o, 4, 5, "ink"); set(o, 5, 5, "ink");
  return o;
};
const wingUp = grid(["..ll", ".lll", "lWll", "llll", "lWll", ".lll", "..ll"], L, "pet_a.wingUp");
const wingDown = grid(["....", "..ll", ".lll", "lWll", "llll", "lWll", ".lll"], L, "pet_a.wingDown");

function frame(dy: number, up: boolean, talk = false): Img {
  const f = blank(16, 16);
  const wy = 4 + dy;
  const wl = up ? wingUp : wingDown;
  blitOutlined(f, wl, 0, wy);
  blitOutlined(f, flipH(wl), 12, wy);
  blitOutlined(f, talk ? mouth(disc) : disc, 3, 5 + dy);
  // thread antennae (single-pixel ink, no outline)
  for (const [x, y] of [[5, 4], [5, 3], [4, 2], [10, 4], [10, 3], [11, 2]]) set(f, x, y + dy, "ink");
  return f;
}

export const frames = [
  frame(0, true),
  frame(1, false),
  frame(0, true, true),
  frame(0, false),
  frame(1, false),
  frame(-2, true),
  frame(0, true),
];
void blit;
