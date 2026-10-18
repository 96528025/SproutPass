// C ↔ B bridge on fakeDb: C's call shapes (C's NEEDS.md) reach B's real handlers and rules.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "./testing/fakeDb.ts";
import { applySeed, seedPlan, DEMO_DATES } from "./seed.ts";
import { demoClock } from "./logic/demo.ts";
import type { AgentNudge, ClothingItem, Encounter, Listing, MatchProposal } from "./types.ts";
import { callB, findMatches, predictOutgrow } from "./cbridge.ts";

let db: FakeDb;
let ids: { mina: string; jo: string; sam: string };
let romper: ClothingItem;

beforeEach(async () => {
  db = createFakeDb();
  ids = (await applySeed(db, seedPlan())).parentIds as typeof ids;
  [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
  await demoClock(db, { now: DEMO_DATES.nudge });
});

const romperNudge = async () => (await db.AgentNudge.filter({ itemId: romper.id, kind: "outgrow_check" }))[0] as AgentNudge;

/** C's iMessage SELL flow: listItem with {sellerId, photos[]} (B takes parentId + photo). */
const listAsC = () => callB(db, "listItem", {
  itemId: romper.id, sellerId: ids.mina, condition: "gently_used", conditionNote: "", photos: ["romper.jpg"], shared: true,
}) as Promise<Listing & { listing: Listing; item: ClothingItem }>;

describe("callB: C's argument shapes", () => {
  it("getCloset adds child.ageMonths (C) next to childAgeMonths (B) and still hides the phone", async () => {
    const view = await callB(db, "getCloset", { parentId: ids.mina }) as Record<string, any>;
    expect(view.child.ageMonths).toBe(view.childAgeMonths);
    expect(JSON.stringify(view)).not.toMatch(/"phone"|"convo"|"asiAddress"/);
  });

  it("listItem with {sellerId, photos[]} lists the romper at $18.00 and returns both shapes", async () => {
    const r = await listAsC();
    expect(r.priceCents).toBe(1800);
    expect(r.listing.priceCents).toBe(1800);
    expect(r.item.status).toBe("listed");
    expect(r.item.photos[0]).toBe("romper.jpg");
  });

  it("resolveNudge maps C's decision 'later' → snooze and finds the parent from the nudge", async () => {
    const nudge = await romperNudge();
    const res = await callB(db, "resolveNudge", { nudgeId: nudge.id, decision: "later" }) as { next: string; nudge: AgentNudge };
    expect(res.next).toBe("none");
    expect(res.nudge.resolved).toBe(true);
  });

  it("resolveNudge 'sell' opens the listing flow", async () => {
    const res = await callB(db, "resolveNudge", { nudgeId: (await romperNudge()).id, decision: "sell" }) as { next: string };
    expect(res.next).toBe("open_listing");
  });

  it("B's rules still hold: a 3rd-owner item refuses to list, with B's status and code", async () => {
    const [cardigan] = (await db.ClothingItem.filter({})).filter((i) => i.ownerCount === 3);
    const owner = cardigan.currentOwnerId;
    await expect(callB(db, "listItem", { itemId: cardigan.id, sellerId: owner, condition: "well_loved", photos: ["c.jpg"], shared: true }))
      .rejects.toMatchObject({ status: 409, code: "not_resellable", message: expect.stringMatching(/^listItem: not_resellable/) });
  });

  it("unknown actions are a 400, not a crash", async () => {
    await expect(callB(db, "deleteEverything", {})).rejects.toMatchObject({ status: 400 });
  });
});

describe("C's encounter → B's createProposal → decide → pay", () => {
  it("runs the whole trade through the bridge, sellerId ignored, encounter marked proposed", async () => {
    await listAsC();
    await demoClock(db, { now: DEMO_DATES.meet });
    const enc = await db.Encounter.create({
      aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "talking", startedAt: DEMO_DATES.meet, transcript: [],
    } as Omit<Encounter, "id">);

    const [best] = await findMatches(db, { buyerId: ids.jo, sellerId: ids.mina });
    expect(best).toMatchObject({ itemId: romper.id, itemName: "Yellow duck romper", size: "6-9M", priceCents: 1800, wearWeeksLeft: 4 });
    expect(best.reason).toMatch(/Jo/);

    const prop = await callB(db, "createProposal", {
      listingId: best.listingId, sellerId: ids.mina, buyerId: ids.jo, encounterId: enc.id, reason: best.reason,
      transcript: [{ from: "buyer_agent", parentId: ids.jo, kind: "looking_for", text: "Looking for 6-9M!", at: DEMO_DATES.meet }],
      source: "local",
    }) as MatchProposal;
    expect(prop).toMatchObject({ status: "open", sellerId: ids.mina, buyerId: ids.jo, source: "local" });
    expect((await db.Encounter.get(enc.id)).status).toBe("proposed");

    await callB(db, "decideProposal", { proposalId: prop.id, parentId: ids.mina, decision: "accepted" });
    await callB(db, "decideProposal", { proposalId: prop.id, parentId: ids.jo, decision: "accepted" });
    const paid = await callB(db, "payProposal", { proposalId: prop.id, parentId: ids.jo }) as { proposal: MatchProposal; item: ClothingItem };
    expect(paid.proposal.status).toBe("paid");
    expect(paid.item).toMatchObject({ currentOwnerId: ids.jo, ownerCount: 2 });
  }, 10_000);

  it("findMatches finds nothing for a pair with no shared fit", async () => {
    expect(await findMatches(db, { buyerId: ids.mina, sellerId: ids.jo })).toEqual([]);
  });
});

describe("predictOutgrow (C's Date signature)", () => {
  it("matches B's size table: Jo's child outgrows the 6-9M romper ≈ Nov 17", async () => {
    const [joChild] = await db.Child.filter({ parentId: ids.jo });
    expect(predictOutgrow(romper, joChild, new Date(DEMO_DATES.meet)).toISOString().slice(0, 10)).toBe("2026-11-17");
  });
});
