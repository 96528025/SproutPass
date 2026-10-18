// C: useEncounter — the active encounter for a parent, live.
// A's EncounterScene and B's TradeWindow both read this; C's AgentBubbles renders the transcript.
//
// Source of truth is the realtime `Encounter` subscription. iPhone Safari drops websockets when the
// screen dims, so we re-read the moment the page becomes visible again, plus a 6 s backstop poll while
// visible (never while hidden: Base44's rate limit is shared by every tab and function).
// An encounter is "active" while it is talking/proposed and started within the last 10 minutes.

import { useEffect, useRef, useState } from "react";
import { type Encounter, listEncountersFor, subscribe } from "./cApi";

const ACTIVE_WINDOW_MS = 10 * 60_000;
const POLL_MS = 6_000;
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export interface EncounterState {
  encounter: Encounter | null;
  /** who the other parent is, from `me`'s point of view */
  peerId: string | null;
  /** "buyer" if my agent opened the conversation (lexically smaller id — same rule as the backend) */
  myRole: "buyer" | "seller" | null;
  /** clear the current encounter from the screen (e.g. after the Trade window closes) */
  dismiss: () => void;
}

function isActive(e: Encounter, nowMs: number): boolean {
  return e.status !== "no_match" || nowMs - Date.parse(e.startedAt) < 15_000; // show "no match" shrug for 15 s
}

function involves(e: Encounter, me: string): boolean {
  return e.aId === me || e.bId === me;
}

export function useEncounter(me: string | null | undefined): EncounterState {
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!me) return;
    let alive = true;

    const consider = (e: Encounter) => {
      if (!alive || !involves(e, me) || dismissed.current.has(e.id)) return;
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

    void refresh();
    const unsub = subscribe<Encounter>("Encounter", (ev) => {
      if (ev.type === "delete") return;
      consider(ev.data);
    });
    const timer = setInterval(() => { if (visible()) void refresh(); }, POLL_MS);
    const onVisible = () => { if (visible()) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      alive = false;
      unsub();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [me]);

  const peerId = encounter && me ? (encounter.aId === me ? encounter.bId : encounter.aId) : null;
  const myRole = encounter && me && peerId ? (me < peerId ? "buyer" : "seller") : null;
  const dismiss = () => {
    if (encounter) dismissed.current.add(encounter.id);
    setEncounter(null);
  };
  return { encounter, peerId, myRole, dismiss };
}
