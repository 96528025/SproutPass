// (C) encounter.ts — the encounter rules now live in ./location.ts (pure: no Deno, no npm:), shared by the
// Deno functions and B's in-browser mock. This file keeps the old import path and signatures working, and holds
// agentApi's encounter actions as pure handlers (claimInbox, fit, createProposal, noMatch), so vitest can run them on
// fakeDb (base44/shared/agentApi.test.ts: a vitest file, kept out of this Deno test folder) while
// base44/functions/agentApi/entry.ts stays a thin door.

// deno-lint-ignore-file no-explicit-any
import {
  type AgentRun,
  cleanAgentLog,
  cleanTurns,
  endWithoutMatch,
  type FindMatches,
  type RulesBlock,
  runFields,
  runLocalFallback as runFallback,
  updateEncounter,
  withRules,
} from "./location.ts";
import { callB, findMatches } from "../cbridge.ts";
import { bad, HttpError } from "../errors.ts";

export {
  detectEncounters,
  type EncounterResult,
  FALLBACK_AFTER_MS,
  type FindMatches,
  type LocalMatch,
  localTranscript,
  resolveEncounter,
  stageEncounter,
} from "./location.ts";

/** Old signature (base44 first); the client isn't needed any more, and the fallback now covers every pair. */
export function runLocalFallback(_base44: any, db: any, _parentId: string, findMatches: FindMatches) {
  return runFallback(db, findMatches);
}

// ---------------------------------------------------------------- agentApi's encounter actions
//
// Division of labour: the Python agents claim only "encounter" rows ({types: ["encounter"]}); "imessage" and
// "event" rows stay pending for the app's TypeScript side (the Photon webhook, inboxFallback.ts).

export const INBOX_TYPES = ["encounter", "imessage", "event"] as const;
export type InboxType = (typeof INBOX_TYPES)[number];

/** `types` from the request → the row types to claim (null = every type, the old behaviour). */
export function inboxTypes(raw: unknown): InboxType[] | null {
  if (raw == null) return null;
  const list = (Array.isArray(raw) ? raw : [raw]).map(String).filter((t): t is InboxType => (INBOX_TYPES as readonly string[]).includes(t));
  if (!list.length) throw bad("types must list encounter | imessage | event");
  return [...new Set(list)];
}

export interface ClaimInboxBody {
  parentId?: string;
  limit?: number;
  /** e.g. ["encounter"]: only those rows are claimed; the others stay pending for the TypeScript side. */
  types?: unknown;
  agentAddress?: string;
  /**
   * With parentId: also return this parent's rows of these types created after `since`, WITHOUT claiming them
   * (`peeked`). A standalone agent whose parent linked ASI:One mirrors them there; the TypeScript side still answers
   * them on iMessage, so nothing is said twice on one channel.
   */
  peek?: { types?: unknown; since?: string };
}

const PEEK_LIMIT = 10;

/**
 * agentApi `claimInbox`: the oldest pending rows (of one parent, or of every parent for a Bureau), marked claimed.
 * With `types`, one filtered read per type (equality filters only, like everywhere else), merged by createdAt.
 */
export async function claimInbox(db: any, body: ClaimInboxBody = {}, nowMs: number = Date.now()): Promise<{ rows: any[]; peeked?: any[] }> {
  const { rows } = await claimRows(db, body, nowMs);
  if (!body.peek || typeof body.peek !== "object" || !body.parentId) return { rows };
  const since = Date.parse(String(body.peek.since ?? "")) || 0;
  const peeked: any[] = [];
  for (const type of inboxTypes(body.peek.types ?? ["event"]) ?? []) {
    const recent: any[] = (await db.AgentInbox.filter({ parentId: String(body.parentId), type }, "-createdAt", PEEK_LIMIT)) ?? [];
    peeked.push(...recent.filter((r) => (Date.parse(String(r.createdAt ?? "")) || 0) > since && !rows.some((c) => c.id === r.id)));
  }
  peeked.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  return { rows, peeked: peeked.slice(-PEEK_LIMIT) };
}

async function claimRows(db: any, body: ClaimInboxBody, nowMs: number): Promise<{ rows: any[] }> {
  const limit = Math.max(1, Math.min(20, Number(body.limit ?? 5) || 5));
  const types = inboxTypes(body.types);
  const base: Record<string, unknown> = { status: "pending" };
  if (body.parentId) base.parentId = String(body.parentId);
  let rows: any[];
  if (!types) {
    rows = (await db.AgentInbox.filter(base, "createdAt", limit)) ?? [];
  } else {
    rows = [];
    for (const type of types) rows.push(...((await db.AgentInbox.filter({ ...base, type }, "createdAt", limit)) ?? []));
    rows.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    rows = rows.slice(0, limit);
  }
  const claimedAt = new Date(nowMs).toISOString();
  const claimed: any[] = [];
  for (const r of rows) {
    // Best-effort claim; Base44 has no compare-and-set, so the agent also tolerates the rare double delivery
    // (idempotent handlers).
    await db.AgentInbox.update(r.id, { status: "claimed", claimedBy: body.agentAddress ?? "agent", claimedAt });
    claimed.push({ ...r, status: "claimed" });
  }
  return { rows: claimed };
}

/** The agents' run as Encounter fields: negotiatedBy "fetch" (only agents reach agentApi) + their cleaned log. */
export function agentsRun(rawLog: unknown, transcript?: unknown, nowMs: number = Date.now()): AgentRun {
  return {
    negotiatedBy: "fetch",
    agentLog: cleanAgentLog(rawLog, "fetch", nowMs),
    ...(transcript !== undefined ? { transcript: cleanTurns(transcript, nowMs) } : {}),
  };
}

/**
 * agentApi `fit` {buyerId, sellerId}: B's ranking, each match with the BUYER's pet-rules verdict (`blocked`:
 * {rule, reason, line}) so the buyer's agent never says "Trade proposal!" for a trade createProposal would refuse.
 * The reads happen only when there is a match.
 */
export async function fitForAgents(db: any, q: { buyerId?: string; sellerId?: string }): Promise<{ matches: any[] }> {
  if (!q.buyerId || !q.sellerId) throw bad("fit needs {buyerId, sellerId}");
  const matches = await findMatches(db, { buyerId: String(q.buyerId), sellerId: String(q.sellerId) });
  return { matches: await withRules(db, String(q.buyerId), matches) };
}

/**
 * How a refusal by the buyer's pet rules reaches the agent: B's not_eligible error, its message tagged
 * `pet_rules(<rule>): <trust.ts sentence>` (no amounts). agents/closet_agent.py reads the tag (PET_RULES_RX).
 */
export const PET_RULES_TAG = "pet_rules";
export const petRulesError = (b: Pick<RulesBlock, "rule" | "reason">) =>
  new HttpError("not_eligible", `createProposal: not_eligible: ${PET_RULES_TAG}(${b.rule}): ${b.reason}`, 409);

/** B said not_eligible: was it the buyer's pet rules? (Listing + item + buyer + this month's totals; only on that error.) */
async function rulesBehind(db: any, args: Record<string, any>, e: unknown): Promise<RulesBlock | null> {
  if ((e as { code?: string })?.code !== "not_eligible" || !args.listingId || !args.buyerId) return null;
  try {
    const listing = await db.Listing.get(String(args.listingId));
    const item = listing?.itemId ? await db.ClothingItem.get(listing.itemId).catch(() => null) : null;
    if (!listing) return null;
    const [checked] = await withRules(db, String(args.buyerId), [{ priceCents: listing.priceCents, category: item?.category }]);
    return checked?.blocked ?? null;
  } catch {
    return null;
  }
}

/**
 * agentApi `createProposal`: B's createProposal (it re-validates every rule), then the Encounter → "proposed" with
 * proposalId, the agents' transcript and their protocol log (agentLog, negotiatedBy "fetch") — all in the one call
 * the agent makes anyway. If B hands back a proposal C's local fallback made first (source "local"), the encounter
 * keeps the fallback's own transcript and log: the agents came late. The transcript is cleaned (cleanTurns) before
 * B or the Encounter sees it. A refusal by the buyer's pet rules comes back tagged (petRulesError), so the agent can
 * say which rule instead of "nothing fits".
 */
export async function proposeFromAgents(db: any, body: Record<string, any> = {}, nowMs: number = Date.now()): Promise<any> {
  const { action: _a, agentLog, negotiatedBy: _n, ...args } = body;
  args.source = args.source ?? "fetch";
  if (args.transcript !== undefined) args.transcript = cleanTurns(args.transcript, nowMs);
  let prop: any;
  try {
    prop = await callB(db, "createProposal", args);
  } catch (e) {
    const block = await rulesBehind(db, args, e);
    throw block ? petRulesError(block) : e;
  }
  if (args.encounterId) {
    const theirs = prop?.source !== "local";
    const patch: Record<string, unknown> = {
      status: "proposed",
      ...(theirs && args.transcript?.length ? { transcript: args.transcript } : {}),
    };
    // proposalId first (A's EncounterScene needs it), then the log: a schema that refuses a field drops the later ones.
    await updateEncounter(db, String(args.encounterId), patch, prop?.id ? { proposalId: prop.id } : {},
      theirs ? runFields(agentsRun(agentLog, undefined, nowMs)) : {})
      .catch(() => {});
  }
  return prop;
}

/**
 * agentApi `noMatch`: location.ts endWithoutMatch with the agents' log (+ their bubbles, when sent) and, when the
 * buyer's pet rules stopped the trade, their reason (→ Encounter.noMatchReason).
 */
export async function noMatchFromAgents(db: any, body: Record<string, any> = {}, nowMs: number = Date.now()) {
  if (!body.encounterId) throw bad("encounterId required");
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  return await endWithoutMatch(db, String(body.encounterId), nowMs, agentsRun(body.agentLog, body.transcript ?? [], nowMs), reason);
}
