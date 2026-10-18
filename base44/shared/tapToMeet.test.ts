// (C) Tap-to-meet (demoWalk `arrive`, c/location.ts) on fakeDb, and the bag layout it shows at the meet (Oct 18) right
// after RESET. In the demo (/world?demo=1) a tap on a family is ONE demoWalk({ parentId, targetParentId, arrive: true }):
// the walker's simulated presence lands ARRIVE_M (10 m) due north of the target and the walk's own check runs (mover,
// onlyPeer = the target, walking), so the meeting — and, with the zero-wait fallback, the pets' proposal — comes back
// from that one call:
//   (a) THE BAG LAYOUT (seed.ts, unchanged): Olivia ↔ Freja MATCH (Fleece bear jacket → Olivia), Caesar ↔ Freja MATCH
//       both ways (the smaller parentId buys first), Caesar ↔ Olivia NO MATCH until Caesar lists the Yellow duck romper,
//       then a tap 15 s later meets again and proposes it. Whoever taps, the same outcome; a second RESET puts it back;
//   (b) a tap from afar (> 40 m, here another family's spot) re-arms the pair an older meeting disarmed, like the walk's
//       reset tick (rearmedAt / PairState armed), before anything else: the cooldown then decides (the answer says how
//       long), and once it is over the tap meets. The re-arm comes first even for a meeting only 5 s old;
//   (c) a tap on the family the walker already stands with is WALK AGAIN: quiet for 10 s after their meeting (no
//       cooldown note on every tap), then it meets or says how long the cooldown holds; the hold ticks after a tap stay quiet;
//   (d) a family with no presence (nobody's tab open, e.g. right after RESET) or a stale real-GPS fix is parked on its
//       demo spot, and the meeting still starts;
//   (e) exactly ONE demoWalk call makes the meeting, also through B's mock (mockWorld.ts passes `arrive` through);
//   (f) a third family standing right at the tap spot is never met (onlyPeer), simulated or on real GPS.
// The handlers run with B's mock deps (zero waits), like proximityMatch.test.ts and matchUseCases.test.ts.
// A vitest file: it lives here, not in c/, so `deno test base44/shared/c/` only finds the Deno suites.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "./testing/fakeDb.ts";
import { DEMO_DATES } from "./seed.ts";
import { demoClock, demoReset } from "./logic/demo.ts";
import { listItem, resolveNudge } from "./logic/closet.ts";
import { decideProposal, payProposal } from "./logic/trade.ts";
import { findMatches } from "./cbridge.ts";
import type { ClothingItem, DemoWalkReq, Encounter, MatchProposal, Parent, Presence } from "./types.ts";
import { COOLDOWN_DEMO_MS, demoHome, destination, haversineM, REARM_M } from "./c/geo.ts";
import { ARRIVE_M, demoWalk, type LocationDeps, pairHasMatch, updatePresence, WALK_AGAIN_AFTER_MS } from "./c/location.ts";
import { createMockWorld, type MockWorld, mockWorldTiming } from "../../src/app/mockWorld.ts";

type Family = "mina" | "jo" | "sam"; // seed keys: Caesar, Olivia, Freja
const NAME: Record<Family, string> = { mina: "Caesar", jo: "Olivia", sam: "Freja" };

let db: FakeDb;
let ids: Record<Family, string>;
/** The real clock the handlers see (deps.nowMs): moved by hand. */
let t: number;
/** demoWalk calls made by this test (one per tap). */
let calls: number;
let world: MockWorld | null;

/** B's mock deps: every tick reads everything, the fallback answers on the same tick. */
const deps = (): LocationDeps => ({ findMatches, recheck: true, fallbackAfterMs: 0, talkMs: () => 0, nowMs: t });

/** A's ?demo=1 fake fix (the server keeps each simulated parent on its own demo spot). */
const FIX = { lat: 34.0689, lng: -118.4452, accuracyM: 12, simulated: true };

/** The demo panel's RESET, then OCT 18 (the romper's nudge waits, nothing answered yet). */
async function resetToMeet() {
  await demoReset(db);
  ids = Object.fromEntries(((await db.Parent.list()) as Parent[]).map((p) => [p.key, p.id])) as Record<Family, string>;
  await demoClock(db, { now: DEMO_DATES.meet });
}

beforeEach(async () => {
  db = createFakeDb();
  t = Date.now();
  calls = 0;
  world = null;
  await resetToMeet();
});

afterEach(() => {
  world?.cancelAll();
  mockWorldTiming.instant = false;
});

const iso = (ms: number) => new Date(ms).toISOString();
const encounters = () => db.Encounter.list("-startedAt") as Promise<Encounter[]>;
const presenceOf = async (k: Family) => ((await db.Presence.filter({ parentId: ids[k] })) as Presence[])[0];
const itemNamed = async (name: string) => ((await db.ClothingItem.filter({ name })) as ClothingItem[])[0];
/** Seconds left on the pair's 2-min demo cooldown from a meeting at `metAt`, as the response rounds them. */
const left = (metAt: number) => Math.ceil((metAt + COOLDOWN_DEMO_MS - t) / 1000);

/** Caesar and Freja fit both ways: the smaller parentId buys at the first meeting (the agents' rule). */
function caesarFreja() {
  return [ids.mina, ids.sam].sort()[0] === ids.mina
    ? { buyerId: ids.mina, sellerId: ids.sam, itemName: "Star puffer snowsuit", priceCents: 3360 }
    : { buyerId: ids.sam, sellerId: ids.mina, itemName: "Spare star sleep sack", priceCents: 1920 };
}

/** Caesar answers the romper's nudge with SELL and lists it, shared, at $18.00 (Bag → nudge → LIST FOR $18.00). */
async function listRomper() {
  const romper = await itemNamed("Yellow duck romper");
  const [nudge] = await db.AgentNudge.filter({ itemId: romper.id, kind: "outgrow_check" });
  await resolveNudge(db, { parentId: ids.mina, nudgeId: nudge.id, action: "sell" });
  await listItem(db, { parentId: ids.mina, itemId: romper.id, photo: "romper.jpg", condition: "gently_used", conditionNote: "", shared: true });
  return romper;
}

/** A's tap on `target`'s sprite: ONE demoWalk with arrive. */
async function tap(walker: Family, target: Family) {
  const req: DemoWalkReq = { parentId: ids[walker], targetParentId: ids[target], arrive: true };
  calls += 1;
  return await demoWalk(db, req, deps());
}

/**
 * One tap that must start a meeting with `target` (hasMatch as given), 10 m from them, with no cooldown: a match ends in
 * exactly one proposal on that same call (one per meeting), nothing fitting in "no_match" and no proposal.
 */
async function tapMeets(walker: Family, target: Family, hasMatch: boolean) {
  const before = calls;
  const res = await tap(walker, target);
  expect(calls - before).toBe(1);
  expect(res.distanceM).toBe(ARRIVE_M);
  expect(res.cooldown).toBeUndefined();
  expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids[target], hasMatch }]);
  const enc = (await db.Encounter.get(res.encounters[0].id)) as Encounter;
  expect(enc).toMatchObject({ aId: ids[walker], bId: ids[target], hasMatch });
  const props = (await db.MatchProposal.filter({ encounterId: enc.id })) as MatchProposal[];
  if (hasMatch) {
    expect(props).toHaveLength(1);
    expect(enc).toMatchObject({ status: "proposed", proposalId: props[0].id });
    expect(props[0].status).toBe("open");
  } else {
    expect(props).toEqual([]);
    expect(enc.status).toBe("no_match");
  }
  return { res, enc, proposal: props[0] as MatchProposal | undefined };
}

/** Both parents accept, the buyer pays (demo payment). */
async function settle(p: MatchProposal) {
  await decideProposal(db, { parentId: p.sellerId, proposalId: p.id, decision: "accepted" });
  await decideProposal(db, { parentId: p.buyerId, proposalId: p.id, decision: "accepted" });
  expect((await payProposal(db, { parentId: p.buyerId, proposalId: p.id }, { delayMs: 0 })).proposal.status).toBe("paid");
}

describe("(a) the bag layout at Oct 18 right after RESET, one tap per meeting", () => {
  it("each pair either matches or not: Freja matches both, Caesar and Olivia each see one match and one no-match", async () => {
    const fits = async (a: Family, b: Family) => await pairHasMatch(db, ids[a], ids[b], findMatches);
    expect(await fits("jo", "sam")).toBe(true);
    expect(await fits("mina", "sam")).toBe(true);
    expect(await fits("mina", "jo")).toBe(false);
  });

  it("Olivia taps Freja (jacket), Caesar taps Freja (smaller id buys), Olivia taps Caesar (nothing), the romper is listed, 15 s later Olivia taps Caesar again (romper)", async () => {
    const jacket = await tapMeets("jo", "sam", true);
    expect(jacket.proposal).toMatchObject({ buyerId: ids.jo, sellerId: ids.sam, snapshot: { itemName: "Fleece bear jacket", priceCents: 2160 } });

    t += 5_000;
    const two = caesarFreja();
    const cf = await tapMeets("mina", "sam", true);
    expect(cf.proposal).toMatchObject({ buyerId: two.buyerId, sellerId: two.sellerId, snapshot: { itemName: two.itemName, priceCents: two.priceCents } });

    t += 5_000;
    const nothing = await tapMeets("jo", "mina", false);
    const romper = await listRomper();
    t += 15_000; // inside the 2-min demo cooldown: a meeting where nothing fit doesn't hold it once something does
    const again = await tapMeets("jo", "mina", true);
    expect(again.enc.id).not.toBe(nothing.enc.id);
    expect(again.proposal).toMatchObject({ buyerId: ids.jo, sellerId: ids.mina, itemId: romper.id, snapshot: { itemName: "Yellow duck romper", priceCents: 1800 } });

    expect(calls).toBe(4); // four taps, four meetings, three trades
    expect(await encounters()).toHaveLength(4);
    expect(await db.MatchProposal.list()).toHaveLength(3);
  });

  const LAYOUT: { walker: Family; target: Family }[] = [
    { walker: "jo", target: "sam" }, { walker: "sam", target: "jo" },
    { walker: "mina", target: "sam" }, { walker: "sam", target: "mina" },
    { walker: "jo", target: "mina" }, { walker: "mina", target: "jo" },
  ];

  it.each(LAYOUT)("$walker taps $target: the same outcome whoever taps", async ({ walker, target }) => {
    const pair = [walker, target].sort().join("|");
    if (pair === "jo|sam") {
      const { proposal } = await tapMeets(walker, target, true);
      expect(proposal).toMatchObject({ buyerId: ids.jo, sellerId: ids.sam, snapshot: { itemName: "Fleece bear jacket" } });
    } else if (pair === "mina|sam") {
      const two = caesarFreja();
      const { proposal } = await tapMeets(walker, target, true);
      expect(proposal).toMatchObject({ buyerId: two.buyerId, sellerId: two.sellerId, snapshot: { itemName: two.itemName } });
    } else {
      await tapMeets(walker, target, false);
      const romper = await listRomper();
      t += 15_000;
      const { proposal } = await tapMeets(walker, target, true);
      expect(proposal).toMatchObject({ buyerId: ids.jo, sellerId: ids.mina, itemId: romper.id });
    }
  });

  it("a second RESET puts every bag back: the same layout again", async () => {
    await tapMeets("jo", "sam", true);
    await listRomper();
    t += 5_000;
    await tapMeets("jo", "mina", true); // the romper, listed this time
    await resetToMeet();
    expect(await encounters()).toEqual([]);
    expect(await db.Presence.list()).toEqual([]);
    t += 5_000;
    expect((await tapMeets("jo", "sam", true)).proposal?.snapshot.itemName).toBe("Fleece bear jacket");
    t += 5_000;
    expect((await tapMeets("mina", "sam", true)).proposal?.snapshot.itemName).toBe(caesarFreja().itemName);
    t += 5_000;
    await tapMeets("jo", "mina", false); // the romper is back in Caesar's closet, unlisted
  });
});

describe("(b) a tap from afar re-arms the pair an older meeting disarmed, like the walk's reset", () => {
  it("Olivia taps Freja, then Caesar ~200 m away, then Freja again: re-armed (rearmedAt), held while the cooldown runs, then meets", async () => {
    const first = await tapMeets("jo", "sam", true);
    const metAt = t;
    t += 40_000; // Freja's parked presence is stale by now: the next tap doesn't see her (no re-arm on the way)
    await tapMeets("jo", "mina", false);
    expect(haversineM(await presenceOf("jo"), await presenceOf("sam"))).toBeGreaterThan(REARM_M);
    expect((await db.Encounter.get(first.enc.id)).rearmedAt).toBeUndefined(); // still disarmed

    t = metAt + 100_000;
    const held = await tap("jo", "sam");
    expect(held.distanceM).toBe(ARRIVE_M);
    expect(held.encounters).toEqual([]);
    expect(held.cooldown).toEqual([{ peerId: ids.sam, retryInS: left(metAt) }]); // the jacket's trade is still open
    expect((await db.Encounter.get(first.enc.id)).rearmedAt).toBe(iso(t)); // re-armed first, as the reset tick does

    t = metAt + COOLDOWN_DEMO_MS;
    const later = await tap("jo", "sam");
    expect(later.cooldown).toBeUndefined();
    expect(later.encounters).toEqual([{ id: expect.any(String), peerId: ids.sam, hasMatch: expect.any(Boolean) }]);
    expect(await encounters()).toHaveLength(3);
  });

  it("…and after the jacket is PAID, the tap back from afar meets at once", async () => {
    const first = await tapMeets("jo", "sam", true);
    await settle(first.proposal!);
    t += 40_000;
    await tapMeets("jo", "mina", false);
    t += 5_000;
    const back = await tap("jo", "sam");
    expect(back.cooldown).toBeUndefined();
    expect(back.encounters).toEqual([{ id: expect.any(String), peerId: ids.sam, hasMatch: false }]); // nothing left to trade
    expect((await db.Encounter.get(first.enc.id)).rearmedAt).toBe(iso(t));
  });

  it("the re-arm comes first: from 120 m away the tap meets even when the older meeting is only 5 s old (WALK AGAIN alone waits 10 s)", async () => {
    const romper = await listRomper();
    await updatePresence(db, { parentId: ids.mina, ...FIX }, deps()); // Caesar's tab: on the lawn
    await updatePresence(db, { parentId: ids.jo, ...FIX }, deps()); // Olivia's tab: her spot, 120 m north of the lawn
    const old = await db.Encounter.create({
      aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "no_match", hasMatch: false, startedAt: iso(t - 5_000), transcript: [],
    });
    const { proposal } = await tapMeets("jo", "mina", true);
    expect(proposal).toMatchObject({ buyerId: ids.jo, itemId: romper.id });
    expect((await db.Encounter.get(old.id)).rearmedAt).toBe(iso(t));
  });

  it("with PairState (live): the tap from afar writes armed: true first, then the new meeting disarms the pair again", async () => {
    const { rows, writes } = addPairState();
    await tapMeets("jo", "sam", true);
    const metAt = t;
    const key = [ids.jo, ids.sam].sort().join("|");
    expect([...rows.values()]).toEqual([expect.objectContaining({ pairKey: key, armed: false, lastEncounterAt: iso(metAt) })]);
    t += 40_000;
    await tapMeets("jo", "mina", false);
    t = metAt + COOLDOWN_DEMO_MS + 1_000;
    writes.length = 0;
    const back = await tap("jo", "sam");
    expect(back.encounters).toEqual([{ id: expect.any(String), peerId: ids.sam, hasMatch: expect.any(Boolean) }]);
    expect(writes).toEqual([
      { armed: true, lastDistanceM: expect.any(Number) }, // the re-arm, at the distance the tap came from
      { armed: false, lastEncounterAt: iso(t), lastDistanceM: expect.closeTo(ARRIVE_M, 6) }, // the new meeting
    ]);
    expect(writes[0].lastDistanceM).toBeGreaterThan(REARM_M);
  });
});

describe("(c) a tap on the family the walker already stands with is WALK AGAIN", () => {
  it("a meeting that popped (open trade): taps within 10 s are quiet, from 10 s on they hear the cooldown, after it they meet", async () => {
    const { enc } = await tapMeets("jo", "sam", true);
    const metAt = Date.parse(enc.startedAt);
    for (const dt of [2_000, 5_000, 9_000]) {
      t = metAt + dt;
      const quiet = await tap("jo", "sam");
      expect(quiet.distanceM).toBe(ARRIVE_M);
      expect(quiet.encounters).toEqual([]);
      expect(quiet).not.toHaveProperty("cooldown"); // no "meet again in…" note on every tap
    }
    t = metAt + WALK_AGAIN_AFTER_MS;
    const held = await tap("jo", "sam");
    expect(held.encounters).toEqual([]);
    expect(held.cooldown).toEqual([{ peerId: ids.sam, retryInS: left(metAt) }]);
    expect(held.cooldown![0].retryInS).toBe(110);
    expect(await encounters()).toHaveLength(1);

    t = metAt + COOLDOWN_DEMO_MS;
    const later = await tap("jo", "sam");
    expect(later.cooldown).toBeUndefined();
    expect(later.encounters).toHaveLength(1);
    expect(await encounters()).toHaveLength(2);
  });

  it("nothing fit (Olivia ↔ Caesar): quiet within 10 s, then the wait while still nothing fits, then the romper's meeting", async () => {
    const { enc } = await tapMeets("jo", "mina", false);
    const metAt = Date.parse(enc.startedAt);
    t = metAt + 5_000;
    const quiet = await tap("jo", "mina");
    expect(quiet.encounters).toEqual([]);
    expect(quiet).not.toHaveProperty("cooldown");
    t = metAt + 12_000;
    const held = await tap("jo", "mina"); // a pair with nothing to trade keeps its cooldown
    expect(held.encounters).toEqual([]);
    expect(held.cooldown).toEqual([{ peerId: ids.mina, retryInS: left(metAt) }]);
    await listRomper();
    t = metAt + 20_000;
    expect((await tapMeets("jo", "mina", true)).proposal?.snapshot.itemName).toBe("Yellow duck romper");
  });

  it("the romper listed but the no-match meeting is under 10 s old: the tap waits (quiet), at 10 s it meets", async () => {
    const { enc } = await tapMeets("jo", "mina", false);
    const metAt = Date.parse(enc.startedAt);
    await listRomper();
    t = metAt + 4_000;
    const quiet = await tap("jo", "mina");
    expect(quiet.encounters).toEqual([]);
    expect(quiet).not.toHaveProperty("cooldown");
    t = metAt + WALK_AGAIN_AFTER_MS;
    await tapMeets("jo", "mina", true);
  });

  it("A's hold ticks after a tap (1 m, every 4 s for 30 s) never re-judge the meeting the tap made", async () => {
    await tapMeets("jo", "sam", true);
    for (let n = 0; n < 7; n++) {
      t += 4_000;
      const hold = await demoWalk(db, { parentId: ids.jo, targetParentId: ids.sam, stepM: 1 }, deps());
      expect(hold.encounters).toEqual([]);
      expect(hold).not.toHaveProperty("cooldown");
    }
    expect(await encounters()).toHaveLength(1);
  });
});

describe("(d) the tapped family's phone isn't on /world: parked on its demo spot, and they still meet", () => {
  it("right after RESET nobody has a presence: Freja is parked on her spot, Olivia lands 10 m due north of her", async () => {
    expect(await db.Presence.list()).toEqual([]);
    await tapMeets("jo", "sam", true);
    const freja = await presenceOf("sam"), olivia = await presenceOf("jo");
    const spot = demoHome((await db.Parent.get(ids.sam)) as Parent);
    expect(freja).toMatchObject({ simulated: true, lat: spot.lat, lng: spot.lng, updatedAt: iso(t) });
    expect(olivia).toMatchObject({ simulated: true, ...destination(spot, 0, ARRIVE_M) });
    expect(haversineM(olivia, freja)).toBeCloseTo(ARRIVE_M, 6);
  });

  it("a real-GPS fix gone stale (that phone left /world 2 min ago) is parked on the demo spot too", async () => {
    await db.Presence.create({
      parentId: ids.sam, ...destination(demoHome((await db.Parent.get(ids.sam)) as Parent), 45, 900), accuracyM: 8, simulated: false, updatedAt: iso(t - 120_000),
    });
    await tapMeets("jo", "sam", true);
    const spot = demoHome((await db.Parent.get(ids.sam)) as Parent);
    expect(await presenceOf("sam")).toMatchObject({ simulated: true, lat: spot.lat, lng: spot.lng });
  });
});

describe("(e) exactly one demoWalk call makes the meeting", () => {
  const CASES: { walker: Family; target: Family; hasMatch: boolean; itemName?: string }[] = [
    { walker: "jo", target: "sam", hasMatch: true, itemName: "Fleece bear jacket" },
    { walker: "sam", target: "mina", hasMatch: true },
    { walker: "mina", target: "jo", hasMatch: false },
  ];

  it.each(CASES)("through B's mock (mockWorld passes arrive through): $walker taps $target", async ({ walker, target, hasMatch, itemName }) => {
    world = createMockWorld(db);
    mockWorldTiming.instant = true;
    const api = { demoWalk: (req: DemoWalkReq) => (calls++, world!.demoWalk(req)) };
    const created: string[] = [];
    const off = db._on((e) => { if (e.entity === "Encounter" && e.type === "create") created.push(e.type); });

    const res = await api.demoWalk({ parentId: ids[walker], targetParentId: ids[target], arrive: true });
    off();
    expect(calls).toBe(1);
    expect(created).toHaveLength(1);
    expect(res.distanceM).toBe(ARRIVE_M);
    expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids[target], hasMatch }]);
    const enc = (await db.Encounter.get(res.encounters[0].id)) as Encounter;
    const props = (await db.MatchProposal.filter({ encounterId: enc.id })) as MatchProposal[];
    expect(props).toHaveLength(hasMatch ? 1 : 0);
    expect(enc.status).toBe(hasMatch ? "proposed" : "no_match");
    if (itemName) expect(props[0].snapshot.itemName).toBe(itemName);
    if (target === "mina" && walker === "sam") expect(props[0].snapshot.itemName).toBe(caesarFreja().itemName);
    // the answer moves the map: my own spot, 10 m due north of the family I tapped
    const spot = await presenceOf(target);
    expect(haversineM(res.position!, spot)).toBeCloseTo(ARRIVE_M, 6);
    expect(res.bearingDeg).toBe(180);
  });

  it(`each tap of the layout is one call (${Object.values(NAME).join(", ")})`, async () => {
    for (const [walker, target] of [["jo", "sam"], ["mina", "sam"], ["jo", "mina"]] as const) {
      const before = calls;
      expect((await tap(walker, target)).encounters).toHaveLength(1);
      expect(calls - before).toBe(1);
      t += 5_000;
    }
  });
});

describe("(f) a tap meets the family tapped, never a third one standing right there", () => {
  it.each([["simulated", true], ["on real GPS", false]] as const)("Olivia stands at the tap spot (%s): Caesar's tap on Freja meets Freja only", async (_label, simulated) => {
    await listRomper(); // every pair has something to trade
    await updatePresence(db, { parentId: ids.sam, ...FIX }, deps()); // Freja's tab: her demo spot
    const spot = demoHome((await db.Parent.get(ids.sam)) as Parent);
    await db.Presence.create({ parentId: ids.jo, ...destination(spot, 0, ARRIVE_M), accuracyM: 5, simulated, updatedAt: iso(t) });

    const res = await tap("mina", "sam");
    expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids.sam, hasMatch: true }]);
    expect(haversineM(await presenceOf("mina"), await presenceOf("jo"))).toBeLessThan(1); // right next to Olivia…
    expect(await encounters()).toHaveLength(1); // …and only the Freja meeting
    expect(await db.AgentInbox.filter({ type: "encounter" })).toHaveLength(2);
  });
});

/** A minimal PairState table on the fakeDb, like Base44's entity handler (as in proximityMatch.test.ts), with its writes. */
function addPairState() {
  const rows = new Map<string, Record<string, unknown> & { id: string }>();
  const writes: Record<string, unknown>[] = [];
  let n = 0;
  const table = {
    async list() { return [...rows.values()].map((r) => ({ ...r })); },
    async filter(q: Record<string, unknown>) { return [...rows.values()].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)); },
    async create(data: Record<string, unknown>) { writes.push(data); const row = { ...data, id: `pst_${++n}` }; rows.set(row.id, row); return { ...row }; },
    async update(id: string, patch: Record<string, unknown>) { writes.push(patch); const row = { ...rows.get(id)!, ...patch, id }; rows.set(id, row); return { ...row }; },
    async delete(id: string) { rows.delete(id); return { ok: true }; },
  };
  (db as unknown as Record<string, unknown>).PairState = table;
  return { rows, writes };
}
