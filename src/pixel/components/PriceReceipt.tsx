import "./kit.css";

export interface PriceReceiptProps {
  /** Original price in cents. */
  original: number;
  /** Percentage the next owner pays, e.g. 60. */
  pct: number;
  /** Resulting price in cents (from the backend; never recomputed here). */
  price: number;
  /** Owner number after the sale: 2 or 3. */
  ownerAfter: 2 | 3;
  className?: string;
  /** Extra stamp line, e.g. "Demo payment · no real charge" (shown as written, bold green). */
  stamp?: string;
}

export function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

const ORD: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

// Zigzag top/bottom edge: 8px teeth, drawn as a polygon up to 416px wide.
function zigzag(): string {
  const w = 416;
  const t = 8;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let x = 0; x <= w; x += t) {
    const up = (x / t) % 2 === 0;
    top.push(`${x}px ${up ? 0 : t}px`);
    bottom.push(`${x}px calc(100% - ${up ? 0 : t}px)`);
  }
  return `polygon(${top.join(",")}, ${bottom.reverse().join(",")})`;
}
const CLIP = zigzag();

/** Receipt-paper look: "2nd owner pays 60% of $30.00 = $18.00". Readable labels, pixel numbers. */
export function PriceReceipt({ original, pct, price, ownerAfter, className, stamp }: PriceReceiptProps) {
  const ord = ORD[ownerAfter];
  return (
    <div
      className={`rcpt ${className ?? ""}`.trim()}
      style={{ padding: 0, background: "transparent" }}
      role="group"
      aria-label={`${ord} owner pays ${pct}% of ${formatCents(original)}: ${formatCents(price)}`}
    >
      <div className="rcpt__shadow" style={{ clipPath: CLIP }} aria-hidden />
      <div className="rcpt__paper" style={{ clipPath: CLIP }}>
        <div className="rcpt__line">
          <span>Original price</span>
          <span className="rcpt__dots" aria-hidden>....................................</span>
          <span className="rcpt__num">{formatCents(original)}</span>
        </div>
        <div className="rcpt__line">
          <span>{ord} owner pays</span>
          <span className="rcpt__dots" aria-hidden>....................................</span>
          <span className="rcpt__num">{pct}%</span>
        </div>
        <div className="rcpt__rule" aria-hidden />
        <div className="rcpt__total">
          <span>{ord} owner price</span>
          <span className="rcpt__price">{formatCents(price)}</span>
        </div>
        {stamp && <div className="rcpt__stamp">{stamp}</div>}
      </div>
    </div>
  );
}
