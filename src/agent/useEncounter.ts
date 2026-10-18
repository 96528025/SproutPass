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
// A dismissed encounter stays dismissed for this tab (sessionStorage), so leaving /world and coming back
// doesn't replay a meeting the parent already closed.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../app/api";
import { type Encounter, listEncountersFor } from "./cApi";

const ACTIVE_WINDOW_MS = 10 * 60_000;
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

function isActive(e: Encounter, nowMs: number): boolean {
  return e.status !== "no_match" || nowMs - Date.parse(e.startedAt) < 15_000; // show "no match" shrug for 15 s
}

function involves(e: Encounter, me: string): boolean {
  return e.aId === me || e.bId === me;
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

    const consider = (e: Encounter) => {
      if (!alive || !e || !involves(e, me) || dismissed.current.has(e.id)) return;
      const now = Date.now();
      if (now - Date.parse(e.startedAt) > ACTIVE_WINDOW_MS || !isActive(e, now)) {
        setEncounter((cur) => (cur?.id === e.id ? null : cur));
        return;
      }
      setEncounter((cur) => (!cur || cur.id === e.id || Date.parse(e.startedAt) > Date.parse(cur.startedAt) ? e : cur));
    };

    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;            // never stack polls when the backend is slow or rate limited
      inFlight = true;
      try {
        const list = await listEncountersFor(me);
        const now = Date.now();
        const best = list.find((e) => !dismissed.current.has(e.id) && now - Date.parse(e.startedAt) <= ACTIVE_WINDOW_MS && isActive(e, now));
        if (alive) setEncounter(best ?? null);
      } catch {
        /* offline: keep what we have */
      } finally {
        inFlight = false;
      }
    };
    refreshRef.current = () => { if (alive && visible()) void refresh(); };

    void refresh();
    const unsub = api.subscribe<Encounter>("Encounter", (ev) => {
      if (ev.type === "delete") return;
      consider(ev.data);
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
