// (C) encounter.ts — the one place that decides when two parents "meet".
// Shared by updatePresence (real GPS) and demoWalk (simulated).
//
// Clock note: presence freshness, cooldown and the 8 s fallback use the REAL
// wall clock (Date.now()), because Setting.now is a frozen story date (May→Oct)
// and would make every presence look stale. Story-time logic (outgrow dates,
// wearWeeksLeft) lives in B's _lib and reads Setting.now.

// deno-lint-ignore-file no-explicit-any
import {
  COOLDOWN_DEMO_MS,
  COOLDOWN_MS,
  isFresh,
  pairKey,
  type PresenceLike,
  REARM_M,
  haversineM,
  withinEncounter,
} from "./geo.ts";
import { getSetting } from "./auth.ts";
import { callB } from "../cbridge.ts";

export const FALLBACK_AFTER_MS = 8_000; // rule: no proposal after 8 s → local match

/**
 * PairState — requested from B in NEEDS.md (one row per unordered pair):
 *   { pairKey: string; armed: boolean; lastEncounterAt?: string; lastDistanceM?: number }
 * If the entity doesn't exist yet we degrade gracefully: every pair counts as
 * armed and cooldown is derived from the latest Encounter.startedAt.
 */
async function loadPairState(db: any, key: string): Promise<any | null> {
  try {
    const rows = await db.PairState.filter({ pairKey: key }, undefined, 1);
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

async function savePairState(db: any, key: string, patch: any, existing: any) {
  try {
    if (existing?.id) await db.PairState.update(existing.id, patch);
    else await db.PairState.create({ pairKey: key, armed: true, ...patch });
  } catch {
    /* entity missing — fallback mode, nothing to persist */
  }
}

async function lastEncounterAt(db: any, a: string, b: string): Promise<number> {
  const rows = await db.Encounter.filter({ aId: a, bId: b }, "-startedAt", 1);
  const rows2 = await db.Encounter.filter({ aId: b, bId: a }, "-startedAt", 1);
  const t = [rows?.[0], rows2?.[0]]
    .filter(Boolean)
    .map((e: any) => Date.parse(e.startedAt))
    .filter((n) => !isNaN(n));
  return t.length ? Math.max(...t) : 0;
}

export interface EncounterResult {
  created: { id: string; peerId: string }[];
}

/**
 * Run the encounter check for `me` against every other fresh, discoverable
 * presence. Returns the encounters created on this call.
 */
export async function detectEncounters(
  db: any,
  me: PresenceLike,
  parentsById: Map<string, any>,
): Promise<EncounterResult> {
  const nowMs = Date.now();
  // Demo mode (rule 5) == the caller is on a simulated position → 2 min cooldown.
  const cooldown = me.simulated ? COOLDOWN_DEMO_MS : COOLDOWN_MS;
  const result: EncounterResult = { created: [] };

  const meParent = parentsById.get(me.parentId);
  if (!meParent?.discoverable) return result;

  const others: PresenceLike[] = await db.Presence.list();
  for (const other of others) {
    if (other.parentId === me.parentId) continue;
    if (!isFresh(other, nowMs)) continue;
    const peer = parentsById.get(other.parentId);
    if (!peer?.discoverable) continue;

    const key = pairKey(me.parentId, other.parentId);
    const state = await loadPairState(db, key);
    const d = haversineM(me, other);

    // Re-arm bookkeeping: once a pair has separated beyond 40 m they can meet again.
    if (state && !state.armed && d > REARM_M) {
      await savePairState(db, key, { armed: true, lastDistanceM: d }, state);
      continue;
    }

    if (!withinEncounter(me, other)) continue;
    if (state && !state.armed) continue; // still inside the old encounter

    const lastAt = state?.lastEncounterAt
      ? Date.parse(state.lastEncounterAt)
      : await lastEncounterAt(db, me.parentId, other.parentId);
    if (lastAt && nowMs - lastAt < cooldown) continue;

    // Skip if a "talking" encounter for this pair is already open.
    const open = await db.Encounter.filter({ aId: me.parentId, bId: other.parentId, status: "talking" }, undefined, 1);
    const open2 = await db.Encounter.filter({ aId: other.parentId, bId: me.parentId, status: "talking" }, undefined, 1);
    if (open?.length || open2?.length) continue;

    const simulated = me.simulated || other.simulated;
    const enc = await db.Encounter.create({
      aId: me.parentId,
      bId: other.parentId,
      band: "<25m",
      simulated,
      status: "talking",
      startedAt: new Date(nowMs).toISOString(),
      transcript: [],
    });

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
        createdAt: new Date(nowMs).toISOString(),
      });
    }

    await savePairState(db, key, {
      armed: false,
      lastEncounterAt: new Date(nowMs).toISOString(),
      lastDistanceM: d,
    }, state);
    result.created.push({ id: enc.id, peerId: other.parentId });
  }
  return result;
}

/**
 * Local fallback (rule 10 + Part C §1): an encounter that is still "talking"
 * after 8 s with no proposal, or when Setting.matchVia === "local", gets
 * resolved here with B's findMatches, both directions. Called on every
 * updatePresence / demoWalk tick for the caller's open encounters, so no cron
 * is needed.
 */
export async function runLocalFallback(
  base44: any,
  db: any,
  parentId: string,
  findMatches: FindMatches,
): Promise<{ resolved: string[] }> {
  const nowMs = Date.now();
  const setting = await getSetting(db);
  const mine = [
    ...(await db.Encounter.filter({ aId: parentId, status: "talking" })),
    ...(await db.Encounter.filter({ bId: parentId, status: "talking" })),
  ];
  const resolved: string[] = [];
  for (const enc of mine) {
    const age = nowMs - Date.parse(enc.startedAt);
    if (setting.matchVia !== "local" && age < FALLBACK_AFTER_MS) continue;

    // Already proposed by the agents? Then just mark and move on.
    const existing = await db.MatchProposal.filter({ encounterId: enc.id }, undefined, 1);
    if (existing?.length) {
      await db.Encounter.update(enc.id, { status: "proposed" });
      resolved.push(enc.id);
      continue;
    }

    // Try both directions: a→b (a buys) then b→a.
    let proposed = false;
    for (const [buyerId, sellerId] of [[enc.aId, enc.bId], [enc.bId, enc.aId]]) {
      const matches = await findMatches(db, { buyerId, sellerId });
      const best = matches?.[0];
      if (!best) continue;
      const transcript = localTranscript(enc, buyerId, sellerId, best, nowMs);
      try {
        // B's createProposal re-validates every rule; we only supply wording. In-process via cbridge.
        await callB(db, "createProposal", {
          listingId: best.listingId,
          sellerId,
          buyerId,
          encounterId: enc.id,
          reason: best.reason ?? `Size ${best.size} matches a shared need.`,
          wearWeeksLeft: best.wearWeeksLeft,
          transcript,
          source: "local",
        });
        await db.Encounter.update(enc.id, { status: "proposed", transcript });
        proposed = true;
        break;
      } catch (e) {
        console.error("[C] local createProposal failed", e);
      }
    }
    if (!proposed) {
      const transcript = [...(enc.transcript ?? []), {
        from: "buyer_agent",
        parentId: enc.aId,
        kind: "no_fit",
        text: "Nothing fits today — maybe next walk!",
        at: new Date(nowMs).toISOString(),
      }];
      await db.Encounter.update(enc.id, { status: "no_match", transcript });
    }
    resolved.push(enc.id);
  }
  return { resolved };
}

/** Contract for B's findMatches (see NEEDS.md). */
export type FindMatches = (
  db: any,
  q: { buyerId: string; sellerId: string },
) => Promise<LocalMatch[]>;

export interface LocalMatch {
  listingId: string;
  itemName: string;
  size: string;
  priceCents: number;
  wearWeeksLeft?: number;
  reason?: string;
}

/** Template transcript so the EncounterScene has bubbles even without LLM/agents. */
function localTranscript(enc: any, buyerId: string, sellerId: string, m: LocalMatch, nowMs: number) {
  const at = (i: number) => new Date(nowMs + i * 600).toISOString();
  const dollars = (m.priceCents / 100).toFixed(2);
  return [
    { from: "buyer_agent", parentId: buyerId, kind: "looking_for", text: `Looking for ${m.size}!`, at: at(0) },
    { from: "seller_agent", parentId: sellerId, kind: "have", text: `I have a ${m.itemName} in ${m.size}.`, at: at(1) },
    ...(m.wearWeeksLeft != null
      ? [{ from: "buyer_agent", parentId: buyerId, kind: "fit_check", text: `Your little one fits it for about ${m.wearWeeksLeft} more weeks.`, at: at(2) }]
      : []),
    { from: "buyer_agent", parentId: buyerId, kind: "propose", text: `Trade proposal! $${dollars} — nothing is charged until you both accept.`, at: at(3) },
    { from: "seller_agent", parentId: sellerId, kind: "ack", text: "Sounds good — over to the humans!", at: at(4) },
  ];
}
