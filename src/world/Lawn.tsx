// A4: the lawn. A canvas of 48-px tiles (16-px art at x3) anchored on the radar centre, so both phones, whatever
// their size, draw the same tile at the same offset from you. Props are placed from a fixed seed: it looks
// hand-placed and identical everywhere.
import { useEffect, useRef } from "react";
import { SPRITES } from "@/pixel/sprites";

const TILE = 48; // 16 px x3
const SEED = 0x1a5e;

const images = new Map<string, Promise<HTMLImageElement>>();
function load(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Deterministic 0..1 for a tile coordinate. */
function hash(i: number, j: number, salt: number): number {
  let h = (Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt + SEED, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Prop = { kind: "flower" | "bench" | "tree"; px: number; py: number };

export interface LawnProps {
  /** Radar centre in this canvas's own coordinates (css px). */
  cx: number;
  cy: number;
}

export function Lawn({ cx, cy }: LawnProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !cx || !cy) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const k = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = w * k;
    canvas.height = h * k;
    let cancelled = false;

    void Promise.all([
      load(SPRITES.tile_grass.src),
      load(SPRITES.tile_path.src),
      load(SPRITES.tile_flowerbed.src),
      load(SPRITES.prop_bench.src),
      load(SPRITES.prop_tree.src),
    ]).then(([grass, path, flower, bench, tree]) => {
      if (cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(k, 0, 0, k, 0, 0);

      const i0 = -Math.ceil(cx / TILE) - 1;
      const i1 = Math.ceil((w - cx) / TILE) + 1;
      const j0 = -Math.ceil(cy / TILE) - 1;
      const j1 = Math.ceil((h - cy) / TILE) + 1;
      const props: Prop[] = [];

      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const px = cx + i * TILE - TILE / 2;
          const py = cy + j * TILE - TILE / 2;
          const onPath = i === 0 || j === 0;
          ctx.drawImage(onPath ? path : grass, px, py, TILE, TILE);
          if (onPath) continue;
          const dist = Math.hypot(i, j) * TILE;
          const r = hash(i, j, 1);
          if (dist > 110 && r < 0.07) props.push({ kind: "flower", px, py });
          else if (dist > 130 && (Math.abs(i) === 1 || Math.abs(j) === 1) && r < 0.2) props.push({ kind: "bench", px, py });
          else if (dist > 210 && Math.abs(i) >= 2 && Math.abs(j) >= 2 && r > 0.93) props.push({ kind: "tree", px, py });
        }
      }
      props.sort((a, b) => a.py - b.py);
      for (const p of props) {
        if (p.kind === "tree") ctx.drawImage(tree, p.px - TILE / 2, p.py + TILE - TILE * 2, TILE * 2, TILE * 2);
        else ctx.drawImage(p.kind === "flower" ? flower : bench, p.px, p.py, TILE, TILE);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cx, cy]);

  return <canvas ref={ref} className="lawn" aria-hidden />;
}
