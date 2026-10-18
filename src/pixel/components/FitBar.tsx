import "./kit.css";

export interface FitBarProps {
  /** Predicted outgrow date. */
  until: Date | string;
  /** Demo clock "now". */
  now: Date | string;
  /** Purchase date; defaults to now - 120 days. */
  from?: Date | string;
  className?: string;
}

const DAY = 86_400_000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function toDate(d: Date | string): Date {
  if (d instanceof Date) return d;
  // date-only strings are local days, not UTC midnight (otherwise "2026-08-27" shows as AUG 26 in PT)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(d);
}

export function formatShort(d: Date | string): string {
  const x = toDate(d);
  return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
}

/** Pixel progress bar: "FITS UNTIL ~AUG 27". Gold within 14 days of `until`, red past it. */
export function FitBar({ until, now, from, className }: FitBarProps) {
  const u = toDate(until).getTime();
  const n = toDate(now).getTime();
  const f = from ? toDate(from).getTime() : n - 120 * DAY;
  const span = Math.max(u - f, DAY);
  const raw = (n - f) / span;
  const pct = Math.min(1, Math.max(0, raw));
  const snapped = Math.round(pct * 12) / 12; // 12 segments
  const daysLeft = Math.ceil((u - n) / DAY);
  const state = daysLeft < 0 ? "past" : daysLeft <= 14 ? "soon" : "ok";
  const right =
    state === "past" ? `${Math.abs(daysLeft)}D OVER` : daysLeft === 0 ? "TODAY" : `${daysLeft}D LEFT`;

  return (
    <div className={`fit fit--${state} ${className ?? ""}`.trim()}>
      <div className="fit__row">
        <span>{state === "past" ? "PROBABLY OUTGROWN" : `FITS UNTIL ~${formatShort(until)}`}</span>
        <span>{right}</span>
      </div>
      <div className="fit__track" role="progressbar" aria-valuenow={Math.round(pct * 100)}>
        <div
          className={`fit__fill ${state === "soon" ? "fit__fill--soon" : state === "past" ? "fit__fill--past" : ""}`}
          style={{ width: `${snapped * 100}%` }}
        />
        <div className="fit__ticks" />
      </div>
    </div>
  );
}
