// agentApi's encounter actions (c/encounter.ts) and the negotiation log (c/location.ts) on fakeDb:
//   - claimInbox {types:["encounter"]}: the Python agents take only encounter rows; imessage / event rows stay pending
//     for the TypeScript side;
//   - createProposal / noMatch store the agents' RelayProtocol log on Encounter.agentLog (negotiatedBy "fetch"),
//     cleaned (by forced to "fetch", no phone numbers), without handing it to B;
//   - C's local fallback writes the same shape (from/to "fallback", by "fallback", negotiatedBy "local");
//   - a late conversation never relabels an encounter someone else already decided;
//   - the buyer's pet rules (B5's mandate) are checked BEFORE the pets say "Trade proposal!": a blocked match ends
//     "no_match" with the rule in the pets' words, a Decline log entry and Encounter.noMatchReason.
// A vitest file: it lives here, not in c/, so `deno test base44/shared/c/` only finds the Deno suites.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "./testing/fakeDb.ts";
import { applySeed, DEMO_DATES, seedPlan } from "./seed.ts";
import { demoClock } from "./logic/demo.ts";
import { listItem, resolveNudge } from "./logic/closet.ts";
import { findMatches } from "./cbridge.ts";
import type { AgentLogEntry, AgentTurn, Encounter, PetMandate } from "./types.ts";
import { claimInbox, fitForAgents, inboxTypes, noMatchFromAgents, proposeFromAgents } from "./c/encounter.ts";
import {
  cleanAgentLog,
  cleanTurns,
  endWithoutMatch,
  localAgentLog,
  resolveEncounter,
  rulesLine,
  runLocalFallback,
  stageEncounter,
  updateEncounter,
} from "./c/location.ts";

let db: FakeDb;
let ids: { mina: string; jo: string; sam: string };

const MINA_AGENT = "agent1qwmina0000000000000000000000000000000000000000000000000000000";
const JO_AGENT = "agent1qwjo00000000000000000000000000000000000000000000000000000000000";

beforeEach(async () => {
  db = createFakeDb();
  ids = (await applySeed(db, seedPlan())).parentIds as typeof ids;
});

const logOf = (e: Encounter): AgentLogEntry[] => e.agentLog ?? [];
const kinds = (e: Encounter) => (e.transcript ?? []).map((t) => t.kind);

/** Mina's romper listed at $18.00 (2nd owner pays 60% of $30.00), clock at the Oct 18 meeting. */
async function listRomper(): Promise<{ listingId: string }> {
  await demoClock(db, { now: DEMO_DATES.nudge });
  const [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
  const [nudge] = await db.AgentNudge.filter({ itemId: romper.id, kind: "outgrow_check" });
  await resolveNudge(db, { parentId: ids.mina, nudgeId: nudge.id, action: "sell" });
  const listing = await listItem(db, { parentId: ids.mina, itemId: romper.id, photo: "romper.jpg", condition: "gently_used", conditionNote: "", shared: true });
  await demoClock(db, { now: DEMO_DATES.meet });
  return { listingId: listing.id };
}

async function talking(a = ids.mina, b = ids.jo): Promise<Encounter> {
  return await db.Encounter.create({ aId: a, bId: b, band: "<25m", simulated: true, status: "talking", startedAt: new Date().toISOString(), transcript: [] });
}

/** Jo's rules for Pip (B5's PetMandate, stored partially like setMandate would). */
async function joRules(m: Partial<PetMandate>) {
  await db.Parent.update(ids.jo, { mandate: m as PetMandate });
}

/** What the Python agents send (agents/agent_log.py), with one summary that leaks a phone number. */
function fetchLog() {
  const t0 = Date.parse("2026-10-18T17:00:00.000Z");
  const at = (i: number) => new Date(t0 + i * 180).toISOString();
  return [
    { at: at(0), from: MINA_AGENT, to: JO_AGENT, type: "LookingFor", summary: "Says hello; has no shared need to ask about.", by: "fetch" },
    { at: at(1), from: JO_AGENT, to: MINA_AGENT, type: "LookingFor", summary: "Asks for size 6-9M (top, onesie).", ms: 180, by: "fetch" },
    { at: at(2), from: MINA_AGENT, to: JO_AGENT, type: "HaveListings", summary: "Offers 1 shared listing: Yellow duck romper, size 6-9M, $18.00.", ms: 181, by: "fetch" },
    { at: at(3), from: JO_AGENT, to: MINA_AGENT, type: "ProposeTrade", summary: "Proposes the listing at $18.00. Call me at +1 (310) 555-0199.", ms: 179.6, by: "mock" },
    { at: at(4), from: MINA_AGENT, to: JO_AGENT, type: "TradeAck", summary: "Agrees to the trade; both parents still decide in the app.", ms: 182, by: "fetch" },
  ];
}

const turns = (buyer: string, seller: string): AgentTurn[] => [
  { from: "buyer_agent", parentId: seller, kind: "looking_for", text: "Button: Hi! Anything you need?", at: "2026-10-18T17:00:00.000Z" },
  { from: "buyer_agent", parentId: buyer, kind: "looking_for", text: "Pip: Looking for 6-9M onesie!", at: "2026-10-18T17:00:00.200Z" },
];

describe("claimInbox types filter", () => {
  async function inbox() {
    const row = (parentId: string, type: "encounter" | "imessage" | "event", i: number) =>
      db.AgentInbox.create({ parentId, type, payload: {}, status: "pending", createdAt: `2026-10-18T17:00:0${i}.000Z` } as never);
    await row(ids.mina, "imessage", 1);
    await row(ids.jo, "encounter", 2);
    await row(ids.mina, "event", 3);
    await row(ids.mina, "encounter", 4);
  }

  it("claims only encounter rows; iMessages and events stay pending for the TypeScript side", async () => {
    await inbox();
    const { rows } = await claimInbox(db, { types: ["encounter"], agentAddress: "live-bureau", limit: 10 });
    expect(rows.map((r) => [r.type, r.parentId])).toEqual([["encounter", ids.jo], ["encounter", ids.mina]]);
    const all: any[] = await db.AgentInbox.list("createdAt");
    expect(all.map((r) => [r.type, r.status])).toEqual([
      ["imessage", "pending"], ["encounter", "claimed"], ["event", "pending"], ["encounter", "claimed"],
    ]);
    expect(all.filter((r) => r.status === "claimed").every((r) => r.claimedBy === "live-bureau")).toBe(true);
  });

  it("merges several types oldest first, honours parentId and limit; no types = every row (old agents)", async () => {
    await inbox();
    const two = await claimInbox(db, { types: ["event", "encounter"], parentId: ids.mina, limit: 2 });
    expect(two.rows.map((r) => r.type)).toEqual(["event", "encounter"]);
    const rest = await claimInbox(db, {});
    expect(rest.rows.map((r) => r.type)).toEqual(["imessage", "encounter"]);
  });

  it("peek returns a parent's newer event rows without claiming them (ASI:One mirror)", async () => {
    await inbox();
    const res = await claimInbox(db, { types: ["encounter"], parentId: ids.mina, peek: { types: ["event"], since: "2026-10-18T17:00:02.000Z" } });
    expect(res.rows.map((r) => r.type)).toEqual(["encounter"]);
    expect(res.peeked?.map((r) => [r.type, r.status])).toEqual([["event", "pending"]]); // still the TypeScript side's
    const later = await claimInbox(db, { types: ["encounter"], parentId: ids.mina, peek: { since: "2026-10-18T17:00:03.000Z" } });
    expect(later.peeked).toEqual([]);
    expect((await claimInbox(db, { types: ["encounter"], peek: { types: ["event"] } })).peeked).toBeUndefined(); // needs a parent
  });

  it("refuses a types list with nothing it knows", async () => {
    expect(inboxTypes(undefined)).toBeNull();
    expect(inboxTypes("encounter")).toEqual(["encounter"]);
    expect(inboxTypes(["encounter", "encounter", "bogus"])).toEqual(["encounter"]);
    await expect(claimInbox(db, { types: ["bogus"] })).rejects.toMatchObject({ status: 400 });
  });
});

describe("the agents' protocol log rides on createProposal / noMatch", () => {
  it("createProposal stores the cleaned log, negotiatedBy fetch, proposalId and the transcript", async () => {
    const { listingId } = await listRomper();
    const enc = await talking();
    const prop = await proposeFromAgents(db, {
      action: "createProposal", listingId, buyerId: ids.jo, sellerId: ids.mina, encounterId: enc.id,
      transcript: turns(ids.jo, ids.mina), source: "fetch", agentLog: fetchLog(), negotiatedBy: "fetch",
    });
    expect(prop.source).toBe("fetch");
    expect(prop).not.toHaveProperty("agentLog"); // B never sees the log
    const after = await db.Encounter.get(enc.id);
    expect(after).toMatchObject({ status: "proposed", proposalId: prop.id, negotiatedBy: "fetch" });
    expect(after.transcript).toHaveLength(2);
    const log = logOf(after);
    expect(log.map((e) => e.type)).toEqual(["LookingFor", "LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
    expect(log.every((e) => e.by === "fetch")).toBe(true); // forced: only agents reach agentApi
    expect(log[0]).not.toHaveProperty("ms");
    expect(log[3].ms).toBe(180);
    expect(log[0].from).toBe(MINA_AGENT);
    expect(log[3].summary).toBe("Proposes the listing at $18.00. Call me at [hidden].");
    expect(JSON.stringify(log)).not.toMatch(/555|Mina|Jo\b/);
  });

  it("createProposal cleans the agents' transcript before B or the Encounter sees it", async () => {
    const { listingId } = await listRomper();
    const enc = await talking();
    const junk = [...turns(ids.jo, ids.mina), { from: "pirate", kind: "propose", text: "arr" }, { from: "seller_agent", kind: "shout", text: "x" }];
    const prop = await proposeFromAgents(db, { listingId, buyerId: ids.jo, encounterId: enc.id, transcript: junk, agentLog: fetchLog() });
    expect(prop.transcript).toHaveLength(2);
    const after = await db.Encounter.get(enc.id);
    expect(kinds(after)).toEqual(["looking_for", "looking_for"]);
    expect(after.negotiatedBy).toBe("fetch");
    expect(logOf(after)).toHaveLength(5); // the log is stored, not lost to a refused transcript
  });

  it("noMatch stores the log and the pets' bubbles on a still-talking encounter", async () => {
    const enc = await talking();
    const log = fetchLog().slice(0, 2).concat([{ at: "2026-10-18T17:00:01.000Z", from: MINA_AGENT, to: JO_AGENT, type: "NoFit", summary: "No fit: nothing in my closet fits today.", ms: 240, by: "fetch" }]);
    const res = await noMatchFromAgents(db, { encounterId: enc.id, agentLog: log, transcript: [...turns(ids.jo, ids.mina), { from: "x", kind: "nope", text: "dropped" }], negotiatedBy: "fetch" });
    expect(res).toEqual({ ok: true });
    const after = await db.Encounter.get(enc.id);
    expect(after.status).toBe("no_match");
    expect(after.negotiatedBy).toBe("fetch");
    expect(logOf(after).map((e) => e.type)).toEqual(["LookingFor", "LookingFor", "NoFit"]);
    expect(kinds(after)).toEqual(["looking_for", "looking_for"]);
    expect(after.noMatchReason).toBeUndefined();
  });

  it("a no_match never keeps a 'Trade proposal!' or 'over to the humans' bubble, and keeps the agents' reason", async () => {
    const enc = await talking();
    const t = [
      ...turns(ids.jo, ids.mina),
      { from: "buyer_agent", parentId: ids.jo, kind: "propose", text: "Pip: Trade proposal! $18.00", at: "2026-10-18T17:00:01.000Z" },
      { from: "seller_agent", parentId: ids.mina, kind: "ack", text: "Button: Sounds good", at: "2026-10-18T17:00:01.500Z" },
      { from: "buyer_agent", parentId: ids.jo, kind: "decline", text: "Pip: Not this one — it's over the price limit Jo set for me.", at: "2026-10-18T17:00:02.000Z" },
    ];
    await noMatchFromAgents(db, { encounterId: enc.id, agentLog: fetchLog().slice(0, 3), transcript: t, reason: "It costs more than the price limit Jo set for Pip." });
    const after = await db.Encounter.get(enc.id);
    expect(kinds(after)).toEqual(["looking_for", "looking_for", "decline"]);
    expect(after.noMatchReason).toBe("It costs more than the price limit Jo set for Pip.");
  });

  it("a late noMatch never relabels an encounter the local fallback already decided", async () => {
    await listRomper();
    const enc = await talking();
    expect(await resolveEncounter(db, enc, findMatches)).toBe("proposed");
    const res = await noMatchFromAgents(db, { encounterId: enc.id, agentLog: fetchLog() });
    expect(res).toEqual({ ok: true, skipped: "proposed" });
    const after = await db.Encounter.get(enc.id);
    expect(after.negotiatedBy).toBe("local");
    expect(logOf(after).every((e) => e.by === "fallback")).toBe(true);
  });

  it("agents that propose after the fallback did keep the fallback's log (B hands back its proposal)", async () => {
    const { listingId } = await listRomper();
    const enc = await talking();
    await resolveEncounter(db, enc, findMatches);
    const before = await db.Encounter.get(enc.id);
    // the fallback's proposal is source "local"; the agents' call for the same listing + buyer gets it back
    const [local] = await db.MatchProposal.filter({ encounterId: enc.id });
    expect(local.source).toBe("local");
    const prop = await proposeFromAgents(db, { listingId, buyerId: ids.jo, encounterId: enc.id, agentLog: fetchLog(), transcript: turns(ids.jo, ids.mina) });
    expect(prop.id).toBe(local.id);
    const after = await db.Encounter.get(enc.id);
    expect(after.negotiatedBy).toBe("local");
    expect(after.agentLog).toEqual(before.agentLog);
    expect(after.transcript).toEqual(before.transcript);
  });
});

describe("C's local fallback writes the same log shape", () => {
  it("the fallback's proposal carries LookingFor → HaveListings → ProposeTrade → TradeAck, by fallback", async () => {
    await listRomper();
    const enc = await talking();
    const step = await stageEncounter(db, enc, findMatches);
    expect(step.status).toBe("staged");
    const staged = await db.Encounter.get(enc.id);
    expect(staged.status).toBe("talking");
    expect(staged.agentLog).toBeUndefined(); // not decided yet: the agents may still win it
    expect(staged.negotiatedBy).toBeUndefined();
    expect(await resolveEncounter(db, staged, findMatches)).toBe("proposed");
    const done = await db.Encounter.get(enc.id);
    expect(done).toMatchObject({ status: "proposed", negotiatedBy: "local" });
    expect(logOf(done).map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]);
    for (const e of logOf(done)) expect(e).toMatchObject({ from: "fallback", to: "fallback", by: "fallback" });
    expect(logOf(done)[1].summary).toBe("Seller side offers a shared listing: Yellow duck romper, size 6-9M, $18.00.");
  });

  it("nothing fits either way → LookingFor → NoFit, negotiatedBy local", async () => {
    const enc = await talking(ids.mina, ids.sam);
    const { resolved } = await runLocalFallback(db, findMatches, { fallbackAfterMs: 0, talkMs: () => 0 });
    expect(resolved).toEqual([enc.id]);
    const after = await db.Encounter.get(enc.id);
    expect(after).toMatchObject({ status: "no_match", negotiatedBy: "local" });
    expect(logOf(after).map((e) => [e.type, e.by])).toEqual([["LookingFor", "fallback"], ["NoFit", "fallback"]]);
  });

  it("an agents' noMatch on staged fallback lines swaps in the agents' run", async () => {
    await listRomper();
    const enc = await talking();
    await stageEncounter(db, enc, findMatches);
    await endWithoutMatch(db, enc.id, Date.now(), { negotiatedBy: "fetch", agentLog: cleanAgentLog(fetchLog().slice(0, 2), "fetch") });
    const after = await db.Encounter.get(enc.id);
    expect(after).toMatchObject({ status: "no_match", negotiatedBy: "fetch" });
    expect(logOf(after).map((e) => e.by)).toEqual(["fetch", "fetch"]);
    expect(kinds(after).at(-1)).toBe("no_fit");
    expect(kinds(after)).not.toContain("propose");
  });
});

describe("the buyer's pet rules are checked before anyone says 'Trade proposal!'", () => {
  const PRICE_REASON = "It costs more than the price limit Jo set for Pip.";
  const PRICE_LINE = "Aw, not this one — it's over the price limit Jo set for me."; // in Pip's own voice

  it("agentApi fit marks each match with the buyer's verdict (price, kinds, budget, may-propose)", async () => {
    await listRomper();
    const fit = () => fitForAgents(db, { buyerId: ids.jo, sellerId: ids.mina });
    const [open] = (await fit()).matches;
    expect(open).toMatchObject({ itemName: "Yellow duck romper", priceCents: 1800 });
    expect(open.blocked).toBeUndefined(); // default rules: up to $50, $100 a month

    await joRules({ maxPriceCents: 1000 });
    expect((await fit()).matches[0].blocked).toEqual({ rule: "over_price", reason: PRICE_REASON, line: "it's over the price limit Jo set for me." });
    await joRules({ categories: ["top"] });
    expect((await fit()).matches[0].blocked).toMatchObject({ rule: "category", line: "it isn't a kind of clothes Jo asked me to look for." });
    await joRules({ monthlyBudgetCents: 1000 });
    expect((await fit()).matches[0].blocked).toMatchObject({ rule: "over_budget", line: "it would go over Jo's monthly budget for me." });
    await joRules({ agentMayPropose: false });
    expect((await fit()).matches[0].blocked).toMatchObject({ rule: "agent_may_not_propose" });
    for (const r of ["over_price", "category", "over_budget", "agent_may_not_propose"] as const) {
      expect(rulesLine(r, "Jo")).not.toMatch(/\$|\d/); // the buyer's limits stay private: no amounts
    }
  });

  it("the local fallback ends a blocked match at once: the rule in the pets' words, a Decline log, noMatchReason", async () => {
    await listRomper();
    await joRules({ maxPriceCents: 1000 });
    const enc = await talking();
    const step = await stageEncounter(db, enc, findMatches);
    expect(step).toMatchObject({ status: "no_match", reason: PRICE_REASON });
    const after = await db.Encounter.get(enc.id);
    expect(after).toMatchObject({ status: "no_match", negotiatedBy: "local", noMatchReason: PRICE_REASON });
    expect(kinds(after)).toEqual(["looking_for", "have", "decline"]);
    const last = after.transcript.at(-1)!;
    expect(last).toMatchObject({ from: "buyer_agent", parentId: ids.jo, text: PRICE_LINE });
    expect(JSON.stringify(after.transcript)).not.toMatch(/Trade proposal|over to the humans|Nothing in my closet/);
    expect(logOf(after).map((e) => e.type)).toEqual(["LookingFor", "HaveListings", "Decline"]);
    expect(logOf(after)[2].summary).toBe("Buyer side declines: over the price limit the buyer set for their pet. Nothing was proposed.");
    expect(JSON.stringify(logOf(after))).not.toMatch(/Jo|Pip|\$10/);
    expect(await db.MatchProposal.filter({ encounterId: enc.id })).toEqual([]); // nothing charged, nothing proposed
  });

  it("rules that change after the lines were staged: the staged proposal lines go, the rule is said", async () => {
    await listRomper();
    const enc = await talking();
    expect((await stageEncounter(db, enc, findMatches)).status).toBe("staged");
    await joRules({ maxPriceCents: 1000 }); // Jo lowers the limit while the pets are still talking
    const staged = await db.Encounter.get(enc.id);
    expect(kinds(staged)).toContain("propose");
    expect(await resolveEncounter(db, staged, findMatches)).toBe("no_match");
    const after = await db.Encounter.get(enc.id);
    expect(after.noMatchReason).toBe(PRICE_REASON);
    expect(kinds(after)).toEqual(["looking_for", "have", "fit_check", "decline"]);
    expect(after.transcript.at(-1)!.text).toBe(PRICE_LINE);
    expect(logOf(after).at(-1)!.type).toBe("Decline");
  });

  it("the whole runLocalFallback tick (what the Deno heartbeat and the mock run) ends blocked, not 'nothing fits'", async () => {
    await listRomper();
    await joRules({ monthlyBudgetCents: 1000 });
    const enc = await talking();
    const { resolved } = await runLocalFallback(db, findMatches, { fallbackAfterMs: 0, talkMs: () => 0 });
    expect(resolved).toEqual([enc.id]);
    const after = await db.Encounter.get(enc.id);
    expect(after.noMatchReason).toBe("It would go over Jo's monthly budget for Pip.");
    expect(logOf(after).at(-1)!.summary).toContain("over the budget the buyer set for their pet");
  });

  it("an agents' createProposal the rules refuse comes back tagged pet_rules(<rule>) and leaves the encounter talking", async () => {
    const { listingId } = await listRomper();
    await joRules({ maxPriceCents: 1000 });
    const enc = await talking();
    const call = proposeFromAgents(db, { listingId, buyerId: ids.jo, encounterId: enc.id, transcript: turns(ids.jo, ids.mina), agentLog: fetchLog() });
    await expect(call).rejects.toMatchObject({ code: "not_eligible", status: 409, message: `createProposal: not_eligible: pet_rules(over_price): ${PRICE_REASON}` });
    expect((await db.Encounter.get(enc.id)).status).toBe("talking"); // the agents end it with noMatch + the reason
    expect(await db.MatchProposal.filter({ encounterId: enc.id })).toEqual([]);
  });

  it("other refusals are passed on untouched", async () => {
    const { listingId } = await listRomper();
    await db.Need.list().then((needs: any[]) => Promise.all(needs.map((n) => db.Need.delete(n.id))));
    const enc = await talking();
    await expect(proposeFromAgents(db, { listingId, buyerId: ids.jo, encounterId: enc.id })).rejects.toMatchObject({
      code: "not_eligible", message: "createProposal: not_eligible: buyer has no shared need",
    });
  });
});

describe("cleaning and schema tolerance", () => {
  it("cleanAgentLog keeps the last 40 plain entries and drops junk", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ type: "LookingFor", summary: `n${i}`, from: "agent1q<script>", to: 7, at: "nope", ms: -3 }));
    const out = cleanAgentLog([null, "x", { type: "!!" }, ...many], "fetch", Date.parse("2026-10-18T17:00:00.000Z"));
    expect(out).toHaveLength(40);
    expect(out[0]).toEqual({ at: "2026-10-18T17:00:00.000Z", from: "agent1qscript", to: "7", type: "LookingFor", summary: "n5", by: "fetch" });
    expect(cleanAgentLog("nope", "fetch")).toEqual([]);
    expect(cleanTurns([{ from: "seller_agent", kind: "ack", text: "x".repeat(300), parentId: 1, at: "bad" }])[0].text).toHaveLength(200);
  });

  it("localAgentLog never invents latency", () => {
    const log = localAgentLog({ listingId: "l", itemName: "Romper", size: "6-9M", priceCents: 1800, wearWeeksLeft: 4 }, 0);
    expect(log.some((e) => "ms" in e)).toBe(false);
    expect(log[2].summary).toBe("Buyer side proposes the listing at $18.00. Size 6-9M fits for about 4 more weeks.");
  });

  it("a schema that refuses the new fields still gets the status change (and proposalId when it can)", async () => {
    const enc = await talking();
    const real = db.Encounter.update.bind(db.Encounter);
    const tries: string[][] = [];
    (db.Encounter as any).update = async (id: string, patch: any) => {
      tries.push(Object.keys(patch));
      if ("agentLog" in patch || "negotiatedBy" in patch) throw new Error("unknown field agentLog");
      return real(id, patch);
    };
    await updateEncounter(db, enc.id, { status: "proposed" }, { proposalId: "p1" }, { negotiatedBy: "fetch", agentLog: [] });
    expect(tries).toEqual([["status", "proposalId", "negotiatedBy", "agentLog"], ["status", "proposalId"]]);
    expect(await db.Encounter.get(enc.id)).toMatchObject({ status: "proposed", proposalId: "p1" });
  });

  it("a schema without noMatchReason still stores the blocked outcome and its log", async () => {
    await listRomper();
    await joRules({ maxPriceCents: 1000 });
    const enc = await talking();
    const real = db.Encounter.update.bind(db.Encounter);
    (db.Encounter as any).update = async (id: string, patch: any) => {
      if ("noMatchReason" in patch) throw new Error("unknown field noMatchReason");
      return real(id, patch);
    };
    await stageEncounter(db, enc, findMatches);
    const after = await db.Encounter.get(enc.id);
    expect(after).toMatchObject({ status: "no_match", negotiatedBy: "local" });
    expect(after.noMatchReason).toBeUndefined();
    expect(logOf(after).at(-1)!.type).toBe("Decline");
    expect(after.transcript.at(-1)!.kind).toBe("decline");
  });
});
