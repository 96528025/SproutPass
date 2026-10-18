// A4: ?demo=1 only. "WALK TOWARD …" calls C's demoWalk (B's api → base44/functions/demoWalk) every 2.5 s, which
// moves this parent's SIMULATED presence 20 m toward the target and runs the same encounter check as updatePresence.
//   - every step continues from the saved position; switching targets or resuming never resets the walker.
//   - the walk ends when the encounter shows up (or the target is <= 25 m away): the parent has "arrived";
//   - matching and no-match meetings both stop the walk and show the shared conversation.
//     A pair still in its cooldown ends with a short note instead.
//   - after arriving, a slow hold tick (every 4 s, 1 m) keeps C's local fallback ticking (it resolves a meeting
//     still "talking" after 8 s) and the simulated presence fresh, instead of updatePresence (`owns` = true: useGps
//     pauses its heartbeat). It stops as soon as the encounter is resolved (proposed / no_match), or after 30 s at
//     most, or while `paused` (a trade is open): the walk is then "done" and useGps' 10 s keepalive takes over
//     (C keeps a simulated presence where the walk left it, so that never pulls the walker back);
//   - one request at a time (the next is scheduled when the last answers), nothing while the tab is hidden,
//     failures back off up to 15 s.
// The target is a seed key ("mina"); its real Parent id is resolved once per tab: from the radar when that parent
// is on it (same name), else one getCloset({ parentKey }) (demo only, only the id is kept), cached in
// sessionStorage. (A demoWalk that took the target's seed key would make that fallback unnecessary: NEEDS.)
// Tap-to-meet (`meet(key)`, a tap on a family on /world?demo=1): the caller picks that family as the walk target
// (WALK TO) and the walk's first tick becomes ONE demoWalk({ arrive: true }), which puts this parent's simulated
// presence 10 m from them and runs the same meeting check. Its answer goes through walkStep like a walk step:
// arrive → the usual hold ticks; a pair still in its cooldown → done + the Toast. (An answer still > 25 m out, e.g.
// a backend that doesn't know `arrive` yet, just walks on.) One tap at a time: a meet runs as a walk, so the next tap
// waits until it is answered; a failed arrive call is tried once more (with the walk's backoff), then the tap is
// dropped quietly and the walk is back where it was.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/app/api";
import type { DemoPosition, DemoWalkReq, EncounterStart, NearbyParent, PairCooldown } from "@/app/types";
import { seedName } from "@/world/people";

export type WalkPhase = "idle" | "walking" | "arrived" | "done";

const WALK_MS = 2500;
const WALK_STEP_M = 20;
const HOLD_MS = 4000;
const HOLD_STEP_M = 1;
const HOLD_MAX_MS = 30_000;
const ARRIVED_M = 25;
const MAX_BACKOFF_MS = 15_000;
const IDS_KEY = "relay:world:parentIds";
let noteSeq = 0;

// ---- seed key → real Parent id, cached per tab --------------------------------------------------------------------

function readIds(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(IDS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
const ids: Record<string, string> = typeof window === "undefined" ? {} : readIds();
function remember(key: string, id: string | null) {
  if (id) ids[key] = id;
  else delete ids[key];
  try {
    sessionStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch {
    /* private mode: memory only */
  }
}

/** The seed key → real Parent id pairs this tab has resolved (demoFamilies tells the radar's demo families apart). */
export function knownParentIds(): Readonly<Record<string, string>> {
  return ids;
}

const resolving = new Map<string, Promise<string>>();
async function resolveParentId(key: string, nearby: NearbyParent[]): Promise<string> {
  if (ids[key]) return ids[key];
  const onRadar = nearby.find((p) => p.name === seedName(key));
  if (onRadar) {
    remember(key, onRadar.parentId);
    return onRadar.parentId;
  }
  let p = resolving.get(key);
  if (!p) {
    p = api
      .getCloset({ parentKey: key })
      .then((c) => {
        remember(key, c.parent.id);
        return c.parent.id;
      })
      .finally(() => resolving.delete(key));
    resolving.set(key, p);
  }
  return p;
}

// ---- what a walk tick's answer means (pure) -----------------------------------------------------------------------

/** The part of demoWalk's answer the walk reads (DemoWalkRes). */
export interface WalkTick {
  distanceM?: number;
  encounters?: readonly Pick<EncounterStart, "peerId" | "hasMatch">[];
  cooldown?: readonly PairCooldown[];
}

/** Why a walk ended with no scene: shown on /world as a Toast (UI copy, so a name is fine; never in agent lines). */
export type WalkNote =
  | { kind: "no_fit"; peerId: string; name: string | null }
  | { kind: "cooldown"; peerId: string; name: string | null; retryInS: number };

export interface WalkStep {
  /** walk on / arrive (start the hold) / keep holding / the walk is over */
  next: "walk" | "arrive" | "hold" | "done";
  note?: { kind: "no_fit"; peerId: string } | { kind: "cooldown"; peerId: string; retryInS: number };
}

/**
 * One tick's answer → the walk's next phase. `phase`: the tick was a walk step or an after-arrival hold tick.
 * A meeting that fits (or might: hasMatch undefined) arrives as before: the scene pops through useEncounter. When
 * every meeting this tick started has nothing that fits, the walk ends with a note (it goes on when that was only
 * someone passed on the way); at the target (<= 25 m) a pair cooldown ends it with a note too. The target's entry
 * wins when there are several.
 */
export function walkStep(res: WalkTick, phase: "walking" | "arrived", targetId: string | null): WalkStep {
  const encounters = res.encounters ?? [];
  const arrived = typeof res.distanceM === "number" && res.distanceM <= ARRIVED_M;
  const ofTarget = <T extends { peerId: string }>(list: readonly T[]) => list.find((x) => x.peerId === targetId) ?? list[0];
  // Both outcomes get the same meeting on both screens; no-match is a result,
  // not a reason to hide the encounter or stop its negotiation ticks.
  if (encounters.length) return { next: phase === "walking" ? "arrive" : "hold" };
  const cooldown = res.cooldown ?? [];
  if (arrived && cooldown.length) {
    const c = ofTarget(cooldown);
    return { next: "done", note: { kind: "cooldown", peerId: c.peerId, retryInS: c.retryInS } };
  }
  if (phase === "walking") return { next: arrived ? "arrive" : "walk" };
  return { next: "hold" };
}

/** One tick's demoWalk request: a tap's single arrive call (meet), a 20 m walk step, or a 1 m hold tick. */
export function walkRequest(parentId: string, targetParentId: string, kind: "meet" | "walk" | "hold"): DemoWalkReq {
  if (kind === "meet") return { parentId, targetParentId, arrive: true };
  return { parentId, targetParentId, stepM: kind === "walk" ? WALK_STEP_M : HOLD_STEP_M };
}

/** What /world knows when a family is tapped (?demo=1). */
export interface MeetGate {
  demo: boolean;
  /** My real Parent id (null while the closet loads). */
  meId: string | null;
  /** A meeting is on screen (the EncounterScene is up). */
  encounterUp: boolean;
  /** A walk is running, or a tap's arrive call is in flight (DemoWalk.active). */
  walking: boolean;
  /** A trade of mine is open, just paid or celebrating: /world is quiet. */
  paused: boolean;
}

/**
 * The families can be tapped to meet them: demo only, never on top of a meeting, a walk (or a tap still in flight)
 * or a live trade: the walk button's own conditions, plus "not walking". Otherwise the sprites aren't buttons.
 */
export function canMeet(g: MeetGate): boolean {
  return g.demo && !!g.meId && !g.encounterUp && !g.walking && !g.paused;
}

/** Seconds → "1:20" from a minute up, "45 s" below. */
export function waitLabel(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

/** The Toast line for a walk that ended with no scene. */
export function walkNoteText(note: WalkNote): string {
  const who = note.name ?? "another family";
  return note.kind === "no_fit"
    ? `You met ${who}. Nothing on either list fits right now.`
    : `You met ${who} a moment ago. Your pets can meet again in ${waitLabel(note.retryInS)}.`;
}

/** A peer's name for the note: the walk's target, another seed family this tab resolved, else the radar's entry. */
function nameOf(peerId: string, targetKey: string, targetId: string, nearby: NearbyParent[]): string | null {
  if (peerId === targetId) return seedName(targetKey);
  const key = Object.keys(ids).find((k) => ids[k] === peerId);
  if (key) return seedName(key);
  return nearby.find((p) => p.parentId === peerId)?.name ?? null;
}

// ---- the hook --------------------------------------------------------------------------------------------------------

export interface DemoWalk {
  /** idle → walking → arrived (hold ticks) → done (the walk is over; WALK AGAIN starts a new one). */
  phase: WalkPhase;
  /** Walking right now (the button reads "WALKING… 80 M"). */
  active: boolean;
  /** The walk drives this parent's simulated position (walking, or holding after arrival): useGps must not send. */
  owns: boolean;
  /** Target's real id once resolved (to find it on the radar). */
  targetId: string | null;
  /** Last distance to the target reported by demoWalk, metres. */
  distanceM: number | null;
  position: DemoPosition | null;
  bearingDeg: number | null;
  /** Why the last walk ended with no scene (nothing fits / they met a moment ago); `seq` changes per note. */
  note: (WalkNote & { seq: number }) | null;
  clearNote: () => void;
  start: () => void;
  stop: () => void;
  /**
   * Tap-to-meet: walk straight to `key` (a seed family) in ONE arrive call. The caller picks `key` as the walk target
   * in the same handler (WALK TO); the call goes out once the hook has that target. Ignored while a walk (or another
   * tap) is running.
   */
  meet: (key: string) => void;
}

export interface DemoWalkOptions {
  enabled: boolean;
  /** Status of my current (unsettled) encounter, or null. Its arrival ends the walk; its resolution ends the hold. */
  encounter: "talking" | "proposed" | "no_match" | null;
  /** No hold ticks (a trade is open / celebrating). A walk the parent started still finishes its few steps. */
  paused: boolean;
  /** The radar's latest list (read when resolving the target's id). */
  nearby: { readonly current: NearbyParent[] };
}

export function useDemoWalk(parentId: string | null, targetKey: string, { enabled, encounter, paused, nearby }: DemoWalkOptions): DemoWalk {
  const [state, setState] = useState<WalkPhase>("idle");
  const [targetId, setTargetId] = useState<string | null>(() => ids[targetKey] ?? null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [location, setLocation] = useState<{ parentId: string; position: DemoPosition } | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [note, setNote] = useState<(WalkNote & { seq: number }) | null>(null);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const inFlight = useRef(false);
  const arrivedAt = useRef(0);
  // A tap waiting for (or in) its arrive call: the family, the phase to fall back to if it fails, one retry spent.
  const meetRef = useRef<{ key: string; from: WalkPhase; retried: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const targetRef = useRef(targetKey);
  targetRef.current = targetKey;

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // A new parent / target / leaving demo mode: start over. A tap that just picked this family (meet) starts right
  // away instead: its arrive call is the walk's first tick.
  useEffect(() => {
    const m = meetRef.current;
    const meeting = enabled && !!parentId && m?.key === targetKey;
    meetRef.current = meeting && m ? { ...m, from: "idle" } : null;
    setState(meeting ? "walking" : "idle");
    setDistanceM(null);
    setBearing(null);
    setNote(null);
    setTargetId(ids[targetKey] ?? null);
  }, [parentId, targetKey, enabled]);

  // The encounter showed up: this walk is over. Once it is resolved, so is the hold.
  useEffect(() => {
    if (!encounter) return;
    if (state === "walking") {
      arrivedAt.current = Date.now();
      setState("arrived");
    } else if (state === "arrived" && encounter !== "talking") {
      setState("done");
    }
  }, [encounter, state]);

  // The hold never outlives HOLD_MAX_MS (no meeting came, the agents went quiet, a trade opened meanwhile, ...).
  useEffect(() => {
    if (state !== "arrived") return;
    const t = window.setTimeout(() => setState((s) => (s === "arrived" ? "done" : s)), Math.max(0, arrivedAt.current + HOLD_MAX_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [state]);

  const ticking = state === "walking" || (state === "arrived" && !paused);
  useEffect(() => {
    if (!enabled || !parentId || !visible || !ticking) return;
    let alive = true;
    let timer: number | undefined;
    const walking = state === "walking";
    const base = walking ? WALK_MS : HOLD_MS;
    let wait = base;
    const tick = async () => {
      if (inFlight.current) {
        timer = window.setTimeout(tick, base);
        return;
      }
      inFlight.current = true;
      // A tap on this family (meet): this tick is its one arrive call, read below exactly like a walk step.
      const m = walking && meetRef.current?.key === targetKey ? meetRef.current : null;
      try {
        const target = await resolveParentId(targetKey, nearby.current);
        if (!alive) return; // a tap not sent yet stays pending for the next run
        setTargetId(target);
        const res = await api.demoWalk(walkRequest(parentId, target, m ? "meet" : walking ? "walk" : "hold"));
        // Answered: the tap is spent, and the position is mine whatever happened meanwhile (a meeting that popped
        // through realtime before this answer already moved the walk on to its hold).
        if (m && meetRef.current === m) meetRef.current = null;
        if (res.position) setLocation({ parentId, position: res.position });
        if (!alive) return;
        if (typeof res.bearingDeg === "number") setBearing(res.bearingDeg);
        wait = base;
        if (typeof res?.distanceM === "number") setDistanceM(res.distanceM);
        const step = walkStep(res ?? {}, walking ? "walking" : "arrived", target);
        if (step.note) setNote({ ...step.note, name: nameOf(step.note.peerId, targetKey, target, nearby.current), seq: ++noteSeq });
        if (step.next === "arrive") {
          arrivedAt.current = Date.now();
          setState("arrived");
          return; // the hold loop takes over (its first tick comes HOLD_MS later)
        }
        if (step.next === "done") {
          setState("done"); // nothing will pop: no hold ticks, useGps' keepalive takes over
          return;
        }
      } catch (e) {
        // a stale cached id (re-seeded db) → resolve it again next time
        if (e instanceof ApiError && e.code === "not_found") {
          remember(targetKey, null);
          setTargetId(null);
        }
        // A tap is one call: tried once more (a stale id is resolved afresh first), then dropped where it started.
        if (m && meetRef.current === m) {
          if (m.retried) {
            meetRef.current = null;
            if (alive) setState(m.from);
            return;
          }
          m.retried = true;
        }
        wait = Math.min(MAX_BACKOFF_MS, wait * 2);
      } finally {
        inFlight.current = false;
      }
      if (alive) timer = window.setTimeout(tick, wait);
    };
    // A walk steps at once; the hold waits a beat first.
    timer = window.setTimeout(tick, walking ? 0 : HOLD_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabled, parentId, targetKey, visible, state, ticking, nearby]);

  const start = useCallback(() => {
    meetRef.current = null;
    setNote(null);
    setState("walking");
  }, []);
  const stop = useCallback(() => {
    meetRef.current = null;
    setState("idle");
  }, []);
  const clearNote = useCallback(() => setNote(null), []);
  const meet = useCallback(
    (key: string) => {
      if (!enabled || !parentId || stateRef.current === "walking") return; // one at a time: a walk / tap is running
      meetRef.current = { key, from: stateRef.current, retried: false };
      setNote(null);
      // Already the target: go now. Otherwise the caller's pick changes the target and the reset above starts it.
      if (key === targetRef.current) setState("walking");
    },
    [enabled, parentId],
  );

  const phase: WalkPhase = enabled ? state : "idle";
  return {
    phase,
    active: phase === "walking",
    owns: phase === "walking" || phase === "arrived",
    targetId,
    distanceM,
    position: location?.parentId === parentId ? location.position : null,
    bearingDeg: bearing,
    note: enabled ? note : null,
    clearNote,
    start,
    stop,
    meet,
  };
}
