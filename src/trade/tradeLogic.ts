// OWNER: Agent 2 (B5). Pure helpers behind the trade screens (no React, no api import) so vitest can cover them.
import type { MatchProposal } from "../app/types";

// ---------------------------------------------------------------- the other party's public profile

/** The only fields the trade window shows about a parent. Never a phone or any other private field. */
export interface Party {
  id: string;
  name: string;
  avatar: { sprite: string; palette: string };
  pet: { sprite: string; name: string };
}

export function slimParty(p: Party): Party {
  return {
    id: p.id, name: p.name,
    avatar: { sprite: p.avatar?.sprite ?? "parent_a", palette: p.avatar?.palette ?? "peach" },
    pet: { sprite: p.pet?.sprite ?? "pet_a", name: p.pet?.name ?? "Pet" },
  };
}

type KV = Pick<Storage, "getItem" | "setItem">;

export interface PartyLoaderOpts {
  fetch(id: string): Promise<Party>;
  /** Backoff between attempts; the number of retries is its length. */
  delaysMs?: number[];
  /** Errors that won't get better by retrying (e.g. not_found). */
  isFatal?(e: unknown): boolean;
  sleep?(ms: number): Promise<void>;
  /** sessionStorage in the browser: a reload mid-demo doesn't refetch names under the rate limit. */
  storage?: KV | null;
  storageKey?: string;
}

export interface PartyLoader {
  get(id: string): Party | null;
  /** Resolves to the party, or null after the last retry failed (a later call tries again). */
  load(id: string): Promise<Party | null>;
}

const MAX_CACHED = 24;

export function createPartyLoader(opts: PartyLoaderOpts): PartyLoader {
  const delays = opts.delaysMs ?? [1000, 2000, 4000, 8000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = opts.storageKey ?? "relay:trade:parties";
  const cache = new Map<string, Party>();
  const inflight = new Map<string, Promise<Party | null>>();

  try {
    const saved = JSON.parse(opts.storage?.getItem(key) ?? "[]") as Party[];
    for (const p of saved) if (p?.id && p.name) cache.set(p.id, slimParty(p));
  } catch { /* corrupt or unavailable storage: start empty */ }

  const persist = () => {
    try { opts.storage?.setItem(key, JSON.stringify([...cache.values()].slice(-MAX_CACHED))); } catch { /* quota / private mode */ }
  };

  function load(id: string): Promise<Party | null> {
    const hit = cache.get(id);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(id);
    if (pending) return pending;
    const run = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const party = slimParty(await opts.fetch(id));
          cache.set(id, party);
          persist();
          return party;
        } catch (e) {
          if (opts.isFatal?.(e) || attempt >= delays.length) return null;
          await sleep(delays[attempt]);
        }
      }
    })().finally(() => inflight.delete(id));
    inflight.set(id, run);
    return run;
  }

  return { get: (id) => cache.get(id) ?? null, load };
}

// ---------------------------------------------------------------- proposals that no longer exist

export const isLive = (p: MatchProposal) => p.status === "open" || p.status === "both_accepted";

/** Live proposals of `meId` that a closet (which always lists every live proposal) left out. */
export function missingLive(rows: Record<string, MatchProposal>, meId: string, listed: Iterable<string>): string[] {
  const inCloset = new Set(listed);
  return Object.values(rows)
    .filter((p) => isLive(p) && (p.buyerId === meId || p.sellerId === meId) && !inCloset.has(p.id))
    .map((p) => p.id);
}

/**
 * Of `ids`, the ones that are really gone: still absent from a closet whose fetch started after we last saw the row.
 * (A closet fetched before a proposal was created is merely stale, not proof of deletion.)
 */
export function confirmedGone(ids: string[], listed: Iterable<string>, seenAt: Map<string, number>, fetchStartedAt: number): string[] {
  const inCloset = new Set(listed);
  return ids.filter((id) => !inCloset.has(id) && (seenAt.get(id) ?? 0) < fetchStartedAt);
}
