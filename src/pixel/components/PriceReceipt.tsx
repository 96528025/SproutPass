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
  /** Extra stamp line, e.g. "DEMO PAYMENT · NO REAL CHARGE". */
  stamp?: string;
}

export function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

const ORD: Record<number, string> = { 1: "1ST", 2: "2ND", 3: "3RD" };

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

/** Receipt-paper look: "2ND OWNER PAYS 60% OF $30.00 = $18.00". */
export function PriceReceipt({ original, pct, price, ownerAfter, className, stamp }: PriceReceiptProps) {
  return (
    <div className={`rcpt ${className ?? ""}`.trim()} style={{ padding: 0, background: "transparent" }}>
      <div className="rcpt__shadow" style={{ clipPath: CLIP }} aria-hidden />
      <div className="rcpt__paper" style={{ clipPath: CLIP }}>
        <div className="rcpt__line">
          <span>ORIGINAL</span>
          <span className="rcpt__dots">....................................</span>
          <span>{formatCents(original)}</span>
        </div>
        <div className="rcpt__line">
          <span>{ORD[ownerAfter]} OWNER PAYS</span>
          <span className="rcpt__dots">....................................</span>
          <span>{pct}%</span>
        </div>
        <div className="rcpt__rule" />
        <div className="rcpt__total">
          <span>= {ORD[ownerAfter]} OWNER PRICE</span>
          <span className="rcpt__price">{formatCents(price)}</span>
        </div>
        {stamp && <div className="rcpt__stamp">{stamp}</div>}
      </div>
    </div>
  );
}
