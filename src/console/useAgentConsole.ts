// B4: the Agent Console's live data. Encounter rows (newest first) with their protocol log, the proposal each
// one produced, and the parents' public cards (name, avatar, pet: getParties never returns a phone).
//
// Reads go through C's client (`base44`: the real SDK, or the mock world's fakeDb in --mode mock); realtime
// through api.subscribe, which live is the SDK's websocket and in the mock also hears the other tabs, so a walk
// on one phone shows up here at once. A 15 s backstop re-read runs only while the page is visible (Base44's
// rate limit is shared by every tab), and once more whenever the page comes back.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../app/api";
import { errorText } from "../app/store";
import type { Encounter, MatchProposal, PublicParty } from "../app/types";
import { base44 } from "../agent/client";

const ENCOUNTERS = 20;
const PROPOSALS = 40;
const POLL_MS = 15_000;
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export interface AgentConsoleData {
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Newest first. */
  encounters: Encounter[];
  /** By encounterId. */
  proposals: Record<string, MatchProposal>;
  /** By parent id. */
  parties: Record<string, PublicParty>;
  /** Last realtime event (ms), for the LIVE indicator. */
  lastEventAt: number | null;
  /** Last successful read (ms). */
  lastSyncAt: number | null;
  /** True while the realtime subscriptions are up. */
  live: boolean;
  reload: () => void;
}

const startedMs = (e: Encounter) => Date.parse(e.startedAt) || 0;
const newestFirst = (a: Encounter, b: Encounter) => startedMs(b) - startedMs(a);

/** The proposal per encounter: the newest one wins (one per encounter is the rule; be safe anyway). */
function byEncounter(rows: MatchProposal[], into: Record<string, MatchProposal> = {}): Record<string, MatchProposal> {
  const out = { ...into };
  for (const p of rows) {
    if (!p?.encounterId) continue;
    const cur = out[p.encounterId];
    if (!cur || cur.id === p.id || (p.createdAt ?? "") >= (cur.createdAt ?? "")) out[p.encounterId] = cur?.id === p.id ? { ...cur, ...p } : p;
  }
  return out;
}

// Public cards are the same for every mount: cache them for the page's life.
const partyCache: Record<string, PublicParty> = {};

export function useAgentConsole(): AgentConsoleData {
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [proposals, setProposals] = useState<Record<string, MatchProposal>>({});
  const [parties, setParties] = useState<Record<string, PublicParty>>(() => ({ ...partyCache }));
  const [status, setStatus] = useState<AgentConsoleData["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const fetchedProposal = useRef(new Set<string>());
  const partyAsked = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (inFlight.current) return; // never stack reads when the backend is slow or rate limited
    inFlight.current = true;
    try {
      const [encs, props] = await Promise.all([
        base44.entities.Encounter.list("-startedAt", ENCOUNTERS) as Promise<Encounter[]>,
        (base44.entities.MatchProposal.list("-createdAt", PROPOSALS) as Promise<MatchProposal[]>).catch(() => [] as MatchProposal[]),
      ]);
      if (!alive.current) return;
      setEncounters([...(encs ?? [])].sort(newestFirst).slice(0, ENCOUNTERS));
      setProposals((cur) => byEncounter(props ?? [], cur));
      setStatus("ready");
      setError(null);
      setLastSyncAt(Date.now());
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e));
      setStatus((s) => (s === "loading" ? "error" : s)); // keep showing what we had
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Realtime + backstop poll.
  useEffect(() => {
    alive.current = true;
    void load();
    const onEncounter = (ev: { type: string; id: string; data: Encounter }) => {
      setLastEventAt(Date.now());
      setEncounters((cur) => {
        if (ev.type === "delete") return cur.filter((e) => e.id !== ev.id);
        if (!ev.data?.id) return cur;
        const rest = cur.filter((e) => e.id !== ev.data.id);
        const before = cur.find((e) => e.id === ev.data.id);
        return [...rest, before ? { ...before, ...ev.data } : ev.data].sort(newestFirst).slice(0, ENCOUNTERS);
      });
    };
    const onProposal = (ev: { type: string; id: string; data: MatchProposal }) => {
      setLastEventAt(Date.now());
      if (ev.type === "delete" || !ev.data?.encounterId) return;
      setProposals((cur) => byEncounter([ev.data], cur));
    };
    const offs = [
      api.subscribe<Encounter>("Encounter", onEncounter),
      api.subscribe<MatchProposal>("MatchProposal", onProposal),
    ];
    setLive(true);
    const timer = setInterval(() => { if (visible()) void load(); }, POLL_MS);
    const onVisible = () => { if (visible()) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      alive.current = false;
      offs.forEach((off) => { try { off(); } catch { /* already gone */ } });
      setLive(false);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [load]);

  // A proposed encounter whose proposal isn't in the recent list (older, or the list was capped): one read each.
  useEffect(() => {
    for (const e of encounters) {
      const pid = (e as Encounter & { proposalId?: string }).proposalId;
      if (e.status !== "proposed" || !pid || proposals[e.id] || fetchedProposal.current.has(pid)) continue;
      fetchedProposal.current.add(pid);
      (base44.entities.MatchProposal.get(pid) as Promise<MatchProposal>)
        .then((p) => { if (alive.current && p) setProposals((cur) => byEncounter([{ ...p, encounterId: p.encounterId ?? e.id }], cur)); })
        .catch(() => { /* not readable: the outcome shows what the encounter knows */ });
    }
  }, [encounters, proposals]);

  // Names for the agent cards (getParties: id, name, avatar, pet only; ≤ 10 ids per call).
  useEffect(() => {
    const missing = [...new Set(encounters.flatMap((e) => [e.aId, e.bId]))]
      .filter((id) => id && !partyCache[id] && !partyAsked.current.has(id))
      .slice(0, 10);
    if (!missing.length) return;
    missing.forEach((id) => partyAsked.current.add(id));
    api.getParties({ parentIds: missing })
      .then((cards) => {
        cards.forEach((c) => { partyCache[c.id] = c; });
        if (alive.current) setParties({ ...partyCache });
      })
      .catch(() => {
        // try again on the next change (rate limited / offline)
        missing.forEach((id) => partyAsked.current.delete(id));
      });
  }, [encounters]);

  return { status, error, encounters, proposals, parties, lastEventAt, lastSyncAt, live, reload: () => void load() };
}
