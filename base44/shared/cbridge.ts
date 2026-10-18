// C ↔ B bridge. C's agents and Deno helpers were written against the contract in C's NEEDS.md;
// this file serves that contract from B's real handlers, in-process (no HTTP hop, no agent-key
// round trip, half the rate-limit cost). Pure: no npm:/base44: imports, so vitest covers it.
import type {
  AgentNudge, Child, ClothingItem, CreateProposalReq, DecideProposalReq, ID, ListItemReq,
  PayProposalReq, RecordPurchaseReq, ResolveNudgeReq, UpsertNeedReq, WithdrawListingReq,
} from "./types.ts";
import type { Db } from "./db.ts";
import { getNow } from "./db.ts";
import { HttpError } from "./errors.ts";
import { findMatches as rankMatches } from "./match.ts";
import { predictOutgrow as predictOutgrowIso } from "./sizes.ts";
import {
  getCloset, listItem, recordPurchase, resolveNudge, upsertNeed, withdrawListing, withRetry,
} from "./logic/closet.ts";
import { createProposal, decideProposal, payProposal } from "./logic/trade.ts";

// deno-lint-ignore no-explicit-any
type Args = Record<string, any>;

/** C sends `sellerId` (listItem) where B takes the caller as `parentId`. */
function withParent(args: Args): Args {
  if (args.parentId || args.parentKey) return args;
  return args.sellerId ? { ...args, parentId: args.sellerId } : args;
}

/** C's nudge answers ("sell" | "keep" | "later") → B's actions ("sell" | "keep" | "snooze"). */
const NUDGE_ACTION: Record<string, ResolveNudgeReq["action"]> = { sell: "sell", keep: "keep", later: "snooze", snooze: "snooze" };

export const B_ACTIONS = [
  "getCloset", "listItem", "resolveNudge", "decideProposal", "payProposal", "withdrawListing", "upsertNeed",
  "recordPurchase", "createProposal",
] as const;
export type BAction = (typeof B_ACTIONS)[number];

/**
 * Run one of B's handlers with C-style args. Errors keep B's HTTP status (C's `handle()` reads `.status`)
 * and say which call failed, e.g. "listItem: not_resellable: Final home: …".
 */
export async function callB(rawDb: unknown, name: string, rawArgs: Args = {}): Promise<unknown> {
  const db = withRetry(rawDb as Db);
  const args = withParent(rawArgs);
  try {
    switch (name as BAction) {
      case "getCloset": {
        const view = await getCloset(db, args);
        // C reads child.ageMonths; B returns it as childAgeMonths. Serve both.
        return { ...view, child: view.child ? { ...view.child, ageMonths: view.childAgeMonths } : null };
      }
      case "listItem": {
        const photo = args.photo ?? args.photos?.[0] ?? (await db.ClothingItem.get(args.itemId).catch(() => null))?.photos?.[0];
        const listing = await listItem(db, { ...args, photo } as ListItemReq);
        const item = await db.ClothingItem.get(listing.itemId);
        return { ...listing, listing, item };   // B's Listing at the top level, plus C's { listing, item }
      }
      case "resolveNudge": {
        const action = NUDGE_ACTION[String(args.action ?? args.decision)];
        if (!action) throw new HttpError("bad_request", `unknown nudge answer '${args.action ?? args.decision}'`, 400);
        let parentId = args.parentId;
        if (!parentId && !args.parentKey) parentId = (await db.AgentNudge.get(args.nudgeId).catch(() => null) as AgentNudge | null)?.parentId;
        return await resolveNudge(db, { ...args, parentId, action } as ResolveNudgeReq);
      }
      case "decideProposal": return await decideProposal(db, args as DecideProposalReq);
      case "payProposal": return await payProposal(db, args as PayProposalReq, { delayMs: 1000 });
      case "withdrawListing": return await withdrawListing(db, args as WithdrawListingReq);
      case "upsertNeed": return await upsertNeed(db, args as UpsertNeedReq);
      case "recordPurchase": return await recordPurchase(db, args as RecordPurchaseReq);
      case "createProposal": {
        const { sellerId: _seller, action: _action, ...req } = rawArgs;   // B derives the seller from the listing
        return await createProposal(db, { source: "fetch", ...req } as CreateProposalReq);
      }
      default:
        throw new HttpError("bad_request", `unknown B action '${name}'`, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) throw new HttpError(e.code, `${name}: ${e.code}: ${e.message}`, e.status);
    throw e;
  }
}

/** One match as C's local fallback and agents expect it (NEEDS.md "LocalMatch"). */
export interface LocalMatch {
  listingId: ID; itemId: ID; itemName: string; size: string; category: string;
  priceCents: number; condition: string; wearWeeksLeft?: number; reason: string;
}

/** C's `findMatches(db, {buyerId, sellerId})`: B's ranking (checkEligibility rules) over live rows. */
export async function findMatches(rawDb: unknown, q: { buyerId: ID; sellerId: ID }): Promise<LocalMatch[]> {
  const db = withRetry(rawDb as Db);
  const [listings, needs, buyerChildren, buyer, now] = await Promise.all([
    db.Listing.filter({ sellerId: q.sellerId, status: "active" }),
    db.Need.filter({ parentId: q.buyerId }),
    db.Child.filter({ parentId: q.buyerId }),
    db.Parent.get(q.buyerId).catch(() => null),
    getNow(db),
  ]);
  const items = (await Promise.all(listings.map((l) => db.ClothingItem.get(l.itemId).catch(() => null))))
    .filter((i): i is ClothingItem => i !== null);
  const ranked = rankMatches({ listings, items, needs, buyerChildren, buyerId: q.buyerId, buyerName: buyer?.name ?? "A friend", now });
  return ranked.map((m) => {
    const listing = listings.find((l) => l.id === m.listingId)!;
    const item = items.find((i) => i.id === listing.itemId)!;
    return {
      listingId: listing.id, itemId: item.id, itemName: item.name, size: item.size, category: item.category,
      priceCents: listing.priceCents, condition: listing.condition, wearWeeksLeft: m.wearWeeksLeft, reason: m.reason,
    };
  });
}

/** C's `predictOutgrow(item, child, now) → Date`: B's size table, never earlier than `now`. */
export function predictOutgrow(item: Pick<ClothingItem, "size">, child: Pick<Child, "birthDate">, now: Date = new Date()): Date {
  return new Date(predictOutgrowIso(item.size, child.birthDate, now.toISOString()));
}
