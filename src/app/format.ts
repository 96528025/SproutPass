// OWNER: B4. Display helpers (dates are UTC so the demo clock reads the same everywhere).
import type { ClothingItem, ISODate } from "./types";

/** "SEP 20, 2026" */
export const shortDate = (iso: ISODate) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();

/** "MAY 15" */
export const monthDay = (iso: ISODate) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();

/** When the current owner got the item (their open ownership entry), else the first purchase. */
export function ownedSince(item: ClothingItem): ISODate {
  const open = [...item.ownershipHistory].reverse().find((h) => h.ownerId === item.currentOwnerId && !h.to);
  return open?.from ?? item.originalPurchaseDate;
}

export const CONDITIONS = [
  { value: "like_new", label: "LIKE NEW", stars: "★★★" },
  { value: "gently_used", label: "GENTLY USED", stars: "★★☆" },
  { value: "well_loved", label: "WELL LOVED", stars: "★☆☆" },
] as const;
