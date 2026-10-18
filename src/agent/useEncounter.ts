// C: useEncounter — the active encounter for a parent, live.
// A's EncounterScene and B's TradeWindow both read this; C's AgentBubbles renders the transcript.
//
// Source of truth is the realtime `Encounter` subscription, through B's `api.subscribe`: live that is the SDK's
// websocket; in the mock it hears this tab's writes AND the other tabs' (BroadcastChannel), so the second phone
// sees the pets meet as soon as the walking phone does (not on the next poll, under the Trade window).
// iPhone Safari drops websockets when the screen dims, so we re-read the moment the page becomes visible
// again, plus a 10 s backstop poll while visible (never while hidden, never stacked, and not while `paused`,
// e.g. a trade is open: Base44's rate limit is shared by every tab and function).
// An encounter is "active" while it is talking/proposed and started within the last 10 minutes.
// Both matching and no-match meetings are shared with both people. A completed no-match
// result stays visible briefly, measured from the last transcript turn rather than the approach.
// A dismissed encounter stays dismissed for this tab (sessionStorage), so leaving /world and coming back
// doesn't replay a meeting the parent already closed.
// The selection is pure (encounterFor / nextEncounter / isActive) so vitest covers it without a DOM.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../app/api";
import { type Encounter, listEncountersFor } from "./cApi";

export const ACTIVE_WINDOW_MS = 10 * 60_000;
/** How long a "no_match" meeting (a fit the pet rules declined) keeps its shrug on screen. */
export const NO_MATCH_SHOW_MS = 15_000;
const POLL_MS = 10_000;
const SS_DISMISSED = "relay:enc:dismissed";
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SS_DISMISSED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveDismissed(ids: Set<string>) {
  try {
    sessionStorage.setItem(SS_DISMISSED, JSON.stringify([...ids].slice(-20)));
  } catch {
    /* private mode: this mount only */
  }
}

export interface EncounterState {
  encounter: Encounter | null;
  /** who the other parent is, from `me`'s point of view */
  peerId: string | null;
  /** "buyer" if my agent opened the conversation (lexically smaller id — same rule as the backend) */
  myRole: "buyer" | "seller" | null;
  /** clear the current encounter from the screen (e.g. after the Trade window closes) */
  dismiss: () => void;
}

export interface UseEncounterOptions {
  /** Stop the backstop poll (realtime keeps listening), e.g. while a trade is open. One re-read on resume. */
  paused?: boolean;
}

/**
 * Can this meeting be on screen at `nowMs`? Started within the last 10 min, something fit (hasMatch not false), and
 * not a "no_match" older than its 15 s shrug.
 */
export function isActive(e: Encounter, nowMs: number): boolean {
  const age = nowMs - Date.parse(e.startedAt);
  if (!(age >= -5_000 && age <= ACTIVE_WINDOW_MS)) return false; // tolerate small server/device clock skew
  const lastTurn = Math.max(Date.parse(e.startedAt), ...(e.transcript ?? []).map(t => Date.parse(t.at) || 0));
  return e.status !== "no_match" || nowMs - lastTurn < NO_MATCH_SHOW_MS;
}

function involves(e: Encounter, me: string): boolean {
  return e.aId === me || e.bId === me;
}

/** `e` may pop for `me`: theirs, not dismissed in this tab, and active. */
function showable(e: Encounter | null | undefined, me: string, dismissed: ReadonlySet<string>, nowMs: number): boolean {
  return !!e && involves(e, me) && !dismissed.has(e.id) && isActive(e, nowMs);
}

const newer = (a: Encounter, b: Encounter) => Date.parse(a.startedAt) > Date.parse(b.startedAt);

/** The refresh path: the newest showable meeting of `me` in `list` (any order), or null. */
export function encounterFor<E extends Encounter>(list: readonly E[], me: string, dismissed: ReadonlySet<string>, nowMs: number): E | null {
  let best: E | null = null;
  for (const e of list) if (showable(e, me, dismissed, nowMs) && (!best || newer(e, best))) best = e;
  return best;
}

/**
 * The realtime path: what is on screen after `incoming` arrives (a create or an update). A row that can't show any
 * more clears itself if it was the one on screen; otherwise the newer meeting wins and an update replaces its own row.
 */
export function nextEncounter<E extends Encounter>(
  cur: E | null, incoming: E, me: string, dismissed: ReadonlySet<string>, nowMs: number,
): E | null {
  if (!incoming || !involves(incoming, me)) return cur;
  if (!showable(incoming, me, dismissed, nowMs)) return cur?.id === incoming.id ? null : cur;
  if (cur?.id === incoming.id && cur.status !== "talking" && incoming.status === "talking") return cur;
  return !cur || cur.id === incoming.id || newer(incoming, cur) ? incoming : cur;
}

export function useEncounter(me: string | null | undefined, { paused = false }: UseEncounterOptions = {}): EncounterState {
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [dismissed] = useState(() => ({ current: readDismissed() }));
  const current = useRef<Encounter | null>(null);
  current.current = encounter;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    setEncounter(null); // another parent (or none): never show the previous parent's meeting
    if (!me) return;
    let alive = true;
    let revision = 0;

    const consider = (e: Encounter) => {
      if (!alive || !e) return;
      revision += 1;
      const now = Date.now();
      setEncounter((cur) => nextEncounter(cur, e, me, dismissed.current, now));
    };

    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;            // never stack polls when the backend is slow or rate limited
      inFlight = true;
      const startedRevision = revision;
      try {
        const list: Encounter[] = await listEncountersFor(me);
        if (alive && revision === startedRevision) setEncounter(cur => {
          const next = encounterFor(list, me, dismissed.current, Date.now());
          // A slow read must not roll a realtime result back to "talking".
          if (cur && next?.id === cur.id && cur.status !== "talking" && next.status === "talking") return cur;
          return next;
        });
      } catch {
        /* offline: keep what we have */
      } finally {
        inFlight = false;
      }
    };
    refreshRef.current = () => { if (alive && visible()) void refresh(); };

    void refresh();
    const unsub = api.subscribe<Encounter>("Encounter", (ev) => {
      if (ev.type === "delete") { revision += 1; setEncounter(cur => cur?.id === ev.id ? null : cur); return; }
      consider({ ...ev.data, id: ev.id });
    });
    const timer = setInterval(() => { if (visible() && !pausedRef.current) void refresh(); }, POLL_MS);
    const onVisible = () => { if (visible() && !pausedRef.current) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      alive = false;
      refreshRef.current = () => {};
      unsub();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [me]);

  // Back from a pause (the trade closed): one re-read instead of waiting for the next poll.
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (wasPaused.current && !paused) refreshRef.current();
    wasPaused.current = paused;
  }, [paused]);

  const peerId = encounter && me ? (encounter.aId === me ? encounter.bId : encounter.aId) : null;
  const myRole = encounter && me && peerId ? (me < peerId ? "buyer" : "seller") : null;
  const dismiss = useCallback(() => {
    const e = current.current;
    if (e) {
      dismissed.current.add(e.id);
      saveDismissed(dismissed.current);
    }
    setEncounter(null);
  }, []);
  return { encounter, peerId, myRole, dismiss };
}
