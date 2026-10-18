// A3: 32×32 top-right speaker button. Toggles A1's sfx; the mute flag persists in localStorage via sfx.
import { useSfx } from "@/pixel/sfx";
import { pixelShadow } from "./BottomBar";
import "./shell.css";

const C = { i: "var(--ink)", r: "var(--red)" };
// 6×6 pixels of 4px = the 24px inside the 4px border
const ON = ["......", "..i..i", "iii.i.", "iii.i.", "..i..i", "......"];
const OFF = ["......", "..ir.r", "iii.r.", "iii.r.", "..ir.r", "......"];

export function MuteToggle() {
  const { muted, toggle } = useSfx();
  const glyph = muted ? OFF : ON;
  return (
    <button
      type="button"
      className={`mt${muted ? " mt--muted" : ""}`}
      onClick={toggle}
      aria-label="Mute sound"
      aria-pressed={muted}
    >
      <span className="mt__glyph" aria-hidden>
        <i style={{ boxShadow: pixelShadow(glyph, C), background: glyph[0][0] === "." ? "transparent" : C[glyph[0][0] as "i"] }} />
      </span>
    </button>
  );
}
