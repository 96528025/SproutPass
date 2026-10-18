// C's location handlers (base44/shared/c/location.ts) on fakeDb, through the mock's world (mockWorld.ts):
// demo spots, radar bands/bearings/demo distance, discoverable, the 120 m walk → encounter at ≤ 25 m → the pets'
// local match → B's createProposal, once per pair until they walk apart. Plus the live (Deno) rules: the staged
// fallback (lines first, proposal after the talk), the agents' heartbeat, noMatch, PairState, races, the mockApi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../../base44/shared/testing/fakeDb.ts";
import { applySeed, DEMO_DATES, seedPlan } from "../../base44/shared/seed.ts";
import { demoClock } from "../../base44/shared/logic/demo.ts";
import { listItem, resolveNudge } from "../../base44/shared/logic/closet.ts";
import { destination, DEMO_LAWN, demoHome, haversineM } from "../../base44/shared/c/geo.ts";
import {
  AGENT_FALLBACK_AFTER_MS,
  demoWalk as cDemoWalk,
  detectEncounters,
  endWithoutMatch,
  FALLBACK_AFTER_MS,
  stampAgents,
  stagedAt,
  talkMs as liveTalkMs,
  updatePresence as cUpdatePresence,
} from "../../base44/shared/c/location.ts";
import type { ClothingItem, Encounter, MatchProposal } from "./types";
import {
  createMockWorld, mockAgentAddress, mockAgentLog, type MockWorld, mockWorldTiming, RULE_PHRASE, rulesPhraseOf, talkMs,
} from "./mockWorld";
import { mockApi, mockDev } from "./api.mock";

let db: FakeDb;
let ids: { mina: string; jo: string; sam: string };
let world: MockWorld;

/** A's ?demo=1 fake fix: every demo tab sends the same one. */
const FIX = { lat: 34.0689, lng: -118.4452, accuracyM: 12, simulated: true };

beforeEach(async () => {
  db = createFakeDb();
  ids = (await applySeed(db, seedPlan())).parentIds as typeof ids;
  world = createMockWorld(db);
  mockWorldTiming.instant = true;
});

afterEach(() => {
  world.cancelAll();
  mockWorldTiming.instant = false;
  vi.useRealTimers();
});

/** Mina's SEP 20 nudge → SELL → romper listed at $18.00, then the clock moves to OCT 18. */
async function listRomper(): Promise<ClothingItem> {
  await demoClock(db, { now: DEMO_DATES.nudge });
  const [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
  const [nudge] = await db.AgentNudge.filter({ itemId: romper.id, kind: "outgrow_check" });
  await resolveNudge(db, { parentId: ids.mina, nudgeId: nudge.id, action: "sell" });
  await listItem(db, { parentId: ids.mina, itemId: romper.id, photo: "romper.jpg", condition: "gently_used", conditionNote: "", shared: true });
  await demoClock(db, { now: DEMO_DATES.meet });
  return romper;
}

/** A's WALK TOWARD: reset on the first call, then one 5 m step per call until an encounter starts. */
async function walk(parentId: string, targetParentId: string, max = 40) {
  let res = await world.demoWalk({ parentId, targetParentId, reset: true });
  const distances = [res.distanceM];
  while (!res.encounters.length && distances.length < max) {
    res = await world.demoWalk({ parentId, targetParentId });
    distances.push(res.distanceM);
  }
  return { res, distances };
}

/** Let the conversation timer's async work finish (setImmediate isn't faked). */
const nextMacrotask = (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate;
const flush = async () => { for (let i = 0; i < 50; i++) await new Promise<void>((r) => nextMacrotask(r)); };

const encounters = () => db.Encounter.list("-startedAt") as Promise<Encounter[]>;
const proposals = () => db.MatchProposal.list() as Promise<MatchProposal[]>;

/** Push an encounter (and its staged lines) `ms` into the past, as if that much real time went by. */
async function age(enc: Encounter, ms: number) {
  const back = (s: string) => new Date(Date.parse(s) - ms).toISOString();
  await db.Encounter.update(enc.id, {
    startedAt: back(enc.startedAt),
    transcript: (enc.transcript ?? []).map((t) => ({ ...t, at: back(t.at) })),
  });
}

describe("presence + radar", () => {
  it("two ?demo=1 tabs with the same fake fix don't stack: each parent gets its own demo spot", async () => {
    const a = await world.updatePresence({ parentId: ids.mina, ...FIX });
    const b = await world.updatePresence({ parentId: ids.jo, ...FIX });
    expect([...a.encounters, ...b.encounters]).toEqual([]);

    const joView = await world.listNearby({ parentId: ids.jo });
    expect(joView.me).toEqual({ accuracyM: 12, simulated: true, fresh: true });
    expect(joView.nearby).toEqual([{ parentId: ids.mina, name: "Mina", sprite: "parent_a", pet: "pet_a", band: "100-300m", bearingDeg: 180, distanceM: 120 }]);
    const minaView = await world.listNearby({ parentId: ids.mina });
    expect(minaView.nearby).toMatchObject([{ parentId: ids.jo, name: "Jo", band: "100-300m", bearingDeg: 0, distanceM: 120 }]);
    // Mina sits on the demo lawn; the client's coordinates were ignored
    const [mina] = await db.Presence.filter({ parentId: ids.mina });
    expect(haversineM(mina, DEMO_LAWN)).toBeLessThan(0.5);
  });

  it("real GPS: band and 5° bearing only, never a distance or coordinates", async () => {
    const here = { lat: 34.05, lng: -118.25 };
    const there = destination(here, 47, 60);
    await world.updatePresence({ parentId: ids.mina, ...here, accuracyM: 10 });
    await world.updatePresence({ parentId: ids.jo, ...there, accuracyM: 10 });
    const view = await world.listNearby({ parentId: ids.mina });
    expect(view.nearby).toHaveLength(1);
    const [jo] = view.nearby;
    expect(jo).toMatchObject({ parentId: ids.jo, band: "25-100m", bearingDeg: 45 });
    expect(jo).not.toHaveProperty("distanceM");
    expect(JSON.stringify(view)).not.toMatch(/"lat"|"lng"|phone/);
  });

  it("out of range (> 300 m), stale or nobody: not on the radar", async () => {
    expect(await world.listNearby({ parentId: ids.mina })).toEqual({ me: null, nearby: [] });
    await world.updatePresence({ parentId: ids.mina, lat: 34.05, lng: -118.25, accuracyM: 10 });
    await world.updatePresence({ parentId: ids.jo, ...destination({ lat: 34.05, lng: -118.25 }, 90, 350), accuracyM: 10 });
    expect((await world.listNearby({ parentId: ids.mina })).nearby).toEqual([]);
    const [jo] = await db.Presence.filter({ parentId: ids.jo });
    await db.Presence.update(jo.id, { ...destination({ lat: 34.05, lng: -118.25 }, 90, 50), updatedAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await world.listNearby({ parentId: ids.mina })).nearby).toEqual([]);
  });

  it("the DISCOVERABLE toggle is written to Parent.discoverable and hides both ways", async () => {
    await world.updatePresence({ parentId: ids.mina, ...FIX, discoverable: false });
    await world.updatePresence({ parentId: ids.jo, ...FIX });
    expect((await db.Parent.get(ids.mina)).discoverable).toBe(false);
    expect((await world.listNearby({ parentId: ids.jo })).nearby).toEqual([]);
    expect((await world.listNearby({ parentId: ids.mina })).nearby).toEqual([]); // you only see others while visible
    await world.updatePresence({ parentId: ids.mina, ...FIX, discoverable: true });
    expect((await db.Parent.get(ids.mina)).discoverable).toBe(true);
    expect((await world.listNearby({ parentId: ids.jo })).nearby).toHaveLength(1);
  });

  it("a real fix can't teleport a parent who is live on real GPS (nobody can drag their dot around)", async () => {
    const here = { lat: 34.05, lng: -118.25 };
    const t0 = Date.now();
    await cUpdatePresence(db, { parentId: ids.mina, ...here, accuracyM: 10 }, { nowMs: t0 });
    const far = destination(here, 90, 2_000);
    const jump = await cUpdatePresence(db, { parentId: ids.mina, ...far, accuracyM: 10 }, { nowMs: t0 + 3_000 });
    expect(jump).toMatchObject({ ok: true, encounters: [], ignored: "implausible jump" });
    const [p] = await db.Presence.filter({ parentId: ids.mina });
    expect(haversineM(p, here)).toBeLessThan(0.5);
    // walking pace is fine, and so is any fix once the old one went stale (30 s)
    await cUpdatePresence(db, { parentId: ids.mina, ...destination(here, 90, 40), accuracyM: 10 }, { nowMs: t0 + 13_000 });
    expect(haversineM((await db.Presence.filter({ parentId: ids.mina }))[0], here)).toBeGreaterThan(39);
    await cUpdatePresence(db, { parentId: ids.mina, ...far, accuracyM: 10 }, { nowMs: t0 + 60_000 });
    expect(haversineM((await db.Presence.filter({ parentId: ids.mina }))[0], far)).toBeLessThan(0.5);
  });

  it("validates its input", async () => {
    await expect(world.updatePresence({ parentId: "", lat: 1, lng: 2, accuracyM: 5 })).rejects.toMatchObject({ code: "bad_request" });
    await expect(world.updatePresence({ parentId: "nope", lat: 1, lng: 2, accuracyM: 5 })).rejects.toMatchObject({ code: "not_found" });
    await expect(world.listNearby({ parentId: "" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(world.demoWalk({ parentId: ids.jo, targetParentId: ids.jo })).rejects.toMatchObject({ code: "bad_request" });
    await expect(world.demoWalk({ parentId: ids.jo, targetParentId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("demo walk → encounter → proposal", () => {
  it("Jo walks from 120 m in 5 m steps; at ≤ 25 m the pets meet and B's createProposal makes the $18 trade", async () => {
    const romper = await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await world.updatePresence({ parentId: ids.jo, ...FIX });

    // the radar label while walking: 5 m steps, bands shrinking
    const first = await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, reset: true });
    expect(first).toMatchObject({ ok: true, distanceM: 120, encounters: [] });
    const { res, distances } = await walk(ids.jo, ids.mina);
    expect(distances[0]).toBe(120);
    expect(distances.at(-1)).toBeLessThanOrEqual(25);
    expect(distances.slice(1).every((d, i) => distances[i] - d === 5)).toBe(true);
    expect(res.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina }]);

    const [enc] = await encounters();
    const [prop] = await proposals();
    expect(enc).toMatchObject({ aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "proposed", proposalId: prop.id });
    expect(enc.transcript.map((t) => t.kind)).toEqual(["looking_for", "have", "fit_check", "propose", "ack"]);
    expect(enc.transcript.map((t) => t.parentId)).toEqual([ids.jo, ids.mina, ids.jo, ids.jo, ids.mina]);
    expect(enc.transcript[1].text).toBe("I have a Yellow duck romper in 6-9M.");
    // the buyer's pet speaks about its own child (it ran the fit for Jo's little one)
    expect(enc.transcript[2].text).toBe("My little one fits it for about 4 more weeks.");
    expect(prop).toMatchObject({
      encounterId: enc.id, buyerId: ids.jo, sellerId: ids.mina, itemId: romper.id, source: "local", status: "open",
      sellerDecision: "pending", buyerDecision: "pending",
    });
    expect(prop.snapshot).toMatchObject({ priceCents: 1800, wearWeeksLeft: 4 });
    expect(prop.transcript).toEqual(enc.transcript);
    expect((await db.ClothingItem.get(romper.id)).status).toBe("pending_trade");
    // nothing is charged: no payment until both accept
    expect(prop.paymentRef).toBeUndefined();
    // both agents heard about it (address only, never coordinates)
    const inbox = await db.AgentInbox.filter({ type: "encounter" });
    expect(inbox.map((r) => r.parentId).sort()).toEqual([ids.jo, ids.mina].sort());
    expect(JSON.stringify(inbox)).not.toMatch(/"lat"|"lng"/);
  });

  it("once per pair: more ticks in range (walk hold, heartbeats from both tabs) don't meet again", async () => {
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    for (let i = 0; i < 3; i++) {
      expect((await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, stepM: 1 })).encounters).toEqual([]);
      expect((await world.updatePresence({ parentId: ids.mina, ...FIX })).encounters).toEqual([]);
      expect((await world.updatePresence({ parentId: ids.jo, ...FIX })).encounters).toEqual([]);
    }
    expect(await encounters()).toHaveLength(1);
    expect(await proposals()).toHaveLength(1);
  });

  it("parked together after a meeting they never re-meet: not after the 2-min cooldown, not after a reload", async () => {
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    const [first] = await encounters();
    await age(first, 5 * 60_000); // well past the demo cooldown
    for (let i = 0; i < 3; i++) {
      expect((await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, stepM: 1 })).encounters).toEqual([]);
      expect((await world.updatePresence({ parentId: ids.mina, ...FIX })).encounters).toEqual([]);
    }
    // a reloaded tab = a new mock world on the same shared rows
    const reloaded = createMockWorld(db);
    expect((await reloaded.updatePresence({ parentId: ids.jo, ...FIX })).encounters).toEqual([]);
    expect((await reloaded.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, stepM: 1 })).encounters).toEqual([]);
    expect(await encounters()).toHaveLength(1);
  });

  it("walking > 40 m apart re-arms the pair: a new WALK TOWARD meets again", async () => {
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    const [first] = await encounters();
    await age(first, 5 * 60_000);
    const again = await walk(ids.jo, ids.mina); // reset → 120 m → re-armed on that tick
    expect(((await db.Encounter.get(first.id)) as Encounter & { rearmedAt?: string }).rearmedAt).toEqual(expect.any(String));
    expect(again.res.encounters).toHaveLength(1);
    const [second] = await encounters();
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("no_match"); // the romper is already in a trade
    expect(await proposals()).toHaveLength(1);
  });

  it("the ~3 s heartbeat of a demo tab never pulls the walker back to the fake fix", async () => {
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, reset: true });
    for (let i = 0; i < 6; i++) await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina });
    await world.updatePresence({ parentId: ids.jo, ...FIX });
    expect((await world.listNearby({ parentId: ids.jo })).nearby[0].distanceM).toBe(90);
  });

  it("a target with no presence is parked on its demo spot (one laptop, one tab)", async () => {
    const { res, distances } = await walk(ids.jo, ids.mina);
    expect(distances[0]).toBe(120);
    expect(res.encounters).toHaveLength(1);
    const [mina] = await db.Presence.filter({ parentId: ids.mina });
    expect(mina.simulated).toBe(true);
    expect(haversineM(mina, DEMO_LAWN)).toBeLessThan(0.5);
  });

  it("a target whose real-GPS presence went stale (that phone left /world) is parked on its demo spot too", async () => {
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, lat: 34.05, lng: -118.25, accuracyM: 10 });
    const [stale] = await db.Presence.filter({ parentId: ids.mina });
    await db.Presence.update(stale.id, { updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    const { res, distances } = await walk(ids.jo, ids.mina);
    expect(distances[0]).toBe(120);
    expect(res.encounters).toHaveLength(1);
    const [mina] = await db.Presence.filter({ parentId: ids.mina });
    expect(mina).toMatchObject({ simulated: true });
    expect(haversineM(mina, demoHome({ id: ids.mina, key: "mina" }))).toBeLessThan(0.5);
  });

  it("nothing fits → no_match with the pets' no-fit lines and no proposal", async () => {
    await listRomper(); // Sam has no need, and nothing listed for Mina to buy
    const { res } = await walk(ids.sam, ids.mina);
    expect(res.encounters).toHaveLength(1);
    const [enc] = await encounters();
    expect(enc.status).toBe("no_match");
    const opener = ids.sam < ids.mina ? ids.sam : ids.mina;
    expect(enc.transcript).toMatchObject([
      { kind: "looking_for", parentId: opener, text: "Hi! Anything on your list for your little one?" },
      { kind: "no_fit", text: "Nothing in my closet fits today." },
    ]);
    expect(await proposals()).toEqual([]);
  });

  it("a hidden parent can't be met; once DISCOVERABLE is back on, the walker's next tick meets (never the target's)", async () => {
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX, discoverable: false });
    const { res } = await walk(ids.jo, ids.mina);
    expect(res.encounters).toEqual([]);
    // Mina's own tick doesn't start a demo encounter: only the walker does, so the two never race
    expect((await world.updatePresence({ parentId: ids.mina, ...FIX, discoverable: true })).encounters).toEqual([]);
    const hold = await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, stepM: 1 });
    expect(hold.encounters).toEqual([{ id: expect.any(String), peerId: ids.mina }]);
    expect((await encounters())[0].status).toBe("proposed");
  });

  it("in the browser the pets talk first: lines while 'talking', the proposal once they've had time to say them", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockWorldTiming.instant = false;
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);

    const [talking] = await encounters();
    expect(talking.status).toBe("talking");
    expect(talking.transcript.map((t) => t.kind)).toEqual(["looking_for", "have", "fit_check", "propose", "ack"]);
    expect(await proposals()).toEqual([]);
    const ms = talkMs(talking.transcript);
    expect(ms).toBeGreaterThanOrEqual(3_000);
    expect(ms).toBeLessThanOrEqual(12_000);
    expect(ms).toBe(liveTalkMs(talking.transcript)); // same talk time as the live fallback

    await vi.advanceTimersByTimeAsync(ms - 100);
    await flush();
    expect((await encounters())[0].status).toBe("talking");
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    const [enc] = await encounters();
    const [prop] = await proposals();
    expect(enc).toMatchObject({ status: "proposed", proposalId: prop.id });
    expect(prop.transcript).toEqual(talking.transcript); // the lines the pets said are the proposal's lines
  });

  it("safety net: an encounter whose tab went away is finished on a later tick after 15 s", async () => {
    mockWorldTiming.instant = false;
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    world.cancelAll(); // the tab that started the conversation closed (its lines were already staged)
    const [enc] = await encounters();
    expect(stagedAt(enc)).not.toBeNull();
    expect((await world.updatePresence({ parentId: ids.mina, ...FIX })).fallback).toEqual([]);
    await age(enc, 16_000);
    expect((await world.updatePresence({ parentId: ids.mina, ...FIX })).fallback).toEqual([enc.id]);
    expect((await encounters())[0].status).toBe("proposed");
    expect(await proposals()).toHaveLength(1);
  });

  it("safety net, never staged: the lines go up first, the proposal a talk-time later", async () => {
    mockWorldTiming.instant = false;
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    world.cancelAll();
    const [enc] = await encounters();
    await db.Encounter.update(enc.id, { transcript: [], startedAt: new Date(Date.now() - 16_000).toISOString() });
    expect((await world.updatePresence({ parentId: ids.mina, ...FIX })).fallback).toEqual([]);
    const staged = await db.Encounter.get(enc.id);
    expect(staged.status).toBe("talking");
    expect(staged.transcript).toHaveLength(5);
    expect(await proposals()).toEqual([]);
    await age(staged, talkMs(staged.transcript) + 1);
    expect((await world.updatePresence({ parentId: ids.mina, ...FIX })).fallback).toEqual([enc.id]);
    expect((await encounters())[0].status).toBe("proposed");
  });
});

describe("the mock agents' protocol log (Agent Console)", () => {
  /** Nothing the agents say may name a parent or child, or carry a phone, a place or a date. */
  const PRIVATE = /\b(Mina|Jo|Sam|Bean|Pea|Sprout)\b|\+\d{6,}|\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b|"lat"|"lng"|\d{4}-\d{2}-\d{2}/;

  it("a mock encounter logs the RelayProtocol exchange, labelled mock, with stand-in addresses", async () => {
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    const [enc] = await encounters();
    expect(enc.status).toBe("proposed");
    expect(enc.negotiatedBy).toBe("local");
    const log = enc.agentLog ?? [];
    expect(log.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
    expect(log.every((e) => e.by === "mock")).toBe(true);
    const jo = mockAgentAddress(ids.jo), mina = mockAgentAddress(ids.mina);
    expect(jo).toMatch(/^mock1q[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{52}$/);
    expect(jo).not.toBe(mina);
    expect(log.map((e) => [e.from, e.to])).toEqual([[jo, mina], [mina, jo], [jo, mina], [mina, jo]]);
    expect(log[0].summary).toBe("Looking for size 6-9M (top, onesie) for a 7-month-old.");
    expect(log[1].summary).toBe("1 shared listing fits: Yellow duck romper, size 6-9M, gently used, $18.00.");
    expect(log[2].summary).toBe("Proposes the Yellow duck romper at $18.00 (60% of $30.00, 2nd owner); fits about 4 more weeks.");
    expect(log[3].summary).toMatch(/nothing is charged until both/);
    // real-time stamps in order, believable hops
    expect(log.every((e, i) => i === 0 || Date.parse(e.at) > Date.parse(log[i - 1].at))).toBe(true);
    expect(log.every((e) => e.ms! >= 140 && e.ms! <= 520)).toBe(true);
    expect(JSON.stringify(log.map(({ summary, type }) => ({ summary, type })))).not.toMatch(PRIVATE);
    expect(JSON.stringify(log)).not.toMatch(/agent1q/); // never posing as a Fetch address
  });

  it("in the browser the messages arrive one by one while the pets talk, and stay after the proposal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockWorldTiming.instant = false;
    // Everything a console watching would see: the fallback's template log never shows up on a mock encounter.
    const seen: string[] = [];
    const off = db._on((e) => {
      if (e.entity === "Encounter") seen.push(...((e.data as Encounter).agentLog ?? []).map((x) => x.by));
    });
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    const [talking] = await encounters();
    expect(talking.status).toBe("talking");
    expect(talking.agentLog ?? []).toEqual([]);
    await vi.advanceTimersByTimeAsync(520);
    await flush();
    const first = (await encounters())[0].agentLog ?? [];
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThan(4);
    await vi.advanceTimersByTimeAsync(talkMs(talking.transcript) + 100);
    await flush();
    const [enc] = await encounters();
    expect(enc.status).toBe("proposed");
    expect(enc.agentLog?.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
    expect(enc.agentLog?.every((e) => e.by === "mock")).toBe(true);
    off();
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["mock"]));
  });

  it("nothing fits → LookingFor then NoFit, from the side that opened", async () => {
    await listRomper();
    await walk(ids.sam, ids.mina);
    const [enc] = await encounters();
    expect(enc.status).toBe("no_match");
    const opener = ids.sam < ids.mina ? ids.sam : ids.mina;
    const other = opener === ids.sam ? ids.mina : ids.sam;
    expect(enc.agentLog?.map((e) => [e.type, e.from, e.to])).toEqual([
      ["LookingFor", mockAgentAddress(opener), mockAgentAddress(other)],
      ["NoFit", mockAgentAddress(other), mockAgentAddress(opener)],
    ]);
    expect(JSON.stringify(enc.agentLog)).not.toMatch(/\b(Mina|Sam|Bean|Sprout)\b/);
  });

  it("mockAgentLog is pure: same context, same messages and latencies", () => {
    const ctx = {
      encounterId: "e1", buyerId: "b", sellerId: "s", needs: [{ sizes: ["2T"] }], childAgeMonths: 26, fits: 2,
      match: { itemName: "Rain boots", size: "2T", priceCents: 1200, originalPriceCents: 3000, previousOwners: 2 },
    };
    const a = mockAgentLog(ctx);
    expect(a).toEqual(mockAgentLog(ctx));
    expect(a[1].summary).toBe("2 shared listings fit: Rain boots, size 2T, $12.00.");
    expect(a[2].summary).toBe("Proposes the Rain boots at $12.00 (40% of $30.00, 3rd owner).");
    expect(mockAgentLog({ ...ctx, needs: [], childAgeMonths: null, fits: 0, match: undefined }).map((e) => e.type))
      .toEqual(["LookingFor", "NoFit"]);
    const declined = mockAgentLog({ ...ctx, declined: { rule: "over_budget", phrase: RULE_PHRASE.over_budget } });
    expect(declined.map((e) => [e.type, e.from])).toEqual([
      ["LookingFor", mockAgentAddress("b")], ["HaveListings", mockAgentAddress("s")], ["Decline", mockAgentAddress("b")],
    ]);
    expect(rulesPhraseOf(declined[2].summary)).toBe("over the monthly budget");
  });
});

describe("the buyer's pet rules say no (B5's mandate, checked by createProposal)", () => {
  /** Jo's pet may only propose up to $10.00: the $18.00 romper is over the limit. */
  const lowLimit = () => db.Parent.update(ids.jo, {
    mandate: { agentMayPropose: true, maxPriceCents: 1000, monthlyBudgetCents: 10_000, categories: [], requirePasskey: false },
  });

  it("the buyer's agent declines instead of proposing; its own pet says why; the log never claims a deal", async () => {
    const romper = await listRomper();
    await lowLimit();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    const [enc] = await encounters();
    expect(enc.status).toBe("no_match");
    expect(await proposals()).toEqual([]);
    expect((await db.ClothingItem.get(romper.id)).status).not.toBe("pending_trade"); // still Mina's, still listed
    // the pets (C's lines): no "Trade proposal!", no "over to the humans", no "nothing fits"; Jo's pet says why not
    const kinds = enc.transcript.map((t) => t.kind);
    expect(kinds).not.toContain("propose");
    expect(kinds).not.toContain("ack");
    expect(kinds).not.toContain("no_fit");
    expect(enc.transcript.at(-1)).toMatchObject({ kind: "decline", parentId: ids.jo });
    // the protocol: no ProposeTrade / TradeAck, a Decline from Jo's agent that names the rule (not the limit)
    const log = enc.agentLog ?? [];
    expect(log.map((e) => [e.type, e.from, e.by])).toEqual([
      ["LookingFor", mockAgentAddress(ids.jo), "mock"],
      ["HaveListings", mockAgentAddress(ids.mina), "mock"],
      ["Decline", mockAgentAddress(ids.jo), "mock"],
    ]);
    expect(log[2].summary).toBe("Won't propose it (the buyer's pet rules: over the price limit). Nothing was proposed or charged.");
    expect(rulesPhraseOf(log[2].summary)).toBe("over the price limit");
    expect(JSON.stringify(log)).not.toMatch(/\b(Mina|Jo|Sam|Bean|Pea|Sprout)\b|\$10\.00/);
    // asking again (another tick) changes nothing
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    const again = (await encounters())[0];
    expect(again.agentLog).toEqual(enc.agentLog);
    expect(again.transcript).toEqual(enc.transcript);
  });

  it("in the browser the decline goes up at once, before any trade line is typed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockWorldTiming.instant = false;
    await listRomper();
    await lowLimit();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    const [enc] = await encounters(); // no timers have run: decided on the meeting tick
    expect(enc.status).toBe("no_match");
    expect(enc.transcript.map((t) => t.kind)).not.toContain("propose");
    expect(enc.transcript.at(-1)?.kind).toBe("decline");
    expect(enc.agentLog?.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "Decline"]);
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(await proposals()).toEqual([]);
    expect((await encounters())[0].agentLog?.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "Decline"]);
  });

  it("a pet that may only point out matches declines too, saying so", async () => {
    await listRomper();
    await db.Parent.update(ids.jo, {
      mandate: { agentMayPropose: false, maxPriceCents: 5000, monthlyBudgetCents: 10_000, categories: [], requirePasskey: false },
    });
    const met = await world.instantEncounter(ids.jo, ids.mina);
    expect(met.proposal).toBeNull();
    expect(met.declined).toMatchObject({ rule: "agent_may_not_propose" });
    expect(met.encounter?.transcript.at(-1)).toMatchObject({ kind: "decline", parentId: ids.jo });
    expect(met.encounter?.agentLog?.at(-1)?.summary).toMatch(/pet rules: point out matches only/);
    expect(met.message).toBe("Stopped by Jo's pet rules: point out matches only, never propose. Nothing was proposed or charged.");
  });
});

describe("TRIGGER ENCOUNTER (instantEncounter): the pets meet without the walk", () => {
  it("a real encounter: the pets' lines, the mock agents' log, then B's proposal for that encounter", async () => {
    const romper = await listRomper();
    const met = await world.instantEncounter(ids.jo, ids.mina);
    const [enc] = await encounters();
    const [prop] = await proposals();
    expect(met.proposal?.id).toBe(prop.id);
    expect(met.encounter?.id).toBe(enc.id);
    expect(enc).toMatchObject({ aId: ids.jo, bId: ids.mina, band: "<25m", simulated: true, status: "proposed", proposalId: prop.id, negotiatedBy: "local" });
    expect(prop).toMatchObject({ encounterId: enc.id, buyerId: ids.jo, sellerId: ids.mina, itemId: romper.id, source: "local", status: "open" });
    expect(enc.transcript.map((t) => t.kind)).toEqual(["looking_for", "have", "fit_check", "propose", "ack"]);
    expect(prop.transcript).toEqual(enc.transcript); // the trade's "how our pets found this" has the pets' lines
    expect(enc.agentLog?.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
    expect(enc.agentLog?.every((e) => e.by === "mock")).toBe(true);
    expect(met.message).toBe("Jo's and Mina's pets agreed on the Yellow duck romper. Both parents decide.");
  });

  it("with talk: the pets say their lines first; it resolves once the proposal lands", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockWorldTiming.instant = false;
    await listRomper();
    let met: Awaited<ReturnType<MockWorld["instantEncounter"]>> | null = null;
    const pending = world.instantEncounter(ids.jo, ids.mina, { talk: true }).then((r) => { met = r; });
    await flush();
    const [talking] = await encounters();
    expect(talking.status).toBe("talking");
    expect(talking.transcript.map((t) => t.kind)).toContain("propose");
    expect(await proposals()).toEqual([]);
    expect(met).toBeNull();
    await vi.advanceTimersByTimeAsync(talkMs(talking.transcript) + 100);
    await flush();
    await pending;
    expect(met!.proposal?.encounterId).toBe(talking.id);
    expect((await encounters())[0].agentLog?.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
  });

  it("nothing fits: an encounter with the no-fit exchange, no proposal, and a plain message", async () => {
    await listRomper();
    const met = await world.instantEncounter(ids.sam, ids.mina);
    expect(met.proposal).toBeNull();
    expect(met.declined).toBeNull();
    expect(met.encounter?.status).toBe("no_match");
    expect(met.encounter?.agentLog?.map((e) => e.type)).toEqual(["LookingFor", "NoFit"]);
    expect(met.message).toBe("The pets met, but nothing on either shared list fits.");
    await expect(world.instantEncounter(ids.jo, ids.jo)).rejects.toMatchObject({ code: "bad_request" });
    await expect(world.instantEncounter(ids.jo, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("live rules (the Deno functions run the same location.ts)", () => {
  /** Walk Jo in with the core directly (default deps: cbridge findMatches, live waits). Returns the meeting time. */
  async function liveWalk(t0: number) {
    let t = t0;
    let r = await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, reset: true }, { nowMs: t });
    while (!r.encounters.length) r = await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina }, { nowMs: (t += 1_000) });
    return { r, t };
  }

  it("no agents on duty: 8 s wait, then the pets' lines while still talking, then the proposal after the talk", async () => {
    await listRomper();
    const t0 = Date.now();
    await cUpdatePresence(db, { parentId: ids.mina, ...FIX }, { nowMs: t0 });
    const { r, t } = await liveWalk(t0);
    const [enc] = await encounters();
    expect(enc.status).toBe("talking");
    expect(r.fallback).toEqual([]);

    // a hold tick before 8 s: nothing yet
    expect((await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 1 }, { nowMs: t + FALLBACK_AFTER_MS - 1_000 })).fallback).toEqual([]);
    expect((await db.Encounter.get(enc.id)).transcript).toEqual([]);

    // 8 s: the lines go up, the encounter keeps talking, no proposal → the Trade window can't cover the bubbles
    const t8 = t + FALLBACK_AFTER_MS;
    expect((await cUpdatePresence(db, { parentId: ids.mina, ...FIX }, { nowMs: t8 })).fallback).toEqual([]);
    const staged = await db.Encounter.get(enc.id);
    expect(staged.status).toBe("talking");
    expect(staged.transcript.map((x: { kind: string }) => x.kind)).toEqual(["looking_for", "have", "fit_check", "propose", "ack"]);
    expect(stagedAt(staged)).toBe(t8);
    expect(await proposals()).toEqual([]);

    // still typing: nothing; once the lines have had time to be said: the proposal
    const talk = liveTalkMs(staged.transcript);
    expect((await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 1 }, { nowMs: t8 + talk - 500 })).fallback).toEqual([]);
    const done = await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 1 }, { nowMs: t8 + talk });
    expect(done.fallback).toEqual([enc.id]);
    const [prop] = await proposals();
    expect(await db.Encounter.get(enc.id)).toMatchObject({ status: "proposed", proposalId: prop.id });
    expect(prop).toMatchObject({ source: "local", encounterId: enc.id });
    expect(prop.transcript).toEqual(staged.transcript);
  });

  it("Fetch agents on duty (agentApi heartbeat < 45 s): the fallback gives them 25 s, not 8 s", async () => {
    await listRomper();
    const t0 = Date.now();
    await cUpdatePresence(db, { parentId: ids.mina, ...FIX }, { nowMs: t0 });
    const { t } = await liveWalk(t0);
    await stampAgents(db, t);
    const [enc] = await encounters();
    await cUpdatePresence(db, { parentId: ids.mina, ...FIX }, { nowMs: t + FALLBACK_AFTER_MS + 1 });
    expect((await db.Encounter.get(enc.id)).transcript).toEqual([]);
    await stampAgents(db, t + 20_000);
    await cUpdatePresence(db, { parentId: ids.mina, ...FIX }, { nowMs: t + AGENT_FALLBACK_AFTER_MS });
    expect((await db.Encounter.get(enc.id)).transcript).toHaveLength(5);
    // the heartbeat is one Setting row next to "demo" (existing fields, nothing for B's getSetting to trip on)
    expect(await db.Setting.filter({ key: "agents" })).toMatchObject([{ now: new Date(t + 20_000).toISOString() }]);
  });

  it("matchVia 'local' stages on the tick that met; the proposal follows after the talk", async () => {
    await listRomper();
    const [s] = await db.Setting.filter({ key: "demo" });
    await db.Setting.update(s.id, { matchVia: "local" });
    const { r, t } = await liveWalk(Date.now());
    expect(r.fallback).toEqual([]);
    const staged = await db.Encounter.get(r.encounters[0].id);
    expect(staged).toMatchObject({ status: "talking" });
    expect(staged.transcript).toHaveLength(5);
    const done = await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 1 }, { nowMs: t + liveTalkMs(staged.transcript) });
    expect(done.fallback).toEqual([r.encounters[0].id]);
    expect((await proposals())[0]).toMatchObject({ encounterId: r.encounters[0].id, source: "local" });
  });

  it("agentApi noMatch never flips an encounter that already has a proposal (a late agent conversation)", async () => {
    await listRomper();
    const [s] = await db.Setting.filter({ key: "demo" });
    await db.Setting.update(s.id, { matchVia: "local" });
    const { r, t } = await liveWalk(Date.now());
    const id = r.encounters[0].id;
    await cDemoWalk(db, { parentId: ids.jo, targetParentId: ids.mina, stepM: 1 }, { nowMs: t + 13_000 });
    expect((await db.Encounter.get(id)).status).toBe("proposed");
    expect(await endWithoutMatch(db, id)).toEqual({ ok: true, skipped: "proposed" });
    expect((await db.Encounter.get(id)).status).toBe("proposed");

    // a talking encounter whose proposal exists (the status write was lost) is marked proposed, not no_match
    await db.Encounter.update(id, { status: "talking" });
    expect(await endWithoutMatch(db, id)).toEqual({ ok: true, skipped: "proposed" });
    expect((await db.Encounter.get(id)).status).toBe("proposed");
    await expect(endWithoutMatch(db, "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("agentApi noMatch ends a talking encounter with no proposal (staged trade lines become the no-fit exchange)", async () => {
    await listRomper();
    const [s] = await db.Setting.filter({ key: "demo" });
    await db.Setting.update(s.id, { matchVia: "local" });
    const { r } = await liveWalk(Date.now());
    const id = r.encounters[0].id;
    expect(stagedAt(await db.Encounter.get(id))).not.toBeNull();
    expect(await endWithoutMatch(db, id)).toEqual({ ok: true });
    const enc = await db.Encounter.get(id);
    expect(enc.status).toBe("no_match");
    expect(enc.transcript.map((x: { kind: string }) => x.kind)).not.toContain("propose");
    expect(enc.transcript.at(-1)).toMatchObject({ kind: "no_fit" });
    expect(await proposals()).toEqual([]);
  });

  it("two ticks crossing 25 m at once make ONE encounter (the later row deletes itself before any inbox row)", async () => {
    await listRomper();
    const now = Date.now();
    // Jo and Mina 10 m apart, both on fresh fixes, armed, never met; both ticks judge the pair at the same time
    const mina = { parentId: ids.mina, ...DEMO_LAWN, accuracyM: 5, simulated: true, updatedAt: new Date(now).toISOString() };
    const jo = { ...mina, parentId: ids.jo, ...destination(DEMO_LAWN, 0, 10) };
    await db.Presence.create(mina);
    await db.Presence.create(jo);
    const parents = new Map((await db.Parent.list()).map((p) => [p.id, p]));
    const seen: string[] = [];
    const off = db._on((e) => { if (e.entity === "Encounter") seen.push(e.type); });
    const opts = { presences: [mina, jo], mover: true, recheck: true };
    const [a, b] = await Promise.all([
      detectEncounters(db, jo, parents, now, opts),
      detectEncounters(db, mina, parents, now, opts),
    ]);
    off();
    expect(seen.filter((t) => t === "create")).toHaveLength(2); // both passed the checks: the race happened…
    expect(seen.filter((t) => t === "delete")).toHaveLength(1); // …and the later row removed itself
    expect(a.created.length + b.created.length).toBe(1);
    expect(await encounters()).toHaveLength(1);
    expect(await db.AgentInbox.filter({ type: "encounter" })).toHaveLength(2);
  });
});

describe("PairState (live, once the entity is pushed)", () => {
  /** A minimal PairState table on the fakeDb, like Base44's entity handler. */
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

  it("one row per pair: disarmed by the meeting, re-armed > 40 m apart, no re-fire while parked", async () => {
    const rows = addPairState();
    await listRomper();
    await world.updatePresence({ parentId: ids.mina, ...FIX });
    await walk(ids.jo, ids.mina);
    expect([...rows.values()]).toMatchObject([{ armed: false, lastEncounterAt: expect.any(String) }]);
    const [first] = await encounters();
    await age(first, 5 * 60_000);
    const [row] = [...rows.values()];
    row.lastEncounterAt = new Date(Date.now() - 5 * 60_000).toISOString();
    for (let i = 0; i < 3; i++) expect((await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, stepM: 1 })).encounters).toEqual([]);
    expect(await encounters()).toHaveLength(1);
    await world.demoWalk({ parentId: ids.jo, targetParentId: ids.mina, reset: true });
    expect([...rows.values()]).toMatchObject([{ armed: true }]);
    expect(((await db.Encounter.get(first.id)) as Encounter & { rearmedAt?: string }).rearmedAt).toBeUndefined(); // PairState holds it, not the encounter
  });
});

describe("mockApi wiring", () => {
  it("updatePresence / listNearby / demoWalk go through the mock world", async () => {
    await mockApi.demoReset();
    const mina = (await mockApi.getCloset({ parentKey: "mina" })).parent.id;
    const jo = (await mockApi.getCloset({ parentKey: "jo" })).parent.id;
    await mockApi.updatePresence({ parentId: mina, ...FIX });
    const walked = await mockApi.demoWalk({ parentId: jo, targetParentId: mina, reset: true });
    expect(walked).toMatchObject({ ok: true, distanceM: 120, encounters: [] });
    const view = await mockApi.listNearby({ parentId: jo });
    expect(view.nearby).toMatchObject([{ parentId: mina, band: "100-300m", distanceM: 120 }]);
  }, 15_000);

  it("the demo panel's TRIGGER ENCOUNTER runs a real encounter (Agent Console, bubbles), not a bare proposal", async () => {
    await mockApi.demoReset();
    await mockApi.demoClock({ now: DEMO_DATES.nudge });
    const closet = await mockApi.getCloset({ parentKey: "mina" });
    const nudge = closet.nudges.find((n) => n.kind === "outgrow_check")!;
    const res = await mockApi.resolveNudge({ parentKey: "mina", nudgeId: nudge.id, action: "sell" });
    await mockApi.listItem({ parentKey: "mina", itemId: res.itemId!, photo: "p.jpg", condition: "gently_used", conditionNote: "", shared: true });
    await mockApi.demoClock({ now: DEMO_DATES.meet });
    const p = (await mockDev.triggerEncounter())!;
    const [enc] = (await mockDev.db.Encounter.list("-startedAt")) as Encounter[];
    expect(p).toMatchObject({ encounterId: enc.id, status: "open", source: "local" });
    expect(enc).toMatchObject({ status: "proposed", proposalId: p.id, negotiatedBy: "local" });
    expect(enc.agentLog?.map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
    expect(p.transcript.length).toBeGreaterThan(0);
  }, 15_000);
});
