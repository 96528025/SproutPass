// OWNER: Agent 2 (B5). Live view of the current parent's trade proposals (buyer or seller).
// One shared store for the whole app: every consumer (TradeWatcher, TradeWindow, …) sees the same rows,
// so a window opened by the watcher never waits on a closet refresh to find its proposal.
// Rows come from closet.proposals plus api.subscribe("MatchProposal"), and only move forward through the
// state machine, so a stale closet fetch can't undo a newer realtime event (or drop a row it left out).
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../app/api";
import { useApp } from "../app/store";
import type { ClosetView, MatchProposal, ProposalStatus } from "../app/types";
import { confirmedGone, isLive, missingLive } from "./tradeLogic";

const RANK: Record<ProposalStatus, number> = { open: 0, both_accepted: 1, paid: 2, declined: 2, expired: 2, payment_failed: 2 };
const progress = (p: MatchProposal) =>
  RANK[p.status] * 10 + (p.sellerDecision !== "pending" ? 1 : 0) + (p.buyerDecision !== "pending" ? 1 : 0);

export { isLive };

function merge(before: MatchProposal | undefined, incoming: MatchProposal): MatchProposal {
  if (!before) return incoming;
  return progress(incoming) >= progress(before) ? { ...before, ...incoming } : before;
}

const newestFirst = (a: MatchProposal, b: MatchProposal) => {
  const ca = (a as { created_date?: string }).created_date ?? a.createdAt;
  const cb = (b as { created_date?: string }).created_date ?? b.createdAt;
  return ca < cb ? 1 : ca > cb ? -1 : (seen.get(b.id) ?? 0) - (seen.get(a.id) ?? 0);
};

// ---------------------------------------------------------------- shared store

interface Snapshot { rows: Record<string, MatchProposal>; justPaid: MatchProposal | null }
let snap: Snapshot = { rows: {}, justPaid: null };
const seen = new Map<string, number>(); // first-seen order: tiebreak when the demo clock gives equal createdAt
let seenSeq = 0;
const seenAt = new Map<string, number>(); // last time a row arrived (event, closet or api reply)
const listeners = new Set<() => void>();
let stopRealtime: (() => void) | null = null;

function apply(list: MatchProposal[], removed: string[] = []) {
  const prev = snap.rows;
  const rows = { ...prev };
  let justPaid = snap.justPaid;
  let changed = removed.some((id) => id in rows);
  for (const id of removed) delete rows[id];
  for (const p of list) {
    if (!seen.has(p.id)) seen.set(p.id, ++seenSeq);
    seenAt.set(p.id, Date.now());
    const before = prev[p.id];
    const next = merge(before, before ? ({ ...before, ...p } as MatchProposal) : p);
    if (next === before) continue;
    rows[p.id] = next;
    changed = true;
    if (next.status === "paid" && before && before.status !== "paid") justPaid = next;
  }
  if (!changed) return;
  snap = { rows, justPaid };
  listeners.forEach((l) => l());
}

function subscribeStore(listener: () => void) {
  listeners.add(listener);
  if (!stopRealtime) {
    try {
      stopRealtime = api.subscribe<MatchProposal>("MatchProposal", (e) => {
        if (e.type === "delete") apply([], [e.id]);
        else if (e.data) apply([{ ...e.data, id: e.id }]);
      });
    } catch (err) {
      console.warn("[trade] subscribe(MatchProposal) failed", err);
      stopRealtime = () => {};
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && stopRealtime) { stopRealtime(); stopRealtime = null; }
  };
}

const getSnapshot = () => snap;

// RESET on real Base44 wipes rows with deleteMany, which sends no per-row delete events. A closet always lists
// every live proposal, so a live row it leaves out is either brand new (stale closet) or deleted. Re-fetch once
// and drop the rows still missing from a closet fetched after we last saw them. One check at a time, and each
// id at most every 15 s, so a misbehaving backend can't turn this into a request loop under the rate limit.
const VERIFY_COOLDOWN_MS = 15_000;
const lastVerified = new Map<string, number>();
let verifying = false;

async function verifyMissing(closet: ClosetView) {
  const now = Date.now();
  const ids = missingLive(snap.rows, closet.parent.id, closet.proposals.map((p) => p.id))
    .filter((id) => now - (lastVerified.get(id) ?? 0) > VERIFY_COOLDOWN_MS);
  if (!ids.length || verifying) return;
  verifying = true;
  ids.forEach((id) => lastVerified.set(id, now));
  try {
    const startedAt = Date.now();
    const fresh = await useApp.getState().refreshCloset();
    if (!fresh || fresh.parent.id !== closet.parent.id) return;
    const gone = confirmedGone(ids, fresh.proposals.map((p) => p.id), seenAt, startedAt);
    if (gone.length) apply([], gone);
  } finally {
    verifying = false;
  }
}

// ---------------------------------------------------------------- hook

export interface ProposalsView {
  me: string | null;
  /** This parent's proposals, newest first. */
  proposals: MatchProposal[];
  /** Every open / both_accepted proposal, newest first (TradeWatcher pops the newest one this tab hasn't closed). */
  live: MatchProposal[];
  /** Newest open / both_accepted proposal (= live[0]). */
  active: MatchProposal | null;
  /** The last proposal seen turning "paid" while the app was running. */
  justPaid: MatchProposal | null;
  byId: Record<string, MatchProposal>;
  /** Merge a proposal returned by an api call (in case the realtime event is late). */
  upsert(p: MatchProposal): void;
}

export function useProposals(): ProposalsView {
  const me = useApp((s) => s.closet?.parent.id ?? null);
  const fromCloset = useApp((s) => s.closet?.proposals);
  const { rows, justPaid } = useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);

  useEffect(() => {
    if (fromCloset?.length) apply(fromCloset);
    const closet = useApp.getState().closet;
    if (closet && closet.proposals === fromCloset) void verifyMissing(closet);
  }, [fromCloset]);

  const upsert = useCallback((p: MatchProposal) => apply([p]), []);

  return useMemo(() => {
    const proposals = me
      ? Object.values(rows).filter((p) => p.buyerId === me || p.sellerId === me).sort(newestFirst)
      : [];
    const live = proposals.filter(isLive);
    return { me, proposals, live, active: live[0] ?? null, justPaid, byId: rows, upsert };
  }, [me, rows, justPaid, upsert]);
}
