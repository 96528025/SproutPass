// (C) match.c-stub.ts — STAND-IN for B's `_lib/match.ts`, used only until B's
// real file lands. Same exported signatures as agreed in NEEDS.md:
//
//   findMatches(db, {buyerId, sellerId}) → LocalMatch[]   (ranked best first)
//   predictOutgrow(item, child, now)     → Date
//
// If `_lib/match.ts` is missing when you deploy:  cp match.c-stub.ts match.ts
// Pricing here is the contract's 60/40 rule, but B's priceFor() is the only
// implementation that counts; this stub only ranks and explains.

// deno-lint-ignore-file no-explicit-any

export interface LocalMatch {
  listingId: string;
  itemId: string;
  itemName: string;
  size: string;
  category: string;
  priceCents: number;
  condition: string;
  wearWeeksLeft?: number;
  reason: string;
}

export const SIZE_RANGES: Record<string, { minMonths: number; maxMonths: number }> = {
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

const COND_RANK: Record<string, number> = { like_new: 0, gently_used: 1, well_loved: 2 };

/** Child passes size.maxMonths, minus 2 weeks, never before purchase. */
export function predictOutgrow(item: any, child: any, _now: Date = new Date()): Date {
  const r = SIZE_RANGES[item.size] ?? { maxMonths: 12 };
  const birth = new Date(child.birthDate);
  const d = new Date(birth);
  d.setMonth(d.getMonth() + r.maxMonths);
  d.setDate(d.getDate() - 14);
  const bought = new Date(item.originalPurchaseDate ?? 0);
  return d < bought ? bought : d;
}

export async function findMatches(db: any, q: { buyerId: string; sellerId: string }): Promise<LocalMatch[]> {
  const needs: any[] = (await db.Need.filter({ parentId: q.buyerId })).filter((n: any) => n.shared);
  if (!needs.length) return [];
  const listings: any[] = (await db.Listing.filter({ sellerId: q.sellerId, status: "active" })).filter((l: any) => l.shared);
  const setting = (await db.Setting.filter({ key: "demo" }, undefined, 1))?.[0];
  const now = new Date(setting?.now ?? Date.now());
  const out: LocalMatch[] = [];
  for (const l of listings) {
    const item = await db.ClothingItem.get(l.itemId).catch(() => null);
    if (!item || item.ownerCount >= 3 || item.status !== "listed") continue;
    for (const n of needs) {
      if (!n.sizes?.includes(item.size)) continue;
      if (n.categories?.length && !n.categories.includes(item.category)) continue;
      if (n.maxPriceCents != null && l.priceCents > n.maxPriceCents) continue;
      let wearWeeksLeft: number | undefined;
      const child = n.childId ? await db.Child.get(n.childId).catch(() => null) : null;
      if (child) {
        const until = predictOutgrow(item, child, now);
        wearWeeksLeft = Math.max(0, Math.round((until.getTime() - now.getTime()) / (7 * 86_400_000)));
      }
      out.push({
        listingId: l.id,
        itemId: item.id,
        itemName: item.name,
        size: item.size,
        category: item.category,
        priceCents: l.priceCents,
        condition: l.condition,
        wearWeeksLeft,
        reason: `${item.size} is on the wish list${wearWeeksLeft != null ? ` and fits for ~${wearWeeksLeft} more weeks` : ""}.`,
      });
      break;
    }
  }
  // rank: size match (all equal here) → condition → newest listing
  return out.sort((a, b) => (COND_RANK[a.condition] ?? 9) - (COND_RANK[b.condition] ?? 9));
}
