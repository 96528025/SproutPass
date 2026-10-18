// OWNER: B4. Starter mock: in-browser fakeDb seeded with the real seed plan, with simple handlers,
// so B5/A/C can build screens before the backend exists.
// B4 upgrades it: once B2/B3 merge, call their functions' logic.ts handlers here so the mock behaves
// exactly like the server.
import type { Api, EntityEvent } from "./api";
import { ApiError } from "./api";
import type { ClosetView, MatchProposal } from "./types";
import { createFakeDb } from "../../base44/shared/testing/fakeDb.ts";
import { applySeed, seedPlan, DEMO_DATES } from "../../base44/shared/seed.ts";
import { getNow, publicParent, resolveParent } from "../../base44/shared/db.ts";
import { priceFor } from "../../base44/shared/pricing.ts";
import { ageInMonths, predictOutgrow, wearWeeksLeft } from "../../base44/shared/sizes.ts";
import { nudgeMessage } from "../../base44/shared/nudges.ts";

const db = createFakeDb();
const ready = applySeed(db, seedPlan());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async <T>(fn: () => Promise<T>): Promise<T> => {
  await ready;
  await wait(120); // feel like a network
  try { return await fn(); } catch (e: any) { throw new ApiError(e?.code ?? "mock_error", e?.message ?? String(e)); }
};

async function closet(ref: { parentId?: string; parentKey?: string }): Promise<ClosetView> {
  const parent = await resolveParent(db, ref);
  const now = await getNow(db);
  const [child] = await db.Child.filter({ parentId: parent.id });
  const items = (await db.ClothingItem.filter({ currentOwnerId: parent.id })).filter((i) => i.status !== "transferred_out");
  const all = await db.ClothingItem.list();
  const passedOn = all.filter((i) => i.ownershipHistory.some((h) => h.ownerId === parent.id && h.to) && i.currentOwnerId !== parent.id);
  const proposals = (await db.MatchProposal.list("-createdAt")).filter((p) => p.buyerId === parent.id || p.sellerId === parent.id);
  return {
    now, parent: publicParent(parent), child: child ?? null,
    childAgeMonths: child ? ageInMonths(child.birthDate, now) : null,
    items, passedOn,
    listings: await db.Listing.filter({ sellerId: parent.id }),
    needs: await db.Need.filter({ parentId: parent.id }),
    nudges: (await db.AgentNudge.filter({ parentId: parent.id })).filter((n) => !n.resolved),
    proposals,
  };
}

/** Mock-only helpers for building screens without B1/C. Not part of Api. */
export const mockDev = {
  db,
  /** Create the demo proposal (Mina's romper → Jo) as if the agents had met. */
  async triggerEncounter(): Promise<MatchProposal | null> {
    await ready;
    const now = await getNow(db);
    const [jo] = await db.Parent.filter({ key: "jo" });
    const [joChild] = await db.Child.filter({ parentId: jo.id });
    const [listing] = await db.Listing.filter({ status: "active" });
    if (!listing) return null;
    const item = await db.ClothingItem.get(listing.itemId);
    await db.ClothingItem.update(item.id, { status: "pending_trade" });
    const weeks = wearWeeksLeft(item.size, joChild.birthDate, now);
    return db.MatchProposal.create({
      listingId: listing.id, itemId: item.id, sellerId: listing.sellerId, buyerId: jo.id,
      snapshot: { itemName: item.name, icon: item.icon, photo: item.photos[0] ?? "", size: item.size,
        originalPurchaseDate: item.originalPurchaseDate, originalPriceCents: item.originalPriceCents,
        condition: listing.condition, conditionNote: listing.conditionNote, previousOwners: item.ownerCount,
        priceCents: listing.priceCents, wearWeeksLeft: weeks },
      reason: `Jo's little one needs 6-9M, and the ${item.name.toLowerCase()} fits for about ${weeks} more weeks.`,
      transcript: [], source: "local", sellerDecision: "pending", buyerDecision: "pending", status: "open",
      handover: "now", createdAt: now, expiresAt: new Date(new Date(now).getTime() + 30 * 60_000).toISOString(),
    });
  },
};

export const mockApi: Api = {
  getCloset: (ref) => call(() => closet(ref)),

  recordPurchase: (req) => call(async () => {
    const parent = await resolveParent(db, req);
    const [child] = await db.Child.filter({ parentId: parent.id });
    const now = await getNow(db);
    const bought = req.purchaseDate ?? now;
    return db.ClothingItem.create({
      name: req.name, category: req.category, icon: req.icon, size: req.size,
      originalPriceCents: req.originalPriceCents, originalPurchaseDate: bought, ownerCount: 1,
      currentOwnerId: parent.id, childId: req.childId ?? child.id, photos: req.photo ? [req.photo] : [],
      ownershipHistory: [{ ownerId: parent.id, from: bought }],
      predictedOutgrowDate: predictOutgrow(req.size, child.birthDate, bought), status: "in_closet",
    });
  }),

  listItem: (req) => call(async () => {
    const parent = await resolveParent(db, req);
    const item = await db.ClothingItem.get(req.itemId);
    const price = priceFor(item);
    if (price === null) throw Object.assign(new Error("final home: can't resell"), { code: "not_resellable" });
    await db.ClothingItem.update(item.id, { status: "listed", photos: [req.photo, ...item.photos] });
    return db.Listing.create({ itemId: item.id, sellerId: parent.id, condition: req.condition,
      conditionNote: req.conditionNote, priceCents: price, shared: req.shared, status: "active", createdAt: await getNow(db) });
  }),

  withdrawListing: (req) => call(async () => {
    const l = await db.Listing.update(req.listingId, { status: "withdrawn" });
    await db.ClothingItem.update(l.itemId, { status: "in_closet" });
    return l;
  }),

  upsertNeed: (req) => call(async () => {
    const parent = await resolveParent(db, req);
    const [child] = await db.Child.filter({ parentId: parent.id });
    const data = { parentId: parent.id, childId: req.childId ?? child.id, sizes: req.sizes, categories: req.categories,
      maxPriceCents: req.maxPriceCents, shared: req.shared, createdAt: await getNow(db) };
    return req.needId ? db.Need.update(req.needId, data) : db.Need.create(data);
  }),

  resolveNudge: (req) => call(async () => {
    const nudge = await db.AgentNudge.update(req.nudgeId, { resolved: true });
    return { nudge, next: req.action === "sell" ? "open_listing" : "none", itemId: nudge.itemId };
  }),

  decideProposal: (req) => call(async () => {
    const parent = await resolveParent(db, req);
    const p = await db.MatchProposal.get(req.proposalId);
    if (p.status !== "open") throw Object.assign(new Error(`proposal is ${p.status}`), { code: "invalid_transition" });
    const side = parent.id === p.sellerId ? "sellerDecision" : "buyerDecision";
    const next: Partial<MatchProposal> = { [side]: req.decision, handover: req.handover ?? p.handover, handoverNote: req.handoverNote };
    const s = side === "sellerDecision" ? req.decision : p.sellerDecision;
    const b = side === "buyerDecision" ? req.decision : p.buyerDecision;
    if (req.decision === "declined") {
      next.status = "declined";
      await db.ClothingItem.update(p.itemId, { status: "listed" });
    } else if (s === "accepted" && b === "accepted") next.status = "both_accepted";
    return db.MatchProposal.update(p.id, next);
  }),

  payProposal: (req) => call(async () => {
    await wait(1000);
    const p = await db.MatchProposal.get(req.proposalId);
    if (p.status !== "both_accepted") throw Object.assign(new Error("both must accept first"), { code: "invalid_transition" });
    if (req.fail) {
      await db.ClothingItem.update(p.itemId, { status: "listed" });
      const proposal = await db.MatchProposal.update(p.id, { status: "payment_failed" });
      return { proposal, item: await db.ClothingItem.get(p.itemId) };
    }
    const now = await getNow(db);
    const item = await db.ClothingItem.get(p.itemId);
    const [buyerChild] = await db.Child.filter({ parentId: p.buyerId });
    const history = item.ownershipHistory.map((h) => (h.ownerId === p.sellerId && !h.to ? { ...h, to: now } : h));
    history.push({ ownerId: p.buyerId, from: now, priceCents: p.snapshot.priceCents });
    const moved = await db.ClothingItem.update(item.id, {
      ownerCount: (item.ownerCount + 1) as 1 | 2 | 3, currentOwnerId: p.buyerId, childId: buyerChild.id,
      ownershipHistory: history, status: "in_closet",
      predictedOutgrowDate: predictOutgrow(item.size, buyerChild.birthDate, now),
    });
    await db.Listing.update(p.listingId, { status: "sold" });
    const proposal = await db.MatchProposal.update(p.id, { status: "paid", paymentRef: `DEMO-${p.id.slice(-6)}` });
    const buyer = await db.Parent.get(p.buyerId);
    await db.AgentNudge.create({ parentId: p.buyerId, itemId: item.id, kind: "new_owner_welcome",
      message: nudgeMessage("new_owner_welcome", { itemName: item.name, size: item.size, petName: buyer.pet.name }),
      createdAt: now, resolved: false });
    return { proposal, item: moved };
  }),

  demoClock: (req) => call(async () => {
    const [s] = await db.Setting.filter({ key: "demo" });
    if (req?.now) await db.Setting.update(s.id, { now: req.now });
    const now = req?.now ?? s.now;
    let nudgesCreated = 0;
    if (new Date(now) >= new Date(DEMO_DATES.nudge)) {           // stand-in for scanForNudges until B1 lands
      for (const item of await db.ClothingItem.filter({ status: "in_closet" })) {
        if (item.ownerCount >= 3 || !item.predictedOutgrowDate) continue;
        if (new Date(now).getTime() < new Date(item.predictedOutgrowDate).getTime() - 14 * 86_400_000) continue;
        const open = await db.AgentNudge.filter({ itemId: item.id, kind: "outgrow_check" });
        if (open.length) continue;
        const owner = await db.Parent.get(item.currentOwnerId);
        await db.AgentNudge.create({ parentId: owner.id, itemId: item.id, kind: "outgrow_check",
          message: nudgeMessage("outgrow_check", { itemName: item.name, size: item.size, petName: owner.pet.name }),
          createdAt: now, resolved: false });
        nudgesCreated++;
      }
    }
    return { now, nudgesCreated };
  }),

  demoReset: () => call(async () => { await applySeed(db, seedPlan()); return { ok: true as const }; }),

  getStats: () => call(async () => ({
    secondsToList: [], encounters: 0,
    proposals: (await db.MatchProposal.list()).length,
    trades: (await db.MatchProposal.filter({ status: "paid" })).length,
    declinedWithZeroCharge: (await db.MatchProposal.filter({ status: "declined" })).length,
    items: (await db.ClothingItem.list()).map((i) => ({ itemId: i.id, name: i.name, icon: i.icon, ownerCount: i.ownerCount,
      chain: i.ownershipHistory.map((h) => ({ ownerName: h.ownerId, from: h.from, to: h.to, priceCents: h.priceCents })) })),
  })),

  selfTest: () => call(async () => ({ results: [], passed: 0, failed: 0 })),

  suggestCondition: () => call(async () => ({ condition: "gently_used" as const, note: "Light pilling on the cuffs" })),

  uploadPhoto: async (file) => ({ url: URL.createObjectURL(file) }),

  subscribe: (entity, cb) => db._on((e) => { if (e.entity === entity) cb({ type: e.type, id: e.id, data: e.data } as EntityEvent<any>); }),
};
