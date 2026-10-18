import "./kit.css";

// 7x7 pixel heart, drawn in pure CSS (box-shadow pixels) so it works before A2's sprites land.
// O = outline, F = fill, . = empty
const HEART = [
  ".OO.OO.",
  "OFFOFFO",
  "OFFFFFO",
  "OFFFFFO",
  ".OFFFO.",
  "..OFO..",
  "...O...",
];

function shadow(fillColor: string): string {
  const px = 2; // 7px heart at x2 = 14px inside a 16px slot
  const parts: string[] = [];
  HEART.forEach((row, y) => {
    row.split("").forEach((ch, x) => {
      if (ch === ".") return;
      const color = ch === "O" ? "var(--ink)" : fillColor;
      parts.push(`${(x + 1) * px}px ${(y + 1) * px}px 0 0 ${color}`);
    });
  });
  return parts.join(",");
}

const FILLED = shadow("var(--pink)");
const EMPTY = shadow("var(--paper)");

export interface HeartsProps {
  /** Owner count, 1..3. */
  filled: 1 | 2 | 3;
  /** Total slots (max owners). */
  of?: number;
  className?: string;
  label?: string;
}

/** Owner count ♥♥♡ */
export function Hearts({ filled, of = 3, className, label }: HeartsProps) {
  const slots = Array.from({ length: of }, (_, i) => i < filled);
  return (
    <span
      className={`hearts ${className ?? ""}`.trim()}
      role="img"
      aria-label={label ?? `${filled} of ${of} owners`}
    >
      {slots.map((on, i) => (
        <span className="heart" key={i}>
          <span
            className="heart__px"
            style={{ boxShadow: on ? FILLED : EMPTY, marginLeft: -2, marginTop: -2 }}
          />
        </span>
      ))}
    </span>
  );
}
