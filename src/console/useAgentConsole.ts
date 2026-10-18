// B4: the Agent Console's live data. Encounter rows (newest first) with their protocol log, the proposal each
// one produced, and the parents' public cards (name, avatar, pet: getParties never returns a phone).
//
// Reads go through C's client (`base44`: the real SDK, or the mock world's fakeDb in --mode mock); realtime
// through api.subscribe, which live is the SDK's websocket and in the mock also hears the other tabs, so a walk
// on one phone shows up here at once. A 15 s backstop re-read runs only while the page is visible (Base44's
// rate limit is shared by every tab), and once more whenever the page comes back.
//
// A deep link (/agents?enc=<id>) pins one encounter: when it is older than the recent list, it is read once on
// its own and joins the list (consoleModel.withPinned), so the pets' scene and the pet's AGENTS' CHAT always open it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../app/api";
import { errorText } from "../app/store";
import type { Encounter, MatchProposal, PublicParty } from "../app/types";
import { base44 } from "../agent/client";
import { withPinned } from "./consoleModel";

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
  /**
   * The pinned encounter (?enc=): "none" without one, "loading" while it is read on its own, "found" once it is in
   * `encounters`, "missing" when the relay doesn't have it (the console then shows the newest and says so).
   */
  pin: "none" | "loading" | "found" | "missing";
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

export function useAgentConsole(pinId: string | null = null): AgentConsoleData {
  const [recent, setEncounters] = useState<Encounter[]>([]);
  const [pinned, setPinned] = useState<Encounter | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
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
  const pinAsked = useRef(new Set<string>());
  const encounters = useMemo(() => withPinned(recent, pinned?.id === pinId ? pinned : null), [recent, pinned, pinId]);

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
      if (ev.type !== "delete" && ev.data?.id) setPinned((cur) => (cur?.id === ev.data.id ? { ...cur, ...ev.data } : cur));
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

  // A pinned encounter that isn't in the recent list (older, or the list was capped): one read of its own.
  const pinInList = !!pinId && recent.some((e) => e.id === pinId);
  useEffect(() => {
    if (!pinId || status !== "ready" || pinInList || pinAsked.current.has(pinId)) return;
    pinAsked.current.add(pinId);
    (base44.entities.Encounter.get(pinId) as Promise<Encounter>)
      .then((e) => {
        if (!alive.current) return;
        if (e?.id) setPinned(e);
        else setGone((cur) => new Set(cur).add(pinId));
      })
      .catch(() => { if (alive.current) setGone((cur) => new Set(cur).add(pinId)); });
  }, [pinId, status, pinInList]);
  const pin: AgentConsoleData["pin"] = !pinId ? "none"
    : encounters.some((e) => e.id === pinId) ? "found"
    : gone.has(pinId) || status === "error" ? "missing"
    : "loading";

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

  return { status, error, encounters, proposals, parties, lastEventAt, lastSyncAt, live, pin, reload: () => void load() };
}
