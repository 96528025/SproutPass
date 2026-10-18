// demoReset / demoClock / getStats / selfTest on fakeDb.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "../testing/fakeDb.ts";
import { DEMO_DATES } from "../seed.ts";
import { demoClock, demoReset, getStats, realTime, selfTest } from "./demo.ts";
import { getCloset, listItem, resolveNudge } from "./closet.ts";

let db: FakeDb;
beforeEach(async () => {
  db = createFakeDb();
  await demoReset(db, { MINA_PHONE: "+15555550101", JO_PHONE: undefined });
});

describe("demoReset", () => {
  it("seeds, keeps phones server-side, and drops unset secrets", async () => {
    const parents = await db.Parent.list();
    expect(parents.map((p) => p.key).sort()).toEqual(["jo", "mina", "sam"]);
    expect(parents.find((p) => p.key === "mina")!.phone).toBe("+15555550101");
    expect(parents.find((p) => p.key === "jo")!).not.toHaveProperty("phone");
    const [s] = await db.Setting.list();
    expect(s.now).toBe(DEMO_DATES.start);
  });

  it("wipes everything (including nudges and inbox rows) on a second run", async () => {
    await demoClock(db, { now: DEMO_DATES.nudge });
    expect(await db.AgentInbox.list()).toHaveLength(1);
    await demoReset(db, {});
    expect(await db.AgentNudge.list()).toHaveLength(0);
    expect(await db.AgentInbox.list()).toHaveLength(0);
    expect(await db.ClothingItem.list()).toHaveLength(17);
  });
});

describe("demoClock", () => {
  it("reading the clock (no now) returns the current time and nudges nothing at the start", async () => {
    expect(await demoClock(db, {})).toEqual({ now: DEMO_DATES.start, nudgesCreated: 0 });
  });

  it("Sep 20 creates exactly one romper nudge and one inbox event; again creates nothing", async () => {
    const r = await demoClock(db, { now: DEMO_DATES.nudge });
    expect(r).toEqual({ now: DEMO_DATES.nudge, nudgesCreated: 1 });
    const nudges = await db.AgentNudge.list();
    expect(nudges).toHaveLength(1);
    const [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
    const [mina] = await db.Parent.filter({ key: "mina" });
    expect(nudges[0]).toMatchObject({ itemId: romper.id, parentId: mina.id, kind: "outgrow_check", resolved: false, createdAt: DEMO_DATES.nudge });
    expect(nudges[0].message).toBe("Button here! The yellow duck romper (6-9M) is probably getting snug — still fit, or want to pass it on?");
    const inbox = await db.AgentInbox.list();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ parentId: mina.id, type: "event", status: "pending",
      payload: { type: "nudge:new", nudgeId: nudges[0].id, itemId: romper.id, kind: "outgrow_check", message: nudges[0].message } });
    expect(await demoClock(db, { now: DEMO_DATES.nudge })).toEqual({ now: DEMO_DATES.nudge, nudgesCreated: 0 });
    expect(await db.AgentInbox.list()).toHaveLength(1);
  });

  it("the Setting row holds the new time and getCloset shows the nudge", async () => {
    await demoClock(db, { now: DEMO_DATES.nudge });
    const [s] = await db.Setting.list();
    expect(s.now).toBe(DEMO_DATES.nudge);
    const c = await getCloset(db, { parentKey: "mina" });
    expect(c.now).toBe(DEMO_DATES.nudge);
    expect(c.nudges).toHaveLength(1);
    expect(c.childAgeMonths).toBe(9);
  });

  it("a kept nudge is never re-created for the same owner, and Oct 18 adds nothing new", async () => {
    await demoClock(db, { now: DEMO_DATES.nudge });
    const [n] = await db.AgentNudge.list();
    await resolveNudge(db, { parentKey: "mina", nudgeId: n.id, action: "keep" });
    expect((await demoClock(db, { now: DEMO_DATES.meet })).nudgesCreated).toBe(0);
  });

  it("normalises the date and rejects garbage", async () => {
    expect((await demoClock(db, { now: "2026-09-20T17:00:00Z" })).now).toBe(DEMO_DATES.nudge);
    await expect(demoClock(db, { now: "not a date" })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("creates the Setting row if it is missing", async () => {
    for (const s of await db.Setting.list()) await db.Setting.delete(s.id);
    const r = await demoClock(db, { now: DEMO_DATES.meet });
    expect(r.now).toBe(DEMO_DATES.meet);
    expect(await db.Setting.list()).toHaveLength(1);
  });

  it("a listing active for 30+ days gets one reminder", async () => {
    await demoClock(db, { now: DEMO_DATES.nudge });
    const [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
    await listItem(db, { parentKey: "mina", itemId: romper.id, photo: "p", condition: "gently_used", conditionNote: "", shared: true });
    expect((await demoClock(db, { now: DEMO_DATES.meet })).nudgesCreated).toBe(0);     // Oct 18 is only 28 days
    expect((await demoClock(db, { now: "2026-10-21T17:00:00.000Z" })).nudgesCreated).toBe(1);
    expect((await demoClock(db, { now: "2026-10-22T17:00:00.000Z" })).nudgesCreated).toBe(0);
    const [reminder] = await db.AgentNudge.filter({ kind: "listing_reminder" });
    expect(reminder.message).toBe("Button here! Your yellow duck romper is still waiting for its next home at $18.00 — keep it listed, or bring it back to the closet?");
  });
});

describe("getStats", () => {
  it("counts, chains with names, and Earlier family for former owners", async () => {
    const s = await getStats(db);
    expect(s).toMatchObject({ encounters: 0, proposals: 0, trades: 0, declinedWithZeroCharge: 0, secondsToList: [] });
    expect(s.items).toHaveLength(17);
    const cardigan = s.items.find((i) => i.name === "Oatmeal knit cardigan")!;
    expect(cardigan.chain.map((c) => c.ownerName)).toEqual(["Earlier family", "Earlier family", "Sam"]);
    expect(cardigan.chain[1].priceCents).toBe(2400);
    expect(s.items[0].ownerCount).toBe(3);                                                // most-travelled first
    const sweater = s.items.find((i) => i.name === "Knit bear sweater")!;
    expect(sweater.chain).toEqual([
      { ownerName: "Sam", from: "2025-08-15T17:00:00.000Z", to: "2026-04-28T17:00:00.000Z" },
      { ownerName: "Mina", from: "2026-04-28T17:00:00.000Z", priceCents: 2160 },
    ]);
  });

  it("secondsToList uses real created_date (listing − its outgrow nudge)", async () => {
    await demoClock(db, { now: DEMO_DATES.nudge });
    const [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
    const [nudge] = await db.AgentNudge.list();
    await db.AgentNudge.update(nudge.id, { created_date: "2026-10-18T04:44:00.000000" } as never);
    const l = await listItem(db, { parentKey: "mina", itemId: romper.id, photo: "p", condition: "gently_used", conditionNote: "", shared: true });
    await db.Listing.update(l.id, { created_date: "2026-10-18T04:44:42.500000" } as never);
    expect((await getStats(db)).secondsToList).toEqual([42.5]);
  });

  it("realTime treats a zone-less Base44 created_date as UTC", () => {
    expect(realTime({ created_date: "2026-10-18T04:44:00.332000" })).toBe(Date.parse("2026-10-18T04:44:00.332Z"));
    expect(realTime({ created_date: "2026-10-18T04:44:00Z" })).toBe(Date.parse("2026-10-18T04:44:00Z"));
    expect(realTime({})).toBeNull();
  });
});

describe("selfTest", () => {
  it("runs every check on its own in-memory seed and never touches the given db", async () => {
    const before = JSON.stringify(db._dump());
    const r = await selfTest(db);
    expect(JSON.stringify(db._dump())).toBe(before);
    expect(r.results.length).toBeGreaterThanOrEqual(13);
    expect(r.passed + r.failed).toBe(r.results.length);
    const failed = r.results.filter((x) => !x.pass);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });
});
