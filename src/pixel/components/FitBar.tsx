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
const MONTHS_READ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(d: Date | string): Date {
  if (d instanceof Date) return d;
  // date-only strings are local days, not UTC midnight (otherwise "2026-08-27" shows as AUG 26 in PT)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(d);
}

/** The local calendar day as a UTC timestamp, so day differences ignore DST shifts. */
function calendarDay(d: Date | string): number {
  const x = toDate(d);
  return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
}

/** "AUG 27" (uppercase, for pixel tags). */
export function formatShort(d: Date | string): string {
  const x = toDate(d);
  return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
}

/** "Aug 27" (sentence case, for readable text); "Nov 26, 2028" when `withYear`. */
function formatRead(d: Date | string, withYear = false): string {
  const x = toDate(d);
  const md = `${MONTHS_READ[x.getMonth()]} ${x.getDate()}`;
  return withYear ? `${md}, ${x.getFullYear()}` : md;
}

/** Past ~300 days a bare "Nov 26" reads as the next Nov 26, so the year must be shown. */
const YEAR_AFTER_DAYS = 300;

/** Pixel progress bar: "Fits until about Aug 27 · 104 days left". Gold within 14 days of `until`, red past it. */
export function FitBar({ until, now, from, className }: FitBarProps) {
  const u = toDate(until).getTime();
  const n = toDate(now).getTime();
  const f = from ? toDate(from).getTime() : n - 120 * DAY;
  const span = Math.max(u - f, DAY);
  const raw = (n - f) / span;
  const pct = Math.min(1, Math.max(0, raw));
  const snapped = Math.round(pct * 12) / 12; // 12 segments
  // Whole calendar days: raw ms / DAY over-counts by one when the span crosses a DST fall-back.
  const daysLeft = Math.round((calendarDay(until) - calendarDay(now)) / DAY);
  const state = daysLeft < 0 ? "past" : daysLeft <= 14 ? "soon" : "ok";
  const plural = (d: number) => (d === 1 ? "day" : "days");
  const right =
    state === "past"
      ? `${Math.abs(daysLeft)} ${plural(Math.abs(daysLeft))} over`
      : daysLeft === 0
        ? "Last day"
        : `${daysLeft} ${plural(daysLeft)} left`;
  const left = state === "past" ? "Probably outgrown" : `Fits until about ${formatRead(until, daysLeft > YEAR_AFTER_DAYS)}`;

  return (
    <div className={`fit fit--${state} ${className ?? ""}`.trim()}>
      <div className="fit__row">
        <span className="fit__when">{left}</span>
        <span className="fit__left">{right}</span>
      </div>
      <div className="fit__track" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}
        aria-label={`${left}, ${right}`}>
        <div
          className={`fit__fill ${state === "soon" ? "fit__fill--soon" : state === "past" ? "fit__fill--past" : ""}`}
          style={{ width: `${snapped * 100}%` }}
        />
        <div className="fit__ticks" />
      </div>
    </div>
  );
}
