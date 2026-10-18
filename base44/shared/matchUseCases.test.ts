// The demo seed's match use cases (seed.ts DEMO_MATCHES) against the real rules, on fakeDb:
//   (a) every DEMO_MATCHES item fits its buyer at the meet (Oct 18), listed at priceFor's price, and the buyer's
//       default pet rules ($50 a trade, $100 a month, every kind of clothes) let the pets propose it;
//   (b) the demo clock still makes exactly ONE nudge (the romper at Sep 20) and nothing new by Oct 18;
//   (c) every pair of families has a match at Oct 18 once the romper is listed, and the seed has no match beyond
//       DEMO_MATCHES (Caesar and Olivia only through the romper, so the headline story has no reverse trade). On the
//       RESET date (May 15) the only match is the spare sleep sack, which Caesar owns by then like every seeded item;
//   (d) a demo walk, whichever side walks, pops a meeting (hasMatch true) that ends in that item's proposal. Caesar and
//       Freja fit both ways: the smaller parentId buys first (the agents' rule), and once that trade is paid they meet
//       again at once (also with A's WALK AGAIN, which walks on from where it stopped) and the second meeting proposes
//       the other way; a declined trade comes back first instead (the documented limit of that rule). All four trades
//       in a row fit every budget;
//   (e) Caesar and Olivia before the romper is listed: hasMatch false, nothing proposed; listing it pops the next meeting;
//   (f) with all three families on /world, a walk meets the family it heads for, never one on its way.
// The walks run C's real location.ts demoWalk with zero waits (B's mock deps), like proximityMatch.test.ts.
// A vitest file: it lives here, not in c/, so `deno test base44/shared/c/` only finds the Deno suites.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "./testing/fakeDb.ts";
import { applySeed, DEMO_DATES, DEMO_MATCHES, seedPlan } from "./seed.ts";
import { demoClock } from "./logic/demo.ts";
import { listItem, resolveNudge } from "./logic/closet.ts";
import { decideProposal, payProposal } from "./logic/trade.ts";
import { defaultMandate, mandateOf } from "./logic/trust.ts";
import { findMatches } from "./cbridge.ts";
import { scanForNudges } from "./nudges.ts";
import { priceFor } from "./pricing.ts";
import type { ClothingItem, Encounter, ISODate, MatchProposal } from "./types.ts";
import { COOLDOWN_DEMO_MS } from "./c/geo.ts";
import { demoWalk, type LocationDeps, pairHasMatch, updatePresence, withRules } from "./c/location.ts";

const FAMILIES = ["mina", "jo", "sam"] as const;
const PAIRS = [["mina", "jo"], ["mina", "sam"], ["jo", "sam"]] as const;

let db: FakeDb;
let ids: Record<string, string>;
/** The real clock the handlers see (deps.nowMs): moved by hand, one second per walk step. */
let t: number;

/** B's mock deps: every tick reads everything, the fallback answers on the same tick. */
const deps = (): LocationDeps => ({ findMatches, recheck: true, fallbackAfterMs: 0, talkMs: () => 0, nowMs: t });

beforeEach(async () => {
  db = createFakeDb();
  ids = (await applySeed(db, seedPlan())).parentIds;
  t = Date.now();
});

const itemNamed = async (name: string) => ((await db.ClothingItem.filter({ name })) as ClothingItem[])[0];

/** Caesar's real story: the Sep 20 nudge → SELL → the romper listed at $18.00, then the clock moves to `then`. */
async function listRomper(then: ISODate = DEMO_DATES.meet) {
  await demoClock(db, { now: DEMO_DATES.nudge });
  const romper = await itemNamed("Yellow duck romper");
  const [nudge] = await db.AgentNudge.filter({ itemId: romper.id, kind: "outgrow_check" });
  await resolveNudge(db, { parentId: ids.mina, nudgeId: nudge.id, action: "sell" });
  await listItem(db, { parentId: ids.mina, itemId: romper.id, photo: "romper.jpg", condition: "gently_used", conditionNote: "", shared: true });
  if (then !== DEMO_DATES.nudge) await demoClock(db, { now: then });
}

/** The world a DEMO_MATCHES entry needs at the meet: the romper listed (afterListing) or just the Oct 18 clock. */
async function meetFor(m: (typeof DEMO_MATCHES)[number]) {
  if (m.afterListing) await listRomper();
  else await demoClock(db, { now: DEMO_DATES.meet });
}

/** Every (seller, buyer, item) the real matcher finds between the seed's families right now. */
async function everyMatch() {
  const out: { seller: string; buyer: string; itemName: string }[] = [];
  for (const seller of FAMILIES) {
    for (const buyer of FAMILIES) {
      if (seller === buyer) continue;
      for (const m of await findMatches(db, { buyerId: ids[buyer], sellerId: ids[seller] })) out.push({ seller, buyer, itemName: m.itemName });
    }
  }
  return out;
}
const sorted = <T extends { itemName: string }>(rows: T[]) => [...rows].sort((a, b) => a.itemName.localeCompare(b.itemName));
const asSeeded = DEMO_MATCHES.map(({ seller, buyer, itemName }) => ({ seller, buyer, itemName }));

/**
 * A's WALK TOWARD: reset (120 m due north of the target, so the pair re-arms), then a 5 m step a second until a
 * meeting with the target starts or the cooldown answers for it (at most 30 steps: the walker is there by then).
 */
async function walk(walker: string, target: string) {
  let res = await demoWalk(db, { parentId: walker, targetParentId: target, reset: true }, deps());
  const met = () => res.encounters.find((e) => e.peerId === target);
  for (let n = 0; !met() && !res.cooldown?.some((c) => c.peerId === target) && n < 30; n++) {
    t += 1_000;
    res = await demoWalk(db, { parentId: walker, targetParentId: target }, deps());
  }
  return { res, start: met() };
}

/** A's ?demo=1 fake fix (the server keeps each simulated parent on its own demo spot). */
const FIX = { lat: 34.0689, lng: -118.4452, accuracyM: 12, simulated: true };

/**
 * A's walk as useDemoWalk sends it: no reset, 20 m steps on from where the walker stands (its saved spot, else its demo
 * home) until a meeting with the target, its cooldown, or ≤ 25 m. `beat`: other open tabs' heartbeats between steps.
 * Returns every meeting the walk started.
 */
async function walkOn(walker: string, target: string, beat: string[] = []) {
  const met: { id: string; peerId: string; hasMatch?: boolean }[] = [];
  for (let n = 0; n < 20; n++) {
    const res = await demoWalk(db, { parentId: walker, targetParentId: target, stepM: 20 }, deps());
    met.push(...res.encounters);
    if (res.encounters.length || res.cooldown?.length || res.distanceM <= 25) break;
    t += 2_500;
    for (const b of beat) await updatePresence(db, { parentId: b, ...FIX }, deps());
  }
  return met;
}

/** Walk in and expect a meeting that pops (hasMatch true) and ends in exactly one proposal (one per meeting). */
async function meet(walker: string, target: string): Promise<MatchProposal> {
  const { res, start } = await walk(walker, target);
  expect(res.cooldown?.find((c) => c.peerId === target)).toBeUndefined();
  expect(start).toEqual({ id: expect.any(String), peerId: target, hasMatch: true });
  const enc = (await db.Encounter.get(start!.id)) as Encounter;
  const props = (await db.MatchProposal.filter({ encounterId: enc.id })) as MatchProposal[];
  expect(props).toHaveLength(1);
  expect(enc).toMatchObject({ hasMatch: true, status: "proposed", proposalId: props[0].id });
  return props[0];
}

/** Both parents accept, the buyer pays (demo payment). */
async function settle(p: MatchProposal) {
  await decideProposal(db, { parentId: p.sellerId, proposalId: p.id, decision: "accepted" });
  await decideProposal(db, { parentId: p.buyerId, proposalId: p.id, decision: "accepted" });
  const paid = await payProposal(db, { parentId: p.buyerId, proposalId: p.id }, { delayMs: 0 });
  expect(paid.proposal.status).toBe("paid");
  expect(paid.item.currentOwnerId).toBe(p.buyerId);
}

describe("DEMO_MATCHES", () => {
  it("covers every pair of families, Caesar and Freja both ways, and only the romper waits for the demo's listing", () => {
    const pairKey = (a: string, b: string) => [a, b].sort().join("|");
    expect(new Set(DEMO_MATCHES.map((m) => pairKey(m.seller, m.buyer)))).toEqual(new Set(PAIRS.map(([a, b]) => pairKey(a, b))));
    expect(DEMO_MATCHES.filter((m) => pairKey(m.seller, m.buyer) === pairKey("mina", "sam")).map((m) => m.seller).sort()).toEqual(["mina", "sam"]);
    expect(DEMO_MATCHES.filter((m) => m.afterListing).map((m) => m.itemName)).toEqual(["Yellow duck romper"]);
  });
});

describe("(a) every match fits at the meet, at priceFor's price, inside the buyer's default pet rules", () => {
  it.each(DEMO_MATCHES)("$seller → $buyer: $itemName", async (m) => {
    await meetFor(m);
    const item = await itemNamed(m.itemName);
    expect(item.currentOwnerId).toBe(ids[m.seller]);
    const [listing] = await db.Listing.filter({ itemId: item.id, status: "active" });
    expect(listing).toMatchObject({ sellerId: ids[m.seller], shared: true, priceCents: priceFor(item) });

    const fits = await findMatches(db, { buyerId: ids[m.buyer], sellerId: ids[m.seller] });
    const hit = fits.find((f) => f.itemId === item.id);
    expect(hit).toMatchObject({ listingId: listing.id, priceCents: priceFor(item) });
    expect(hit!.wearWeeksLeft).toBeGreaterThan(0);

    const buyer = await db.Parent.get(ids[m.buyer]);
    expect(mandateOf(buyer)).toEqual(defaultMandate(buyer)); // RESET leaves every pet on the default rules
    const [ruled] = await withRules(db, ids[m.buyer], [hit!]);
    expect(ruled.blocked).toBeUndefined();
  });

  it("the seeded listings are priced by priceFor (2nd owner pays 60%)", async () => {
    const listings = await db.Listing.list();
    expect(listings).toHaveLength(3);
    for (const l of listings) expect(l.priceCents).toBe(priceFor(await db.ClothingItem.get(l.itemId)));
  });
});

describe("(b) still exactly one nudge: the romper at Sep 20", () => {
  it("May 15 nothing, Sep 20 the romper's outgrow check, Oct 18 nothing new", async () => {
    expect((await demoClock(db, { now: DEMO_DATES.start })).nudgesCreated).toBe(0);
    expect((await demoClock(db, { now: DEMO_DATES.nudge })).nudgesCreated).toBe(1);
    const romper = await itemNamed("Yellow duck romper");
    expect(await db.AgentNudge.list()).toEqual([expect.objectContaining({ itemId: romper.id, parentId: ids.mina, kind: "outgrow_check" })]);
    expect((await demoClock(db, { now: DEMO_DATES.meet })).nudgesCreated).toBe(0);
    expect(await db.AgentNudge.list()).toHaveLength(1);
  });

  it("with the romper listed through that nudge, Oct 18 still adds nothing (every listing is under 30 days old)", async () => {
    await listRomper(DEMO_DATES.nudge);
    expect((await demoClock(db, { now: DEMO_DATES.meet })).nudgesCreated).toBe(0);
    expect(await db.AgentNudge.list()).toHaveLength(1);
  });

  it.each([["Sep 20", DEMO_DATES.nudge], ["Oct 18", DEMO_DATES.meet]])("scanForNudges on the fresh seed at %s: only the romper", async (_label, now) => {
    const [items, listings, children, parents] = await Promise.all([
      db.ClothingItem.list(), db.Listing.list(), db.Child.list(), db.Parent.list(),
    ]);
    const parentsById = Object.fromEntries(parents.map((p) => [p.id, { name: p.name, petName: p.pet?.name ?? "" }]));
    const drafts = scanForNudges({ items, listings, children, parentsById, existing: [], now });
    const romper = await itemNamed("Yellow duck romper");
    expect(drafts.map((d) => [d.itemId, d.kind])).toEqual([[romper.id, "outgrow_check"]]);
  });
});

describe("(c) every pair of families matches, and nothing beyond DEMO_MATCHES", () => {
  it.each(PAIRS)("%s and %s have at least one match at Oct 18 once the romper is listed", async (a, b) => {
    await listRomper();
    expect(await pairHasMatch(db, ids[a], ids[b])).toBe(true);
  });

  it.each([["Sep 20", DEMO_DATES.nudge], ["Oct 18", DEMO_DATES.meet]] as const)("the whole match matrix at %s is exactly DEMO_MATCHES", async (_label, now) => {
    await listRomper(now);
    expect(sorted(await everyMatch())).toEqual(sorted(asSeeded));
  });

  it("on the RESET date (May 15) the only match is Caesar's spare sleep sack for Freja, and every seeded item is owned by then", async () => {
    await demoClock(db, { now: DEMO_DATES.start });
    expect(await everyMatch()).toEqual([{ seller: "mina", buyer: "sam", itemName: "Spare star sleep sack" }]);
    // so a trade made right after RESET never hands over something its seller only buys later in the story
    for (const item of (await db.ClothingItem.list()) as ClothingItem[]) {
      expect(Date.parse(item.originalPurchaseDate), item.name).toBeLessThanOrEqual(Date.parse(DEMO_DATES.start));
    }
  });
});

describe("(d) a demo walk pops the meeting and the pets propose that item", () => {
  const CASES = DEMO_MATCHES.flatMap((m) => (["seller", "buyer"] as const).map((walker) => ({ ...m, walker })));

  it.each(CASES)("$seller → $buyer: $itemName ($walker walking)", async (m) => {
    await meetFor(m);
    const seller = ids[m.seller], buyer = ids[m.buyer];
    const walker = m.walker === "seller" ? seller : buyer, target = walker === seller ? buyer : seller;
    const reverse = DEMO_MATCHES.find((r) => r.seller === m.buyer && r.buyer === m.seller);

    let p = await meet(walker, target);
    if (reverse) {
      // Both ways fit: whoever walked, the smaller parentId buys at this meeting (the inbox role, the agents' rule).
      const lo = [seller, buyer].sort()[0];
      expect(p.buyerId).toBe(lo);
      if (lo !== buyer) {
        expect(p).toMatchObject({ sellerId: buyer, snapshot: { itemName: reverse.itemName } });
        // One proposal per meeting: the other way waits for the next one. A PAID trade lifts the cooldown at once.
        await settle(p);
        t += 5_000;
        p = await meet(walker, target);
      }
    }
    expect(p).toMatchObject({ buyerId: buyer, sellerId: seller, status: "open", snapshot: { itemName: m.itemName } });
    const item = await itemNamed(m.itemName);
    expect(p.snapshot.priceCents).toBe(priceFor(item));
  });

  it("the whole world in one run: all four trades, paid in a row, inside every buyer's monthly budget", async () => {
    await listRomper();
    // Walkers chosen so nobody's line passes a third family's spot (each walk starts 120 m north of its target).
    await settle(await meet(ids.jo, ids.mina));   // the romper → Olivia
    await settle(await meet(ids.jo, ids.sam));    // the fleece jacket → Olivia ($18.00 + $21.60 this month)
    t += 5_000;
    await settle(await meet(ids.sam, ids.mina));  // Caesar and Freja: the smaller id buys first…
    t += 5_000;
    await settle(await meet(ids.sam, ids.mina));  // …and right after paying, the other way
    const paid = (await db.MatchProposal.filter({ status: "paid" })) as MatchProposal[];
    const families = (id: string) => FAMILIES.find((k) => ids[k] === id);
    expect(sorted(paid.map((p) => ({ seller: families(p.sellerId)!, buyer: families(p.buyerId)!, itemName: p.snapshot.itemName }))))
      .toEqual(sorted(asSeeded));
    for (const m of DEMO_MATCHES) expect((await itemNamed(m.itemName)).currentOwnerId).toBe(ids[m.buyer]);
    expect(await db.MatchProposal.list()).toHaveLength(4); // nothing proposed twice, nothing blocked by a pet's rules
  });

  it("Caesar and Freja with A's WALK AGAIN (no reset: they never walked apart): paid, then the other way at once", async () => {
    await demoClock(db, { now: DEMO_DATES.meet });
    const [lo, hi] = [ids.mina, ids.sam].sort();
    const proposalOf = async (encounterId: string) => ((await db.MatchProposal.filter({ encounterId })) as MatchProposal[])[0];
    const [first] = await walkOn(ids.mina, ids.sam);
    expect(first).toEqual({ id: expect.any(String), peerId: ids.sam, hasMatch: true });
    const p1 = await proposalOf(first.id);
    expect(p1).toMatchObject({ buyerId: lo, sellerId: hi });
    await settle(p1);
    t += 20_000; // the trade window, the celebration, then WALK AGAIN from where the walk stopped
    const [again] = await walkOn(ids.mina, ids.sam);
    expect(again).toEqual({ id: expect.any(String), peerId: ids.sam, hasMatch: true });
    const p2 = await proposalOf(again.id);
    expect(p2).toMatchObject({ buyerId: hi, sellerId: lo, status: "open" });
    expect(sorted([p1, p2].map((p) => ({ itemName: p.snapshot.itemName }))))
      .toEqual([{ itemName: "Spare star sleep sack" }, { itemName: "Star puffer snowsuit" }]);
  });

  it("a DECLINED trade comes back first: the smaller id buys at every meeting until its trade is paid (the agents' rule)", async () => {
    await demoClock(db, { now: DEMO_DATES.meet });
    const lo = [ids.mina, ids.sam].sort()[0];
    const p1 = await meet(ids.mina, ids.sam);
    expect(p1.buyerId).toBe(lo);
    await decideProposal(db, { parentId: p1.buyerId, proposalId: p1.id, decision: "declined" });
    t += COOLDOWN_DEMO_MS; // a declined trade popped: it holds the cooldown
    const p2 = await meet(ids.sam, ids.mina); // whoever walks
    expect(p2).toMatchObject({ buyerId: lo, listingId: p1.listingId, status: "open" });
  });
});

describe("(e) Caesar and Olivia before the romper is listed: nothing pops", () => {
  it.each([["May 15", DEMO_DATES.start], ["Sep 20", DEMO_DATES.nudge], ["Oct 18", DEMO_DATES.meet]])("nothing fits either way on %s", async (_label, now) => {
    await demoClock(db, { now });
    expect(await pairHasMatch(db, ids.mina, ids.jo)).toBe(false);
  });

  it("at Oct 18 they are the only pair without a match", async () => {
    await demoClock(db, { now: DEMO_DATES.meet });
    expect(await pairHasMatch(db, ids.mina, ids.sam)).toBe(true);
    expect(await pairHasMatch(db, ids.jo, ids.sam)).toBe(true);
  });

  it.each(["jo", "mina"])("%s walking: the meeting is written with hasMatch false (the app never pops it), no proposal", async (who) => {
    await demoClock(db, { now: DEMO_DATES.meet });
    const walker = ids[who], target = who === "jo" ? ids.mina : ids.jo;
    const { res, start } = await walk(walker, target);
    expect(start).toEqual({ id: expect.any(String), peerId: target, hasMatch: false });
    expect(res.cooldown).toBeUndefined();
    expect(await db.Encounter.get(start!.id)).toMatchObject({ hasMatch: false, status: "no_match" });
    expect(await db.MatchProposal.list()).toEqual([]);
  });

  it("then Caesar lists the romper and they meet again 30 s later: that meeting pops with the romper for Olivia", async () => {
    await demoClock(db, { now: DEMO_DATES.meet }); // the romper's nudge is waiting, not answered yet
    expect((await walk(ids.jo, ids.mina)).start?.hasMatch).toBe(false);
    const romper = await itemNamed("Yellow duck romper");
    const [nudge] = await db.AgentNudge.filter({ itemId: romper.id, kind: "outgrow_check" });
    await resolveNudge(db, { parentId: ids.mina, nudgeId: nudge.id, action: "sell" });
    await listItem(db, { parentId: ids.mina, itemId: romper.id, photo: "romper.jpg", condition: "gently_used", conditionNote: "", shared: true });
    t += 30_000; // inside the 2-min demo cooldown: the no-match meeting doesn't hold it
    const p = await meet(ids.jo, ids.mina);
    expect(p).toMatchObject({ buyerId: ids.jo, sellerId: ids.mina, itemId: romper.id, snapshot: { priceCents: 1800 } });
    expect(await db.Encounter.list()).toHaveLength(2);
  });
});

describe("(f) all three families on /world: a walk meets the family it heads for", () => {
  /** The API's reset start (120 m due north of the target: for Caesar that is Olivia's spot), 5 m a second after. */
  async function walkFrom120(walker: string, target: string, beat: string[]) {
    let res = await demoWalk(db, { parentId: walker, targetParentId: target, reset: true }, deps());
    const met = [...res.encounters];
    for (let n = 0; !res.encounters.length && !res.cooldown?.length && n < 30; n++) {
      t += 1_000;
      for (const b of beat) await updatePresence(db, { parentId: b, ...FIX }, deps());
      res = await demoWalk(db, { parentId: walker, targetParentId: target }, deps());
      met.push(...res.encounters);
    }
    return met;
  }
  const ORDERED = FAMILIES.flatMap((w) => FAMILIES.filter((x) => x !== w).map((target) => [w, target] as const));
  const CASES = ORDERED.flatMap(([w, target]) => (["reset", "walk on"] as const).map((how) => ({ w, target, how })));

  it.each(CASES)("$w walks to $target ($how) while the third family's tab keeps its heartbeat", async ({ w, target, how }) => {
    await listRomper(); // every pair has something to trade
    for (const k of FAMILIES) await updatePresence(db, { parentId: ids[k], ...FIX }, deps()); // each tab on its demo spot
    const beat = FAMILIES.filter((k) => k !== w && k !== target).map((k) => ids[k]);
    const met = how === "reset" ? await walkFrom120(ids[w], ids[target], beat) : await walkOn(ids[w], ids[target], beat);
    expect(met).toEqual([{ id: expect.any(String), peerId: ids[target], hasMatch: true }]);
    expect(await db.Encounter.list()).toHaveLength(1);
  });
});
