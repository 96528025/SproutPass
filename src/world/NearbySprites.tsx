// A4: other parents placed around the radar centre by useNearby's smoothed (x, y), facing the centre.
// Movement arrives already stepped in 4 px; a parent that vanished for 6 s fades out as a dither (CSS mask).
import { Sprite } from "@/pixel/components/Sprite";
import type { SmoothParent } from "@/world/useNearby";

export function NearbySprites({ items }: { items: SmoothParent[] }) {
  return (
    <>
      {items.map((p) => (
        <div
          key={p.parentId}
          className={`ns ${p.fading ? "ns--fade" : ""}`}
          style={{ transform: `translate(${p.x}px, ${p.y}px)`, zIndex: 200 + p.y }}
          data-parent={p.parentId}
          data-band={p.band}
        >
          <Sprite name={p.sprite} anim="idle" scale={2} facing={p.x > 0 ? "left" : "right"} />
          <span className="ns__name">{p.name}</span>
        </div>
      ))}
    </>
  );
}
