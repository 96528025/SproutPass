// Trade state machine on fakeDb (delayMs: 0). Every rule trade.ts enforces has a case here.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "../testing/fakeDb.ts";
import { applySeed, seedPlan, DEMO_DATES } from "../seed.ts";
import { priceFor } from "../pricing.ts";
import type { AgentInbox, ClothingItem, Encounter, InboxEvent, Listing } from "../types.ts";
import { createProposal, decideProposal, getParties, payProposal, PROPOSAL_TTL_MS } from "./trade.ts";

let db: FakeDb;
let ids: { mina: string; jo: string; sam: string };
let romper: ClothingItem;
let listing: Listing;

async function setClock(now: string) {
  const [s] = await db.Setting.filter({ key: "demo" });
  await db.Setting.update(s.id, { now });
}

/** List an item directly (listItem belongs to closet.ts), the way the seller's SELL flow leaves it. */
async function listDirect(item: ClothingItem, extra: Partial<Listing> = {}): Promise<Listing> {
  await db.ClothingItem.update(item.id, { status: "listed", photos: ["romper.jpg", ...item.photos] });
  return db.Listing.create({
    itemId: item.id, sellerId: item.currentOwnerId, condition: "gently_used", conditionNote: "tiny stain on the cuff",
    priceCents: priceFor(item) ?? 0, shared: true, status: "active", createdAt: DEMO_DATES.nudge, ...extra,
  });
}

const propose = (extra: Record<string, unknown> = {}) =>
  createProposal(db, { listingId: listing.id, buyerId: ids.jo, reason: "", transcript: [], source: "local", ...extra });

const item = () => db.ClothingItem.get(romper.id);
const events = async (parentId: string): Promise<InboxEvent[]> =>
  (await db.AgentInbox.filter({ parentId })).map((r: AgentInbox) => r.payload as unknown as InboxEvent);

beforeEach(async () => {
  db = createFakeDb();
  const { parentIds } = await applySeed(db, seedPlan());
  ids = parentIds as typeof ids;
  [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
  await setClock(DEMO_DATES.nudge);
  listing = await listDirect(romper);
  await setClock(DEMO_DATES.meet);
});

describe("createProposal", () => {
  it("creates an open proposal with the snapshot and takes the item off the market", async () => {
    const p = await propose();
    expect(p).toMatchObject({
      status: "open", sellerDecision: "pending", buyerDecision: "pending", handover: "now",
      sellerId: ids.mina, buyerId: ids.jo, listingId: listing.id, itemId: romper.id, source: "local",
      createdAt: DEMO_DATES.meet,
    });
    expect(new Date(p.expiresAt).getTime() - new Date(p.createdAt).getTime()).toBe(PROPOSAL_TTL_MS);
    expect(p.snapshot).toMatchObject({
      itemName: "Yellow duck romper", icon: "item_romper", photo: "romper.jpg", size: "6-9M",
      originalPriceCents: 3000, previousOwners: 1, priceCents: 1800, wearWeeksLeft: 4, condition: "gently_used",
    });
    expect(p.reason).toMatch(/Jo/);
    expect((await item()).status).toBe("pending_trade");
  });

  it("keeps the agent's reason and transcript", async () => {
    const turn = { from: "buyer_agent" as const, parentId: ids.jo, kind: "looking_for" as const, text: "6-9M?", at: DEMO_DATES.meet };
    const p = await propose({ reason: "Pea needs a romper.", transcript: [turn], source: "fetch" });
    expect(p.reason).toBe("Pea needs a romper.");
    expect(p.transcript).toEqual([turn]);
    expect(p.source).toBe("fetch");
  });

  it("ignores the caller's wearWeeksLeft (server re-checks)", async () => {
    const p = await propose({ wearWeeksLeft: 99 });
    expect(p.snapshot.wearWeeksLeft).toBe(4);
  });

  it("is idempotent for the same buyer, 409 already_open for a different buyer", async () => {
    const a = await propose();
    const b = await propose();
    expect(b.id).toBe(a.id);
    expect(await db.MatchProposal.list()).toHaveLength(1);
    await expect(createProposal(db, { listingId: listing.id, buyerId: ids.sam, reason: "", transcript: [], source: "local" }))
      .rejects.toMatchObject({ code: "already_open", status: 409 });
  });

  it("a third-owner item can't be proposed", async () => {
    const [cardigan] = await db.ClothingItem.filter({ name: "Oatmeal knit cardigan" });
    const forced = await listDirect(cardigan, { priceCents: 1600 });
    await expect(createProposal(db, { listingId: forced.id, buyerId: ids.jo, reason: "", transcript: [], source: "local" }))
      .rejects.toMatchObject({ code: "not_eligible", status: 409, message: "item already has 3 owners" });
  });

  it("not_eligible with checkEligibility's reason", async () => {
    await db.Listing.update(listing.id, { shared: false });
    await expect(propose()).rejects.toMatchObject({ code: "not_eligible", message: "listing not shared" });
    await db.Listing.update(listing.id, { shared: true });
    await expect(createProposal(db, { listingId: listing.id, buyerId: ids.mina, reason: "", transcript: [], source: "local" }))
      .rejects.toMatchObject({ code: "not_eligible" });
  });

  it("not_eligible when the buyer has no shared need", async () => {
    const [need] = await db.Need.filter({ parentId: ids.jo });
    await db.Need.update(need.id, { shared: false });
    await expect(propose()).rejects.toMatchObject({ code: "not_eligible", message: "buyer has no shared need" });
  });

  it("tries each shared need until one passes", async () => {
    const [joChild] = await db.Child.filter({ parentId: ids.jo });
    await db.Need.create({ parentId: ids.jo, childId: joChild.id, sizes: ["2T"], shared: true, createdAt: "2026-01-01T00:00:00.000Z" });
    const p = await propose();
    expect(p.status).toBe("open");
  });

  it("validates the encounter and marks it proposed", async () => {
    const turn = { from: "seller_agent" as const, parentId: ids.mina, kind: "have" as const, text: "romper!", at: DEMO_DATES.meet };
    const enc = await db.Encounter.create({ aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "talking",
      startedAt: DEMO_DATES.meet, transcript: [turn] });
    const p = await propose({ encounterId: enc.id });
    expect(p.encounterId).toBe(enc.id);
    expect(p.transcript).toEqual([turn]);
    const after: Encounter = await db.Encounter.get(enc.id);
    expect(after.status).toBe("proposed");
  });

  it("rejects an encounter between other parents or one that isn't talking", async () => {
    const other = await db.Encounter.create({ aId: ids.jo, bId: ids.sam, band: "<25m", simulated: true, status: "talking",
      startedAt: DEMO_DATES.meet, transcript: [] });
    await expect(propose({ encounterId: other.id })).rejects.toMatchObject({ code: "forbidden" });
    const done = await db.Encounter.create({ aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "no_match",
      startedAt: DEMO_DATES.meet, transcript: [] });
    await expect(propose({ encounterId: done.id })).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(propose({ encounterId: "nope" })).rejects.toMatchObject({ code: "not_found" });
    expect((await item()).status).toBe("listed");
  });

  it("writes proposal:new for both sides", async () => {
    const p = await propose();
    // peerPet = the other side's pet (C's agents: "Pip found a buyer…"): Mina's Button, Jo's Pip.
    expect(await events(ids.mina)).toContainEqual({ type: "proposal:new", proposalId: p.id, role: "seller", peerPet: "Pip" });
    expect(await events(ids.jo)).toContainEqual({ type: "proposal:new", proposalId: p.id, role: "buyer", peerPet: "Button" });
  });

  it("expires a stale open proposal and proposes again", async () => {
    const old = await propose();
    await setClock(new Date(new Date(DEMO_DATES.meet).getTime() + PROPOSAL_TTL_MS + 60_000).toISOString());
    const fresh = await propose();
    expect(fresh.id).not.toBe(old.id);
    expect((await db.MatchProposal.get(old.id)).status).toBe("expired");
  });

  it("requires listingId and buyerId", async () => {
    await expect(createProposal(db, { buyerId: ids.jo } as never)).rejects.toMatchObject({ code: "bad_request" });
    await expect(createProposal(db, { listingId: listing.id } as never)).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("happy path", () => {
  it("both accept → pay → Jo owns the romper, ownerCount 2, listing sold", async () => {
    const p = await propose();
    const a = await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    expect(a).toMatchObject({ status: "open", sellerDecision: "accepted", buyerDecision: "pending" });
    const b = await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    expect(b).toMatchObject({ status: "both_accepted", sellerDecision: "accepted", buyerDecision: "accepted" });

    const res = await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });
    expect(res.proposal.status).toBe("paid");
    expect(res.proposal.paymentRef).toMatch(/^DEMO-[A-Z0-9]{6}$/);
    const [joChild] = await db.Child.filter({ parentId: ids.jo });
    expect(res.item).toMatchObject({ ownerCount: 2, currentOwnerId: ids.jo, childId: joChild.id, status: "in_closet" });
    expect(res.item.predictedOutgrowDate?.slice(0, 10)).toBe("2026-11-17");
    expect(res.item.ownershipHistory).toEqual([
      { ownerId: ids.mina, from: romper.originalPurchaseDate, to: DEMO_DATES.meet },
      { ownerId: ids.jo, from: DEMO_DATES.meet, priceCents: 1800 },
    ]);
    expect(await item()).toEqual(res.item);
    expect((await db.Listing.get(listing.id)).status).toBe("sold");
    expect((await db.MatchProposal.get(p.id)).status).toBe("paid");

    const welcome = await db.AgentNudge.filter({ parentId: ids.jo, kind: "new_owner_welcome" });
    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toMatchObject({ itemId: romper.id, resolved: false, createdAt: DEMO_DATES.meet });
  });

  it("either side may set handover later + note", async () => {
    const p = await propose();
    const a = await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted", handover: "later", handoverNote: "Saturday at the park" });
    expect(a).toMatchObject({ handover: "later", handoverNote: "Saturday at the park" });
    const b = await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    expect(b).toMatchObject({ status: "both_accepted", handover: "later", handoverNote: "Saturday at the park" });
  });
});

describe("decline", () => {
  it("charges nothing and re-lists the item", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    const d = await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "declined" });
    expect(d).toMatchObject({ status: "declined", buyerDecision: "declined" });
    expect(d.paymentRef).toBeUndefined();
    const it2 = await item();
    expect(it2).toMatchObject({ status: "listed", currentOwnerId: ids.mina, ownerCount: 1 });
    expect(it2.ownershipHistory).toHaveLength(1);
    expect((await db.Listing.get(listing.id)).status).toBe("active");
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }))
      .rejects.toMatchObject({ code: "invalid_transition", status: 409 });
    expect((await db.MatchProposal.get(p.id)).paymentRef).toBeUndefined();
  });

  it("the seller can decline too, and the item can be proposed again", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "declined" });
    const again = await propose();
    expect(again.id).not.toBe(p.id);
    expect(again.status).toBe("open");
  });
});

describe("guards", () => {
  it("pay before both accept → 409", async () => {
    const p = await propose();
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }))
      .rejects.toMatchObject({ code: "invalid_transition", status: 409 });
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }))
      .rejects.toMatchObject({ code: "invalid_transition", status: 409 });
    expect((await item()).currentOwnerId).toBe(ids.mina);
  });

  it("only the buyer can pay", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    await expect(payProposal(db, { parentKey: "mina", proposalId: p.id }, { delayMs: 0 })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(payProposal(db, { parentKey: "sam", proposalId: p.id }, { delayMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("double accept is idempotent", async () => {
    const p = await propose();
    const a = await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    const inboxBefore = (await db.AgentInbox.list()).length;
    const again = await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    expect(again).toEqual(a);
    expect((await db.AgentInbox.list()).length).toBe(inboxBefore);
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    const third = await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    expect(third.status).toBe("both_accepted");
  });

  it("a changed decision after accept → invalid_transition", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await expect(decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "declined" }))
      .rejects.toMatchObject({ code: "invalid_transition" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    await expect(decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "declined" }))
      .rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("double pay transfers once (sequential and concurrent)", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    const [x, y] = await Promise.all([
      payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }),
      payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }),
    ]);
    const z = await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });
    for (const r of [x, y, z]) expect(r.proposal.status).toBe("paid");
    expect(new Set([x, y, z].map((r) => r.proposal.paymentRef)).size).toBe(1);
    const it2 = await item();
    expect(it2.ownerCount).toBe(2);
    expect(it2.ownershipHistory).toHaveLength(2);
    expect(await db.AgentNudge.filter({ parentId: ids.jo, kind: "new_owner_welcome" })).toHaveLength(1);
    expect((await events(ids.jo)).filter((e) => e.type === "trade:completed")).toHaveLength(1);
  });

  it("a crash after the transfer doesn't transfer twice on retry", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    // Simulate step 1 done, then a crash: the item already belongs to Jo but the proposal is still both_accepted.
    const before = await item();
    const [joChild] = await db.Child.filter({ parentId: ids.jo });
    await db.ClothingItem.update(romper.id, {
      currentOwnerId: ids.jo, childId: joChild.id, ownerCount: 2, status: "in_closet",
      ownershipHistory: [{ ...before.ownershipHistory[0], to: DEMO_DATES.meet }, { ownerId: ids.jo, from: DEMO_DATES.meet, priceCents: 1800 }],
    });
    const res = await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });
    expect(res.proposal.status).toBe("paid");
    expect(res.item.ownerCount).toBe(2);
    expect(res.item.ownershipHistory).toHaveLength(2);
  });

  it("a non-party can't decide", async () => {
    const p = await propose();
    await expect(decideProposal(db, { parentKey: "sam", proposalId: p.id, decision: "accepted" }))
      .rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("an expired proposal can't be accepted, and the item is re-listed", async () => {
    const p = await propose();
    await setClock(new Date(new Date(DEMO_DATES.meet).getTime() + PROPOSAL_TTL_MS + 1000).toISOString());
    await expect(decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" }))
      .rejects.toMatchObject({ code: "expired" });
    expect((await db.MatchProposal.get(p.id)).status).toBe("expired");
    expect((await item()).status).toBe("listed");
    await expect(decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" }))
      .rejects.toMatchObject({ code: "expired" });
  });

  it("validates decision, handover and ids", async () => {
    const p = await propose();
    await expect(decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "maybe" as never })).rejects.toMatchObject({ code: "bad_request" });
    await expect(decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted", handover: "tuesday" as never })).rejects.toMatchObject({ code: "bad_request" });
    await expect(decideProposal(db, { parentKey: "jo", proposalId: "nope", decision: "accepted" })).rejects.toMatchObject({ code: "not_found" });
    await expect(decideProposal(db, { proposalId: p.id, decision: "accepted" })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("payment failure", () => {
  it("fail: true → payment_failed, item re-listed, nothing moved", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    const res = await payProposal(db, { parentKey: "jo", proposalId: p.id, fail: true }, { delayMs: 0 });
    expect(res.proposal.status).toBe("payment_failed");
    expect(res.item).toMatchObject({ status: "listed", currentOwnerId: ids.mina, ownerCount: 1 });
    expect((await db.Listing.get(listing.id)).status).toBe("active");
    expect(await db.AgentNudge.filter({ kind: "new_owner_welcome" })).toHaveLength(0);
    for (const [pid, role] of [[ids.mina, "seller"], [ids.jo, "buyer"]] as const) {
      expect(await events(pid)).toContainEqual(expect.objectContaining({ type: "proposal:updated", proposalId: p.id, role, status: "payment_failed" }));
    }
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 })).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("inbox", () => {
  it("events are written for both sides through the whole trade", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });

    const mina = await events(ids.mina);
    const jo = await events(ids.jo);
    const both = { proposalId: p.id, status: "both_accepted", sellerDecision: "accepted", buyerDecision: "accepted" };
    expect(mina).toContainEqual({ type: "proposal:updated", role: "seller", ...both, otherName: "Jo" });
    expect(jo).toContainEqual({ type: "proposal:updated", role: "buyer", ...both, otherName: "Mina" });
    const moved = await item();
    const done = {
      proposalId: p.id, itemId: romper.id, priceCents: 1800, buyerId: ids.jo, sellerId: ids.mina,
      snapshot: p.snapshot, predictedOutgrowDate: moved.predictedOutgrowDate,
    };
    expect(mina).toContainEqual({ type: "trade:completed", role: "seller", ...done });
    expect(jo).toContainEqual({ type: "trade:completed", role: "buyer", ...done });
    expect(jo).toContainEqual(expect.objectContaining({ type: "nudge:new", itemId: romper.id, kind: "new_owner_welcome" }));
    expect(mina.some((e) => e.type === "nudge:new")).toBe(false);
    const rows = await db.AgentInbox.list();
    expect(rows.every((r) => r.type === "event" && r.status === "pending")).toBe(true);
  });

  it("trade:completed carries what C's agents read without a second lookup (NEEDS: snapshot, buyer/seller, new date)", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });
    const done = (await events(ids.jo)).find((e) => e.type === "trade:completed");
    if (done?.type !== "trade:completed") throw new Error("no trade:completed for Jo");
    expect(done.snapshot).toMatchObject({ itemName: "Yellow duck romper", size: "6-9M", priceCents: 1800, previousOwners: 1 });
    expect(done).toMatchObject({ buyerId: ids.jo, sellerId: ids.mina });
    // the buyer's child's date, not the seller's: Jo's Pea is younger than Mina's Bean
    expect(done.predictedOutgrowDate).toBe((await item()).predictedOutgrowDate);
    expect(done.predictedOutgrowDate).not.toBe(romper.predictedOutgrowDate);
  });

  it("proposal:updated names the other parent for each side (seller hears the buyer's name and vice versa)", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    expect(await events(ids.mina)).toContainEqual(expect.objectContaining({ type: "proposal:updated", role: "seller", status: "open", otherName: "Jo" }));
    expect(await events(ids.jo)).toContainEqual(expect.objectContaining({ type: "proposal:updated", role: "buyer", status: "open", otherName: "Mina" }));
  });

  it("an expired proposal's proposal:updated still names the other parent", async () => {
    const p = await propose();
    await setClock(new Date(new Date(DEMO_DATES.meet).getTime() + PROPOSAL_TTL_MS + 1000).toISOString());
    await expect(decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" })).rejects.toMatchObject({ code: "expired" });
    expect(await events(ids.jo)).toContainEqual(expect.objectContaining({ type: "proposal:updated", status: "expired", otherName: "Mina" }));
    expect(await events(ids.mina)).toContainEqual(expect.objectContaining({ type: "proposal:updated", status: "expired", otherName: "Jo" }));
  });

  it("decline writes proposal:updated for both with $0", async () => {
    const p = await propose();
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "declined" });
    expect(await events(ids.mina)).toContainEqual(expect.objectContaining({ type: "proposal:updated", role: "seller", status: "declined", buyerDecision: "declined" }));
    expect(await events(ids.jo)).toContainEqual(expect.objectContaining({ type: "proposal:updated", role: "buyer", status: "declined" }));
    expect((await events(ids.jo)).some((e) => e.type === "trade:completed")).toBe(false);
  });
});

describe("getParties", () => {
  const PRIVATE = ["phone", "photonUserId", "photonSpaceId", "photonLineUserId", "convo", "asiAddress", "key", "agentAddress", "discoverable"];

  it("returns each party's public card, in the order asked", async () => {
    const res = await getParties(db, { parentIds: [ids.jo, ids.mina] });
    expect(res).toEqual([
      { id: ids.jo, name: "Jo", avatar: { sprite: "parent_b", palette: "mint" }, pet: { sprite: "pet_b", name: "Pip" } },
      { id: ids.mina, name: "Mina", avatar: { sprite: "parent_a", palette: "peach" }, pet: { sprite: "pet_a", name: "Button" } },
    ]);
  });

  it("never includes phone, Photon ids, convo or ASI address", async () => {
    await db.Parent.update(ids.mina, {
      phone: "+15551234567", photonUserId: "pu_1", photonSpaceId: "ps_1", photonLineUserId: "pl_1",
      convo: { step: "claim" }, asiAddress: "asi1qmina", agentAddress: "agent1qmina",
    });
    const [mina] = await getParties(db, { parentIds: [ids.mina] });
    expect(Object.keys(mina).sort()).toEqual(["avatar", "id", "name", "pet"]);
    for (const k of PRIVATE) expect(mina).not.toHaveProperty(k);
    expect(JSON.stringify(mina)).not.toMatch(/\+1555|pu_1|ps_1|pl_1|claim|asi1q|agent1q/);
  });

  it("skips unknown ids and dedupes", async () => {
    const res = await getParties(db, { parentIds: ["nope", ids.sam, ids.sam, "former_ana"] });
    expect(res.map((p) => p.name)).toEqual(["Sam"]);
    expect(await getParties(db, { parentIds: ["nope"] })).toEqual([]);
  });

  it("reads Parent once, whatever the count", async () => {
    let reads = 0;
    const counting = { ...db, Parent: { ...db.Parent, list: (...a: Parameters<typeof db.Parent.list>) => { reads++; return db.Parent.list(...a); },
      get: () => { throw new Error("no per-id gets"); }, filter: (...a: Parameters<typeof db.Parent.filter>) => { reads++; return db.Parent.filter(...a); } } };
    await getParties(counting as typeof db, { parentIds: [ids.mina, ids.jo, ids.sam] });
    expect(reads).toBe(1);
  });

  it("rejects an empty list, more than 10 ids, and non-id input", async () => {
    await expect(getParties(db, { parentIds: [] })).rejects.toMatchObject({ code: "bad_request", status: 400 });
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`);
    await expect(getParties(db, { parentIds: eleven })).rejects.toMatchObject({ code: "bad_request" });
    expect(await getParties(db, { parentIds: [...Array(12).fill(ids.jo)] })).toHaveLength(1);   // 12 entries, 1 after dedupe
    await expect(getParties(db, {} as never)).rejects.toMatchObject({ code: "bad_request" });
    await expect(getParties(db, { parentIds: "jo" } as never)).rejects.toMatchObject({ code: "bad_request" });
    await expect(getParties(db, { parentIds: [ids.jo, 7] } as never)).rejects.toMatchObject({ code: "bad_request" });
  });
});

// ---------------------------------------------------------------- trusted checkout (B5): the buyer's mandate + Face ID approval

describe("the buyer's mandate (createProposal)", () => {
  const mandate = (m: Record<string, unknown>) => db.Parent.update(ids.jo, { mandate: { agentMayPropose: true, maxPriceCents: 5000,
    monthlyBudgetCents: 10_000, categories: [], requirePasskey: false, ...m } });
  const refused = async (reason: RegExp) => {
    await expect(propose()).rejects.toMatchObject({ code: "not_eligible", status: 409, message: expect.stringMatching(reason) });
    expect(await db.MatchProposal.filter({ listingId: listing.id })).toHaveLength(0);
    expect((await item()).status).toBe("listed");
    expect(await events(ids.jo)).toEqual([]);
  };
  const otherTrade = (status: "paid" | "open", createdAt: string, priceCents: number) => db.MatchProposal.create({
    listingId: "l_other", itemId: "i_other", sellerId: ids.sam, buyerId: ids.jo, snapshot: { priceCents } as never, reason: "",
    transcript: [], source: "local", sellerDecision: "accepted", buyerDecision: "accepted", status, handover: "now",
    createdAt, expiresAt: new Date(new Date(createdAt).getTime() + PROPOSAL_TTL_MS).toISOString(),
  });

  it("the default rules allow the demo trade", async () => {
    expect((await propose()).status).toBe("open");
  });

  it("no proposal when the parent told the pet only to point out matches", async () => {
    await mandate({ agentMayPropose: false });
    await refused(/Jo asked Pip to only point out matches/);
  });

  it("no proposal above the price limit (the limit itself is fine)", async () => {
    await mandate({ maxPriceCents: 1799 });
    await refused(/price limit/);
    await mandate({ maxPriceCents: 1800 });
    expect((await propose()).status).toBe("open");
  });

  it("no proposal outside the chosen kinds of clothes", async () => {
    await mandate({ categories: ["outerwear", "dress"] });
    await refused(/kinds of clothes/);
    await mandate({ categories: ["onesie"] });
    expect((await propose()).status).toBe("open");
  });

  it("no proposal that would go over the monthly budget, counting paid and pending trades this month", async () => {
    await mandate({ monthlyBudgetCents: 2500 });
    await otherTrade("paid", DEMO_DATES.meet, 800);
    await refused(/monthly budget/);
    await mandate({ monthlyBudgetCents: 2600 });                // 800 + 1800 = 2600: exactly on budget
    expect((await propose()).status).toBe("open");
  });

  it("last month's trades and timed-out offers don't count; a pending one does", async () => {
    await mandate({ monthlyBudgetCents: 2000 });
    await otherTrade("paid", "2026-09-30T17:00:00.000Z", 1500);
    await otherTrade("open", "2026-10-18T15:00:00.000Z", 1500);  // expired 15:30 → doesn't count
    expect((await propose()).status).toBe("open");
    await db.MatchProposal.delete((await db.MatchProposal.filter({ listingId: listing.id }))[0].id);
    await db.ClothingItem.update(romper.id, { status: "listed" });
    await otherTrade("open", DEMO_DATES.meet, 500);            // live → 500 + 1800 > 2000
    await expect(propose()).rejects.toMatchObject({ code: "not_eligible", message: expect.stringMatching(/monthly budget/) });
  });

  it("the reason never shows the buyer's amounts, and the seller's own rules don't block a sale", async () => {
    await db.Parent.update(ids.mina, { mandate: { agentMayPropose: false, maxPriceCents: 0, monthlyBudgetCents: 0, categories: ["dress"], requirePasskey: false } });
    expect((await propose()).status).toBe("open");
    await db.MatchProposal.delete((await db.MatchProposal.list())[0].id);
    await db.ClothingItem.update(romper.id, { status: "listed" });
    await mandate({ maxPriceCents: 1234 });
    await expect(propose()).rejects.toMatchObject({ message: expect.not.stringMatching(/\$|12\.34|1234/) });
  });

  it("an already-open proposal for the same buyer is returned, not re-judged", async () => {
    const p = await propose();
    await mandate({ agentMayPropose: false });
    expect((await propose()).id).toBe(p.id);
  });
});

describe("Face ID approval (payProposal)", () => {
  const passkey = { key: "pk_1", credentialId: "cred-1", publicKey: "", counter: 0, transports: [], label: "Jo's phone",
    createdAt: DEMO_DATES.meet, rpID: "localhost" };
  async function accepted() {
    const p = await propose();
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    return decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
  }
  const untouched = async (id: string) => {
    expect(await db.MatchProposal.get(id)).toMatchObject({ status: "both_accepted" });
    expect((await db.MatchProposal.get(id)).paymentRef).toBeUndefined();
    expect(await item()).toMatchObject({ currentOwnerId: ids.mina, ownerCount: 1, status: "pending_trade" });
  };

  it("with a saved passkey, paying needs an approval for THIS trade", async () => {
    await db.Parent.update(ids.jo, { passkeys: [passkey] });
    const p = await accepted();
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }))
      .rejects.toMatchObject({ code: "forbidden", status: 403, message: "Approve with Face ID first" });
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0, passkeyApprovedFor: "another_trade" }))
      .rejects.toMatchObject({ code: "forbidden" });
    // the body can't carry the approval: only the entry (after verifying a passkey) sets opts.passkeyApprovedFor
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id, passkeyApprovedFor: p.id } as never, { delayMs: 0 }))
      .rejects.toMatchObject({ code: "forbidden" });
    await untouched(p.id);
    const res = await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0, passkeyApprovedFor: p.id });
    expect(res.proposal.status).toBe("paid");
    expect(res.item.currentOwnerId).toBe(ids.jo);
    // reading back a paid trade needs no new approval and doesn't pay twice
    const again = await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });
    expect(again.proposal.paymentRef).toBe(res.proposal.paymentRef);
  });

  it("a simulated failure needs approval too", async () => {
    await db.Parent.update(ids.jo, { passkeys: [passkey] });
    const p = await accepted();
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id, fail: true }, { delayMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
    await untouched(p.id);
  });

  it("a stored requirePasskey with no passkey saved doesn't lock the buyer out (Face ID follows the passkeys)", async () => {
    await db.Parent.update(ids.jo, { mandate: { agentMayPropose: true, maxPriceCents: 5000, monthlyBudgetCents: 10_000, categories: [], requirePasskey: true } });
    const p = await accepted();
    expect((await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 })).proposal.status).toBe("paid");
  });

  it("the order of checks: only the buyer, both must accept, then approval", async () => {
    await db.Parent.update(ids.jo, { passkeys: [passkey] });
    const p = await propose();
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 })).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(payProposal(db, { parentKey: "mina", proposalId: p.id }, { delayMs: 0 })).rejects.toMatchObject({ code: "forbidden", message: "only the buyer can pay" });
  });

  it("a seller's passkey doesn't change what the buyer must do", async () => {
    await db.Parent.update(ids.mina, { passkeys: [passkey] });
    const p = await accepted();
    expect((await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 })).proposal.status).toBe("paid");
  });
});
