// A4: three dotted pixel rings (25 M / 100 M / 300 M) drawn on a canvas as 4-px cells, plus a radar_dot that
// sweeps around the outer ring once every 4 s in 16 steps. No gradients, no border-radius.
import { useEffect, useRef } from "react";
import { Sprite } from "@/pixel/components/Sprite";
import { RING_PX } from "@/world/useNearby";

const SIZE = 352; // canvas box, centre at 176
const RINGS: { r: number; label: string }[] = [
  { r: RING_PX["<25m"], label: "25 M" },
  { r: RING_PX["25-100m"], label: "100 M" },
  { r: RING_PX["100-300m"], label: "300 M" },
];

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

export function Radar() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const k = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = SIZE * k;
    canvas.height = SIZE * k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const mid = SIZE / 2;
    for (const { r } of RINGS) {
      const cells = ringCells(r);
      cells.forEach(([x, y], idx) => {
        if (idx % 2) return; // every other cell: a dotted ring
        ctx.fillStyle = "#2b2140"; // ink shadow, then paper dot
        ctx.fillRect(mid + x * 4 + 2, mid + y * 4 + 2, 4, 4);
      });
      cells.forEach(([x, y], idx) => {
        if (idx % 2) return;
        ctx.fillStyle = "#fff4d6";
        ctx.fillRect(mid + x * 4, mid + y * 4, 4, 4);
      });
    }
  }, []);

  return (
    <div className="radar" aria-hidden>
      <canvas ref={ref} className="radar__rings" style={{ width: SIZE, height: SIZE }} />
      {RINGS.map(({ r, label }) => (
        <span
          key={label}
          className={`radar__label ${r === RING_PX["<25m"] ? "radar__label--side" : ""}`}
          style={{ top: r === RING_PX["<25m"] ? SIZE / 2 - 8 : SIZE / 2 - r - 8 }}
        >
          {label}
        </span>
      ))}
      <div className="radar__sweep">
        <div className="radar__sweep-arm">
          <Sprite name="radar_dot" scale={2} />
        </div>
      </div>
    </div>
  );
}
