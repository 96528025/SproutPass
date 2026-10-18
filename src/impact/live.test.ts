// B9: /log and /impact reload gently (Base44 rate-limits): bursts of writes become one load, loads stay at least
// minGapMs apart, never overlap, and say what changed (so /log can skip getImpact when nothing priced moved).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReloader, duration, type ReloadWhy } from "./live";

describe("createReloader", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(opts: { delayMs?: number; minGapMs?: number; loadMs?: number } = {}) {
    const calls: { at: number; why: ReloadWhy }[] = [];
    const load = vi.fn(async (why: ReloadWhy) => {
      calls.push({ at: Date.now(), why: { ...why, changed: new Set(why.changed) } });
      if (opts.loadMs) await new Promise((r) => setTimeout(r, opts.loadMs));
    });
    const r = createReloader(load, { delayMs: opts.delayMs ?? 3000, minGapMs: opts.minGapMs ?? 5000 });
    return { r, calls, load };
  }

  it("loads once at start, then turns a burst of changes into one load that lists them", async () => {
    const { r, calls } = setup();
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].why).toMatchObject({ initial: true, poll: false });

    // One encounter: several Encounter / MatchProposal writes within a second.
    await vi.advanceTimersByTimeAsync(6000);
    for (const e of ["Encounter", "Encounter", "MatchProposal", "Encounter"] as const) {
      r.kick(e);
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    expect([...calls[1].why.changed].sort()).toEqual(["Encounter", "MatchProposal"]);
    expect(calls[1].why).toMatchObject({ initial: false, poll: false });
    r.stop();
  });

  it("keeps loads at least minGapMs apart, even under a steady trickle of writes, and doesn't starve", async () => {
    const { r, calls } = setup({ delayMs: 3000, minGapMs: 5000 });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let t = 0; t < 30_000; t += 500) {
      r.kick("Encounter");
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
    expect(gaps.every((g) => g >= 5000)).toBe(true);
    // ~30 s of writes: about one load every 5 s, not 60 loads, and not zero either.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls.length).toBeLessThanOrEqual(8);
    r.stop();
  });

  it("never overlaps loads: a change during a slow load waits for it, then loads once", async () => {
    const { r, calls } = setup({ delayMs: 100, minGapMs: 100, loadMs: 2000 });
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    r.kick("Listing");
    r.kick("MatchProposal");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1); // still in the first load
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    expect([...calls[1].why.changed].sort()).toEqual(["Listing", "MatchProposal"]);
    r.stop();
  });

  it("marks the safety-net poll, and stop() cancels anything scheduled", async () => {
    const { r, calls } = setup();
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    r.kick();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls[1].why).toMatchObject({ initial: false, poll: true });
    expect(calls[1].why.changed.size).toBe(0);
    r.kick("Need");
    r.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(2);
  });

  it("a load that throws doesn't break later loads", async () => {
    let n = 0;
    const load = vi.fn(async () => { n++; if (n === 1) throw new Error("429"); });
    const r = createReloader(load, { delayMs: 10, minGapMs: 10 });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    r.kick("Listing");
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    r.stop();
  });
});

describe("duration (time to list on /log)", () => {
  it("reads in friendly steps and never shows a bare 0 SEC", () => {
    expect(duration(0)).toMatchObject({ value: "<1", unit: "MIN", words: "under a minute" });
    expect(duration(42.5)).toMatchObject({ value: "<1", unit: "MIN" });
    expect(duration(60)).toMatchObject({ value: "1", unit: "MIN", words: "1 minute" });
    expect(duration(754)).toMatchObject({ value: "12", unit: "MIN" });
    expect(duration(3600)).toMatchObject({ value: "1", unit: "HOUR" });
    expect(duration(5 * 3600 + 59)).toMatchObject({ value: "5", unit: "HOURS", words: "5 hours" });
    expect(duration(86400)).toMatchObject({ value: "1", unit: "DAY" });
    expect(duration(2.5 * 86400)).toMatchObject({ value: "2", unit: "DAYS", words: "2 days" });
    expect(duration(Number.NaN)).toMatchObject({ value: "<1" });
  });
});
