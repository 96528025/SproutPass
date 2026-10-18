// Pure trade-screen helpers: the other party's name loader and "is this proposal gone?" detection.
import { describe, expect, it, vi } from "vitest";
import type { MatchProposal } from "../app/types";
import { confirmedGone, createPartyLoader, missingLive, slimParty, type Party } from "./tradeLogic";

const jo: Party = { id: "p_jo", name: "Jo", avatar: { sprite: "parent_b", palette: "mint" }, pet: { sprite: "pet_b", name: "Pip" } };
const noSleep = () => Promise.resolve();
const rateLimited = () => Object.assign(new Error("Rate limit exceeded"), { code: "internal" });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("createPartyLoader", () => {
  it("retries a rate-limited fetch until it succeeds", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(rateLimited()).mockRejectedValueOnce(rateLimited()).mockResolvedValue(jo);
    const sleep = vi.fn((_ms: number) => noSleep());
    const loader = createPartyLoader({ fetch, sleep, delaysMs: [10, 20, 40] });
    expect(await loader.load("p_jo")).toEqual(jo);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(loader.get("p_jo")).toEqual(jo);
  });

  it("gives up after the last retry, and a later load tries again", async () => {
    const fetch = vi.fn().mockRejectedValue(rateLimited());
    const loader = createPartyLoader({ fetch, sleep: noSleep, delaysMs: [1, 1] });
    expect(await loader.load("p_jo")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockResolvedValue(jo);
    expect(await loader.load("p_jo")).toEqual(jo);
  });

  it("doesn't retry fatal errors (not_found)", async () => {
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error("parent not found"), { code: "not_found" }));
    const loader = createPartyLoader({ fetch, sleep: noSleep, isFatal: (e) => (e as { code?: string }).code === "not_found" });
    expect(await loader.load("gone")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent loads and caches the result", async () => {
    let resolve!: (p: Party) => void;
    const fetch = vi.fn(() => new Promise<Party>((r) => { resolve = r; }));
    const loader = createPartyLoader({ fetch, sleep: noSleep });
    const a = loader.load("p_jo");
    const b = loader.load("p_jo");
    resolve(jo);
    expect(await a).toEqual(jo);
    expect(await b).toEqual(jo);
    await loader.load("p_jo");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps only public fields, and persists them for the next page load", async () => {
    const storage = memoryStorage();
    const leaky = { ...jo, phone: "+15550000000", photonUserId: "u1", key: "jo" } as unknown as Party;
    const first = createPartyLoader({ fetch: async () => leaky, storage });
    const got = await first.load("p_jo");
    expect(got).toEqual(jo);
    expect(JSON.stringify(got)).not.toContain("+1555");
    expect([...storage.m.values()].join()).not.toContain("+1555");

    const fetch = vi.fn();
    const second = createPartyLoader({ fetch, storage });
    expect(second.get("p_jo")).toEqual(jo);
    expect(await second.load("p_jo")).toEqual(jo);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("survives corrupt or throwing storage", async () => {
    const bad = { getItem: () => "{not json", setItem: () => { throw new Error("quota"); } };
    const loader = createPartyLoader({ fetch: async () => jo, storage: bad });
    expect(await loader.load("p_jo")).toEqual(jo);
  });

  it("fills defaults for a partial profile", () => {
    expect(slimParty({ id: "x", name: "X" } as Party)).toEqual({
      id: "x", name: "X", avatar: { sprite: "parent_a", palette: "peach" }, pet: { sprite: "pet_a", name: "Pet" },
    });
  });
});

const proposal = (id: string, status: MatchProposal["status"], buyerId = "jo", sellerId = "mina") =>
  ({ id, status, buyerId, sellerId }) as MatchProposal;

describe("gone detection", () => {
  const rows = {
    a: proposal("a", "open"),
    b: proposal("b", "both_accepted"),
    c: proposal("c", "paid"),
    d: proposal("d", "open", "sam", "mina"),
  };

  it("missingLive: only this parent's live proposals that the closet left out", () => {
    expect(missingLive(rows, "jo", ["b"])).toEqual(["a"]);
    expect(missingLive(rows, "jo", ["a", "b"])).toEqual([]);
    expect(missingLive(rows, "mina", [])).toEqual(["a", "b", "d"]);
  });

  it("confirmedGone: absent from a closet fetched after we last saw the row", () => {
    const seenAt = new Map([["a", 1000], ["b", 5000]]);
    expect(confirmedGone(["a", "b"], [], seenAt, 3000)).toEqual(["a"]);   // b arrived after the fetch began: stale, keep it
    expect(confirmedGone(["a", "b"], ["a"], seenAt, 9000)).toEqual(["b"]); // a is listed again
  });
});
