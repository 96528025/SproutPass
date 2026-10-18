// A4: the 25 M ring (dotted) and a fainter 100 M ring drawn on a canvas as 4-px cells, plus a radar_dot that
// sweeps around the 100 M ring once every 4 s in 16 steps. The 300 M ring is gone: it never fit a phone and
// only added noise. No gradients, no border-radius.
import { useEffect, useMemo, useRef } from "react";
import { Sprite } from "@/pixel/components/Sprite";
import { ringPxFor } from "@/world/useNearby";

/** Ordered, de-duplicated 4-px cells along a circle, starting at the top. */
function ringCells(r: number): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const n = Math.ceil(2 * Math.PI * r);
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2;
    const cx = Math.round((Math.sin(a) * r) / 4);
    const cy = Math.round((-Math.cos(a) * r) / 4);
    const key = `${cx},${cy}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push([cx, cy]);
    }
  }
  return out;
}

/** Rings at their real distances: radii come from the map's metres-per-pixel, so 25 / 100 / 300 m are true to the map. */
export function Radar({ mpp }: { mpp: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rings = useMemo(
    () => [
      { r: ringPxFor("<25m", mpp), label: "25 M", every: 2 },
      { r: ringPxFor("25-100m", mpp), label: "100 M", every: 4 },
    ],
    [mpp],
  );
  // canvas box: the 100-m ring plus a margin, in whole 4-px cells
  const half = Math.ceil((rings[1].r + 12) / 4) * 4;
  const SIZE = half * 2;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const k = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = SIZE * k;
    canvas.height = SIZE * k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const mid = SIZE / 2;
    for (const { r, every } of rings) {
      const cells = ringCells(r);
      cells.forEach(([x, y], idx) => {
        if (idx % every) return; // every nth cell: a dotted ring, sparser for 100 M
        ctx.fillStyle = "#2b2140"; // ink shadow, then paper dot
        ctx.fillRect(mid + x * 4 + 2, mid + y * 4 + 2, 4, 4);
      });
      cells.forEach(([x, y], idx) => {
        if (idx % every) return;
        ctx.fillStyle = "#fff4d6";
        ctx.fillRect(mid + x * 4, mid + y * 4, 4, 4);
      });
    }
  }, [rings, SIZE]);

  return (
    <div className="radar" aria-hidden style={{ "--rh": `${half}px`, "--sweep-r": `${rings[1].r}px` } as React.CSSProperties}>
      <canvas ref={ref} className="radar__rings" style={{ width: SIZE, height: SIZE }} />
      <div className="radar__sweep">
        <div className="radar__sweep-arm">
          <Sprite name="radar_dot" scale={2} />
        </div>
      </div>
      {/* one label only: the 25 M ring is what matters (encounters fire inside it) */}
      <span className="radar__label radar__label--side" style={{ top: half - 8 }}>
        {rings[0].label}
      </span>
    </div>
  );
}
