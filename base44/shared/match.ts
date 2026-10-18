// Matching rules. Used by B3 (createProposal validation) and C (local fallback).
// STATUS: eligibility is complete; ranking + reason wording are B1's to harden and test.
// Pure TS: no npm:/base44: imports.
import type { Child, ClothingItem, ID, ISODate, Listing, Need } from "./types.ts";
import { canResell } from "./pricing.ts";
import { fitsNow, wearWeeksLeft } from "./sizes.ts";

export type Eligibility = { ok: true; wearWeeksLeft: number } | { ok: false; reason: string };

export interface EligibilityInput {
  listing: Listing; item: ClothingItem; need: Need; buyerChild: Child; buyerId: ID; now: ISODate;
}

/** Every rule a proposal must satisfy (rule 1–3). The server re-checks this; agents never decide. */
export function checkEligibility({ listing, item, need, buyerChild, buyerId, now }: EligibilityInput): Eligibility {
  if (listing.status !== "active") return { ok: false, reason: "listing not active" };
  if (!listing.shared) return { ok: false, reason: "listing not shared" };
  if (!need.shared) return { ok: false, reason: "need not shared" };
  if (listing.sellerId === buyerId) return { ok: false, reason: "own listing" };
  if (need.parentId !== buyerId) return { ok: false, reason: "need belongs to someone else" };
  if (!canResell(item)) return { ok: false, reason: "item already has 3 owners" };
  if (item.status !== "listed") return { ok: false, reason: "item not listed" };
  if (!need.sizes.includes(item.size)) return { ok: false, reason: "size not in need" };
  if (need.categories?.length && !need.categories.includes(item.category)) return { ok: false, reason: "category not wanted" };
  if (need.maxPriceCents != null && listing.priceCents > need.maxPriceCents) return { ok: false, reason: "over max price" };
  if (!fitsNow(item.size, buyerChild.birthDate, now)) return { ok: false, reason: "child doesn't fit this size now" };
  return { ok: true, wearWeeksLeft: wearWeeksLeft(item.size, buyerChild.birthDate, now) };
}

export interface MatchCandidate {
  listingId: ID; needId: ID; score: number; reason: string; wearWeeksLeft: number;
}

export interface FindMatchesInput {
  listings: Listing[];          // seller's listings
  items: ClothingItem[];        // items for those listings
  needs: Need[];                // buyer's needs
  buyerChildren: Child[];
  buyerId: ID;
  buyerName: string;
  now: ISODate;
}

export const CONDITION_RANK = { like_new: 3, gently_used: 2, well_loved: 1 } as const;

/**
 * All eligible listings for the buyer, best first: more wear weeks left > better condition > newer listing
 * (listingId breaks exact ties so the order is stable). One candidate per listing: the buyer's first need
 * (in `needs` order) that passes checkEligibility. `score` mirrors the first two keys for display/logging.
 */
export function findMatches(input: FindMatchesInput): MatchCandidate[] {
  const out: (MatchCandidate & { condition: number; createdAt: number })[] = [];
  for (const listing of input.listings) {
    const item = input.items.find((i) => i.id === listing.itemId);
    if (!item) continue;
    for (const need of input.needs) {
      const child = input.buyerChildren.find((c) => c.id === need.childId);
      if (!child) continue;
      const e = checkEligibility({ listing, item, need, buyerChild: child, buyerId: input.buyerId, now: input.now });
      if (!e.ok) continue;
      const condition = CONDITION_RANK[listing.condition] ?? 0;
      out.push({ listingId: listing.id, needId: need.id, score: e.wearWeeksLeft * 10 + condition, wearWeeksLeft: e.wearWeeksLeft,
        reason: reasonLine(input.buyerName, item, e.wearWeeksLeft), condition, createdAt: new Date(listing.createdAt).getTime() || 0 });
      break;
    }
  }
  out.sort((a, b) => b.wearWeeksLeft - a.wearWeeksLeft || b.condition - a.condition || b.createdAt - a.createdAt ||
    (a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0));
  return out.map(({ condition: _c, createdAt: _t, ...m }) => m);
}

/** Small stable string hash (FNV-1a) so wording varies by match but never between calls. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * One plain sentence for the Trade window and both agents, e.g.
 * "Jo's little one needs 6-9M, and the yellow duck romper fits for about 4 more weeks."
 * Deterministic: the variant is picked by hashing (buyer, item, size, weeks).
 */
export function reasonLine(buyerName: string, item: Pick<ClothingItem, "name" | "size">, weeks: number): string {
  const name = item.name.trim().toLowerCase();
  const fit = weeks >= 1 ? `fits for about ${weeks} more week${weeks === 1 ? "" : "s"}` : "fits right now";
  const variants = [
    `${buyerName}'s little one needs ${item.size}, and the ${name} ${fit}.`,
    `${buyerName} is looking for ${item.size}, and the ${name} ${fit}.`,
    `The ${name} is ${item.size}, just what ${buyerName} asked for, and it ${fit}.`,
    `Good timing for ${buyerName}: the ${name} is ${item.size} and ${fit}.`,
  ];
  return variants[hash(`${buyerName}|${name}|${item.size}|${weeks}`) % variants.length];
}
