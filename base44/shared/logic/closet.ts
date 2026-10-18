// OWNER: B2. Handlers for closet functions. Pure TS (no npm:/base44: imports) so tests, selfTest and the
// frontend mock can run them on fakeDb. Each Base44 function's entry.ts is: export default wrap(handler).
import type { Db } from "../db.ts";
import { getNow, mustGet, publicParent, resolveParent } from "../db.ts";
import { bad, forbidden, HttpError, invalid } from "../errors.ts";
import { canResell, priceFor } from "../pricing.ts";
import { ageInMonths, predictOutgrow, SIZE_ORDER, SIZE_RANGES } from "../sizes.ts";
import type {
  Category, Child, ClosetView, ClothingItem, Condition, ID, Listing, ListItemReq, MatchProposal, Need, ParentRef,
  ProposalStatus, RecordPurchaseReq, ResolveNudgeReq, ResolveNudgeRes, SizeLabel, UpsertNeedReq, WithdrawListingReq,
} from "../types.ts";

const CATEGORIES: Category[] = ["top", "bottom", "onesie", "outerwear", "dress", "set", "other"];
const CONDITIONS: Condition[] = ["like_new", "gently_used", "well_loved"];
const OPEN_PROPOSAL: ProposalStatus[] = ["open", "both_accepted"];
const RECENT_TERMINAL = 5;
const MANY = 1000; // explicit page size: real Base44 pages list()/filter()

const isSize = (s: unknown): s is SizeLabel => typeof s === "string" && s in SIZE_RANGES;
const isDate = (s: unknown) => typeof s === "string" && !Number.isNaN(new Date(s).getTime());
/**
 * Chronological sort. createdAt is the demo clock, so every row made at "Oct 18 17:00" ties: break ties by the real
 * Base44 created_date, then by list position (fakeDb keeps insertion order). dir 1 = oldest first, -1 = newest first.
 */
function chrono<T extends { createdAt: string }>(rows: T[], dir: 1 | -1): T[] {
  const real = (r: T) => (r as T & { created_date?: string }).created_date ?? "";
  return rows.map((r, i) => ({ r, i }))
    .sort((a, b) => dir * (a.r.createdAt.localeCompare(b.r.createdAt) || real(a.r).localeCompare(real(b.r)) || a.i - b.i))
    .map((x) => x.r);
}
/** Base44 adds created_date; fakeDb doesn't. Oldest first, id as tiebreak. */
const byRowAge = (a: { id: ID; created_date?: string }, b: { id: ID; created_date?: string }) =>
  (a.created_date ?? "").localeCompare(b.created_date ?? "") || a.id.localeCompare(b.id);

/** The parent's first child (oldest), or the given childId if it belongs to the parent. */
export async function childOf(db: Db, parentId: ID, childId?: ID): Promise<Child | null> {
  if (childId) {
    const c = await mustGet(db.Child, childId, "child");
    if (c.parentId !== parentId) throw forbidden("that child belongs to another parent");
    return c;
  }
  const kids = await db.Child.filter({ parentId });
  kids.sort((a, b) => a.birthDate.localeCompare(b.birthDate) || a.id.localeCompare(b.id));
  return kids[0] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimited = (e: unknown) => {
  const err = e as { status?: number; response?: { status?: number }; message?: unknown } | null;
  return err?.status === 429 || err?.response?.status === 429 || /rate limit/i.test(String(err?.message ?? ""));
};

/**
 * Wrap the service-role entities so a call rejected by Base44's per-app rate limit is retried with backoff
 * (a 429 means nothing was written, so retrying a create is safe). entry.ts: wrap((db, b) => fn(withRetry(db), b)).
 */
export function withRetry<D extends object>(db: D, delaysMs: number[] = [400, 900, 1800, 3500, 5000]): D {
  const apis = new Map<PropertyKey, unknown>();
  const wrapApi = (api: Record<PropertyKey, unknown>) => new Proxy(api, {
    get(target, key) {
      const v = target[key];
      if (typeof v !== "function") return v;
      return async (...args: unknown[]) => {
        for (let attempt = 0; ; attempt++) {
          try { return await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args); }
          catch (e) {
            if (!isRateLimited(e) || attempt >= delaysMs.length) throw e;
            await sleep(delaysMs[attempt] + Math.floor(Math.random() * 200));
          }
        }
      };
    },
  });
  return new Proxy(db, {
    get(target, key) {
      const v = (target as Record<PropertyKey, unknown>)[key];
      if (!v || typeof v !== "object") return v;
      if (!apis.has(key)) apis.set(key, wrapApi(v as Record<PropertyKey, unknown>));
      return apis.get(key);
    },
  });
}

export async function getCloset(db: Db, body: ParentRef): Promise<ClosetView> {
  const parent = await resolveParent(db, body ?? {});
  // One read per entity, in parallel: keeps the call cheap under Base44's per-app rate limit.
  const [now, kids, allItems, listingRows, needRows, nudgeRows, allProposals] = await Promise.all([
    getNow(db),
    db.Child.filter({ parentId: parent.id }),
    db.ClothingItem.list(undefined, MANY),
    db.Listing.filter({ sellerId: parent.id }, undefined, MANY),
    db.Need.filter({ parentId: parent.id }, undefined, MANY),
    db.AgentNudge.filter({ parentId: parent.id }, undefined, MANY),
    db.MatchProposal.list(undefined, MANY),
  ]);
  kids.sort((a, b) => a.birthDate.localeCompare(b.birthDate) || a.id.localeCompare(b.id));
  const child = kids[0] ?? null;

  const items = allItems.filter((i) => i.currentOwnerId === parent.id && i.status !== "transferred_out");
  const passedOn = allItems.filter((i) => i.currentOwnerId !== parent.id &&
    (i.ownershipHistory ?? []).some((h) => h.ownerId === parent.id && h.to));
  const listings = chrono(listingRows, -1);
  const needs = chrono(needRows, 1);
  const nudges = chrono(nudgeRows.filter((n) => !n.resolved), 1);

  const mine = chrono(allProposals.filter((p) => p.buyerId === parent.id || p.sellerId === parent.id), -1);
  const recentDone = new Set(mine.filter((p) => !OPEN_PROPOSAL.includes(p.status)).slice(0, RECENT_TERMINAL));
  const proposals = mine.filter((p) => OPEN_PROPOSAL.includes(p.status) || recentDone.has(p));   // keeps newest-first order

  return {
    now,
    parent: publicParent(parent),
    child,
    childAgeMonths: child ? ageInMonths(child.birthDate, now) : null,
    items, passedOn, listings, needs, nudges, proposals,
  };
}

export async function recordPurchase(db: Db, body: RecordPurchaseReq): Promise<ClothingItem> {
  const parent = await resolveParent(db, body);
  if (typeof body.name !== "string" || !body.name.trim()) throw bad("name required");
  if (!CATEGORIES.includes(body.category)) throw bad(`unknown category '${body.category}'`);
  if (!isSize(body.size)) throw bad(`unknown size '${body.size}'`);
  if (!Number.isInteger(body.originalPriceCents) || body.originalPriceCents < 0) {
    throw bad("originalPriceCents must be a whole number of cents ≥ 0");
  }
  if (body.purchaseDate != null && !isDate(body.purchaseDate)) throw bad("purchaseDate must be an ISO date");
  const child = await childOf(db, parent.id, body.childId);
  if (!child) throw bad("add a child before recording a purchase");

  const bought = body.purchaseDate ? new Date(body.purchaseDate).toISOString() : await getNow(db);
  return db.ClothingItem.create({
    name: body.name.trim(),
    category: body.category,
    icon: body.icon || "item_tee",
    size: body.size,
    originalPriceCents: body.originalPriceCents,
    originalPurchaseDate: bought,
    ownerCount: 1,
    currentOwnerId: parent.id,
    childId: child.id,
    photos: body.photo ? [body.photo] : [],
    ownershipHistory: [{ ownerId: parent.id, from: bought }],
    predictedOutgrowDate: predictOutgrow(body.size, child.birthDate, bought),
    status: "in_closet",
  });
}

/** Resolve this owner's open outgrow_check nudges for an item (it's being listed). */
async function resolveOutgrowNudges(db: Db, parentId: ID, itemId: ID) {
  const open = (await db.AgentNudge.filter({ itemId, kind: "outgrow_check" }))
    .filter((n) => !n.resolved && n.parentId === parentId);
  for (const n of open) await db.AgentNudge.update(n.id, { resolved: true });
}

export async function listItem(db: Db, body: ListItemReq): Promise<Listing> {
  const parent = await resolveParent(db, body);
  const item = await mustGet(db.ClothingItem, body.itemId, "item");
  if (item.currentOwnerId !== parent.id || item.status === "transferred_out") throw forbidden("you don't own this item");
  if (item.size === "unknown" || item.photoMetadata?.priceConfirmed === false) {
    throw bad("Reply to your pet on iMessage with the size and original price before selling this item.");
  }
  const priceCents = priceFor(item);
  if (priceCents === null) throw new HttpError("not_resellable", "Final home: this item has had its 3 owners.", 409);
  if (!CONDITIONS.includes(body.condition)) throw bad(`unknown condition '${body.condition}'`);
  if (typeof body.photo !== "string" || !body.photo) throw bad("photo required");

  // Idempotent: an active listing already exists → return it (and repair the item if a write was lost).
  const active = (await db.Listing.filter({ itemId: item.id, status: "active" })).sort(byRowAge);
  if (active.length) {
    if (item.status === "in_closet") await db.ClothingItem.update(item.id, { status: "listed" });
    await resolveOutgrowNudges(db, parent.id, item.id);
    return active[0];
  }
  if (item.status !== "in_closet") throw invalid(`item is ${item.status}, not in the closet`);

  // Listing first: if the item update fails, a retry finds the listing and repairs the item.
  const created = await db.Listing.create({
    itemId: item.id, sellerId: parent.id, condition: body.condition,
    conditionNote: typeof body.conditionNote === "string" ? body.conditionNote.trim() : "",
    priceCents, shared: body.shared !== false, status: "active", createdAt: await getNow(db),
  });
  // Double-tap guard: if two calls raced, keep the oldest active listing and withdraw the rest.
  const raced = (await db.Listing.filter({ itemId: item.id, status: "active" })).sort(byRowAge);
  const keep = raced[0] ?? created;
  for (const extra of raced.slice(1)) await db.Listing.update(extra.id, { status: "withdrawn" });

  const photos = item.photos?.[0] === body.photo ? item.photos : [body.photo, ...(item.photos ?? [])];
  await db.ClothingItem.update(item.id, { status: "listed", photos });
  await resolveOutgrowNudges(db, parent.id, item.id);
  return keep.id === created.id ? created : keep;
}

export async function withdrawListing(db: Db, body: WithdrawListingReq): Promise<Listing> {
  const parent = await resolveParent(db, body);
  const listing = await mustGet(db.Listing, body.listingId, "listing");
  if (listing.sellerId !== parent.id) throw forbidden("only the seller can withdraw this listing");
  if (listing.status === "withdrawn") return listing;                       // idempotent
  if (listing.status !== "active") throw invalid(`listing is ${listing.status}`);

  const item = await mustGet(db.ClothingItem, listing.itemId, "item");
  const openProposals = (await db.MatchProposal.filter({ listingId: listing.id }))
    .filter((p) => OPEN_PROPOSAL.includes(p.status));
  if (item.status === "pending_trade" || openProposals.length) {
    throw invalid("This item is in a trade now. Open the trade to decline it first.");
  }
  // Item first: an active listing whose item is in_closet can't be proposed, so a failed second write is safe.
  if (item.status === "listed") await db.ClothingItem.update(item.id, { status: "in_closet" });
  return db.Listing.update(listing.id, { status: "withdrawn" });
}

export async function upsertNeed(db: Db, body: UpsertNeedReq): Promise<Need> {
  const parent = await resolveParent(db, body);
  if (!Array.isArray(body.sizes) || !body.sizes.length) throw bad("pick at least one size");
  const badSize = body.sizes.find((s) => !isSize(s));
  if (badSize !== undefined) throw bad(`unknown size '${badSize}'`);
  if (body.categories != null) {
    if (!Array.isArray(body.categories)) throw bad("categories must be a list");
    const badCat = body.categories.find((c) => !CATEGORIES.includes(c));
    if (badCat !== undefined) throw bad(`unknown category '${badCat}'`);
  }
  if (body.maxPriceCents != null && (!Number.isInteger(body.maxPriceCents) || body.maxPriceCents < 0)) {
    throw bad("maxPriceCents must be a whole number of cents ≥ 0");
  }
  const sizes = SIZE_ORDER.filter((s) => body.sizes.includes(s));
  const categories = CATEGORIES.filter((c) => body.categories?.includes(c));

  if (body.needId) {
    const need = await mustGet(db.Need, body.needId, "need");
    if (need.parentId !== parent.id) throw forbidden("that need belongs to another parent");
    const child = body.childId ? await childOf(db, parent.id, body.childId) : null;
    return db.Need.update(need.id, {
      sizes, categories,
      // null clears a previous cap (checkEligibility treats null as "no cap")
      maxPriceCents: (body.maxPriceCents ?? null) as unknown as number,
      shared: typeof body.shared === "boolean" ? body.shared : need.shared,
      ...(child ? { childId: child.id } : {}),
    });
  }
  const child = await childOf(db, parent.id, body.childId);
  if (!child) throw bad("add a child before saving a need");
  return db.Need.create({
    parentId: parent.id, childId: child.id, sizes, categories,
    ...(body.maxPriceCents != null ? { maxPriceCents: body.maxPriceCents } : {}),
    shared: body.shared !== false, createdAt: await getNow(db),
  });
}

export async function resolveNudge(db: Db, body: ResolveNudgeReq): Promise<ResolveNudgeRes> {
  const parent = await resolveParent(db, body);
  if (!["sell", "keep", "snooze"].includes(body.action)) throw bad(`unknown action '${body.action}'`);
  const found = await mustGet(db.AgentNudge, body.nudgeId, "nudge");
  if (found.parentId !== parent.id) throw forbidden("that nudge belongs to another parent");
  const nudge = found.resolved ? found : await db.AgentNudge.update(found.id, { resolved: true });   // idempotent

  let sellable = false;
  if (body.action === "sell") {
    try {
      const item = await db.ClothingItem.get(nudge.itemId);
      sellable = canResell(item) && item.currentOwnerId === parent.id;
    } catch { sellable = false; }
  }
  return { nudge, next: sellable ? "open_listing" : "none", itemId: nudge.itemId };
}
