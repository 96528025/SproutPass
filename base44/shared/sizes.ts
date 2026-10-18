// Size ranges and outgrow prediction. Pure TS: no npm:/base44: imports.
import type { ISODate, SizeLabel } from "./types.ts";

export const SIZE_RANGES: Record<SizeLabel, { minMonths: number; maxMonths: number }> = {
  "unknown": { minMonths: 0, maxMonths: 0 },
  "0-3M": { minMonths: 0, maxMonths: 3 },
  "3-6M": { minMonths: 3, maxMonths: 6 },
  "6-9M": { minMonths: 6, maxMonths: 9 },
  "9-12M": { minMonths: 9, maxMonths: 12 },
  "12-18M": { minMonths: 12, maxMonths: 18 },
  "18-24M": { minMonths: 18, maxMonths: 24 },
  "2T": { minMonths: 24, maxMonths: 36 },
  "3T": { minMonths: 36, maxMonths: 48 },
  "4T": { minMonths: 48, maxMonths: 60 },
};

export const SIZE_ORDER: SizeLabel[] = ["0-3M", "3-6M", "6-9M", "9-12M", "12-18M", "18-24M", "2T", "3T", "4T"];
export const OUTGROW_BUFFER_DAYS = 14;
const DAY_MS = 86_400_000;

/** Add whole calendar months in UTC, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsUTC(iso: ISODate, months: number): Date {
  const d = new Date(iso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** Completed months of age at `now` (integer, floor). */
export function ageInMonths(birthDate: ISODate, now: ISODate): number {
  const b = new Date(birthDate), n = new Date(now);
  let months = (n.getUTCFullYear() - b.getUTCFullYear()) * 12 + (n.getUTCMonth() - b.getUTCMonth());
  if (n.getUTCDate() < b.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Date the child is predicted to outgrow `size`:
 * birthDate + size.maxMonths − 14 days, never earlier than the purchase/ownership start.
 * Seed checks: romper 6-9M for a child born 2025-12-10 → 2026-08-27; born 2026-03-01 → 2026-11-17.
 */
export function predictOutgrow(size: SizeLabel, birthDate: ISODate, notBefore: ISODate): ISODate {
  const outgrow = addMonthsUTC(birthDate, SIZE_RANGES[size].maxMonths).getTime() - OUTGROW_BUFFER_DAYS * DAY_MS;
  const floor = new Date(notBefore).getTime();
  return new Date(Math.max(outgrow, floor)).toISOString();
}

/** Whole weeks from `now` until the predicted outgrow date (0 if already past). */
export function wearWeeksLeft(size: SizeLabel, birthDate: ISODate, now: ISODate): number {
  const until = new Date(predictOutgrow(size, birthDate, now)).getTime() - new Date(now).getTime();
  return Math.max(0, Math.floor(until / (7 * DAY_MS)));
}

/** True if a child of this age currently fits the size range (inclusive min, exclusive max). */
export function fitsNow(size: SizeLabel, birthDate: ISODate, now: ISODate): boolean {
  if (size === "unknown") return false;
  const age = ageInMonths(birthDate, now);
  const r = SIZE_RANGES[size];
  return age >= r.minMonths - 1 && age < r.maxMonths;   // allow sizing up one month early
}
