// A1 owns this player; A2 owns the wav files in public/sfx/<name>.wav.
import { useEffect, useState } from "react";

export type SfxName =
  | "start"
  | "blip"
  | "alert"
  | "select"
  | "accept"
  | "decline"
  | "coin"
  | "jingle"
  | "step";

const STORAGE_KEY = "relay.muted";
const BLIP_MIN_GAP_MS = 66; // ~15/s max; the typewriter spams it

let ctx: AudioContext | null = null;
let unlocked = false;
let muted = readMuted();
const buffers = new Map<SfxName, Promise<AudioBuffer | null>>();
const listeners = new Set<() => void>();
let lastBlipAt = 0;

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  listeners.forEach((cb) => cb());
}

async function load(name: SfxName): Promise<AudioBuffer | null> {
  if (!ctx) return null;
  const existing = buffers.get(name);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(`/sfx/${name}.wav`);
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      return await ctx!.decodeAudioData(bytes);
    } catch {
      return null; // missing file = silent, never throws
    }
  })();
  buffers.set(name, p);
  return p;
}

export const sfx = {
  /** Call on the first user gesture (title tap). Safe to call again. */
  async unlock(): Promise<void> {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    try {
      if (ctx.state !== "running") await ctx.resume();
      // iOS: play a silent buffer inside the gesture to fully unlock
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      unlocked = true;
      notify();
      // warm the cache
      (["blip", "select", "start"] as SfxName[]).forEach((n) => void load(n));
    } catch {
      /* stay locked; play() stays a no-op */
    }
  },

  play(name: SfxName, opts?: { volume?: number }): void {
    if (!unlocked || muted || !ctx) return;
    if (name === "blip") {
      const now = performance.now();
      if (now - lastBlipAt < BLIP_MIN_GAP_MS) return;
      lastBlipAt = now;
    }
    void load(name).then((buf) => {
      if (!buf || !ctx) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = opts?.volume ?? 1;
        src.connect(gain).connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
    });
  },

  setMuted(b: boolean): void {
    muted = b;
    try {
      localStorage.setItem(STORAGE_KEY, b ? "1" : "0");
    } catch {
      /* ignore */
    }
    notify();
  },

  isMuted(): boolean {
    return muted;
  },

  isUnlocked(): boolean {
    return unlocked;
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
  });
}

export function useSfx(): { muted: boolean; unlocked: boolean; toggle(): void } {
  const [, force] = useState(0);
  useEffect(() => sfx.subscribe(() => force((n) => n + 1)), []);
  return {
    muted: sfx.isMuted(),
    unlocked: sfx.isUnlocked(),
    toggle: () => sfx.setMuted(!sfx.isMuted()),
  };
}
