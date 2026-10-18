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

const CONDITION_RANK = { like_new: 3, gently_used: 2, well_loved: 1 } as const;

/** All eligible (listing, need) pairs, best first. TODO(B1): tune ranking; eval table in match.test.ts. */
export function findMatches(input: FindMatchesInput): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  for (const listing of input.listings) {
    const item = input.items.find((i) => i.id === listing.itemId);
    if (!item) continue;
    for (const need of input.needs) {
      const child = input.buyerChildren.find((c) => c.id === need.childId);
      if (!child) continue;
      const e = checkEligibility({ listing, item, need, buyerChild: child, buyerId: input.buyerId, now: input.now });
      if (!e.ok) continue;
      const score = e.wearWeeksLeft * 10 + CONDITION_RANK[listing.condition] * 3 + new Date(listing.createdAt).getTime() / 1e13;
      out.push({ listingId: listing.id, needId: need.id, score, wearWeeksLeft: e.wearWeeksLeft,
        reason: reasonLine(input.buyerName, item, e.wearWeeksLeft) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** "Jo's little one needs 6-9M, and this romper fits for about 4 more weeks." TODO(B1): nicer variants. */
export function reasonLine(buyerName: string, item: Pick<ClothingItem, "name" | "size">, weeks: number): string {
  const fit = weeks >= 1 ? `fits for about ${weeks} more week${weeks === 1 ? "" : "s"}` : "fits right now";
  return `${buyerName}'s little one needs ${item.size}, and the ${item.name.toLowerCase()} ${fit}.`;
}
