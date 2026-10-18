// Shared pose rig for the three 32x32 parents. A parent is a handful of small grids (head, torso, legs,
// arms, extras); the rig stacks them, outlines each part, and produces the 8 frames of the strip:
//   idle(2) walk(4) cheer(2). Each parent file owns its own grids and legend.
import { blank, blitOutlined, grid, type Img, type Legend } from "../lib";

export interface ParentParts {
  head: Img;            // 14 or 16 wide, 12 tall; face is the left 14 columns
  torso: Img;           // 8 wide, 8 tall
  armDown: [Img, Img];  // [left, right] 2 wide, 6 tall
  armUp: [Img, Img];    // 5 wide, 11 tall, drawn from shoulder up beside the head
  legs: { stand: Img; liftL: Img; liftR: Img }; // 10 wide, 6 tall
  /** drawn after the torso, before the head (carrier, pocket...). `dy` = this frame's body offset. */
  front?: (f: Img, dy: number) => void;
  /** drawn after the arms (tote bag...). */
  hand?: (f: Img, dy: number, cheer: boolean) => void;
  /** drawn before everything (bun, hood back...) */
  back?: (f: Img, dy: number) => void;
}

const HEAD_X = 9, HEAD_Y = 4, TORSO_X = 12, TORSO_Y = 16, LEGS_X = 11, LEGS_Y = 24;

/** Leg grids from a pants/shoe token pair. p = pants, s = shoe, d = shoe shade. */
export function makeLegs(pants: string, shoe: string, legend: Legend, name: string) {
  const mk = (rows: string[]) => grid(rows.map((r) => r.replace(/p/g, pants).replace(/s/g, shoe)), legend, name);
  return {
    stand: mk(["pppp..pppp", "pppp..pppp", "pppp..pppp", "pppp..pppp", "ssss..ssss", "ssss..ssss"]),
    liftL: mk(["pppp..pppp", "pppp..pppp", "ssss..pppp", "ssss..pppp", "......ssss", "......ssss"]),
    liftR: mk(["pppp..pppp", "pppp..pppp", "pppp..ssss", "pppp..ssss", "ssss......", "ssss......"]),
  };
}

export function buildParent(p: ParentParts): Img[] {
  const frame = (o: { dy: number; legs: Img; up?: boolean; hop?: number }): Img => {
    const f = blank(32, 32);
    const dy = o.dy + (o.hop ?? 0);
    p.back?.(f, dy);
    blitOutlined(f, o.legs, LEGS_X, LEGS_Y + (o.hop ?? 0));
    blitOutlined(f, p.torso, TORSO_X, TORSO_Y + dy);
    p.front?.(f, dy);
    if (o.up) {
      blitOutlined(f, p.armUp[0], 7, 6 + dy);
      blitOutlined(f, flipArm(p.armUp[1]), 20, 6 + dy);
    } else {
      blitOutlined(f, p.armDown[0], 10, 17 + dy);
      blitOutlined(f, p.armDown[1], 20, 17 + dy);
    }
    p.hand?.(f, dy, !!o.up);
    blitOutlined(f, p.head, HEAD_X, HEAD_Y + dy);
    return f;
  };
  const { stand, liftL, liftR } = p.legs;
  return [
    frame({ dy: 0, legs: stand }),
    frame({ dy: 1, legs: stand }),
    frame({ dy: 0, legs: stand }),
    frame({ dy: -1, legs: liftL }),
    frame({ dy: 0, legs: stand }),
    frame({ dy: -1, legs: liftR }),
    frame({ dy: 0, legs: stand, up: true, hop: -2 }),
    frame({ dy: 1, legs: stand, up: true }),
  ];
}

// the right raised arm is authored as the mirror of the left one
function flipArm(i: Img): Img {
  const o = blank(i.w, i.h);
  for (let y = 0; y < i.h; y++) for (let x = 0; x < i.w; x++) o.d[y * i.w + x] = i.d[y * i.w + (i.w - 1 - x)];
  return o;
}

/** Raised-arm grid, sleeve `s`, hand `f`. Left arm; the rig mirrors it for the right side. */
export function armUpGrid(sleeve: string, hand: string, legend: Legend, name: string): Img {
  return grid(
    ["ff...", "ff...", "ss...", "ss...", ".ss..", ".ss..", ".ss..", "..ss.", "..ss.", "...ss", "...ss"].map((r) =>
      r.replace(/s/g, sleeve).replace(/f/g, hand),
    ),
    legend,
    name,
  );
}
