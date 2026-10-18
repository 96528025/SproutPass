// (C) location.ts — presence, radar, demo walk and encounters as PURE handlers.
//
// No Deno globals, no npm:/base44: imports, so the same code runs in three places:
//   - the Deno functions updatePresence / listNearby / demoWalk (thin wrappers: auth + a throttled inbox sweep),
//   - B's mock (src/app/mockWorld.ts) on the in-browser fakeDb, so /world?demo=1 works offline,
//   - vitest (src/app/mockWorld.test.ts).
//
// Rule 3: nothing returned here carries another parent's coordinates, phone or exact distance. The one
// exception is `distanceM` in listNearby when BOTH presences are simulated (a demo walk on a fake lawn),
// rounded to 5 m. Real GPS stays band + 5°-bearing only.
//
// Clock note: presence freshness, cooldown and the fallback wait use the REAL wall clock, because
// Setting.now is a frozen story date (May → Oct) and would make every presence look stale.
//
// Cost note (Base44's rate limit is shared by the whole team): a tick reads Presence once (Presence.list), the
// caller's Parent once, and the pair bookkeeping (PairState, or recent Encounters when PairState isn't pushed)
// only while somebody is within 40 m, on the walk's reset, or about once per 10 s (recheckDue). The talking-
// encounter query runs only around a recent meeting or on such a recheck. `recheck: true` (B's mock, where
// reads are free) reads everything on every tick.

// deno-lint-ignore-file no-explicit-any
import {
  band,
  bearingDeg,
  COOLDOWN_DEMO_MS,
  COOLDOWN_MS,
  DEMO_ACCURACY_M,
  DEMO_START_M,
  demoHome,
  destination,
  haversineM,
  isFresh,
  type LatLng,
  pairKey,
  type PresenceLike,
  REARM_M,
  roundBearing,
  roundDemoDistance,
  stepToward,
  withinEncounter,
} from "./geo.ts";
import { tl } from "./wording.ts";
import { callB, findMatches as bFindMatches } from "../cbridge.ts";
import { getNow } from "../db.ts";
import { bad, notFound } from "../errors.ts";
import { checkMandate, type MandateRule, mandateOf, monthTotals } from "../logic/trust.ts";
import type { AgentLogEntry, Category } from "../types.ts";

/** No Fetch agents on duty: the local fallback starts the pets' talk 8 s after the meeting. */
export const FALLBACK_AFTER_MS = 8_000;
/** Fetch agents on duty (their Bureau polls claimInbox every 12 s and needs ~6 calls): give them 25 s. */
export const AGENT_FALLBACK_AFTER_MS = 25_000;
/** …and never more than this, even while their lines keep arriving. */
export const AGENT_FALLBACK_MAX_MS = 60_000;
/** The agents count as on duty when agentApi saw them (claimInbox / now / registerAgent) within 45 s. */
export const AGENT_HEARTBEAT_TTL_MS = 45_000;
/** Setting row the agentApi stamps: { key: "agents", now: <last poll> } (existing Setting fields, no schema change). */
export const AGENTS_KEY = "agents";
/** Far-apart pairs (re-arm) and stuck encounters are re-checked about once per 10 s (see recheckDue). */
export const RECHECK_EVERY_MS = 10_000;
/** Around a meeting this recent, every tick checks the talking encounters. */
const RECENT_MEETING_MS = 3 * 60_000;
/** A walk target's simulated presence is re-stamped when older than this (presence TTL is 30 s). */
const TARGET_REFRESH_MS = 10_000;
/** A live real-GPS parent can't move faster than this (+ both accuracies + 50 m slack): see updatePresence. */
export const MAX_SPEED_MPS = 30;
/** Without PairState the pair bookkeeping comes from the latest encounters. */
const RECENT_ENCOUNTERS = 50;
/** Safety valve: a pair nobody saw walk apart (both tabs closed) is armed again an hour after its last meeting. */
const DISARM_MAX_MS = 60 * 60_000;

// ---------------------------------------------------------------- B's findMatches contract (NEEDS.md)

export interface LocalMatch {
  listingId: string;
  itemName: string;
  size: string;
  priceCents: number;
  /** The item's category (cbridge sends it): the buyer's "kinds of clothes" rule needs it. */
  category?: string;
  wearWeeksLeft?: number;
  reason?: string;
}

export type FindMatches = (db: any, q: { buyerId: string; sellerId: string }) => Promise<LocalMatch[]>;

export interface LocationDeps {
  /** B's ranking (default: cbridge's findMatches over the same db). */
  findMatches?: FindMatches;
  /** Fixed wait before the local fallback starts (overrides the 8 s / 25 s rule; 0 when Setting.matchVia = "local"). */
  fallbackAfterMs?: number;
  /** How long the pets' staged lines take to "say" before the proposal lands (default talkMs). 0 = same tick. */
  talkMs?: (transcript: { text?: string }[]) => number;
  /** Read everything on every tick (B's mock: reads are free there). */
  recheck?: boolean;
  /** Real-clock "now" in ms (tests). */
  nowMs?: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: unknown) => (typeof s === "string" ? Date.parse(s) || 0 : 0);

let lastRecheckAt = 0;

/**
 * "Look at everything" about once per RECHECK_EVERY_MS: by the clock on a warm isolate, else on about one tick in
 * three (random, so a fixed-period heartbeat can't phase-lock out of it). Call once per tick.
 */
export function recheckDue(nowMs: number): boolean {
  const due = lastRecheckAt ? nowMs - lastRecheckAt >= RECHECK_EVERY_MS || nowMs < lastRecheckAt : Math.random() < 1 / 3;
  if (due) lastRecheckAt = nowMs;
  return due;
}

// ---------------------------------------------------------------- talk timing (shared with B's mock)

export const TALK_TIMING = {
  /** Pets hop out ~2.2 s after the EncounterScene mounts (A5's timeline). */
  introMs: 2400,
  /** AgentBubbles types at 40 chars/s; a little air between bubbles. */
  msPerChar: 25,
  msPerLine: 250,
};

/** How long the pets need to "say" these lines before the proposal lands (3–12 s). */
export function talkMs(transcript: { text?: string }[], t: typeof TALK_TIMING = TALK_TIMING): number {
  const chars = transcript.reduce((n, turn) => n + (turn.text?.length ?? 0), 0);
  return Math.min(12_000, Math.max(3_000, t.introMs + chars * t.msPerChar + transcript.length * t.msPerLine));
}

// ---------------------------------------------------------------- settings + the agents' heartbeat

export interface LocSettings {
  matchVia?: string;
  /** Last time agentApi saw the Fetch agents (ms, 0 = never). */
  agentsSeenAt: number;
}

/** One read for both rows: Setting "demo" (matchVia) and Setting "agents" (heartbeat). */
export async function readSettings(db: any): Promise<LocSettings> {
  try {
    const rows: any[] = (await db.Setting.list(undefined, 20)) ?? [];
    return {
      matchVia: rows.find((r) => r?.key === "demo")?.matchVia,
      agentsSeenAt: ms(rows.find((r) => r?.key === AGENTS_KEY)?.now),
    };
  } catch {
    return { agentsSeenAt: 0 };
  }
}

export const agentsOnDuty = (s: LocSettings, nowMs: number) => s.agentsSeenAt > 0 && nowMs - s.agentsSeenAt <= AGENT_HEARTBEAT_TTL_MS;

/** agentApi calls this when the agents poll (it throttles itself). */
export async function stampAgents(db: any, nowMs: number = Date.now()): Promise<void> {
  const [row] = (await db.Setting.filter({ key: AGENTS_KEY }, undefined, 1)) ?? [];
  if (row) await db.Setting.update(row.id, { now: iso(nowMs) });
  else await db.Setting.create({ key: AGENTS_KEY, now: iso(nowMs) });
}

// ---------------------------------------------------------------- pair bookkeeping (PairState, or recent Encounters)

interface PairView {
  armed: boolean;
  /** Last meeting (ms, 0 = unknown). */
  lastAt: number;
}

interface Pairs {
  mode: "pairstate" | "encounters";
  view(a: string, b: string): PairView & { known: boolean };
  rearm(a: string, b: string, d: number): Promise<void>;
  disarm(a: string, b: string, d: number): Promise<void>;
  /** encounters mode: the recent rows (newest first), so the fallback needs no second read. */
  encounters?: any[];
}

let pairStateMissing = false; // fakeDb, or PairState not pushed on this app: don't ask every tick

/**
 * PairState — one row per unordered pair: { pairKey, armed, lastEncounterAt?, lastDistanceM? }, read with ONE list.
 * Without the entity (B's fakeDb, or not pushed yet) the same rule comes from the Encounter rows: a pair is
 * disarmed by its latest encounter until a tick sees them > 40 m apart and stamps that encounter's `rearmedAt`.
 * Either way a pair meets once, then not again until they have walked apart (no 2-minute re-fire while parked).
 */
async function loadPairs(db: any, nowMs: number): Promise<Pairs> {
  if (!pairStateMissing) {
    try {
      const rows: any[] = (await db.PairState.list(undefined, 500)) ?? [];
      return pairStatePairs(db, rows, nowMs);
    } catch (e) {
      // Base44 answers 404 for an entity that isn't pushed: stop asking on this isolate. (fakeDb has no table at
      // all — a TypeError, free to retry — so a test that adds one later still gets it.)
      const m = String((e as Error)?.message ?? e);
      if (!(e instanceof TypeError) && /not.?found|404|does not exist|unknown entity/i.test(m)) pairStateMissing = true;
    }
  }
  const encounters: any[] = (await db.Encounter.list("-startedAt", RECENT_ENCOUNTERS)) ?? [];
  return encounterPairs(db, encounters, nowMs);
}

function pairStatePairs(db: any, rows: any[], nowMs: number): Pairs {
  const byKey = new Map<string, any>(rows.map((r) => [r.pairKey, r]));
  const save = async (key: string, patch: any) => {
    const row = byKey.get(key);
    try {
      byKey.set(key, row?.id ? await db.PairState.update(row.id, patch) : await db.PairState.create({ pairKey: key, armed: true, ...patch }));
    } catch {
      /* best effort: the cooldown still holds */
    }
  };
  return {
    mode: "pairstate",
    view(a, b) {
      const row = byKey.get(pairKey(a, b));
      const lastAt = ms(row?.lastEncounterAt);
      return { armed: !row || row.armed !== false || (lastAt > 0 && nowMs - lastAt > DISARM_MAX_MS), lastAt, known: !!row };
    },
    rearm: (a, b, d) => save(pairKey(a, b), { armed: true, lastDistanceM: d }),
    disarm: (a, b, d) => save(pairKey(a, b), { armed: false, lastEncounterAt: iso(nowMs), lastDistanceM: d }),
  };
}

function encounterPairs(db: any, encounters: any[], nowMs: number): Pairs {
  const latest = (a: string, b: string) => encounters.find((e) => (e.aId === a && e.bId === b) || (e.aId === b && e.bId === a));
  return {
    mode: "encounters",
    encounters,
    view(a, b) {
      const e = latest(a, b);
      const lastAt = ms(e?.startedAt);
      return { armed: !e || !!e.rearmedAt || nowMs - lastAt > DISARM_MAX_MS, lastAt, known: true };
    },
    async rearm(a, b) {
      const e = latest(a, b);
      if (!e || e.rearmedAt) return;
      e.rearmedAt = iso(nowMs);
      await db.Encounter.update(e.id, { rearmedAt: e.rearmedAt }).catch(() => {});
    },
    async disarm() {
      /* the new encounter IS the disarm */
    },
  };
}

/** Latest Encounter.startedAt for the pair, in ms (0 = never met). */
export async function lastEncounterAt(db: any, a: string, b: string): Promise<number> {
  const rows = await db.Encounter.filter({ aId: a, bId: b }, "-startedAt", 1);
  const rows2 = await db.Encounter.filter({ aId: b, bId: a }, "-startedAt", 1);
  const t = [rows?.[0], rows2?.[0]].filter(Boolean).map((e: any) => ms(e.startedAt)).filter(Boolean);
  return t.length ? Math.max(...t) : 0;
}

/**
 * Two ticks can pass the checks at once (Base44 has no compare-and-set): after creating, look at the pair's
 * encounters from the last cooldown and keep only the FIRST created (Base44's created_date, else startedAt, else
 * id). The loser deletes its row before any inbox row is written. Returns true when `mine` lost.
 */
async function lostRace(db: any, mine: any, a: string, b: string, cooldown: number, nowMs: number): Promise<boolean> {
  const rows = [
    ...((await db.Encounter.filter({ aId: a, bId: b }, "-startedAt", 3)) ?? []),
    ...((await db.Encounter.filter({ aId: b, bId: a }, "-startedAt", 3)) ?? []),
  ].filter((e: any) => e?.id && nowMs - ms(e.startedAt) < cooldown);
  if (rows.length < 2) return false;
  const key = (e: any) => [ms(e.created_date) || ms(e.startedAt), String(e.id)] as const;
  const first = rows.reduce((x: any, y: any) => {
    const [tx, ix] = key(x), [ty, iy] = key(y);
    return ty < tx || (ty === tx && iy < ix) ? y : x;
  });
  if (first.id === mine.id) return false;
  await db.Encounter.delete(mine.id).catch(() => {});
  return true;
}

// ---------------------------------------------------------------- encounter detection

export interface EncounterResult {
  created: { id: string; peerId: string }[];
  /** True when the pair bookkeeping was read on this tick (the fallback then looks at talking encounters). */
  checked?: boolean;
  /** A meeting of the caller's started within the last 3 min (or was just created). */
  recent?: boolean;
  /** encounters mode: the recent Encounter rows, reused by the fallback. */
  encounters?: any[];
}

export type ParentLookup = (id: string) => Promise<any | null>;

function asLookup(parents: Map<string, any> | ParentLookup, db: any): ParentLookup {
  if (typeof parents === "function") return parents;
  return async (id) => parents.get(id) ?? (await db.Parent.get(id).catch(() => null));
}

export interface DetectOpts {
  /** The other presences (else one Presence.list). */
  presences?: PresenceLike[];
  /** The caller is the demo walker (demoWalk): it alone starts encounters where both sides are simulated. */
  mover?: boolean;
  /** Read the pair bookkeeping even when nobody is within 40 m (recheckDue, the walk's reset, B's mock). */
  recheck?: boolean;
}

/**
 * Run the encounter check for `me` against every other fresh, discoverable presence (rule 4: ≤ 25 m, both
 * accuracies ≤ 30 m unless both are simulated; once per pair per cooldown; re-armed after > 40 m).
 * Two simulated parents only move through demoWalk, so only the walker's tick STARTS an encounter for that pair:
 * the target's own heartbeat never races the walker into a second one (it still keeps the re-arm bookkeeping and
 * keeps the fallback ticking). Returns the encounters created on this call.
 */
export async function detectEncounters(
  db: any,
  me: PresenceLike,
  parents: Map<string, any> | ParentLookup,
  nowMs: number = Date.now(),
  opts: DetectOpts = {},
): Promise<EncounterResult> {
  // Demo mode (rule 5) == the caller is on a simulated position → 2 min cooldown.
  const cooldown = me.simulated ? COOLDOWN_DEMO_MS : COOLDOWN_MS;
  const result: EncounterResult = { created: [] };
  const parentOf = asLookup(parents, db);

  const meParent = await parentOf(me.parentId);
  if (!meParent?.discoverable) return result;

  const others: PresenceLike[] = opts.presences ?? (await db.Presence.list());
  const cands: { other: PresenceLike; d: number; judge: boolean }[] = [];
  for (const other of others) {
    if (other.parentId === me.parentId || !isFresh(other, nowMs)) continue;
    cands.push({ other, d: haversineM(me, other), judge: !(me.simulated && other.simulated) || !!opts.mover });
  }
  if (!cands.length) return result;
  // Far apart: nothing can start; the re-arm bookkeeping waits for a recheck tick.
  if (!opts.recheck && !cands.some((c) => c.d <= REARM_M)) return result;

  const pairs = await loadPairs(db, nowMs);
  result.checked = true;
  result.encounters = pairs.encounters;

  for (const { other, d, judge } of cands) {
    let state = pairs.view(me.parentId, other.parentId);
    if (state.lastAt && nowMs - state.lastAt < RECENT_MEETING_MS) result.recent = true;

    // Re-arm bookkeeping: once a pair has separated beyond 40 m they can meet again.
    if (!state.armed) {
      if (d > REARM_M) await pairs.rearm(me.parentId, other.parentId, d);
      continue; // still inside (or just left) the old encounter
    }
    if (!judge || !withinEncounter(me, other)) continue;

    const peer = await parentOf(other.parentId);
    if (!peer?.discoverable) continue;

    // PairState without a row for this pair yet (first meeting since the entity was added): the encounters say.
    if (!state.known || (pairs.mode === "pairstate" && !state.lastAt)) {
      state = { ...state, lastAt: Math.max(state.lastAt, await lastEncounterAt(db, me.parentId, other.parentId)) };
    }
    if (state.lastAt && nowMs - state.lastAt < cooldown) continue;

    const simulated = me.simulated || other.simulated;
    const enc = await db.Encounter.create({
      aId: me.parentId,
      bId: other.parentId,
      band: "<25m",
      simulated,
      status: "talking",
      startedAt: iso(nowMs),
      transcript: [],
    });
    if (await lostRace(db, enc, me.parentId, other.parentId, cooldown, nowMs)) continue;

    // One inbox row per parent → each agent learns who it met (address only,
    // never coordinates, names or phones — rule 3).
    for (const [self, peerP] of [[meParent, peer], [peer, meParent]] as const) {
      await db.AgentInbox.create({
        parentId: self.id,
        type: "encounter",
        payload: {
          encounterId: enc.id,
          peer: { parentId: peerP.id, agentAddress: peerP.agentAddress ?? null },
          // role lets the two agents agree who speaks first without a handshake:
          // the lexically smaller parentId opens as the buyer side.
          role: self.id < peerP.id ? "buyer" : "seller",
        },
        status: "pending",
        createdAt: iso(nowMs),
      });
    }

    await pairs.disarm(me.parentId, other.parentId, d);
    pairs.encounters?.unshift(enc);
    result.created.push({ id: enc.id, peerId: other.parentId });
    result.recent = true;
  }
  return result;
}

// ---------------------------------------------------------------- the negotiation log (Encounter.agentLog)
//
// Every encounter says who negotiated it (negotiatedBy) and what was said, as AgentLogEntry rows (types.ts):
//   - the Fetch.ai agents send their whole RelayProtocol log with the createProposal / noMatch call that ends the talk
//     (agentApi → encounter.ts proposeFromAgents / noMatchFromAgents): by "fetch", from/to = their agent1q… addresses;
//   - C's local fallback (below) writes the same shape for its template talk: by "fallback", from/to "fallback".
// The Encounter row is readable by every signed-in parent, so a summary never carries private data: the agents build
// it from shared listings / needs only, and cleanAgentLog still blanks anything shaped like a phone number or email.

export const AGENT_LOG_MAX = 40;
const PHONE_RX = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.]+/g;

/** Who negotiated an encounter, as written next to its status. */
export interface AgentRun {
  negotiatedBy: "fetch" | "local";
  agentLog?: AgentLogEntry[];
  /** The pets' bubbles (agents' noMatch): replaces the transcript when non-empty. */
  transcript?: any[];
}

const plainText = (s: unknown, max: number) =>
  String(s ?? "").replace(/\s+/g, " ").trim().replace(EMAIL_RX, "[hidden]").replace(PHONE_RX, "[hidden]").slice(0, max);
const addressLike = (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 80) || "unknown";

/**
 * Untrusted log in (an agent's request body) → at most AGENT_LOG_MAX clean entries (the last ones). `by` is forced:
 * only the agents call agentApi, so everything that arrives there is "fetch".
 */
export function cleanAgentLog(raw: unknown, by: AgentLogEntry["by"], nowMs: number = Date.now()): AgentLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentLogEntry[] = [];
  for (const e of raw.slice(-AGENT_LOG_MAX)) {
    if (!e || typeof e !== "object") continue;
    const type = String((e as any).type ?? "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
    if (!type) continue;
    const at = Date.parse(String((e as any).at ?? ""));
    const latency = Number((e as any).ms);
    out.push({
      at: iso(Number.isFinite(at) ? at : nowMs),
      from: addressLike((e as any).from),
      to: addressLike((e as any).to),
      type,
      summary: plainText((e as any).summary, 200),
      ...((e as any).ms != null && Number.isFinite(latency) && latency >= 0 ? { ms: Math.min(Math.round(latency), 3_600_000) } : {}),
      by,
    });
  }
  return out;
}

const TURN_FROM = new Set(["buyer_agent", "seller_agent"]);
const TURN_KINDS = new Set(["looking_for", "have", "no_fit", "fit_check", "propose", "ack", "decline"]);

/** Untrusted AgentTurn[] in → the turns that fit the Encounter.transcript schema (as appendTurn writes them). */
export function cleanTurns(raw: unknown, nowMs: number = Date.now()): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object" && TURN_FROM.has(t.from) && TURN_KINDS.has(t.kind) && String(t.text ?? "").trim())
    .slice(-AGENT_LOG_MAX)
    .map((t) => ({
      from: t.from,
      parentId: String(t.parentId ?? ""),
      kind: t.kind,
      text: String(t.text).slice(0, 200),
      at: Number.isFinite(Date.parse(String(t.at ?? ""))) ? String(t.at) : iso(nowMs),
    }));
}

/** An AgentRun as Encounter fields (agentLog only when there is one). */
export function runFields(run?: AgentRun | null): Record<string, unknown> {
  if (!run) return {};
  return { negotiatedBy: run.negotiatedBy, ...(run.agentLog?.length ? { agentLog: run.agentLog } : {}) };
}

const money = (cents: number) => `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;

// ---------------------------------------------------------------- the buyer's pet rules (B5's mandate, trust.ts)
//
// B's createProposal refuses a trade the BUYER's pet rules don't allow (may propose at all, price limit, kinds of
// clothes, monthly budget). The pets check the same rules BEFORE anyone says "Trade proposal!", so a parent sees why
// nothing was proposed instead of a false "nothing fits": the buyer's pet says the rule (first person, no amounts),
// the protocol log gets a Decline entry (no names, no amounts) and the Encounter keeps trust.ts's sentence as
// noMatchReason. createProposal stays the judge: this only decides what the pets say.

/** A match the buyer's own pet rules stop. */
export interface RulesBlock {
  rule: MandateRule;
  /** trust.ts checkMandate's sentence, e.g. "It costs more than the price limit Jo set for Pip." (no amounts). */
  reason: string;
  /** What the buyer's pet says after "Not this one — " (first person, no amounts). */
  line: string;
}

const RULE_LINE: Record<MandateRule, (name: string) => string> = {
  agent_may_not_propose: (n) => `${n} asked me to point out matches, not propose trades.`,
  over_price: (n) => `it's over the price limit ${n} set for me.`,
  category: (n) => `it isn't a kind of clothes ${n} asked me to look for.`,
  over_budget: (n) => `it would go over ${n}'s monthly budget for me.`,
};

/** The same rules for the protocol log, which never names anyone (Encounter rows are readable by every parent). */
export const RULE_SUMMARY: Record<MandateRule, string> = {
  agent_may_not_propose: "the buyer asked their pet to point out matches only",
  over_price: "over the price limit the buyer set for their pet",
  category: "not a kind of clothes the buyer asked their pet to look for",
  over_budget: "over the budget the buyer set for their pet",
};

/** The buyer's pet's words for a rule ("it's over the price limit Jo set for me."). agents/closet_agent.py mirrors it. */
export function rulesLine(rule: MandateRule, parentName: string): string {
  return (RULE_LINE[rule] ?? RULE_LINE.over_price)(parentName || "my family");
}

/**
 * Each match (best first) with the buyer's verdict: `blocked` when their pet rules say no. One Parent read, plus this
 * month's totals (one MatchProposal read + the clock) only when a budget check is reached. Unknown buyer → unchanged.
 */
export async function withRules<M extends { priceCents: number; category?: string }>(
  db: any,
  buyerId: string,
  matches: M[],
): Promise<(M & { blocked?: RulesBlock })[]> {
  if (!matches?.length) return [];
  const buyer: any = await db.Parent.get(buyerId).catch(() => null);
  if (!buyer) return matches;
  const m = mandateOf(buyer);
  const who = { name: String(buyer.name ?? ""), petName: String(buyer.pet?.name ?? "") || "their pet" };
  let committed: number | null = null;
  const out: (M & { blocked?: RulesBlock })[] = [];
  for (const match of matches) {
    const offer = { priceCents: Number(match.priceCents) || 0, category: (match.category ?? "other") as Category };
    const rules = match.category ? m : { ...m, categories: [] }; // no category known: createProposal judges that one
    let check = checkMandate(rules, offer, 0, who);
    if (check.ok) {
      if (committed == null) {
        const t = await monthTotals(db, buyerId, await getNow(db)).catch(() => ({ spentCents: 0, pendingCents: 0 }));
        committed = t.spentCents + t.pendingCents;
      }
      check = checkMandate(rules, offer, committed, who);
    }
    out.push(check.ok ? match : { ...match, blocked: { rule: check.rule, reason: check.reason, line: rulesLine(check.rule, who.name) } });
  }
  return out;
}

/**
 * The local fallback's talk in the agents' log shape: the same four protocol steps the Fetch agents take
 * (LookingFor → HaveListings → ProposeTrade → TradeAck); LookingFor → HaveListings → Decline when the buyer's pet
 * rules stop the match; LookingFor → NoFit when nothing fits either way.
 * No latency (`ms`): nothing travelled, it is one template written at once.
 */
export function localAgentLog(match: LocalMatch | null, nowMs: number = Date.now(), blocked?: RulesBlock | null): AgentLogEntry[] {
  const at = iso(nowMs);
  const line = (type: string, summary: string): AgentLogEntry => ({ at, from: "fallback", to: "fallback", type, summary, by: "fallback" });
  if (!match) {
    return [
      line("LookingFor", "Local matcher checks both closets' shared listings and needs."),
      line("NoFit", "No fit: nothing shared fits either way today."),
    ];
  }
  const weeks = match.wearWeeksLeft != null ? ` Size ${match.size} fits for about ${match.wearWeeksLeft} more weeks.` : "";
  const opening = [
    line("LookingFor", `Buyer side asks for size ${match.size}.`),
    line("HaveListings", plainText(`Seller side offers a shared listing: ${match.itemName}, size ${match.size}, ${money(match.priceCents)}.`, 200)),
  ];
  if (blocked) {
    return [...opening, line("Decline", `Buyer side declines: ${RULE_SUMMARY[blocked.rule] ?? "the buyer's pet rules say no"}. Nothing was proposed.`)];
  }
  return [
    ...opening,
    line("ProposeTrade", `Buyer side proposes the listing at ${money(match.priceCents)}.${weeks}`),
    line("TradeAck", "Seller side agrees; both parents still decide in the app."),
  ];
}

/** A local-fallback run (negotiatedBy "local") for this match, for a match the buyer's rules stopped, or for "nothing fits". */
export const localRun = (match: LocalMatch | null, nowMs: number = Date.now(), blocked?: RulesBlock | null): AgentRun => ({
  negotiatedBy: "local",
  agentLog: localAgentLog(match, nowMs, blocked),
});

/**
 * Encounter.update with optional extras, most important first (e.g. proposalId, then the agent log). The live
 * schema may not know a newer field until `entities push`: a refused write is retried with fewer extras, and
 * finally with the patch alone, so the status change itself always lands.
 */
export async function updateEncounter(db: any, id: string, patch: Record<string, unknown>, ...extras: Record<string, unknown>[]) {
  const layers = extras.filter((x) => x && Object.keys(x).length);
  for (let n = layers.length; n > 0; n--) {
    try {
      return await db.Encounter.update(id, Object.assign({}, patch, ...layers.slice(0, n)));
    } catch {
      /* retry with one extra fewer */
    }
  }
  return await db.Encounter.update(id, patch);
}

// ---------------------------------------------------------------- local match (fallback "agents")

export interface LocalPlan {
  buyerId: string;
  sellerId: string;
  match: LocalMatch;
  transcript: any[];
  /** The buyer's pet rules stop this match: the pets say so (blockedTranscript) and nobody calls createProposal. */
  blocked?: RulesBlock;
}

type BlockedPlan = LocalPlan & { blocked: RulesBlock };

/**
 * Template transcript so the EncounterScene has bubbles even without LLM/agents. Same lines as the Python agents
 * (wording.ts `tl` = agents/wording.py t_*), without the "Pip: " prefix: AgentBubbles names the pet by parentId.
 * The buyer's pet says the fit line ("My little one…"): it is the buyer's child the fit was computed for.
 */
export function localTranscript(buyerId: string, sellerId: string, m: LocalMatch, nowMs: number): any[] {
  const at = (i: number) => iso(nowMs + i * 600);
  return [
    { from: "buyer_agent", parentId: buyerId, kind: "looking_for", text: tl.lookingFor([m.size]), at: at(0) },
    { from: "seller_agent", parentId: sellerId, kind: "have", text: tl.have(m.itemName, m.size), at: at(1) },
    ...(m.wearWeeksLeft != null
      ? [{ from: "buyer_agent", parentId: buyerId, kind: "fit_check", text: tl.fitCheck(m.wearWeeksLeft), at: at(2) }]
      : []),
    { from: "buyer_agent", parentId: buyerId, kind: "propose", text: tl.propose(m.priceCents), at: at(3) },
    { from: "seller_agent", parentId: sellerId, kind: "ack", text: tl.ack(), at: at(4) },
  ];
}

/** The buyer's pet turns the offer down because of its parent's rules: no "Trade proposal!", no "over to the humans". */
export function blockedTranscript(buyerId: string, sellerId: string, m: LocalMatch, block: RulesBlock, nowMs: number): any[] {
  const at = (i: number) => iso(nowMs + i * 600);
  return [
    { from: "buyer_agent", parentId: buyerId, kind: "looking_for", text: tl.lookingFor([m.size]), at: at(0) },
    { from: "seller_agent", parentId: sellerId, kind: "have", text: tl.have(m.itemName, m.size), at: at(1) },
    { from: "buyer_agent", parentId: buyerId, kind: "decline", text: tl.decline(block.line), at: at(2) },
  ];
}

/**
 * The best match each way, a→b (a buys) first, then b→a; each with the template lines the pets would say. The best
 * match the buyer's pet rules allow wins; when they allow none, the plan is the best match marked `blocked`.
 * `first`: stop at the first plan that can be proposed.
 */
export async function planLocalMatch(
  db: any,
  enc: any,
  findMatches: FindMatches,
  nowMs: number = Date.now(),
  opts: { first?: boolean } = {},
): Promise<LocalPlan[]> {
  const plans: LocalPlan[] = [];
  for (const [buyerId, sellerId] of [[enc.aId, enc.bId], [enc.bId, enc.aId]]) {
    const ranked = ((await findMatches(db, { buyerId, sellerId })) ?? []).slice(0, 5);
    if (!ranked.length) continue;
    const checked = await withRules(db, buyerId, ranked);
    const pick = checked.find((x) => !x.blocked) ?? checked[0];
    const { blocked, ...match } = pick;
    plans.push(blocked
      ? { buyerId, sellerId, match, blocked, transcript: blockedTranscript(buyerId, sellerId, match, blocked, nowMs) }
      : { buyerId, sellerId, match, transcript: localTranscript(buyerId, sellerId, match, nowMs) });
    if (opts.first && !blocked) break;
  }
  return plans;
}

/**
 * Encounter → "proposed", with Encounter.proposalId so A's EncounterScene can hand the right proposal to the
 * Trade window, and (when given) who negotiated it + their log. Newer optional fields (entities/Encounter.json):
 * if the live schema refuses them, the write is retried without them (updateEncounter).
 */
async function markProposed(db: any, encounterId: string, patch: Record<string, unknown>, proposalId: string | undefined, run?: AgentRun) {
  await updateEncounter(db, encounterId, patch, proposalId ? { proposalId } : {}, runFields(run));
}

/**
 * Nothing fits either way: the pets say so (the Python agents' no-fit exchange) and the encounter ends. `run`: who
 * decided it (default: the local fallback, with its LookingFor → NoFit log; null = don't say).
 */
async function markNoMatch(
  db: any,
  enc: any,
  nowMs: number,
  run: AgentRun | null = localRun(null, nowMs),
  extra: Record<string, unknown> = {},
): Promise<"no_match"> {
  const said: any[] = (Array.isArray(enc.transcript) ? enc.transcript : []).filter((t: any) => t?.kind !== "propose" && t?.kind !== "ack");
  const opener = enc.aId < enc.bId ? enc.aId : enc.bId; // same rule as the agents: the smaller id opens
  const other = opener === enc.aId ? enc.bId : enc.aId;
  const transcript = [
    ...(said.length ? said : [{ from: "buyer_agent", parentId: opener, kind: "looking_for", text: tl.hello(), at: iso(nowMs) }]),
    { from: "seller_agent", parentId: other, kind: "no_fit", text: tl.noFit(), at: iso(nowMs + 600) },
  ];
  await updateEncounter(db, enc.id, { status: "no_match", transcript }, runFields(run), extra);
  return "no_match";
}

/**
 * The buyer's pet rules stopped the match: the encounter ends "no_match" with the pets saying why (any staged
 * "Trade proposal!" / "over to the humans" lines are dropped), the fallback's LookingFor → HaveListings → Decline
 * log, and trust.ts's sentence as Encounter.noMatchReason (the Agent Console's outcome; no amounts).
 */
async function markBlocked(db: any, enc: any, plan: BlockedPlan, nowMs: number): Promise<"no_match"> {
  const keep = (t: any) => t && t.kind !== "propose" && t.kind !== "ack" && t.kind !== "no_fit";
  const said: any[] = (Array.isArray(enc.transcript) ? enc.transcript : []).filter(keep);
  const opening = said.length ? said : plan.transcript.filter((t) => keep(t) && t.kind !== "decline");
  const last = Math.max(nowMs, ...opening.map((t: any) => ms(t?.at) + 600));
  const transcript = [
    ...opening,
    { from: "buyer_agent", parentId: plan.buyerId, kind: "decline", text: tl.decline(plan.blocked.line), at: iso(last) },
  ];
  // The log before the reason: a live schema that doesn't know noMatchReason yet still stores the log.
  await updateEncounter(db, enc.id, { status: "no_match", transcript }, runFields(localRun(plan.match, nowMs, plan.blocked)),
    { noMatchReason: plan.blocked.reason });
  return "no_match";
}

/**
 * Step 1 of the local fallback: the pets' lines go onto the encounter while it stays "talking", so AgentBubbles
 * type them under the EncounterScene before any Trade window exists. Nothing fits → "no_match" at once; a match the
 * buyer's pet rules stop → "no_match" at once too, with the pets saying which rule (never "Trade proposal!").
 */
export async function stageEncounter(
  db: any,
  enc: any,
  findMatches: FindMatches,
  nowMs: number = Date.now(),
): Promise<{ status: "staged" | "no_match"; transcript: any[]; reason?: string }> {
  const plans = await planLocalMatch(db, enc, findMatches, nowMs, { first: true });
  const plan = plans.find((p) => !p.blocked);
  if (!plan) {
    const stop = plans.find((p): p is BlockedPlan => !!p.blocked);
    if (stop) return { status: await markBlocked(db, enc, stop, nowMs), transcript: [], reason: stop.blocked.reason };
    return { status: await markNoMatch(db, enc, nowMs), transcript: [] };
  }
  // No agentLog yet: the encounter isn't decided (the agents may still win it, and B's mock plays its own log while
  // the pets talk). resolveEncounter writes the fallback's log with the proposal.
  await db.Encounter.update(enc.id, { transcript: plan.transcript });
  return { status: "staged", transcript: plan.transcript };
}

/** When the pets' lines were staged (ms), or null: the first line's `at` once a "propose" line is there. */
export function stagedAt(enc: any): number | null {
  const lines: any[] = Array.isArray(enc?.transcript) ? enc.transcript : [];
  if (!lines.some((t) => t?.kind === "propose")) return null;
  return ms(lines[0]?.at) || null;
}

/**
 * Step 2 (or all of it, for a caller that skips the talk): resolve one "talking" encounter the way C's local
 * fallback does (rule 10 + Part C §1): an existing proposal just marks it; otherwise B's findMatches both
 * directions → B's createProposal (it re-validates every rule; we only supply wording) → "proposed"; nothing
 * fits → "no_match". Pass a fresh row.
 */
export async function resolveEncounter(
  db: any,
  enc: any,
  findMatches: FindMatches,
  nowMs: number = Date.now(),
): Promise<"proposed" | "no_match"> {
  // Already proposed by the agents? Then just mark and move on.
  const existing = await db.MatchProposal.filter({ encounterId: enc.id }, undefined, 1);
  if (existing?.length) {
    await markProposed(db, enc.id, { status: "proposed" }, existing[0].id);
    return "proposed";
  }

  let stop: BlockedPlan | null = null;
  for (const plan of await planLocalMatch(db, enc, findMatches, nowMs)) {
    if (plan.blocked) {
      stop ??= plan as BlockedPlan; // the other direction may still work
      continue;
    }
    // Keep lines the pets already said for this same buyer (the staged lines, agents' appendTurn, the mock).
    const said: any[] = Array.isArray(enc.transcript) ? enc.transcript : [];
    const transcript = said.some((t) => t?.kind === "propose" && t?.parentId === plan.buyerId) ? said : plan.transcript;
    try {
      const prop: any = await callB(db, "createProposal", {
        listingId: plan.match.listingId,
        sellerId: plan.sellerId,
        buyerId: plan.buyerId,
        encounterId: enc.id,
        reason: plan.match.reason ?? `Size ${plan.match.size} matches a shared need.`,
        wearWeeksLeft: plan.match.wearWeeksLeft,
        transcript,
        source: "local",
      });
      // B hands back the agents' proposal if theirs landed a moment earlier (idempotent): then their log stays.
      const run = prop?.source === "fetch" ? undefined : localRun(plan.match, nowMs);
      await markProposed(db, enc.id, { status: "proposed", transcript }, prop?.id, run);
      return "proposed";
    } catch (e) {
      // Another tick (or the agents) may have proposed for this encounter meanwhile: never add a second trade.
      const won = await db.MatchProposal.filter({ encounterId: enc.id }, undefined, 1).catch(() => []);
      if (won?.length) {
        await markProposed(db, enc.id, { status: "proposed" }, won[0].id);
        return "proposed";
      }
      // The buyer's rules changed since the lines were staged (a trade paid meanwhile, a new limit): say which.
      const [again] = (e as { code?: string })?.code === "not_eligible"
        ? await withRules(db, plan.buyerId, [plan.match]).catch(() => [])
        : [];
      if (again?.blocked) {
        console.info(`[C] pet rules stopped encounter ${enc.id}: ${again.blocked.rule}`);
        stop ??= { ...plan, blocked: again.blocked };
      } else {
        console.error("[C] local createProposal failed", e);
      }
    }
  }
  if (stop) return await markBlocked(db, enc, stop, nowMs);
  return await markNoMatch(db, enc, nowMs);
}

/**
 * agentApi `noMatch`: the agents found nothing. Only a still-"talking" encounter without a proposal ends here; a
 * late conversation never flips an encounter the local fallback (or the agents) already proposed (and their log is
 * then not stored either: the encounter keeps the log of whoever decided it). `run` = the agents' log + bubbles:
 * their bubbles replace the transcript (minus any "Trade proposal!" / "over to the humans" line: no trade was
 * proposed); else, if the fallback had staged its trade lines, those are swapped for the no-fit exchange.
 * `reason` (e.g. the buyer's pet rules said no) is kept as Encounter.noMatchReason.
 */
export async function endWithoutMatch(
  db: any,
  encounterId: string,
  nowMs: number = Date.now(),
  run?: AgentRun,
  reason?: string,
): Promise<{ ok: true; skipped?: string }> {
  const enc = await db.Encounter.get(encounterId).catch(() => null);
  if (!enc) throw notFound("encounter");
  if (enc.status !== "talking") return { ok: true, skipped: enc.status };
  const [prop] = (await db.MatchProposal.filter({ encounterId }, undefined, 1)) ?? [];
  if (prop) {
    await markProposed(db, enc.id, { status: "proposed" }, prop.id);
    return { ok: true, skipped: "proposed" };
  }
  const why = plainText(reason, 200);
  const extra = why ? { noMatchReason: why } : {};
  const said = (run?.transcript ?? []).filter((t: any) => t?.kind !== "propose" && t?.kind !== "ack");
  if (said.length) await updateEncounter(db, enc.id, { status: "no_match", transcript: said }, runFields(run), extra);
  else if (stagedAt(enc) != null) await markNoMatch(db, enc, nowMs, run ?? null, extra);
  else await updateEncounter(db, enc.id, { status: "no_match" }, runFields(run), extra);
  return { ok: true };
}

export interface FallbackOpts {
  /** Overrides the 8 s / 25 s wait (B's mock; 0 = start at once). Setting.matchVia "local" always means 0. */
  fallbackAfterMs?: number;
  talkMs?: (transcript: { text?: string }[]) => number;
  nowMs?: number;
  /** Talking encounters already read on this tick (else one query). */
  talking?: any[];
}

/**
 * Local fallback, staged like a real conversation so the Trade window never covers the pets' talk:
 *   1. a "talking" encounter older than the wait (8 s; 25 s while the Fetch agents are on duty, longer while their
 *      lines keep arriving; 0 when Setting.matchVia = "local") gets the pets' lines, still "talking";
 *   2. a later tick, once those lines have had time to be typed (talkMs), calls B's createProposal → "proposed".
 * Runs from every updatePresence / demoWalk tick (no cron) and covers every pair, not only the caller's.
 * Returns the encounters it finished (proposed / no_match) and the ones it staged.
 */
export async function runLocalFallback(
  db: any,
  findMatches: FindMatches,
  opts: FallbackOpts = {},
): Promise<{ resolved: string[]; staged: string[] }> {
  const nowMs = opts.nowMs ?? Date.now();
  const resolved: string[] = [], staged: string[] = [];
  const talking: any[] = opts.talking ?? ((await db.Encounter.filter({ status: "talking" }, "-startedAt", 20)) ?? []);
  if (!talking.length) return { resolved, staged };

  const s = await readSettings(db);
  const onDuty = agentsOnDuty(s, nowMs);
  const wait = s.matchVia === "local" ? 0 : (opts.fallbackAfterMs ?? (onDuty ? AGENT_FALLBACK_AFTER_MS : FALLBACK_AFTER_MS));
  const talkFor = opts.talkMs ?? ((t: { text?: string }[]) => talkMs(t));

  for (const enc of talking) {
    if (enc?.status !== "talking") continue;
    const age = nowMs - ms(enc.startedAt);
    if (age < wait) continue;
    let at = stagedAt(enc);
    if (at == null) {
      // The agents are still saying lines (appendTurn): let them finish, up to a hard cap.
      const lastLine = Math.max(0, ...((enc.transcript ?? []) as any[]).map((t) => ms(t?.at)));
      if (onDuty && opts.fallbackAfterMs == null && nowMs - lastLine < 10_000 && age < AGENT_FALLBACK_MAX_MS) continue;
      const step = await stageEncounter(db, enc, findMatches, nowMs);
      if (step.status === "no_match") {
        resolved.push(enc.id);
        continue;
      }
      staged.push(enc.id);
      enc.transcript = step.transcript;
      at = stagedAt(enc) ?? nowMs;
    }
    if (nowMs - at < talkFor(enc.transcript ?? [])) continue;
    const fresh = await db.Encounter.get(enc.id).catch(() => null);
    if (fresh?.status !== "talking") continue; // the agents (or another tick) got there first
    await resolveEncounter(db, fresh, findMatches, nowMs);
    resolved.push(enc.id);
  }
  return { resolved, staged };
}

/** After detection: the fallback, read only around a recent meeting (or on a recheck tick). */
async function fallbackTick(db: any, det: EncounterResult, deps: LocationDeps, recheck: boolean, nowMs: number): Promise<string[]> {
  const look = recheck || det.created.length > 0 || det.recent;
  if (!look) return [];
  const talking = det.encounters?.filter((e) => e?.status === "talking");
  const { resolved } = await runLocalFallback(db, deps.findMatches ?? bFindMatches, {
    fallbackAfterMs: deps.fallbackAfterMs,
    talkMs: deps.talkMs,
    nowMs,
    talking,
  });
  return resolved;
}

// ---------------------------------------------------------------- handlers

async function parentsMap(db: any): Promise<Map<string, any>> {
  const parents: any[] = await db.Parent.list();
  return new Map(parents.map((p) => [p.id, p]));
}

/** One Presence.list per call; one row per parent (the newest, should a race ever have made two). */
async function presences(db: any): Promise<Map<string, any>> {
  const rows: any[] = (await db.Presence.list()) ?? [];
  const out = new Map<string, any>();
  for (const r of rows) {
    const cur = out.get(r.parentId);
    if (!cur || ms(r.updatedAt) > ms(cur.updatedAt)) out.set(r.parentId, r);
  }
  return out;
}

async function writePresence(db: any, existing: any | null, row: any): Promise<any> {
  return existing?.id ? await db.Presence.update(existing.id, row) : await db.Presence.create(row);
}

export interface UpdatePresenceBody {
  parentId?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  simulated?: boolean;
  discoverable?: boolean;
}

/**
 * updatePresence — GPS in (A's /world). One Presence row per parent, overwritten.
 * `discoverable` (A's toggle) is written to Parent.discoverable when it changes.
 * `simulated: true`: the client's coordinates are ignored (server-owned demo position, see geo.ts demoHome),
 * so the heartbeat never undoes a demo walk and two ?demo=1 tabs never stack on one spot.
 * A real fix for a parent who is live on real GPS can't jump faster than MAX_SPEED_MPS (+ accuracy slack): such a
 * fix is ignored, so nobody can teleport a live parent's dot around (or use it to triangulate others).
 */
export async function updatePresence(db: any, body: UpdatePresenceBody, deps: LocationDeps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const parentId = String(body?.parentId ?? "");
  const lat = Number(body?.lat), lng = Number(body?.lng);
  const accuracyM = Number(body?.accuracyM ?? 999);
  const simulated = Boolean(body?.simulated);
  if (!parentId || !isFinite(lat) || !isFinite(lng)) throw bad("parentId, lat, lng required");

  let parent: any = await db.Parent.get(parentId).catch(() => null);
  if (!parent) throw notFound("parent");

  if (typeof body.discoverable === "boolean" && body.discoverable !== Boolean(parent.discoverable)) {
    await db.Parent.update(parentId, { discoverable: body.discoverable });
    parent = { ...parent, discoverable: body.discoverable };
  }

  const all = await presences(db);
  const existing = all.get(parentId) ?? null;
  const acc = isFinite(accuracyM) ? accuracyM : 999;
  if (!simulated && existing && !existing.simulated && isFresh(existing, nowMs)) {
    const dt = Math.max(1, (nowMs - ms(existing.updatedAt)) / 1000);
    const allowed = MAX_SPEED_MPS * dt + acc + (Number(existing.accuracyM) || 0) + 50;
    if (haversineM(existing, { lat, lng }) > allowed) return { ok: true as const, encounters: [], fallback: [], ignored: "implausible jump" };
  }

  const pos: LatLng = !simulated ? { lat, lng } : existing?.simulated ? { lat: existing.lat, lng: existing.lng } : demoHome(parent);
  const row = { parentId, lat: pos.lat, lng: pos.lng, accuracyM: acc, simulated, updatedAt: iso(nowMs) };
  await writePresence(db, existing, row);
  all.set(parentId, row);

  const parentOf: ParentLookup = async (id) => (id === parentId ? parent : await db.Parent.get(id).catch(() => null));
  const recheck = deps.recheck || recheckDue(nowMs);
  const det = await detectEncounters(db, row, parentOf, nowMs, { presences: [...all.values()], recheck });
  const fallback = await fallbackTick(db, det, deps, recheck, nowMs);
  return { ok: true as const, encounters: det.created, fallback };
}

/**
 * listNearby — bands + bearing out (A's radar). You only see others while you are discoverable
 * yourself (symmetry keeps it fair). Only avatar, band and 5° direction leave; `distanceM` (5 m steps) only
 * when both presences are simulated.
 */
export async function listNearby(db: any, body: { parentId?: string }, deps: Pick<LocationDeps, "nowMs"> = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const parentId = String(body?.parentId ?? "");
  if (!parentId) throw bad("parentId required");

  const all = await presences(db);
  const mine = all.get(parentId);
  if (!mine) return { me: null, nearby: [] };

  const byId = await parentsMap(db);
  const meParent = byId.get(parentId);

  const nearby: any[] = [];
  if (meParent?.discoverable) {
    for (const p of all.values()) {
      if (p.parentId === parentId || !isFresh(p, nowMs)) continue;
      const parent = byId.get(p.parentId);
      if (!parent?.discoverable) continue;
      const d = haversineM(mine, p);
      const b = band(d);
      if (!b) continue;
      nearby.push({
        parentId: parent.id,
        name: parent.name,
        sprite: parent.avatar?.sprite ?? "parent_a",
        pet: parent.pet?.sprite ?? "pet_a",
        band: b,
        bearingDeg: roundBearing(bearingDeg(mine, p)),
        ...(mine.simulated && p.simulated ? { distanceM: roundDemoDistance(d) } : {}),
      });
    }
  }
  return {
    me: { accuracyM: mine.accuracyM, simulated: Boolean(mine.simulated), fresh: isFresh(mine, nowMs) },
    nearby,
  };
}

export interface DemoWalkBody {
  parentId?: string;
  targetParentId?: string;
  /** A's stub name for targetParentId; accepted too. */
  towardParentId?: string;
  stepM?: number;
  reset?: boolean;
}

/**
 * demoWalk — "WALK TOWARD JO" for indoor judging (rule 5). Moves the caller's SIMULATED presence `stepM`
 * (default 5 m) toward the target and runs the same encounter check as updatePresence. A calls it every 1 s
 * until an encounter fires (A's hook then keeps a slow `stepM: 1` hold tick going, which keeps the walker's
 * simulated presence fresh and the fallback ticking). The walk starts 120 m due north of the target on the
 * first call, with `reset: true` (A sends it at the start of every walk), or when the caller was on real GPS.
 * A target with no presence — or a real-GPS presence gone stale (that phone left /world) — is parked on its
 * demo spot as simulated, and a simulated target is kept fresh, so a single laptop with two tabs always works.
 */
export async function demoWalk(db: any, body: DemoWalkBody, deps: LocationDeps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const parentId = String(body?.parentId ?? "");
  const targetParentId = String(body?.targetParentId ?? body?.towardParentId ?? "");
  const stepM = Math.max(1, Math.min(50, Number(body?.stepM ?? 5) || 5));
  if (!parentId || !targetParentId) throw bad("parentId, targetParentId required");
  if (parentId === targetParentId) throw bad("can't walk toward yourself");

  const parentsById = await parentsMap(db);
  const targetParent = parentsById.get(targetParentId);
  if (!parentsById.has(parentId) || !targetParent) throw notFound("parent");
  const nowIso = iso(nowMs);
  const all = await presences(db);

  // Target presence: parked on its demo spot when missing or a stale real fix; a simulated one kept fresh.
  let target = all.get(targetParentId) ?? null;
  if (!target || (!target.simulated && !isFresh(target, nowMs))) {
    const parked = { parentId: targetParentId, ...demoHome(targetParent), accuracyM: DEMO_ACCURACY_M, simulated: true, updatedAt: nowIso };
    target = { ...(await writePresence(db, target, parked)), ...parked };
  } else if (target.simulated && nowMs - ms(target.updatedAt) > TARGET_REFRESH_MS) {
    await db.Presence.update(target.id, { updatedAt: nowIso });
    target = { ...target, updatedAt: nowIso };
  }
  all.set(targetParentId, target);

  // Caller presence.
  const me = all.get(parentId) ?? null;
  const start = () => destination(target, 0, DEMO_START_M); // 120 m due north: the radar's 100–300 m ring
  const pos: LatLng = !me || body.reset || !me.simulated ? start() : stepToward(me, target, stepM);
  const row = { parentId, lat: pos.lat, lng: pos.lng, accuracyM: DEMO_ACCURACY_M, simulated: true, updatedAt: nowIso };
  await writePresence(db, me, row);
  all.set(parentId, row);

  const recheck = deps.recheck || recheckDue(nowMs);
  const det = await detectEncounters(db, row, parentsById, nowMs, {
    presences: [...all.values()],
    mover: true,
    recheck: recheck || Boolean(body.reset), // the reset tick re-arms the pair at once
  });
  const fallback = await fallbackTick(db, det, deps, recheck, nowMs);
  return {
    ok: true as const,
    distanceM: Math.round(haversineM(row, target)),
    encounters: det.created,
    fallback,
  };
}
