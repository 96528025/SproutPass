// C (W3): the location half of B's mock. updatePresence / listNearby / demoWalk run C's real handlers
// (base44/shared/c/location.ts: presence per parent, 25/100/300 m bands, 5° bearings, encounter at ≤ 25 m once
// per pair until they walk > 40 m apart, the 120 m demo walk) on the mock's in-browser fakeDb, so /world?demo=1
// works offline exactly like live. fakeDb has no PairState, so location.ts keeps the pair bookkeeping on the
// Encounter rows (`rearmedAt`), which every tab shares and a reload keeps: parked parents never re-meet.
//
// The pets' conversation follows the same two steps as C's live fallback (location.ts runLocalFallback), only
// without the live 8 s wait for the Fetch agents (the mock has none): the moment an encounter starts, the pets'
// lines go onto it (still "talking", so AgentBubbles type them while the pets are out); once they've had time to
// say them (talkMs), B's createProposal runs with those lines (source "local") → "proposed" → the Trade window
// pops on both tabs. Nothing fits → "no_match" at once. A safety net finishes any encounter still talking after
// 15 s on the next presence/walk tick (e.g. the tab that started it was closed). `mockWorldTiming.instant = true`
// (tests) does all of it inside the same call. `instantEncounter` (the demo panel's TRIGGER ENCOUNTER) runs the
// same conversation for two parents without the walk.
//
// The buyer's own pet rules (B5's mandate: may propose, price limit, kinds of clothes, monthly budget) are checked
// on the server by createProposal, and C checks the same rules before the pets talk (location.ts withRules). When
// they say no, the buyer's agent declines instead of proposing: its pet says why (C's lines), the mock log ends with
// a Decline that names the rule (never the limit), and nothing is proposed or charged.
//
// The Agent Console (/agents) shows the agents' protocol messages (Encounter.agentLog). The mock has no Fetch
// agents, so it writes the messages they would have sent (RelayProtocol: LookingFor → HaveListings → ProposeTrade
// → TradeAck, LookingFor → HaveListings → Decline, or LookingFor → NoFit), clearly labelled: by "mock", from/to
// "mock1q…" stand-in addresses (never "agent1q…"), negotiatedBy "local". The opening messages go up one by one a
// few hundred ms apart while the pets type their lines; how it ended (ProposeTrade → TradeAck, or Decline) is only
// written once B's createProposal has answered, so the log never claims a deal the server refused. Summaries carry
// only what the protocol shares: shared needs, shared listings, the child's age in months. Never names, phones,
// places or birthdates.
import type {
  AgentLogEntry, DemoWalkReq, DemoWalkRes, Encounter, ListNearbyReq, ListNearbyRes, MatchProposal, UpdatePresenceReq,
  UpdatePresenceRes,
} from "./types";
import {
  demoWalk as cDemoWalk,
  type FindMatches,
  listNearby as cListNearby,
  type LocationDeps,
  resolveEncounter,
  type RulesBlock,
  stageEncounter,
  TALK_TIMING,
  talkMs as cTalkMs,
  updatePresence as cUpdatePresence,
  withRules,
} from "../../base44/shared/c/location.ts";
import { findMatches as bFindMatches, type LocalMatch } from "../../base44/shared/cbridge.ts";
import { getNow } from "../../base44/shared/db.ts";
import { bad, notFound } from "../../base44/shared/errors.ts";
import type { MandateRule } from "../../base44/shared/logic/trust.ts";
import { formatCents, RESALE_PCT } from "../../base44/shared/pricing.ts";
import { ageInMonths } from "../../base44/shared/sizes.ts";
import type { FakeDb } from "../../base44/shared/testing/fakeDb.ts";

export const mockWorldTiming = {
  /** Resolve encounters inside the call that created them (tests). */
  instant: false,
  ...TALK_TIMING,
  /** Safety net for an encounter nobody resolved (its tab closed): next tick after this long. */
  fallbackAfterMs: 15_000,
};

const findMatches: FindMatches = bFindMatches;

/** How long the pets need to "say" these lines before the proposal lands (3–12 s): same rule as live. */
export function talkMs(transcript: { text?: string }[]): number {
  return cTalkMs(transcript, mockWorldTiming);
}

// ---------------------------------------------------------------- the mock agents' protocol log (Agent Console)

/** Stand-in agent addresses start with this, so nobody mistakes them for a Fetch.ai address ("agent1q…"). */
export const MOCK_AGENT_PREFIX = "mock1q";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function hash32(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** A stable, address-shaped id for a parent's mock agent ("mock1q" + 52 chars, like a uAgent address). */
export function mockAgentAddress(parentId: string): string {
  let h = hash32(parentId) || 1;
  let out = MOCK_AGENT_PREFIX;
  for (let i = 0; i < 52; i++) {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; // xorshift32
    out += BECH32[h & 31];
  }
  return out;
}

/** Why the buyer's agent declined instead of proposing. Every text here is name-free (the log is public). */
export interface MockDecline {
  /** The buyer's pet rule that said no (B5's checkMandate), or null when the relay refused for another reason. */
  rule: MandateRule | null;
  /** What stopped it, for the log and the console: "over the price limit". */
  phrase: string;
}

/** The pet rules in a few words (name-free: the buyer's limits themselves stay private). */
export const RULE_PHRASE: Record<MandateRule, string> = {
  agent_may_not_propose: "point out matches only, never propose",
  over_price: "over the price limit",
  category: "not a kind of clothes on the list",
  over_budget: "over the monthly budget",
};

const RULES_TAG = "the buyer's pet rules";
const NOTHING_CHARGED = "Nothing was proposed or charged.";

/** The Decline message's summary. The console reads the rules phrase back with `rulesPhraseOf`. */
export function declineSummary(d: MockDecline): string {
  return d.rule ? `Won't propose it (${RULES_TAG}: ${d.phrase}). ${NOTHING_CHARGED}` : `Won't propose it: ${d.phrase}. ${NOTHING_CHARGED}`;
}

/** "over the price limit" from a Decline written by `declineSummary` for a pet-rules stop; null otherwise. */
export function rulesPhraseOf(summary: string | undefined | null): string | null {
  const m = /\(the buyer's pet rules: ([^)]+)\)/.exec(summary ?? "");
  return m ? m[1] : null;
}

/** What one mock exchange is about: only the fields the RelayProtocol shares (no names, places or birthdates). */
export interface MockLogContext {
  encounterId: string;
  /** The side that opens (and buys, when there is a match). */
  buyerId: string;
  sellerId: string;
  /** The opener's SHARED needs. */
  needs: { sizes: string[]; categories?: string[] }[];
  childAgeMonths: number | null;
  /** How many of the seller's shared listings fit (0 = NoFit). */
  fits: number;
  match?: {
    itemName: string; size: string; priceCents: number; condition?: string; wearWeeksLeft?: number;
    originalPriceCents?: number; previousOwners?: number;
  };
  /** B's createProposal said no (the buyer's pet rules, or another rule): the buyer's agent declines. */
  declined?: MockDecline;
}

type LogStep = Omit<AgentLogEntry, "at"> & { ms: number };

/** A believable network hop for message `i` (140–520 ms), stable per encounter. */
function hopMs(encounterId: string, i: number): number {
  return 140 + (hash32(`${encounterId}:${i}`) % 381);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ORDINAL = ["1st", "2nd", "3rd"];
/** LookingFor + HaveListings: what the agents say before anyone knows how it ends. */
const OPENING = 2;

/**
 * The messages the two closet agents would exchange for this encounter (RelayProtocol, agents/relay_protocol.py),
 * labelled `by: "mock"`. Pure: same context → same log (latencies included).
 */
export function mockAgentLog(ctx: MockLogContext): LogStep[] {
  const buyer = mockAgentAddress(ctx.buyerId);
  const seller = mockAgentAddress(ctx.sellerId);
  const sizes = [...new Set(ctx.needs.flatMap((n) => n.sizes))];
  const cats = [...new Set(ctx.needs.flatMap((n) => n.categories ?? []))];
  const age = ctx.childAgeMonths != null ? ` for a ${ctx.childAgeMonths}-month-old` : "";
  const lookingFor = sizes.length
    ? `Looking for size ${sizes.join(" or ")}${cats.length ? ` (${cats.join(", ")})` : ""}${age}.`
    : `No open needs${age}; asks what is on the other closet's shared list.`;
  const steps: Omit<LogStep, "ms">[] = [
    { from: buyer, to: seller, type: "LookingFor", summary: lookingFor, by: "mock" },
  ];
  const m = ctx.match;
  if (!m || ctx.fits < 1) {
    steps.push({ from: seller, to: buyer, type: "NoFit", summary: "Nothing on this closet's shared list fits those needs.", by: "mock" });
  } else {
    const cond = m.condition ? `, ${m.condition.replace(/_/g, " ")}` : "";
    steps.push({
      from: seller, to: buyer, type: "HaveListings", by: "mock",
      summary: `${plural(ctx.fits, "shared listing")} ${ctx.fits === 1 ? "fits" : "fit"}: ${m.itemName}, size ${m.size}${cond}, ${formatCents(m.priceCents)}.`,
    });
    if (ctx.declined) {
      steps.push({ from: buyer, to: seller, type: "Decline", by: "mock", summary: declineSummary(ctx.declined) });
    } else {
      const pct = m.previousOwners === 1 || m.previousOwners === 2 ? Math.round(RESALE_PCT[m.previousOwners] * 100) : null;
      const rule = pct != null && m.originalPriceCents
        ? ` (${pct}% of ${formatCents(m.originalPriceCents)}, ${ORDINAL[m.previousOwners!]} owner)`
        : "";
      const wear = m.wearWeeksLeft != null ? `; fits about ${plural(m.wearWeeksLeft, "more week")}` : "";
      steps.push({
        from: buyer, to: seller, type: "ProposeTrade", by: "mock",
        summary: `Proposes the ${m.itemName} at ${formatCents(m.priceCents)}${rule}${wear}.`,
      });
      steps.push({
        from: seller, to: buyer, type: "TradeAck", by: "mock",
        summary: "Agrees. The trade goes to both parents to accept; nothing is charged until both say yes.",
      });
    }
  }
  return steps.map((s, i) => ({ ...s, ms: hopMs(ctx.encounterId, i) }));
}

// ---------------------------------------------------------------- reading an encounter (shared rows only)

const iso = (ms: number) => new Date(ms).toISOString();
const startMs = (enc: Encounter) => Date.parse(enc.startedAt) || Date.now();
const mockEntriesOf = (enc: Encounter | null): AgentLogEntry[] =>
  (Array.isArray(enc?.agentLog) ? enc!.agentLog! : []).filter((e) => e?.by === "mock");

async function getEncounter(db: FakeDb, id: string): Promise<Encounter | null> {
  return ((await db.Encounter.get(id).catch(() => null)) as Encounter | null) ?? null;
}

/** The proposal this encounter ended in (its proposalId, else one made for it), or null. */
async function proposalOf(db: FakeDb, enc: Encounter): Promise<MatchProposal | null> {
  const pid = (enc as Encounter & { proposalId?: string }).proposalId;
  if (pid) {
    const p = (await db.MatchProposal.get(pid).catch(() => null)) as MatchProposal | null;
    if (p) return p;
  }
  const [p] = ((await db.MatchProposal.filter({ encounterId: enc.id }, undefined, 1).catch(() => [])) ?? []) as MatchProposal[];
  return p ?? null;
}

/** What the pets talked about: the log context, plus the listing they found when no proposal came of it. */
interface Talk {
  ctx: MockLogContext;
  /** B's match the pets talked about (no proposal yet, or none was made), `blocked` when the buyer's rules stop it. */
  found?: LocalMatch & { blocked?: RulesBlock };
}

/** The buyer's shared needs and child's age: all the LookingFor carries. */
async function talkFor(db: FakeDb, enc: Encounter, buyerId: string, sellerId: string): Promise<MockLogContext> {
  const [needs, children, now] = await Promise.all([
    db.Need.filter({ parentId: buyerId }).catch(() => []),
    db.Child.filter({ parentId: buyerId }).catch(() => []),
    getNow(db),
  ]);
  const child = children[0];
  return {
    encounterId: enc.id,
    buyerId,
    sellerId,
    needs: needs.filter((n) => n.shared).map((n) => ({ sizes: n.sizes, categories: n.categories })),
    childAgeMonths: child ? ageInMonths(child.birthDate, now) : null,
    fits: 0,
  };
}

const matchOf = (best: LocalMatch, item?: { originalPriceCents?: number; ownerCount?: number } | null) => ({
  itemName: best.itemName, size: best.size, priceCents: best.priceCents, condition: best.condition,
  wearWeeksLeft: best.wearWeeksLeft, originalPriceCents: item?.originalPriceCents, previousOwners: item?.ownerCount,
});

/**
 * Who bought (or would have) and what, for this encounter at any stage: its proposal; else the pets' staged
 * "propose" line; else B's matches both ways, picked as C's fallback picks them (location.ts planLocalMatch: aId
 * buys first; the best match the buyer's pet rules allow, else the best one they stop); else nothing fits and the
 * opener (smaller id, the agents' rule) speaks first.
 */
async function talkOf(db: FakeDb, enc: Encounter): Promise<Talk> {
  const prop = await proposalOf(db, enc);
  if (prop) {
    const ctx = await talkFor(db, enc, prop.buyerId, prop.sellerId);
    const matches = await bFindMatches(db, { buyerId: prop.buyerId, sellerId: prop.sellerId }).catch(() => []);
    const s = prop.snapshot;
    ctx.fits = Math.max(1, matches.length);
    ctx.match = {
      itemName: s.itemName, size: s.size, priceCents: s.priceCents, condition: s.condition, wearWeeksLeft: s.wearWeeksLeft,
      originalPriceCents: s.originalPriceCents, previousOwners: s.previousOwners,
    };
    return { ctx };
  }
  const turns = Array.isArray(enc.transcript) ? enc.transcript : [];
  const proposer = turns.find((t) => t?.kind === "propose")?.parentId;
  const pairs: [string, string][] = proposer === enc.bId ? [[enc.bId, enc.aId]]
    : proposer === enc.aId ? [[enc.aId, enc.bId]]
    : [[enc.aId, enc.bId], [enc.bId, enc.aId]];
  for (const [buyerId, sellerId] of pairs) {
    const ranked = ((await bFindMatches(db, { buyerId, sellerId }).catch(() => [])) ?? []).slice(0, 5);
    if (!ranked.length) continue;
    const checked = await withRules(db, buyerId, ranked).catch(() => ranked as (LocalMatch & { blocked?: RulesBlock })[]);
    const pick = checked.find((x) => !x.blocked) ?? checked[0];
    const ctx = await talkFor(db, enc, buyerId, sellerId);
    const item = await db.ClothingItem.get(pick.itemId).catch(() => null);
    ctx.fits = ranked.length;
    ctx.match = matchOf(pick, item);
    return { ctx, found: pick };
  }
  const opener = enc.aId < enc.bId ? enc.aId : enc.bId;
  return { ctx: await talkFor(db, enc, opener, opener === enc.aId ? enc.bId : enc.aId) };
}

/**
 * Why B's createProposal refused (or would refuse) this match: the buyer's pet rules, as C's withRules saw them
 * (B5's checkMandate over this month's paid + pending trades), else the listing itself. Read-only, name-free: the
 * buyer's actual limits never appear. The pets' own lines are C's (location.ts markBlocked).
 */
async function declineFor(db: FakeDb, found: LocalMatch & { blocked?: RulesBlock }): Promise<MockDecline> {
  const rule = found.blocked?.rule;
  if (rule && RULE_PHRASE[rule]) return { rule, phrase: RULE_PHRASE[rule] };
  const live = ((await db.MatchProposal.filter({ listingId: found.listingId }).catch(() => [])) as MatchProposal[])
    .some((p) => p.status === "open" || p.status === "both_accepted");
  if (live) return { rule: null, phrase: "another trade is already open on it" };
  const listing = await db.Listing.get(found.listingId).catch(() => null);
  if (!listing || listing.status !== "active") return { rule: null, phrase: "it isn't up for trade anymore" };
  return { rule: null, phrase: "the relay's trade rules said no" };
}

/**
 * The fakeDb as C's handlers see it here. The mock speaks for every agent, so the local fallback's template log
 * (by "fallback", written with the proposal / the no-fit) never lands on a mock encounter: the mock writes its own
 * (by "mock") instead, and a console watching never flickers between the two. Everything else passes through.
 */
function asMockAgents(db: FakeDb): FakeDb {
  const strip = (patch: Record<string, unknown>) => {
    const log = patch?.agentLog;
    if (!Array.isArray(log) || !log.every((e: AgentLogEntry) => e?.by === "fallback")) return patch;
    const { agentLog: _fallbackLog, ...rest } = patch;
    return rest;
  };
  const bind = <T extends object>(t: T, k: string | symbol) => {
    const v = Reflect.get(t, k);
    return typeof v === "function" ? v.bind(t) : v;
  };
  const Encounter = new Proxy(db.Encounter, {
    get: (t, k) => (k === "update" ? (id: string, patch: Record<string, unknown>) => t.update(id, strip(patch)) : bind(t, k)),
  });
  return new Proxy(db, { get: (t, k) => (k === "Encounter" ? Encounter : bind(t, k)) });
}

/** What TRIGGER ENCOUNTER (instantEncounter) ended in. */
export interface InstantEncounter {
  encounter: Encounter | null;
  proposal: MatchProposal | null;
  declined: MockDecline | null;
  /** One plain sentence for the demo panel. */
  message: string;
}

type Timer = ReturnType<typeof setTimeout>;

export function createMockWorld(db: FakeDb) {
  const cdb = asMockAgents(db); // what C's location handlers get
  const timers = new Map<string, Timer>();
  /** Messages still to go up, one by one, per encounter. */
  const queues = new Map<string, { steps: LogStep[]; timer?: Timer }>();
  /** One log writer at a time per encounter (the playback and the result never interleave). */
  const locks = new Map<string, Promise<unknown>>();
  /** instantEncounter callers waiting for an encounter to be decided. */
  const waiting = new Map<string, (() => void)[]>();
  /** How each encounter this tab decided ended, when the buyer's agent declined. */
  const declines = new Map<string, MockDecline>();

  function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
    const tail = run.then(() => {}, () => {});
    locks.set(id, tail);
    void tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
    return run;
  }

  function whenDecided(id: string): Promise<void> {
    return new Promise((resolve) => waiting.set(id, [...(waiting.get(id) ?? []), resolve]));
  }

  function decided(id: string): void {
    waiting.get(id)?.forEach((r) => r());
    waiting.delete(id);
  }

  async function writeLog(encounterId: string, entries: AgentLogEntry[]): Promise<void> {
    await db.Encounter.update(encounterId, { agentLog: entries, negotiatedBy: "local" }).catch(() => {});
  }

  function stopQueue(id: string): void {
    const q = queues.get(id);
    if (q?.timer) clearTimeout(q.timer);
    queues.delete(id);
  }

  /** Next queued message after its hop: appended to what the row holds, stamped with the real time. */
  function pump(id: string): void {
    const q = queues.get(id);
    if (!q || q.timer) return;
    if (!q.steps.length) {
      queues.delete(id);
      return;
    }
    q.timer = setTimeout(() => {
      q.timer = undefined;
      locked(id, async () => {
        const next = q.steps.shift();
        if (!next) return;
        const cur = await getEncounter(db, id);
        if (cur) await writeLog(id, [...mockEntriesOf(cur), { ...next, at: new Date().toISOString() }]);
      })
        .catch((e) => console.error("[mock] agent log", e))
        .finally(() => { if (queues.get(id) === q) pump(id); });
    }, q.steps[0].ms);
  }

  /**
   * Bring an encounter's log up to `steps`: what is written (or queued) already stays when it starts the same way,
   * the rest is played one by one ("play") or written at once ("now", stamped to end about now). A different story
   * (say the other parent ended up buying) replaces it.
   */
  function complete(id: string, steps: LogStep[], how: "play" | "now"): Promise<void> {
    return locked(id, async () => {
      const enc = await getEncounter(db, id);
      if (!enc) return;
      const written = mockEntriesOf(enc);
      const planned: Pick<AgentLogEntry, "type" | "from">[] = [...written, ...(queues.get(id)?.steps ?? [])];
      let k = 0;
      while (k < planned.length && k < steps.length && planned[k].type === steps[k].type && planned[k].from === steps[k].from) k++;
      const fresh = k < planned.length;
      if (fresh || how === "now") stopQueue(id);
      const keep = fresh ? [] : written;
      const rest = steps.slice(fresh ? 0 : how === "now" ? written.length : planned.length);
      if (!rest.length) return;
      if (how === "play" && !fresh) {
        const q = queues.get(id) ?? { steps: [] };
        queues.set(id, q);
        q.steps.push(...rest);
        pump(id);
        return;
      }
      const lastAt = keep.length ? Date.parse(keep[keep.length - 1].at) || 0 : startMs(enc);
      let at = Math.max(lastAt, Date.now() - rest.reduce((n, s) => n + s.ms, 0));
      await writeLog(id, [...keep, ...rest.map((s) => ({ ...s, at: iso((at += s.ms)) }))]);
    });
  }

  /**
   * After B's createProposal answered (or nothing fit): the closing messages, and for a declined match the buyer's
   * pet saying why. Safe to call again (another tick, another tab): nothing is written twice.
   */
  async function afterResult(id: string): Promise<void> {
    const enc = await getEncounter(db, id);
    if (!enc || enc.status === "talking") return;
    const t = await talkOf(db, enc);
    let ctx = t.ctx;
    if (enc.status === "no_match" && t.found) {
      // The agents found something but no trade came of it: the buyer's agent declines, saying why.
      const d = await declineFor(db, t.found);
      declines.set(id, d);
      ctx = { ...ctx, declined: d };
    }
    await complete(id, mockAgentLog(ctx), "now");
  }

  async function finish(encounterId: string): Promise<void> {
    timers.delete(encounterId);
    try {
      const enc = await getEncounter(db, encounterId);
      if (enc?.status === "talking") await resolveEncounter(cdb, enc, findMatches);
      await afterResult(encounterId); // a tick or another tab may have decided it first: still idempotent
    } finally {
      decided(encounterId);
    }
  }

  /** The mock's stand-in for the two Fetch agents: see the header. */
  async function converse(encounterId: string, talk = !mockWorldTiming.instant): Promise<void> {
    try {
      const enc = await getEncounter(db, encounterId);
      if (!enc) return decided(encounterId);
      if (enc.status !== "talking" || !talk) {
        // Already decided on this tick (tests: the zero-wait fallback), or decide it now.
        if (enc.status === "talking") await resolveEncounter(cdb, enc, findMatches);
        await afterResult(encounterId);
        return decided(encounterId);
      }
      const step = await stageEncounter(cdb, enc, findMatches);
      const staged = await getEncounter(db, encounterId);
      if (!staged || step.status !== "staged") {
        // Decided at once: nothing fits (LookingFor → NoFit), or the buyer's pet rules stop the match (C's
        // stageEncounter: the buyer's pet says which rule, never "Trade proposal!") → LookingFor → HaveListings → Decline.
        await afterResult(encounterId);
        return decided(encounterId);
      }
      const t = await talkOf(db, staged);
      await complete(encounterId, mockAgentLog(t.ctx).slice(0, OPENING), "play");
      timers.set(encounterId, setTimeout(() => {
        finish(encounterId).catch((e) => console.error("[mock] encounter", e));
      }, talkMs(step.transcript)));
    } catch (e) {
      decided(encounterId);
      throw e;
    }
  }

  async function afterTick<T extends { encounters: { id: string }[]; fallback?: string[] }>(res: T): Promise<T> {
    for (const { id } of res.encounters) await converse(id);
    // The safety net (or the zero-wait fallback) decided these on this tick: their closing messages go up at once.
    for (const id of res.fallback ?? []) await afterResult(id);
    return res;
  }

  // Reads are free here, so every tick reads everything (`recheck`); the live 8 s/25 s agent wait doesn't apply.
  const deps = (): LocationDeps => ({
    findMatches,
    recheck: true,
    fallbackAfterMs: mockWorldTiming.instant ? 0 : mockWorldTiming.fallbackAfterMs,
    talkMs: mockWorldTiming.instant ? () => 0 : talkMs,
  });

  return {
    async updatePresence(req: UpdatePresenceReq): Promise<UpdatePresenceRes> {
      return afterTick(await cUpdatePresence(cdb, req, deps()));
    },
    async listNearby(req: ListNearbyReq): Promise<ListNearbyRes> {
      return (await cListNearby(cdb, req)) as ListNearbyRes;
    },
    async demoWalk(req: DemoWalkReq): Promise<DemoWalkRes> {
      return afterTick(await cDemoWalk(cdb, req, deps()));
    },
    /**
     * TRIGGER ENCOUNTER: `buyerId`'s pet meets `sellerId`'s right now, without the walk. Same conversation as a walk
     * (an Encounter, the pets' lines, the mock agents' protocol log, C's fallback → B's createProposal), so the
     * Agent Console, the bubbles and the trade's "how our pets found this" fill in. `talk` (default: unless
     * mockWorldTiming.instant) lets the pets say their lines first; resolves once the encounter is decided.
     */
    async instantEncounter(buyerId: string, sellerId: string, opts: { talk?: boolean } = {}): Promise<InstantEncounter> {
      if (!buyerId || !sellerId) throw bad("buyerId, sellerId required");
      if (buyerId === sellerId) throw bad("a pet can't meet itself");
      const [buyer, seller] = await Promise.all([
        db.Parent.get(buyerId).catch(() => null),
        db.Parent.get(sellerId).catch(() => null),
      ]);
      if (!buyer || !seller) throw notFound("parent");
      const enc = (await db.Encounter.create({
        aId: buyerId, bId: sellerId, band: "<25m", simulated: true, status: "talking", startedAt: iso(Date.now()), transcript: [],
      })) as Encounter;
      const done = whenDecided(enc.id);
      await converse(enc.id, opts.talk ?? !mockWorldTiming.instant);
      await done;
      const fin = await getEncounter(db, enc.id);
      const proposal = fin ? await proposalOf(db, fin) : null;
      const declined = proposal ? null : declines.get(enc.id) ?? null;
      const first = (name: string) => name.split(/\s+/)[0] || name;
      const message = fin?.status === "talking" // RESET stopped the conversation (cancelAll)
        ? "The conversation stopped before the pets finished."
        : proposal
        ?`${first(buyer.name)}'s and ${first(seller.name)}'s pets agreed on the ${proposal.snapshot.itemName}. Both parents decide.`
        : declined?.rule
          ? `Stopped by ${first(buyer.name)}'s pet rules: ${declined.phrase}. ${NOTHING_CHARGED}`
          : declined
            ? `No trade: ${declined.phrase}. ${NOTHING_CHARGED}`
            : "The pets met, but nothing on either shared list fits.";
      return { encounter: fin, proposal, declined, message };
    },
    /** Pending conversation timers (tests / RESET). */
    cancelAll(): void {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      [...queues.keys()].forEach(stopQueue);
      [...waiting.keys()].forEach(decided);
    },
  };
}

export type MockWorld = ReturnType<typeof createMockWorld>;
