// 32×32 pixel icon buttons for the top-right HUD cluster (next to A3's MuteToggle): DISCOVERABLE and ZONE.
// Same look as MuteToggle: 4-px ink border, paper face, cream when "on", 6×6 glyph of 4-px pixels.
import { pixelShadow } from "./BottomBar";
import "./world.css";

const C = { i: "var(--ink)", g: "var(--gold)", r: "var(--red)", s: "var(--sky)", m: "var(--mint)" };

export const GLYPHS = {
  // an eye: open (visible to others) / crossed out
  eyeOn: ["......", ".iiii.", "iiggii", "iiggii", ".iiii.", "......"],
  eyeOff: [".....r", ".iiir.", "iirgii", "iirgii", ".riii.", "r....."],
  // a diamond "map": follow view / zoomed-out zone view
  zone: ["..ii..", ".immi.", "immmmi", "immmmi", ".immi.", "..ii.."],
  zoneOut: ["..ii..", ".issi.", "isssss", "isssss", ".issi.", "..ii.."],
} as const;

export interface HudButtonProps {
  glyph: keyof typeof GLYPHS;
  /** Slot from the right edge: 0 is the mute toggle's, so HUD buttons start at 1 (at 0 when B's demo panel holds the toggle). */
  slot: 0 | 1 | 2 | 3;
  on?: boolean;
  label: string;
  onClick: () => void;
}

export function HudButton({ glyph, slot, on, label, onClick }: HudButtonProps) {
  const rows = GLYPHS[glyph];
  return (
    <button
      type="button"
      className={`hud${on ? " hud--on" : ""}`}
      style={{ right: 8 + slot * 40 }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={!!on}
    >
      <span className="hud__glyph" aria-hidden>
        <i style={{ boxShadow: pixelShadow([...rows], C) }} />
      </span>
    </button>
  );
}
