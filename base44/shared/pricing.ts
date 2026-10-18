// The ONLY place price is computed (rule 2). Pure TS: no npm:/base44: imports.
import type { ClothingItem } from "./types.ts";

export const RESALE_PCT: Record<1 | 2, number> = { 1: 0.6, 2: 0.4 };
export const MAX_OWNERS = 3;

/** Price the next buyer pays, in cents. null when the item can't be resold (ownerCount 3). */
export function priceFor(item: Pick<ClothingItem, "ownerCount" | "originalPriceCents">): number | null {
  if (item.ownerCount >= MAX_OWNERS) return null;
  const pct = RESALE_PCT[item.ownerCount as 1 | 2];
  return Math.round(item.originalPriceCents * pct);
}

export function canResell(item: Pick<ClothingItem, "ownerCount">): boolean {
  return item.ownerCount < MAX_OWNERS;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const ORDINAL = ["", "1st", "2nd", "3rd"];

/** "2nd owner pays 60% of $30.00 = $18.00" */
export function priceRuleText(item: Pick<ClothingItem, "ownerCount" | "originalPriceCents">): string {
  const price = priceFor(item);
  if (price === null) return "Final home: this item has had its 3 owners.";
  const pct = Math.round(RESALE_PCT[item.ownerCount as 1 | 2] * 100);
  return `${ORDINAL[item.ownerCount + 1]} owner pays ${pct}% of ${formatCents(item.originalPriceCents)} = ${formatCents(price)}`;
}
