// Which meeting pops on /world (useEncounter's pure selection): a meeting where nothing fits either way never pops;
// an older row without the flag still does; dismissed meetings stay closed; the pet-rules shrug lasts 15 s.
import { describe, expect, it, vi } from "vitest";

// The hook's module talks to B's api / C's client; the selection under test never does (no DOM, no network here).
vi.mock("../app/api", () => ({ api: { subscribe: () => () => {} } }));
vi.mock("./cApi", () => ({ listEncountersFor: async () => [] }));

import type { Encounter } from "./cApi";
import { ACTIVE_WINDOW_MS, NO_MATCH_SHOW_MS, encounterFor, isActive, nextEncounter } from "./useEncounter";

const NOW = Date.parse("2026-10-18T17:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const none: ReadonlySet<string> = new Set();

function enc(id: string, over: Partial<Encounter> = {}): Encounter {
  return {
    id, aId: "p_jo", bId: "p_mina", band: "<25m", simulated: true, status: "talking", startedAt: ago(5_000), transcript: [],
    ...over,
  };
}

describe("isActive", () => {
  it("shows both matching and no-fit meetings", () => {
    expect(isActive(enc("a", { hasMatch: false }), NOW)).toBe(true);
    expect(isActive(enc("a", { hasMatch: true }), NOW)).toBe(true);
    expect(isActive(enc("a"), NOW)).toBe(true);
  });

  it("keeps the no_match shrug (a fit the pet rules declined) for 15 s, then lets it go", () => {
    expect(isActive(enc("a", { hasMatch: true, status: "no_match", startedAt: ago(NO_MATCH_SHOW_MS - 1) }), NOW)).toBe(true);
    expect(isActive(enc("a", { hasMatch: true, status: "no_match", startedAt: ago(NO_MATCH_SHOW_MS) }), NOW)).toBe(false);
    expect(isActive(enc("a", { status: "no_match", startedAt: ago(3_000) }), NOW)).toBe(true);
    expect(isActive(enc("a", { hasMatch: false, status: "no_match", startedAt: ago(3_000) }), NOW)).toBe(true);
  });

  it("only meetings from the last 10 minutes (a proposed one too)", () => {
    expect(isActive(enc("a", { status: "proposed", startedAt: ago(ACTIVE_WINDOW_MS) }), NOW)).toBe(true);
    expect(isActive(enc("a", { status: "proposed", startedAt: ago(ACTIVE_WINDOW_MS + 1_000) }), NOW)).toBe(false);
    expect(isActive(enc("a", { startedAt: "not a date" }), NOW)).toBe(false);
    expect(isActive(enc("a", { startedAt: new Date(NOW + 500).toISOString() }), NOW)).toBe(true);
  });
});

describe("encounterFor (the refresh path)", () => {
  it("shows the newest meeting even when it has no match", () => {
    const list = [enc("new", { hasMatch: false, startedAt: ago(1_000) }), enc("old", { hasMatch: true, startedAt: ago(60_000) })];
    expect(encounterFor(list, "p_jo", none, NOW)?.id).toBe("new");
    expect(encounterFor([list[0]], "p_jo", none, NOW)?.id).toBe("new");
  });

  it("shows a meeting without the flag (schema not pushed yet), as today", () => {
    expect(encounterFor([enc("a")], "p_mina", none, NOW)?.id).toBe("a");
  });

  it("never brings back a meeting this tab dismissed", () => {
    const list = [enc("a", { startedAt: ago(1_000) }), enc("b", { startedAt: ago(2_000) })];
    expect(encounterFor(list, "p_jo", new Set(["a"]), NOW)?.id).toBe("b");
    expect(encounterFor(list, "p_jo", new Set(["a", "b"]), NOW)).toBeNull();
  });

  it("the newest showable meeting wins, whatever order the list comes in", () => {
    const list = [enc("old", { startedAt: ago(90_000) }), enc("newest", { startedAt: ago(1_000) }), enc("mid", { startedAt: ago(30_000) })];
    expect(encounterFor(list, "p_jo", none, NOW)?.id).toBe("newest");
  });

  it("only my meetings, and only inside the 10 minute window", () => {
    expect(encounterFor([enc("a", { aId: "p_sam", bId: "p_mina" })], "p_jo", none, NOW)).toBeNull();
    expect(encounterFor([enc("a", { startedAt: ago(ACTIVE_WINDOW_MS + 1) })], "p_jo", none, NOW)).toBeNull();
    expect(encounterFor([enc("a", { startedAt: ago(ACTIVE_WINDOW_MS - 1) })], "p_jo", none, NOW)?.id).toBe("a");
  });

  it("drops a no_match shrug after 15 s", () => {
    const shrug = enc("a", { hasMatch: true, status: "no_match", startedAt: ago(20_000) });
    expect(encounterFor([shrug], "p_jo", none, NOW)).toBeNull();
  });
});

describe("nextEncounter (the realtime path)", () => {
  it("a no-fit meeting appears for both people without a second approach", () => {
    const up = enc("up", { hasMatch: true, startedAt: ago(20_000) });
    const noFit = enc("nofit", { hasMatch: false, startedAt: ago(1_000), aId: "p_sam", bId: "p_jo" });
    expect(nextEncounter(up, noFit, "p_jo", none, NOW)).toBe(noFit);
    expect(nextEncounter(null, noFit, "p_jo", none, NOW)).toBe(noFit);
    expect(nextEncounter(null, noFit, "p_sam", none, NOW)).toBe(noFit);
  });

  it("a newer meeting that fits takes over; an update replaces its own row", () => {
    const up = enc("up", { startedAt: ago(20_000) });
    const fresh = enc("fresh", { hasMatch: true, startedAt: ago(1_000) });
    expect(nextEncounter(up, fresh, "p_jo", none, NOW)).toBe(fresh);
    const updated = { ...up, status: "proposed" as const };
    expect(nextEncounter(up, updated, "p_jo", none, NOW)).toBe(updated);
    expect(nextEncounter(updated, up, "p_jo", none, NOW)).toBe(updated);
    expect(nextEncounter(fresh, up, "p_jo", none, NOW)).toBe(fresh); // an older row never steals the screen
  });

  it("a row that can't show any more clears itself, and leaves another meeting alone", () => {
    const up = enc("up", { status: "no_match", startedAt: ago(20_000) });
    expect(nextEncounter(up, up, "p_jo", none, NOW)).toBeNull();
    const other = enc("other", { startedAt: ago(5_000) });
    expect(nextEncounter(other, up, "p_jo", none, NOW)).toBe(other);
  });

  it("ignores other parents' meetings and dismissed ones", () => {
    const up = enc("up");
    expect(nextEncounter(up, enc("x", { aId: "p_sam", bId: "p_mina", startedAt: ago(1) }), "p_jo", none, NOW)).toBe(up);
    expect(nextEncounter(null, enc("d"), "p_jo", new Set(["d"]), NOW)).toBeNull();
  });
});
