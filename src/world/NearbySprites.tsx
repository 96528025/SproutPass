// A4: other parents placed around the radar centre by useNearby's smoothed (x, y), facing the centre.
// Movement arrives already stepped in 4 px; a parent that vanished for 6 s fades out as a dither (CSS mask).
// Depth: a lower sprite stands in front (z = DEPTH_Z + y), and DEPTH_Z clears the radar's tallest ring (y >= -halfH,
// about -310 px on a tall phone), so a family due north on the 300 m ring is never sorted under the map (z 0).
// ?demo=1 tap-to-meet: with `onMeet`, every demo family (a sprite with a seed `key`, see useNearby's demoFamilies) is a
// button, "Meet Freja": the same sprite and name tag (no button chrome; the 64 px face is well over the 44 px tap
// minimum) with a 4 px focus / hover ring. Without `onMeet` (a meeting, a walk or a trade is on) it is the plain,
// untappable sprite again, so nothing announces a button that does nothing. A fading sprite is never a button.
import type { CSSProperties } from "react";
import { Sprite } from "@/pixel/components/Sprite";
import type { FamilySprite } from "@/world/useNearby";

/** = .ws__me's z-index in world.css: sprites above my centre sort behind me, sprites below in front. */
const DEPTH_Z = 1000;

export function NearbySprites({ items, onMeet }: { items: readonly FamilySprite[]; onMeet?: (key: string) => void }) {
  return (
    <>
      {items.map((p) => {
        const style: CSSProperties = { transform: `translate(${p.x}px, ${p.y}px)`, zIndex: DEPTH_Z + p.y };
        const face = (
          <>
            <Sprite name={p.sprite} anim="idle" scale={2} facing={p.x > 0 ? "left" : "right"} />
            <span className="ns__name">{p.name}</span>
          </>
        );
        const key = p.key;
        if (onMeet && key && !p.fading) {
          return (
            <button
              key={p.parentId}
              type="button"
              className="ns ns--tap"
              style={style}
              data-parent={p.parentId}
              data-band={p.band}
              data-parked={p.parked ? "1" : undefined}
              aria-label={`Meet ${p.name}`}
              onClick={() => onMeet(key)}
            >
              {face}
            </button>
          );
        }
        return (
          <div
            key={p.parentId}
            className={`ns ${p.fading ? "ns--fade" : ""}`}
            style={style}
            data-parent={p.parentId}
            data-band={p.band}
            data-parked={p.parked ? "1" : undefined}
          >
            {face}
          </div>
        );
      })}
    </>
  );
}
