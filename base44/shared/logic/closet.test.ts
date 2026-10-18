// Closet handler rules on fakeDb + the real seed. Every rule enforced in closet.ts has a test here.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "../testing/fakeDb.ts";
import { applySeed, seedPlan, DEMO_DATES } from "../seed.ts";
import { predictOutgrow } from "../sizes.ts";
import { HttpError } from "../errors.ts";
import type { ClothingItem, MatchProposal, ProposalStatus } from "../types.ts";
import { getCloset, listItem, recordPurchase, resolveNudge, upsertNeed, withdrawListing } from "./closet.ts";

let db: FakeDb;
let ids: { parentIds: Record<string, string>; itemIds: Record<string, string> };

async function expectHttp(p: Promise<unknown>, code: string, status: number) {
  const err = await p.then(() => null, (e) => e);
  expect(err, `expected ${code}`).toBeInstanceOf(HttpError);
  expect((err as HttpError).code).toBe(code);
  expect((err as HttpError).status).toBe(status);
  return err as HttpError;
}
const setNow = async (now: string) => {
  const [s] = await db.Setting.filter({ key: "demo" });
  await db.Setting.update(s.id, { now });
};
const romperId = () => ids.itemIds["Yellow duck romper"];
const listRomper = (extra: Partial<Parameters<typeof listItem>[1]> = {}) =>
  listItem(db, { parentKey: "mina", itemId: romperId(), photo: "romper.jpg", condition: "gently_used",
    conditionNote: "tiny stain on the cuff", shared: true, ...extra });

function proposal(over: Partial<MatchProposal>): Omit<MatchProposal, "id"> {
  return {
    listingId: "lis_x", itemId: romperId(), sellerId: ids.parentIds.mina, buyerId: ids.parentIds.jo,
    snapshot: { itemName: "Yellow duck romper", icon: "item_romper", photo: "", size: "6-9M",
      originalPurchaseDate: DEMO_DATES.start, originalPriceCents: 3000, condition: "gently_used", conditionNote: "",
      previousOwners: 1, priceCents: 1800 },
    reason: "", transcript: [], source: "local", sellerDecision: "pending", buyerDecision: "pending", status: "open",
    handover: "now", createdAt: DEMO_DATES.meet, expiresAt: DEMO_DATES.meet, ...over,
  };
}

beforeEach(async () => {
  db = createFakeDb();
  ids = await applySeed(db, seedPlan({ MINA_PHONE: "+15555550101", JO_PHONE: "+15555550102", SAM_PHONE: "+15555550103" }));
});

describe("seed", () => {
  it("has 17 items over three closets and keeps the demo anchors exact", async () => {
    const items = await db.ClothingItem.list();
    expect(items).toHaveLength(17);
    const by = (k: string) => items.filter((i) => i.currentOwnerId === ids.parentIds[k]).length;
    expect([by("mina"), by("jo"), by("sam")]).toEqual([7, 5, 5]);
    const romper = items.find((i) => i.name === "Yellow duck romper")!;
    expect(romper).toMatchObject({ size: "6-9M", originalPriceCents: 3000, ownerCount: 1, icon: "item_romper" });
    expect(romper.predictedOutgrowDate!.slice(0, 10)).toBe("2026-08-27");
    const icons = new Set(items.map((i) => i.icon));
    for (const icon of icons) expect(icon).toMatch(/^item_(romper|onesie|tee|pants|jacket|dress|set|hat|socks|sweater|bib|sleepsack)$/);
    const sweater = items.find((i) => i.name === "Knit bear sweater")!;
    expect(sweater.ownershipHistory[0]).toMatchObject({ ownerId: ids.parentIds.sam, to: "2026-04-28T17:00:00.000Z" });
    expect(sweater.ownershipHistory[1]).toMatchObject({ ownerId: ids.parentIds.mina, priceCents: 2160 });
  });

  it("applySeed is a full reset (running twice leaves one copy)", async () => {
    await applySeed(db, seedPlan());
    expect(await db.ClothingItem.list()).toHaveLength(17);
    expect(await db.Parent.list()).toHaveLength(3);
    expect(await db.Setting.list()).toHaveLength(1);
  });
});

describe("getCloset", () => {
  it("returns Mina's closet with child age and no phone anywhere", async () => {
    const c = await getCloset(db, { parentKey: "mina" });
    expect(c.now).toBe(DEMO_DATES.start);
    expect(c.parent.key).toBe("mina");
    expect(c.child?.nickname).toBe("Bean");
    expect(c.childAgeMonths).toBe(5);
    expect(c.items).toHaveLength(7);
    expect(c.passedOn).toEqual([]);
    const json = JSON.stringify(c);
    expect(json).not.toContain("phone");
    expect(json).not.toContain("+1555555");
    expect(c.parent).not.toHaveProperty("photonUserId");
  });

  it("never sends the server-only Photon / C fields to the browser", async () => {
    const mina = ids.parentIds.mina;
    await db.Parent.update(mina, { phone: "+15551230000", photonUserId: "pho_usr_parent", photonSpaceId: "pho_spc_1",
      photonLineUserId: "pho_usr_line", convo: { step: "await_photo" }, asiAddress: "asi1qmina" });
    const c = await getCloset(db, { parentId: mina });
    for (const k of ["phone", "photonUserId", "photonSpaceId", "photonLineUserId", "convo", "asiAddress"]) {
      expect(c.parent).not.toHaveProperty(k);
    }
    expect(JSON.stringify(c)).not.toMatch(/\+1555123|pho_usr_|pho_spc_|await_photo|asi1q/);
  });

  it("accepts parentId as well as parentKey; unknown parent is 404", async () => {
    const c = await getCloset(db, { parentId: ids.parentIds.jo });
    expect(c.parent.name).toBe("Jo");
    expect(c.needs).toHaveLength(1);
    await expectHttp(getCloset(db, { parentKey: "nobody" }), "not_found", 404);
    await expectHttp(getCloset(db, {}), "bad_request", 400);
  });

  it("passedOn = items this parent owned before and someone else owns now; transferred_out is hidden", async () => {
    const sam = await getCloset(db, { parentKey: "sam" });
    expect(sam.passedOn.map((i) => i.name)).toEqual(["Knit bear sweater"]);
    expect(sam.items.some((i) => i.name === "Knit bear sweater")).toBe(false);
    await db.ClothingItem.update(ids.itemIds["Denim overall dress"], { status: "transferred_out" });
    const after = await getCloset(db, { parentKey: "sam" });
    expect(after.items.some((i) => i.name === "Denim overall dress")).toBe(false);
  });

  it("nudges = unresolved only; listings = this parent's", async () => {
    const mina = ids.parentIds.mina;
    await db.AgentNudge.create({ parentId: mina, itemId: romperId(), kind: "outgrow_check", message: "a", createdAt: DEMO_DATES.nudge, resolved: false });
    await db.AgentNudge.create({ parentId: mina, itemId: romperId(), kind: "listing_reminder", message: "b", createdAt: DEMO_DATES.nudge, resolved: true });
    await db.AgentNudge.create({ parentId: ids.parentIds.jo, itemId: romperId(), kind: "new_owner_welcome", message: "c", createdAt: DEMO_DATES.nudge, resolved: false });
    await listRomper();
    const c = await getCloset(db, { parentKey: "mina" });
    expect(c.nudges.map((n) => n.message)).toEqual([]);          // listing resolved the outgrow nudge
    expect(c.listings).toHaveLength(1);
    expect((await getCloset(db, { parentKey: "jo" })).listings).toHaveLength(0);
    expect((await getCloset(db, { parentKey: "jo" })).nudges.map((n) => n.message)).toEqual(["c"]);
  });

  it("proposals: every open one plus the 5 newest terminal ones, newest first, buyer or seller", async () => {
    const t = (h: number) => new Date(Date.parse(DEMO_DATES.meet) + h * 3_600_000).toISOString();
    const terminal: ProposalStatus[] = ["paid", "declined", "expired", "payment_failed", "declined", "declined", "declined"];
    for (const [i, status] of terminal.entries()) await db.MatchProposal.create(proposal({ status, createdAt: t(i) }));
    await db.MatchProposal.create(proposal({ status: "open", createdAt: t(-10) }));
    await db.MatchProposal.create(proposal({ status: "both_accepted", createdAt: t(20) }));
    await db.MatchProposal.create(proposal({ status: "open", sellerId: ids.parentIds.sam, buyerId: ids.parentIds.jo, createdAt: t(30) }));
    const mina = await getCloset(db, { parentKey: "mina" });
    expect(mina.proposals).toHaveLength(2 + 5);
    expect(mina.proposals.map((p) => p.createdAt)).toEqual([...mina.proposals.map((p) => p.createdAt)].sort().reverse());
    expect(mina.proposals.filter((p) => p.status === "open" || p.status === "both_accepted")).toHaveLength(2);
    expect(mina.proposals.some((p) => p.createdAt === t(0))).toBe(false);   // 6th/7th oldest terminal dropped
    const jo = await getCloset(db, { parentKey: "jo" });
    expect(jo.proposals.filter((p) => p.status === "open")).toHaveLength(2);
  });
});

describe("recordPurchase", () => {
  it("creates a first-owner item with history, outgrow date and photo", async () => {
    const item = await recordPurchase(db, { parentKey: "jo", name: "Peach ruffle dress", category: "dress", icon: "item_dress",
      size: "9-12M", originalPriceCents: 2600, purchaseDate: "2026-06-01T12:00:00.000Z", photo: "dress.jpg" });
    const [pea] = await db.Child.filter({ parentId: ids.parentIds.jo });
    expect(item).toMatchObject({ ownerCount: 1, status: "in_closet", currentOwnerId: ids.parentIds.jo, childId: pea.id,
      photos: ["dress.jpg"], originalPurchaseDate: "2026-06-01T12:00:00.000Z",
      ownershipHistory: [{ ownerId: ids.parentIds.jo, from: "2026-06-01T12:00:00.000Z" }] });
    expect(item.predictedOutgrowDate).toBe(predictOutgrow("9-12M", pea.birthDate, "2026-06-01T12:00:00.000Z"));
  });

  it("defaults the purchase date to the demo clock and photos to []", async () => {
    await setNow(DEMO_DATES.nudge);
    const item = await recordPurchase(db, { parentKey: "mina", name: "Blue tee", category: "top", icon: "item_tee", size: "12-18M", originalPriceCents: 0 });
    expect(item.originalPurchaseDate).toBe(DEMO_DATES.nudge);
    expect(item.ownershipHistory[0].from).toBe(DEMO_DATES.nudge);
    expect(item.photos).toEqual([]);
  });

  it("rejects a negative or fractional price, an unknown size or category, and someone else's child", async () => {
    const base = { parentKey: "mina", name: "X", category: "top" as const, icon: "item_tee", size: "6-9M" as const, originalPriceCents: 100 };
    await expectHttp(recordPurchase(db, { ...base, originalPriceCents: -1 }), "bad_request", 400);
    await expectHttp(recordPurchase(db, { ...base, originalPriceCents: 1.5 }), "bad_request", 400);
    await expectHttp(recordPurchase(db, { ...base, size: "5T" as never }), "bad_request", 400);
    await expectHttp(recordPurchase(db, { ...base, category: "shoes" as never }), "bad_request", 400);
    await expectHttp(recordPurchase(db, { ...base, name: " " }), "bad_request", 400);
    const [pea] = await db.Child.filter({ parentId: ids.parentIds.jo });
    await expectHttp(recordPurchase(db, { ...base, childId: pea.id }), "forbidden", 403);
  });
});

describe("listItem", () => {
  it("lists the romper at exactly 1800, prepends the photo and stamps the demo clock", async () => {
    await setNow(DEMO_DATES.nudge);
    const listing = await listRomper();
    expect(listing).toMatchObject({ priceCents: 1800, status: "active", sellerId: ids.parentIds.mina, shared: true,
      condition: "gently_used", conditionNote: "tiny stain on the cuff", createdAt: DEMO_DATES.nudge, itemId: romperId() });
    const item = await db.ClothingItem.get(romperId());
    expect(item.status).toBe("listed");
    expect(item.photos[0]).toBe("romper.jpg");
  });

  it("prices a second-owner item at 40%", async () => {
    const l = await listItem(db, { parentKey: "mina", itemId: ids.itemIds["Knit bear sweater"], photo: "s.jpg", condition: "like_new", conditionNote: "", shared: false });
    expect(l.priceCents).toBe(1440);
    expect(l.shared).toBe(false);
  });

  it("Sam's third-owner cardigan refuses to list (not_resellable 409) and nothing is written", async () => {
    const err = await expectHttp(listItem(db, { parentKey: "sam", itemId: ids.itemIds["Oatmeal knit cardigan"], photo: "c.jpg",
      condition: "well_loved", conditionNote: "", shared: true }), "not_resellable", 409);
    expect(err.message).toBe("Final home: this item has had its 3 owners.");
    expect(await db.Listing.list()).toHaveLength(0);
    expect((await db.ClothingItem.get(ids.itemIds["Oatmeal knit cardigan"])).status).toBe("in_closet");
  });

  it("only the owner can list", async () => {
    await expectHttp(listItem(db, { parentKey: "jo", itemId: romperId(), photo: "p", condition: "gently_used", conditionNote: "", shared: true }), "forbidden", 403);
  });

  it("is idempotent: a second call returns the same active listing", async () => {
    const a = await listRomper();
    const b = await listRomper({ photo: "other.jpg" });
    expect(b.id).toBe(a.id);
    expect(await db.Listing.filter({ itemId: romperId() })).toHaveLength(1);
    expect((await db.ClothingItem.get(romperId())).photos).toEqual(["romper.jpg"]);
  });

  it("a listed item without an active listing is invalid_transition; so is pending_trade after withdraw", async () => {
    await db.ClothingItem.update(romperId(), { status: "listed" });
    await expectHttp(listRomper(), "invalid_transition", 409);
    await db.ClothingItem.update(romperId(), { status: "pending_trade" });
    await expectHttp(listRomper(), "invalid_transition", 409);
  });

  it("repairs the item if the listing exists but the item write was lost", async () => {
    const a = await listRomper();
    await db.ClothingItem.update(romperId(), { status: "in_closet" });
    const b = await listRomper();
    expect(b.id).toBe(a.id);
    expect((await db.ClothingItem.get(romperId())).status).toBe("listed");
  });

  it("resolves the open outgrow_check nudge for the item, and only that one", async () => {
    const mina = ids.parentIds.mina;
    const n = await db.AgentNudge.create({ parentId: mina, itemId: romperId(), kind: "outgrow_check", message: "m", createdAt: DEMO_DATES.nudge, resolved: false });
    const other = await db.AgentNudge.create({ parentId: mina, itemId: ids.itemIds["Fox-ear knit hat"], kind: "outgrow_check", message: "m", createdAt: DEMO_DATES.nudge, resolved: false });
    await listRomper();
    expect((await db.AgentNudge.get(n.id)).resolved).toBe(true);
    expect((await db.AgentNudge.get(other.id)).resolved).toBe(false);
  });

  it("rejects an unknown condition and a missing photo", async () => {
    await expectHttp(listRomper({ condition: "mint" as never }), "bad_request", 400);
    await expectHttp(listRomper({ photo: "" }), "bad_request", 400);
    await expectHttp(listItem(db, { parentKey: "mina", itemId: "nope", photo: "p", condition: "gently_used", conditionNote: "", shared: true }), "not_found", 404);
  });
});

describe("withdrawListing", () => {
  it("seller withdraws an active listing: listing withdrawn, item back in the closet", async () => {
    const l = await listRomper();
    const w = await withdrawListing(db, { parentKey: "mina", listingId: l.id });
    expect(w.status).toBe("withdrawn");
    expect((await db.ClothingItem.get(romperId())).status).toBe("in_closet");
    expect((await withdrawListing(db, { parentKey: "mina", listingId: l.id })).status).toBe("withdrawn");   // idempotent
    const again = await listRomper();                                                                  // can relist
    expect(again.id).not.toBe(l.id);
  });

  it("only the seller can withdraw", async () => {
    const l = await listRomper();
    await expectHttp(withdrawListing(db, { parentKey: "jo", listingId: l.id }), "forbidden", 403);
  });

  it("refuses while the item is pending_trade or a proposal is open, and from sold", async () => {
    const l = await listRomper();
    await db.ClothingItem.update(romperId(), { status: "pending_trade" });
    await expectHttp(withdrawListing(db, { parentKey: "mina", listingId: l.id }), "invalid_transition", 409);
    await db.ClothingItem.update(romperId(), { status: "listed" });
    await db.MatchProposal.create(proposal({ listingId: l.id, status: "both_accepted" }));
    await expectHttp(withdrawListing(db, { parentKey: "mina", listingId: l.id }), "invalid_transition", 409);
    await db.Listing.update(l.id, { status: "sold" });
    await expectHttp(withdrawListing(db, { parentKey: "mina", listingId: l.id }), "invalid_transition", 409);
    expect((await db.ClothingItem.get(romperId())).status).toBe("listed");
  });
});

describe("upsertNeed", () => {
  it("creates a need for the first child with sizes in size order, shared by default", async () => {
    await setNow(DEMO_DATES.nudge);
    const n = await upsertNeed(db, { parentKey: "mina", sizes: ["12-18M", "9-12M", "9-12M"], categories: ["top"], maxPriceCents: 1500, shared: undefined as never });
    const [bean] = await db.Child.filter({ parentId: ids.parentIds.mina });
    expect(n).toMatchObject({ parentId: ids.parentIds.mina, childId: bean.id, sizes: ["9-12M", "12-18M"], categories: ["top"],
      maxPriceCents: 1500, shared: true, createdAt: DEMO_DATES.nudge });
  });

  it("updates by needId (sizes, shared, clears the cap) and keeps createdAt", async () => {
    const [need] = await db.Need.filter({ parentId: ids.parentIds.jo });
    const withCap = await upsertNeed(db, { parentKey: "jo", needId: need.id, sizes: ["6-9M"], maxPriceCents: 2000, shared: true });
    expect(withCap.maxPriceCents).toBe(2000);
    const u = await upsertNeed(db, { parentKey: "jo", needId: need.id, sizes: ["6-9M", "9-12M"], shared: false });
    expect(u).toMatchObject({ id: need.id, sizes: ["6-9M", "9-12M"], shared: false, createdAt: need.createdAt, categories: [] });
    expect(u.maxPriceCents ?? null).toBeNull();
    expect(await db.Need.filter({ parentId: ids.parentIds.jo })).toHaveLength(1);
  });

  it("rejects empty or unknown sizes, unknown categories, a bad cap, and another parent's need", async () => {
    await expectHttp(upsertNeed(db, { parentKey: "jo", sizes: [], shared: true }), "bad_request", 400);
    await expectHttp(upsertNeed(db, { parentKey: "jo", sizes: ["7T" as never], shared: true }), "bad_request", 400);
    await expectHttp(upsertNeed(db, { parentKey: "jo", sizes: ["6-9M"], categories: ["shoes" as never], shared: true }), "bad_request", 400);
    await expectHttp(upsertNeed(db, { parentKey: "jo", sizes: ["6-9M"], maxPriceCents: -5, shared: true }), "bad_request", 400);
    const [need] = await db.Need.filter({ parentId: ids.parentIds.jo });
    await expectHttp(upsertNeed(db, { parentKey: "mina", needId: need.id, sizes: ["6-9M"], shared: true }), "forbidden", 403);
  });
});

describe("resolveNudge", () => {
  const nudge = (kind: "outgrow_check" | "new_owner_welcome" = "outgrow_check", item = "Yellow duck romper") =>
    db.AgentNudge.create({ parentId: ids.parentIds.mina, itemId: ids.itemIds[item], kind, message: "m", createdAt: DEMO_DATES.nudge, resolved: false });

  it("sell → open_listing; keep / snooze → none; all resolve the nudge", async () => {
    const a = await nudge();
    const r = await resolveNudge(db, { parentKey: "mina", nudgeId: a.id, action: "sell" });
    expect(r).toMatchObject({ next: "open_listing", itemId: romperId(), nudge: { id: a.id, resolved: true } });
    for (const action of ["keep", "snooze"] as const) {
      const n = await nudge();
      const res = await resolveNudge(db, { parentKey: "mina", nudgeId: n.id, action });
      expect(res.next).toBe("none");
      expect((await db.AgentNudge.get(n.id)).resolved).toBe(true);
    }
  });

  it("is idempotent on an already-resolved nudge", async () => {
    const a = await nudge();
    const first = await resolveNudge(db, { parentKey: "mina", nudgeId: a.id, action: "sell" });
    const second = await resolveNudge(db, { parentKey: "mina", nudgeId: a.id, action: "sell" });
    expect(second).toEqual(first);
  });

  it("the nudge must belong to the caller; the action must be known", async () => {
    const a = await nudge();
    await expectHttp(resolveNudge(db, { parentKey: "jo", nudgeId: a.id, action: "keep" }), "forbidden", 403);
    await expectHttp(resolveNudge(db, { parentKey: "mina", nudgeId: a.id, action: "burn" as never }), "bad_request", 400);
    await expectHttp(resolveNudge(db, { parentKey: "mina", nudgeId: "nope", action: "keep" }), "not_found", 404);
    expect((await db.AgentNudge.get(a.id)).resolved).toBe(false);
  });

  it("never says open_listing for a third-owner item", async () => {
    const n = await db.AgentNudge.create({ parentId: ids.parentIds.sam, itemId: ids.itemIds["Oatmeal knit cardigan"], kind: "new_owner_welcome",
      message: "m", createdAt: DEMO_DATES.nudge, resolved: false });
    expect((await resolveNudge(db, { parentKey: "sam", nudgeId: n.id, action: "sell" })).next).toBe("none");
  });

  it("chain: resolve sell → listItem returns priceCents 1800", async () => {
    const a = await nudge();
    const r = await resolveNudge(db, { parentKey: "mina", nudgeId: a.id, action: "sell" });
    const l = await listItem(db, { parentKey: "mina", itemId: r.itemId, photo: "p.jpg", condition: "gently_used", conditionNote: "", shared: true });
    expect(l.priceCents).toBe(1800);
    const item: ClothingItem = await db.ClothingItem.get(r.itemId);
    expect(item.status).toBe("listed");
  });
});

describe("withRetry", () => {
  it("retries rate-limited calls with backoff and passes other errors straight through", async () => {
    const { withRetry } = await import("./closet.ts");
    let calls = 0;
    const flaky = { Thing: {
      async get(id: string) { calls++; if (calls < 3) throw Object.assign(new Error("Rate limit exceeded"), { status: 429 }); return { id }; },
      async boom() { calls++; throw new Error("nope"); },
    } };
    const db = withRetry(flaky, [1, 1, 1]);
    expect(await db.Thing.get("a")).toEqual({ id: "a" });
    expect(calls).toBe(3);
    calls = 0;
    await expect(db.Thing.boom()).rejects.toThrow("nope");
    expect(calls).toBe(1);
    calls = -10;                                         // always rate limited → gives up after the last delay
    await expect(db.Thing.get("b")).rejects.toThrow("Rate limit exceeded");
    expect(calls).toBe(-6);
  });

  it("works transparently over fakeDb for a whole handler", async () => {
    const { withRetry } = await import("./closet.ts");
    const l = await listItem(withRetry(db), { parentKey: "mina", itemId: romperId(), photo: "p", condition: "gently_used", conditionNote: "", shared: true });
    expect(l.priceCents).toBe(1800);
  });
});

describe("getCloset ordering when the demo clock ties (every run happens at Oct 18 17:00)", () => {
  it("keeps the 5 NEWEST terminal proposals, newest first, on fakeDb (insertion order)", async () => {
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push((await db.MatchProposal.create(proposal({ status: "paid", createdAt: DEMO_DATES.meet }))).id);
    const open = await db.MatchProposal.create(proposal({ status: "open", createdAt: DEMO_DATES.meet }));
    const c = await getCloset(db, { parentKey: "jo" });
    expect(c.proposals.map((p) => p.id)).toEqual([open.id, ...made.slice(2).reverse()]);
  });

  it("uses Base44's real created_date to break the tie", async () => {
    const stamps = ["2026-10-18T05:10:00.000000", "2026-10-18T05:30:00.000000", "2026-10-18T05:20:00.000000"];
    const ids: string[] = [];
    for (const created_date of stamps) {
      ids.push((await db.MatchProposal.create({ ...proposal({ status: "declined", createdAt: DEMO_DATES.meet }), created_date } as never)).id);
    }
    const c = await getCloset(db, { parentKey: "mina" });
    expect(c.proposals.map((p) => p.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("listings newest first and nudges oldest first under the same tie", async () => {
    const mina = ids.parentIds.mina;
    const n1 = await db.AgentNudge.create({ parentId: mina, itemId: romperId(), kind: "outgrow_check", message: "1", createdAt: DEMO_DATES.nudge, resolved: false });
    const n2 = await db.AgentNudge.create({ parentId: mina, itemId: romperId(), kind: "listing_reminder", message: "2", createdAt: DEMO_DATES.nudge, resolved: false });
    const first = await db.Listing.create({ itemId: romperId(), sellerId: mina, condition: "gently_used", conditionNote: "", priceCents: 1800, shared: true, status: "withdrawn", createdAt: DEMO_DATES.nudge });
    const second = await db.Listing.create({ itemId: romperId(), sellerId: mina, condition: "gently_used", conditionNote: "", priceCents: 1800, shared: true, status: "sold", createdAt: DEMO_DATES.nudge });
    const c = await getCloset(db, { parentKey: "mina" });
    expect(c.listings.map((l) => l.id)).toEqual([second.id, first.id]);
    expect(c.nudges.map((n) => n.id)).toEqual([n1.id, n2.id]);
  });
});
