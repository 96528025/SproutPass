// (C) The proximity pop-up rule (c/location.ts) on fakeDb: a meeting pops up on both phones only when something shared
// fits, one way or the other (Encounter.hasMatch), and the pair cooldown only counts a meeting that could have popped.
//   - hasMatch is set when the row is created (B's findMatches both ways, before the buyer's pet rules), and a live
//     schema that doesn't know the field yet gets the create again without it: the meeting always starts;
//   - every meeting still reaches both agents' inboxes (the Fetch agents talk them all through);
//   - the reproduced bug: a no-match meeting, the seller lists a fitting item, they walk apart and meet again ~30 s
//     later (inside the 2-min demo cooldown) → a NEW meeting (not deleted by lostRace) and a proposal;
//   - a meeting that popped (open, declined or unknown trade) still holds the cooldown, and the walker's response
//     says for how long; a PAID trade lifts it at once;
//   - a pair with nothing to trade keeps its cooldown (no meeting at every 25 m / 40 m crossing) until something fits;
//   - two parents still together after a meeting with nothing to trade meet again once something fits (real GPS), and
//     A's WALK AGAIN (no reset: on from where the last walk stopped) meets again or hears the wait — never silence;
//   - when both ways fit, the smaller parentId buys first, whoever walked (the agents' rule);
//   - the same rules with PairState, including two phones racing the pair's first meeting.
// The seed's own listings / needs are dropped: each test builds what it needs (sizes from the seed children's ages),
// so a richer demo seed never changes what these tests see.
// A vitest file: it lives here, not in c/, so `deno test base44/shared/c/` only finds the Deno suites (like agentApi.test.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "./testing/fakeDb.ts";
import { applySeed, DEMO_DATES, seedPlan } from "./seed.ts";
import { demoClock } from "./logic/demo.ts";
import { listItem, recordPurchase, upsertNeed } from "./logic/closet.ts";
import { decideProposal, payProposal } from "./logic/trade.ts";
import { findMatches } from "./cbridge.ts";
import { fitsNow, SIZE_ORDER } from "./sizes.ts";
import type { Category, ClothingItem, Encounter, MatchProposal, SizeLabel } from "./types.ts";
import { COOLDOWN_DEMO_MS, COOLDOWN_MS, DEMO_LAWN, destination } from "./c/geo.ts";
import { demoWalk, detectEncounters, type LocationDeps, STAND_AGAIN_MS, updatePresence } from "./c/location.ts";

let db: FakeDb;
let ids: { mina: string; jo: string; sam: string };
/** The real clock the handlers see (deps.nowMs): moved by hand, one second per walk step. */
let t: number;

/** A's ?demo=1 fake fix (the server keeps each simulated parent on its own demo spot). */
const FIX = { lat: 34.0689, lng: -118.4452, accuracyM: 12, simulated: true };

/** B's mock deps: every tick reads everything, the fallback answers on the same tick. */
const deps = (): LocationDeps => ({ findMatches, recheck: true, fallbackAfterMs: 0, talkMs: () => 0, nowMs: t });

beforeEach(async () => {
  db = createFakeDb();
  ids = (await applySeed(db, { ...seedPlan(), listings: [], needs: [] })).parentIds as typeof ids;
  await demoClock(db, { now: DEMO_DATES.meet });
  t = Date.now();
});

const iso = (ms: number) => new Date(ms).toISOString();
const encounters = () => db.Encounter.list("-startedAt") as Promise<Encounter[]>;
const proposals = () => db.MatchProposal.list("-createdAt") as Promise<MatchProposal[]>;
const inbox = () => db.AgentInbox.filter({ type: "encounter" });
/** Seconds left on the pair's 2-min demo cooldown from a meeting at `metAt`, as the response rounds them. */
const left = (metAt: number) => Math.ceil((metAt + COOLDOWN_DEMO_MS - t) / 1000);

/** The size this parent's child wears today (Oct 18), from the seed's birth date. */
async function sizeNow(parentId: string): Promise<SizeLabel> {
  const [child] = await db.Child.filter({ parentId });
  return SIZE_ORDER.find((s) => fitsNow(s, child.birthDate, DEMO_DATES.meet))!;
}

/** `sellerId` has an item in `buyerId`'s child's size ($30 new → $18 to the 2nd owner, under the $50 default limit). */
async function itemFor(sellerId: string, buyerId: string, name: string, category: Category): Promise<ClothingItem> {
  return await recordPurchase(db, {
    parentId: sellerId, name, category, icon: "item_tee", size: await sizeNow(buyerId), originalPriceCents: 3000,
    purchaseDate: "2026-06-01T17:00:00.000Z",
  });
}

const list = (sellerId: string, item: ClothingItem) =>
  listItem(db, { parentId: sellerId, itemId: item.id, photo: `${item.id}.jpg`, condition: "gently_used", conditionNote: "", shared: true });

/** …and lists it, shared. */
async function listFor(sellerId: string, buyerId: string, name: string, category: Category) {
  return await list(sellerId, await itemFor(sellerId, buyerId, name, category));
}

/** A shared need for this parent's child's size today. */
async function need(parentId: string, categories: Category[]) {
  return await upsertNeed(db, { parentId, sizes: [await sizeNow(parentId)], categories, shared: true });
}

/**
 * A's WALK TOWARD: reset (120 m out, so the pair re-arms), then a 5 m step a second until a meeting starts or the
 * cooldown answers (at most 30 steps: the walker is at the target by then).
 */
async function walk(walker: string, target: string, on: unknown = db) {
  let res = await demoWalk(on, { parentId: walker, targetParentId: target, reset: true }, deps());
  for (let n = 0; !res.encounters.length && !res.cooldown?.length && n < 30; n++) {
    t += 1_000;
    res = await demoWalk(on, { parentId: walker, targetParentId: target }, deps());
  }
  return res;
}

describe("hasMatch: a meeting says whether anything shared fits, either way", () => {
  it("nothing on either list: the meeting is still written, both inboxes hear it, hasMatch false on row and response", async () => {
    await need(ids.jo, ["onesie"]); // a need, but nothing listed anywhere
    const res = await walk(ids.jo, ids.mina);
    expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: false }]);
    expect(res.cooldown).toBeUndefined();
    const enc = await db.Encounter.get(res.encounters[0].id);
    expect(enc).toMatchObject({ aId: ids.jo, bId: ids.mina, hasMatch: false, status: "no_match" });
    // the Fetch agents still talk it through (their no-fit exchange); only the app keeps it off the screen
    const rows = await inbox();
    expect(rows.map((r) => r.parentId).sort()).toEqual([ids.jo, ids.mina].sort());
    expect(rows.every((r) => r.payload.encounterId === enc.id)).toBe(true);
    expect(await proposals()).toEqual([]);
  });

  it("a fitting listing: hasMatch true, and the meeting ends in a proposal", async () => {
    await need(ids.jo, ["onesie"]);
    const listing = await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    const res = await walk(ids.jo, ids.mina);
    expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: true }]);
    const id = res.encounters[0].id;
    expect(res.fallback).toEqual([id]);
    const [prop] = await proposals();
    expect(prop).toMatchObject({ encounterId: id, listingId: listing.id, buyerId: ids.jo, sellerId: ids.mina, status: "open" });
    expect(await db.Encounter.get(id)).toMatchObject({ hasMatch: true, status: "proposed", proposalId: prop.id });
    expect(await inbox()).toHaveLength(2);
  });

  it("hasMatch is judged before the buyer's pet rules: a match those rules stop still pops (the pets say which rule)", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    await db.Parent.update(ids.jo, { mandate: { agentMayPropose: true, maxPriceCents: 1000, monthlyBudgetCents: 10_000, categories: [], requirePasskey: false } });
    const res = await walk(ids.jo, ids.mina);
    expect(res.encounters).toMatchObject([{ hasMatch: true }]);
    const enc = await db.Encounter.get(res.encounters[0].id);
    expect(enc).toMatchObject({ hasMatch: true, status: "no_match" });
    expect(enc.transcript.at(-1)).toMatchObject({ kind: "decline", parentId: ids.jo });
    expect(await proposals()).toEqual([]);
  });

  it("the other way counts too: only the walker's own listing fits the target's need", async () => {
    await need(ids.mina, ["outerwear"]);
    await listFor(ids.jo, ids.mina, "Rain jacket", "outerwear");
    const res = await walk(ids.jo, ids.mina);
    expect(res.encounters).toMatchObject([{ peerId: ids.mina, hasMatch: true }]);
    expect((await proposals())[0]).toMatchObject({ buyerId: ids.mina, sellerId: ids.jo });
  });

  it("a live schema that doesn't know hasMatch yet: the create is retried without it and the meeting still starts", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    const refused: unknown[] = [];
    // Base44 refuses a field the pushed schema doesn't have (fakeDb's methods are closures: no `this` to bind)
    const Encounter = new Proxy(db.Encounter, {
      get: (e, k) => k !== "create" ? Reflect.get(e, k) : async (row: Omit<Encounter, "id">) => {
        if ("hasMatch" in row) {
          refused.push(row);
          throw new Error("Encounter: unknown field 'hasMatch'");
        }
        return await e.create(row);
      },
    });
    const oldSchema = new Proxy(db, { get: (d, k) => (k === "Encounter" ? Encounter : Reflect.get(d, k)) });

    const res = await walk(ids.jo, ids.mina, oldSchema);
    expect(refused).toMatchObject([{ aId: ids.jo, bId: ids.mina, hasMatch: true }]);
    // the row couldn't keep it, so the response says "unknown" too: the walker's tab and the EncounterScene agree
    expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina }]);
    const enc = await db.Encounter.get(res.encounters[0].id);
    expect(enc).not.toHaveProperty("hasMatch");
    expect(enc.status).toBe("proposed");
    expect(await inbox()).toHaveLength(2);

    // unknown counts as a meeting that popped: meeting again inside the cooldown is held, as before
    const metAt = Date.parse(enc.startedAt);
    t += 5_000;
    const again = await walk(ids.jo, ids.mina, oldSchema);
    expect(again.encounters).toEqual([]);
    expect(again.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);
  });
});

describe("the pair cooldown only counts a meeting that could have popped up", () => {
  it("THE REPRODUCED BUG: no match → the seller lists a fitting item → walk apart → meet again 30 s later → a new meeting and a proposal", async () => {
    await need(ids.jo, ["onesie"]);
    const romper = await itemFor(ids.mina, ids.jo, "Duck romper", "onesie"); // in Caesar's closet, not listed yet
    await updatePresence(db, { parentId: ids.mina, ...FIX }, deps());

    const first = await walk(ids.jo, ids.mina);
    expect(first.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: false }]);
    const metAt = t;

    await list(ids.mina, romper);
    t += 10_000; // listing it takes Caesar a moment; then Olivia walks out (120 m: re-armed) and back in 5 m steps
    const again = await walk(ids.jo, ids.mina);
    expect(t - metAt).toBeGreaterThanOrEqual(29_000);
    expect(t - metAt).toBeLessThan(COOLDOWN_DEMO_MS); // inside the old meeting's 2-min cooldown
    expect(again.cooldown).toBeUndefined();
    expect(again.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: true }]);

    // the new row survived lostRace (the no-match row is inside the window but older than this meeting)
    const [latest, old] = await encounters();
    expect(old.id).toBe(first.encounters[0].id);
    expect(latest).toMatchObject({ id: again.encounters[0].id, hasMatch: true, status: "proposed" });
    const [prop] = await proposals();
    expect(prop).toMatchObject({ encounterId: latest.id, itemId: romper.id, buyerId: ids.jo, sellerId: ids.mina, status: "open" });
    expect(latest.proposalId).toBe(prop.id);
    expect(await inbox()).toHaveLength(4); // both meetings reached both agents
  });

  it("a meeting that popped holds the cooldown (open trade, then declined); the walker hears how long", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    await updatePresence(db, { parentId: ids.mina, ...FIX }, deps());
    const first = await walk(ids.jo, ids.mina);
    expect(first.encounters).toMatchObject([{ hasMatch: true }]);
    const metAt = t;
    const [prop] = await proposals();

    t += 5_000;
    const again = await walk(ids.jo, ids.mina);
    expect(again.distanceM).toBeLessThanOrEqual(25); // arrived…
    expect(again.encounters).toEqual([]); // …but nothing starts
    expect(again.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);
    expect(again.cooldown![0].retryInS).toBeGreaterThan(60);
    expect(again.cooldown![0].retryInS).toBeLessThan(120);
    // the target's own heartbeat doesn't judge a simulated pair (only the walker does), so it hears nothing
    expect(await updatePresence(db, { parentId: ids.mina, ...FIX }, deps())).not.toHaveProperty("cooldown");
    // a hold tick a few seconds later counts down
    t += 3_000;
    const hold = await demoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 1 }, deps());
    expect(hold.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);

    // declined: it still popped, so it still holds
    await decideProposal(db, { parentId: ids.jo, proposalId: prop.id, decision: "declined" });
    t += 5_000;
    const third = await walk(ids.jo, ids.mina);
    expect(third.encounters).toEqual([]);
    expect(third.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);
    expect(await encounters()).toHaveLength(1);

    // once the cooldown is over they meet again
    t = metAt + COOLDOWN_DEMO_MS;
    const later = await walk(ids.jo, ids.mina);
    expect(later.cooldown).toBeUndefined();
    expect(later.encounters).toHaveLength(1);
    expect(await encounters()).toHaveLength(2);
  });

  it("after a PAID trade the pair can meet again at once (and trade the next thing)", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    await listFor(ids.mina, ids.jo, "Frog romper", "onesie");
    const first = await walk(ids.jo, ids.mina);
    const [p1] = await proposals();
    expect(p1.encounterId).toBe(first.encounters[0].id);
    await decideProposal(db, { parentId: ids.mina, proposalId: p1.id, decision: "accepted" });
    await decideProposal(db, { parentId: ids.jo, proposalId: p1.id, decision: "accepted" });
    await payProposal(db, { parentId: ids.jo, proposalId: p1.id }, { delayMs: 0 });
    expect((await db.MatchProposal.get(p1.id)).status).toBe("paid");

    t += 5_000;
    const again = await walk(ids.jo, ids.mina);
    expect(again.cooldown).toBeUndefined();
    expect(again.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: true }]);
    expect(await encounters()).toHaveLength(2); // not deleted by lostRace
    const p2 = (await proposals()).find((p) => p.id !== p1.id)!;
    expect(p2).toMatchObject({ encounterId: again.encounters[0].id, buyerId: ids.jo, status: "open" });
    expect(p2.listingId).not.toBe(p1.listingId);
  });

  it("two ticks crossing 25 m at once right after a no-match meeting still make ONE new meeting", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    // their last meeting, 30 s ago, found nothing (before the listing); they walked apart since (re-armed)
    const old = await db.Encounter.create({
      aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "no_match", hasMatch: false,
      startedAt: iso(t - 30_000), rearmedAt: iso(t - 15_000), transcript: [],
    });
    const mina = { parentId: ids.mina, ...DEMO_LAWN, accuracyM: 5, simulated: true, updatedAt: iso(t) };
    const jo = { ...mina, parentId: ids.jo, ...destination(DEMO_LAWN, 0, 10) };
    await db.Presence.create(mina);
    await db.Presence.create(jo);
    const parents = new Map((await db.Parent.list()).map((p) => [p.id, p]));
    const seen: string[] = [];
    const off = db._on((e) => { if (e.entity === "Encounter") seen.push(e.type); });
    const opts = { presences: [mina, jo], mover: true, recheck: true, findMatches };
    const [a, b] = await Promise.all([
      detectEncounters(db, jo, parents, t, opts),
      detectEncounters(db, mina, parents, t, opts),
    ]);
    off();
    expect(seen.filter((x) => x === "create")).toHaveLength(2); // both lifted the cooldown and created…
    expect(seen.filter((x) => x === "delete")).toHaveLength(1); // …the later row removed itself, the old one stays
    expect([...a.created, ...b.created]).toEqual([{ id: expect.any(String), peerId: expect.any(String), hasMatch: true }]);
    const rows = await encounters();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toContain(old.id);
    expect(await inbox()).toHaveLength(2);
  });
});

/** A real phone's fix `d` m due north of the demo lawn (not simulated: both phones' ticks judge, 10-min cooldown). */
const real = (d: number) => ({ ...destination(DEMO_LAWN, 0, d), accuracyM: 10, simulated: false });

describe("a pair with nothing to trade keeps its cooldown", () => {
  it("real GPS, nothing listed, crossing 45 m / 20 m every 5 s for 3 min: ONE meeting, each crossing hears the wait; a listing then meets at once", async () => {
    await need(ids.jo, ["onesie"]);
    const romper = await itemFor(ids.mina, ids.jo, "Duck romper", "onesie");
    await updatePresence(db, { parentId: ids.mina, ...real(0) }, deps());
    let metAt = 0;
    for (let i = 0; i < 36; i++) {
      t += 5_000;
      const res = await updatePresence(db, { parentId: ids.jo, ...real(i % 2 ? 20 : 45) }, deps());
      await updatePresence(db, { parentId: ids.mina, ...real(0) }, deps());
      if (i === 1) {
        expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: false }]);
        metAt = t;
      } else {
        expect(res.encounters).toEqual([]);
        // back within 25 m (re-armed at 45 m), still inside the 10-min cooldown: held, with the seconds left
        if (i % 2) expect(res).toMatchObject({ cooldown: [{ peerId: ids.mina, retryInS: Math.ceil((metAt + COOLDOWN_MS - t) / 1000) }] });
      }
    }
    expect(await encounters()).toMatchObject([{ hasMatch: false }]);
    expect(await inbox()).toHaveLength(2); // the agents talked it through once, not at every crossing

    await list(ids.mina, romper); // now something fits: the next crossing (still inside the cooldown) meets
    t += 5_000;
    await updatePresence(db, { parentId: ids.jo, ...real(45) }, deps());
    t += 5_000;
    const again = await updatePresence(db, { parentId: ids.jo, ...real(20) }, deps());
    expect(again.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: true }]);
    expect(again).not.toHaveProperty("cooldown");
    expect((await proposals())[0]).toMatchObject({ encounterId: again.encounters[0].id, buyerId: ids.jo, itemId: romper.id });
  });
});

describe("two parents still together: a match that appears while they stand there pops", () => {
  /** Both phones' heartbeats (real GPS, 10 m apart); the meetings either tick started. */
  const tick = async () => [
    ...(await updatePresence(db, { parentId: ids.mina, ...real(0) }, deps())).encounters,
    ...(await updatePresence(db, { parentId: ids.jo, ...real(10) }, deps())).encounters,
  ];

  it("nothing fits, they stay 10 m apart, Caesar lists a fitting item: the next look (≤ 30 s) meets, once", async () => {
    await need(ids.jo, ["onesie"]);
    const romper = await itemFor(ids.mina, ids.jo, "Duck romper", "onesie");
    expect(await tick()).toEqual([{ id: expect.any(String), peerId: expect.any(String), hasMatch: false }]);
    for (let i = 0; i < 8; i++) { // 2 min standing there with nothing to trade: no new meeting
      t += 15_000;
      expect(await tick()).toEqual([]);
    }
    await list(ids.mina, romper);
    const listedAt = t;
    let again: Awaited<ReturnType<typeof tick>> = [];
    while (!again.length && t - listedAt < STAND_AGAIN_MS) {
      t += 15_000;
      again = await tick();
    }
    expect(again).toEqual([{ id: expect.any(String), peerId: expect.any(String), hasMatch: true }]);
    const [prop] = await proposals();
    expect(prop).toMatchObject({ encounterId: again[0].id, buyerId: ids.jo, sellerId: ids.mina, itemId: romper.id, status: "open" });
    expect(await inbox()).toHaveLength(4);
    // that meeting popped (an open trade): standing there doesn't repeat it
    for (let i = 0; i < 8; i++) {
      t += 15_000;
      expect(await tick()).toEqual([]);
    }
    expect(await encounters()).toHaveLength(2);
  });
});

describe("WALK AGAIN as A sends it: no reset, on from where the last walk stopped", () => {
  /**
   * useDemoWalk's requests: 20 m steps every 2.5 s until a meeting, a cooldown or ≤ 25 m; then (unless held) 1 m hold
   * ticks every 4 s for 30 s. Returns the walk's last step and every hold tick's answer.
   */
  async function walkAgain(walker: string, target: string) {
    let step = await demoWalk(db, { parentId: walker, targetParentId: target, stepM: 20 }, deps());
    for (let n = 0; !step.encounters.length && !step.cooldown?.length && step.distanceM > 25 && n < 10; n++) {
      t += 2_500;
      step = await demoWalk(db, { parentId: walker, targetParentId: target, stepM: 20 }, deps());
    }
    const holds = [];
    for (let n = 0; !step.cooldown?.length && n < 7; n++) {
      t += 4_000;
      holds.push(await demoWalk(db, { parentId: walker, targetParentId: target, stepM: 1 }, deps()));
    }
    return { step, holds };
  }
  const quiet = (holds: { encounters: unknown[]; cooldown?: unknown }[]) => holds.every((h) => !h.encounters.length && !h.cooldown);

  it("nothing fits → Caesar lists the romper → WALK AGAIN (still standing there) meets at once; its hold ticks stay quiet", async () => {
    await need(ids.jo, ["onesie"]);
    const romper = await itemFor(ids.mina, ids.jo, "Duck romper", "onesie");
    const first = await walkAgain(ids.jo, ids.mina);
    expect(first.step.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: false }]);
    expect(quiet(first.holds)).toBe(true); // a walk never re-judges the meeting it just made

    await list(ids.mina, romper);
    t += 10_000;
    const again = await walkAgain(ids.jo, ids.mina);
    expect(again.step.distanceM).toBeLessThanOrEqual(25); // no 120 m reset: the walker never left
    expect(again.step.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: true }]);
    expect(quiet(again.holds)).toBe(true);
    const [prop] = await proposals();
    expect(prop).toMatchObject({ encounterId: again.step.encounters[0].id, buyerId: ids.jo, itemId: romper.id });
  });

  it("a meeting that popped: WALK AGAIN inside the cooldown hears the wait; once it is over, WALK AGAIN meets again", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    const first = await walkAgain(ids.jo, ids.mina);
    expect(first.step.encounters).toMatchObject([{ hasMatch: true }]);
    expect(quiet(first.holds)).toBe(true);
    const metAt = Date.parse((await encounters())[0].startedAt);

    t += 20_000;
    const held = await walkAgain(ids.jo, ids.mina);
    expect(held.step.encounters).toEqual([]);
    expect(held.step.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);

    t = metAt + COOLDOWN_DEMO_MS;
    const later = await walkAgain(ids.jo, ids.mina);
    expect(later.step.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: expect.any(Boolean) }]);
    expect(await encounters()).toHaveLength(2);
  });

  it("a meeting the other phone started while the walk was still stepping in: the next step neither re-meets nor calls it a cooldown", async () => {
    await need(ids.jo, ["onesie"]);
    await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
    await updatePresence(db, { parentId: ids.mina, ...real(0) }, deps()); // Caesar on real GPS, on the lawn
    await demoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, reset: true }, deps()); // Olivia's walker, 120 m north
    let step = await demoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 20 }, deps());
    while (step.distanceM > 40) {
      t += 2_500;
      step = await demoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 20 }, deps());
    }
    expect(step.encounters).toEqual([]);
    // Caesar walks 20 m toward the walker: his own heartbeat (real GPS: it judges) starts the meeting…
    t += 1_000;
    const his = await updatePresence(db, { parentId: ids.mina, ...real(20) }, deps());
    expect(his.encounters).toMatchObject([{ peerId: ids.jo, hasMatch: true }]);
    // …and the walk's next step a second later: that meeting is the one up, not "you met a moment ago"
    t += 1_000;
    const next = await demoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 20 }, deps());
    expect(next.encounters).toEqual([]);
    expect(next.cooldown).toBeUndefined();
    expect(await encounters()).toHaveLength(1);
  });
});

describe("who buys: the smaller parentId first, whoever walked (the agents' rule)", () => {
  for (const walker of ["jo", "mina"] as const) {
    it(`both ways fit (romper → Olivia, rain jacket → Caesar), ${walker} walking`, async () => {
      await need(ids.jo, ["onesie"]);
      await listFor(ids.mina, ids.jo, "Duck romper", "onesie");
      await need(ids.mina, ["outerwear"]);
      await listFor(ids.jo, ids.mina, "Rain jacket", "outerwear");
      const me = ids[walker], peer = walker === "jo" ? ids.mina : ids.jo;
      const [lo, hi] = [ids.jo, ids.mina].sort();

      const res = await walk(me, peer);
      expect(res.encounters).toEqual([{ id: expect.any(String), peerId: peer, hasMatch: true }]);
      const enc = await db.Encounter.get(res.encounters[0].id);
      expect(enc.aId).toBe(me); // the walker's tick started it…
      const [prop] = await proposals();
      expect(prop).toMatchObject({ buyerId: lo, sellerId: hi, encounterId: enc.id }); // …the smaller id bought
      expect(enc.transcript[0]).toMatchObject({ kind: "looking_for", parentId: lo }); // its pet opened
      // same side as the inbox role the Fetch agents follow
      const roles = Object.fromEntries((await inbox()).map((r) => [r.parentId, r.payload.role]));
      expect(roles).toEqual({ [lo]: "buyer", [hi]: "seller" });
      expect(await proposals()).toHaveLength(1); // one proposal per meeting: the other way waits for the next one
    });
  }
});

describe("PairState (live, once the entity is pushed)", () => {
  /** A minimal PairState table on the fakeDb, like Base44's entity handler (as in src/app/mockWorld.test.ts). */
  function addPairState() {
    const rows = new Map<string, Record<string, unknown> & { id: string }>();
    let n = 0;
    const table = {
      async list() { return [...rows.values()].map((r) => ({ ...r })); },
      async filter(q: Record<string, unknown>) { return [...rows.values()].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)); },
      async create(data: Record<string, unknown>) { const row = { ...data, id: `pst_${++n}` }; rows.set(row.id, row); return { ...row }; },
      async update(id: string, patch: Record<string, unknown>) { const row = { ...rows.get(id)!, ...patch, id }; rows.set(id, row); return { ...row }; },
      async delete(id: string) { rows.delete(id); return { ok: true }; },
    };
    (db as unknown as Record<string, unknown>).PairState = table;
    return rows;
  }

  it("lifts the cooldown past a no-match meeting and holds it after one that popped", async () => {
    const rows = addPairState();
    await need(ids.jo, ["onesie"]);
    const romper = await itemFor(ids.mina, ids.jo, "Duck romper", "onesie");
    const first = await walk(ids.jo, ids.mina);
    expect(first.encounters).toMatchObject([{ hasMatch: false }]);
    expect([...rows.values()]).toMatchObject([{ armed: false, lastEncounterAt: iso(t) }]);

    await list(ids.mina, romper);
    t += 10_000;
    const again = await walk(ids.jo, ids.mina);
    expect(again.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: true }]);
    const metAt = t;
    expect([...rows.values()]).toMatchObject([{ armed: false, lastEncounterAt: iso(metAt) }]);
    expect(await encounters()).toHaveLength(2);
    expect((await proposals())[0]).toMatchObject({ encounterId: again.encounters[0].id, buyerId: ids.jo });

    t += 5_000;
    const third = await walk(ids.jo, ids.mina);
    expect(third.encounters).toEqual([]);
    expect(third.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);
    expect(await encounters()).toHaveLength(2);
    // PairState keeps the bookkeeping, not the Encounter rows
    expect((await encounters()).every((e) => e.rearmedAt === undefined)).toBe(true);
  });

  it("two phones racing the pair's FIRST meeting (no PairState row yet): the late tick holds, one meeting, one row", async () => {
    const rows = addPairState();
    const mina = { parentId: ids.mina, ...real(0), updatedAt: iso(t) };
    const jo = { parentId: ids.jo, ...real(10), updatedAt: iso(t) };
    const parents = new Map((await db.Parent.list()).map((p) => [p.id, p]));
    // Olivia's tick creates the meeting (nothing fits) and writes both inbox rows; its PairState write (the disarm)
    // waits until Caesar's tick, 300 ms later, is done. Caesar's tick finds no PairState row and that fresh meeting.
    type Table = Record<string, (...a: unknown[]) => Promise<unknown>>;
    const table = (db as unknown as Record<string, Table>).PairState;
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const atDisarm = new Promise<void>((r) => (reached = r));
    const slow = new Proxy(table, {
      get: (ps, k) => (k === "create" || k === "update")
        ? async (...a: unknown[]) => { reached(); await gate; return await ps[k as string](...a); }
        : Reflect.get(ps, k),
    });
    const joDb = new Proxy(db, { get: (d, k) => (k === "PairState" ? slow : Reflect.get(d, k)) });
    const opts = { presences: [mina, jo], recheck: true, findMatches };

    const a = detectEncounters(joDb, jo, parents, t, opts);
    await atDisarm;
    const b = await detectEncounters(db, mina, parents, t + 300, opts);
    release();
    expect((await a).created).toEqual([{ id: expect.any(String), peerId: ids.mina, hasMatch: false }]);
    // a row newer than anything the pair bookkeeping knew is that same meeting in flight: it holds, never lifts
    expect(b.created).toEqual([]);
    expect(b.cooldown).toEqual([{ peerId: ids.jo, retryInS: Math.ceil((COOLDOWN_MS - 300) / 1000) }]);
    expect(await encounters()).toHaveLength(1);
    expect(await inbox()).toHaveLength(2); // the agents negotiate it once
    expect([...rows.values()]).toMatchObject([{ armed: false }]);
  });

  it("standing together: a listing made while they stand there still pops (the look reads the pair's last meeting)", async () => {
    const rows = addPairState();
    await need(ids.jo, ["onesie"]);
    const romper = await itemFor(ids.mina, ids.jo, "Duck romper", "onesie");
    const tick = async () => [
      ...(await updatePresence(db, { parentId: ids.mina, ...real(0) }, deps())).encounters,
      ...(await updatePresence(db, { parentId: ids.jo, ...real(10) }, deps())).encounters,
    ];
    expect(await tick()).toMatchObject([{ hasMatch: false }]);
    t += 45_000;
    expect(await tick()).toEqual([]);
    await list(ids.mina, romper);
    t += STAND_AGAIN_MS;
    expect(await tick()).toMatchObject([{ peerId: ids.jo, hasMatch: true }]); // Caesar's heartbeat looked first
    expect(await encounters()).toHaveLength(2);
    expect([...rows.values()]).toMatchObject([{ armed: false, lastEncounterAt: iso(t) }]);
  });
});
