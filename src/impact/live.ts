// OWNER: B9. Small hooks shared by /impact and /log: reload on live entity changes (gently: Base44 rate-limits),
// big-screen mode for the projector, and pixel count-up numbers.
import { useEffect, useRef, useState } from "react";
import { api } from "../app/api";
import type { EntityName } from "../app/types";

/** Why a reload runs: the first load, the safety-net poll (or the tab coming back), and/or entities that changed. */
export interface ReloadWhy {
  initial: boolean;
  poll: boolean;
  changed: ReadonlySet<EntityName>;
}

export interface ReloaderOpts {
  /** Wait this long after the first change before reloading, so a burst of writes becomes one reload. */
  delayMs?: number;
  /** Never start two loads closer together than this (one encounter writes several rows). */
  minGapMs?: number;
  /** Called when a load finishes (even if it failed). */
  onDone?: () => void;
  now?: () => number;
}

/**
 * The scheduling behind useLiveReload, without React (tested on its own). The first change in a burst schedules one
 * load `delayMs` later (later still if the last load started under `minGapMs` ago); changes that arrive meanwhile
 * join that load instead of pushing it back, so a steady trickle of writes can't starve the screen either. Loads
 * never overlap: a change during a load is picked up by the next one.
 */
export function createReloader(load: (why: ReloadWhy) => Promise<unknown>, opts: ReloaderOpts = {}) {
  const { delayMs = 3_000, minGapMs = 5_000, onDone, now = Date.now } = opts;
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let lastStart = -Infinity;
  let pending: { poll: boolean; changed: Set<EntityName> } | null = null;

  const run = async (why: ReloadWhy) => {
    running = true;
    lastStart = now();
    try { await load(why); } catch { /* the screen shows its own error */ } finally {
      running = false;
      if (alive) { onDone?.(); if (pending) schedule(); }
    }
  };
  const schedule = () => {
    if (!alive || timer || running) return;
    const wait = Math.max(delayMs, lastStart + minGapMs - now());
    timer = setTimeout(() => {
      timer = undefined;
      if (!alive || running || !pending) return;
      const p = pending;
      pending = null;
      void run({ initial: false, poll: p.poll, changed: p.changed });
    }, wait);
  };

  return {
    /** Load now (the first load; a new `load` function). */
    start() { void run({ initial: true, poll: false, changed: new Set() }); },
    /** Something changed (`entity`), or it's time for the safety-net poll (no entity). */
    kick(entity?: EntityName) {
      pending ??= { poll: false, changed: new Set() };
      if (entity) pending.changed.add(entity); else pending.poll = true;
      schedule();
    },
    stop() { alive = false; clearTimeout(timer); timer = undefined; pending = null; },
  };
}

/**
 * Calls `load` now (and whenever `load` itself changes), again whenever one of `entities` changes in this tab or
 * another (batched: see createReloader), and every `pollMs` while the page is visible (a safety net if realtime
 * drops). Returns when the last load finished.
 */
export function useLiveReload(
  load: (why: ReloadWhy) => Promise<unknown>,
  entities: readonly EntityName[],
  { pollMs = 30_000, delayMs = 3_000, minGapMs = 5_000 }: { pollMs?: number; delayMs?: number; minGapMs?: number } = {},
): number | null {
  const [at, setAt] = useState<number | null>(null);
  const key = entities.join(",");

  useEffect(() => {
    const r = createReloader(load, { delayMs, minGapMs, onDone: () => setAt(Date.now()) });
    r.start();
    const offs = (key ? key.split(",") : []).map((entity) => {
      try { return api.subscribe(entity as EntityName, () => r.kick(entity as EntityName)); } catch { return () => {}; }
    });
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const poll = setInterval(() => { if (visible()) r.kick(); }, pollMs);
    const onVisible = () => { if (visible()) r.kick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      r.stop();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      offs.forEach((off) => off());
    };
  }, [load, key, pollMs, delayMs, minGapMs]); // `load` should be a useCallback: a new one reloads now
  return at;
}

// ---------------------------------------------------------------- big screen

const BIG_QUERY = "(min-width: 1024px)";
const wideNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(BIG_QUERY).matches;

/** True while the window is at least 1024 px wide (a laptop or a projector), live. */
export function useWideWindow(): boolean {
  const [wide, setWide] = useState(wideNow);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(BIG_QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

/**
 * Big screen (a full-window layer over the handheld frame) on wide windows, the handheld frame otherwise, like the
 * agent console. ?view=big or ?view=phone wins; after that the viewer's last choice on this device is remembered.
 */
export function useBigScreen(storageKey: string): [boolean, (big: boolean) => void] {
  const [big, setBigState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search).get("view");
    if (q === "big" || q === "phone") return q === "big";
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "big" || saved === "phone") return saved === "big";
    } catch { /* storage blocked */ }
    return wideNow();
  });
  const setBig = (v: boolean) => {
    setBigState(v);
    try { localStorage.setItem(storageKey, v ? "big" : "phone"); } catch { /* storage blocked */ }
  };
  return [big, setBig];
}

// ---------------------------------------------------------------- numbers

/**
 * Time to list (/log): big number + small unit in friendly steps, readable on a projector: <1 MIN · 12 MIN ·
 * 5 HOURS · 2 DAYS. Never a bare "0 SEC": on the demo clock the nudge and the listing share a timestamp, which is
 * "under a minute", not broken.
 */
export function duration(sec: number): { value: string; unit: string; words: string } {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  if (s < 60) return { value: "<1", unit: "MIN", words: "under a minute" };
  if (s < 3600) { const m = Math.floor(s / 60); return { value: String(m), unit: "MIN", words: n(m, "minute") }; }
  if (s < 86400) { const h = Math.floor(s / 3600); return { value: String(h), unit: h === 1 ? "HOUR" : "HOURS", words: n(h, "hour") }; }
  const d = Math.floor(s / 86400);
  return { value: String(d), unit: d === 1 ? "DAY" : "DAYS", words: n(d, "day") };
}

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The number on screen climbs to `target` in stepped frames (about 12 a second, like the sprites), from 0 the
 * first time and from the previous value after that. Reduced motion: it just shows the target.
 */
export function useCountUp(target: number, ms = 1200): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (reducedMotion()) { from.current = target; setShown(target); return; }
    const start = from.current;
    if (start === target) { setShown(target); return; }
    const steps = Math.max(1, Math.round(ms / 83));
    let i = 0;
    const id = setInterval(() => {
      i++;
      const p = i / steps;
      const eased = 1 - (1 - p) ** 3;
      const v = i >= steps ? target : start + (target - start) * eased;
      from.current = v;
      setShown(v);
      if (i >= steps) clearInterval(id);
    }, 83);
    return () => clearInterval(id);
  }, [target, ms]);
  return shown;
}

/** After the first value, how much `value` just went up by (shown for a moment as "+N"), else 0. */
export function useBump(value: number | undefined, holdMs = 2400): number {
  const prev = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (value == null) return;
    const before = prev.current;
    prev.current = value;
    if (before == null || value <= before) return;
    setBump(value - before);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBump(0), holdMs);
  }, [value, holdMs]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return bump;
}
