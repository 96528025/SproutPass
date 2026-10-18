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

function shadow(fillColor: string, px: number): string {
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

// 7px heart at x2 = 14px inside a 16px slot; `big` draws it at x3 = 21px inside a 24px slot.
const FILLED = shadow("var(--pink)", 2);
const EMPTY = shadow("var(--paper)", 2);
const FILLED_BIG = shadow("var(--pink)", 3);
const EMPTY_BIG = shadow("var(--paper)", 3);

export interface HeartsProps {
  /** Owner count, 1..3. */
  filled: 1 | 2 | 3;
  /** Total slots (max owners). */
  of?: number;
  className?: string;
  label?: string;
  /** 24px hearts (default 16px) for places where the owner count is the headline. */
  big?: boolean;
}

/** Owner count ♥♥♡. Screen readers (and a hover tooltip) get "2 of 3 owners". */
export function Hearts({ filled, of = 3, className, label, big }: HeartsProps) {
  const slots = Array.from({ length: of }, (_, i) => i < filled);
  const text = label ?? `${filled} of ${of} owners`;
  const off = big ? -3 : -2;
  return (
    <span className={`hearts${big ? " hearts--lg" : ""} ${className ?? ""}`.trim()} role="img" aria-label={text} title={text}>
      {slots.map((on, i) => (
        <span className="heart" key={i}>
          <span
            className="heart__px"
            style={{ boxShadow: on ? (big ? FILLED_BIG : FILLED) : big ? EMPTY_BIG : EMPTY, marginLeft: off, marginTop: off }}
          />
        </span>
      ))}
    </span>
  );
}
