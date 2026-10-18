// OWNER: B4. Mock api: the SERVER's own handlers (base44/shared/logic/*) running on an in-browser fakeDb,
// so the mock behaves exactly like Base44. Tabs share one world: changes go over a BroadcastChannel and a
// localStorage snapshot lets a new or reloaded tab join it (RESET in the demo panel starts over).
import type { Api, EntityEvent } from "./api";
import { ApiError } from "./api";
import type { MatchProposal } from "./types";
import { createFakeDb } from "../../base44/shared/testing/fakeDb.ts";
import type { ChangeEvent } from "../../base44/shared/testing/fakeDb.ts";
import { applySeed, seedPlan } from "../../base44/shared/seed.ts";
import { getCloset, listItem, recordPurchase, resolveNudge, upsertNeed, withdrawListing } from "../../base44/shared/logic/closet.ts";
import { createProposal, decideProposal, getParties, payProposal } from "../../base44/shared/logic/trade.ts";
import { demoClock, demoReset, getStats, selfTest } from "../../base44/shared/logic/demo.ts";
import { toSmallDataUrl } from "./photo";

const db = createFakeDb();
const inBrowser = typeof window !== "undefined";

// ---------------------------------------------------------------- shared world across tabs

const SNAP = "relay:mockdb";
/** Snapshots from an older seed plan are dropped, so seed edits show up without a manual RESET. */
const SEED_SIG = (() => {
  let h = 0;
  for (const ch of JSON.stringify(seedPlan())) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h.toString(36);
})();

function loadSnapshot(): Record<string, unknown[]> | null {
  if (!inBrowser) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(SNAP) ?? "null") as { sig?: string; data?: Record<string, unknown[]> } | null;
    return raw?.sig === SEED_SIG && raw.data ? raw.data : null;
  } catch { return null; }
}

const bc = inBrowser && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("relay-mockdb") : null;
const remote = new Set<(e: ChangeEvent) => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const saved = loadSnapshot();
const ready: Promise<unknown> = saved ? Promise.resolve(db._reset(saved)) : applySeed(db, seedPlan());

// Local writes go to the other tabs + the snapshot. Remote writes below bypass _on, so there's no echo loop.
db._on((e) => {
  bc?.postMessage(e);
  if (!inBrowser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SNAP, JSON.stringify({ sig: SEED_SIG, data: db._dump() })); } catch { /* quota */ }
  }, 50);
});
bc?.addEventListener("message", ({ data: e }: MessageEvent<ChangeEvent>) => {
  const table = db._tables[e.entity];
  if (!table) return;
  if (e.type === "delete") table.delete(e.id); else table.set(e.id, e.data);
  remote.forEach((l) => l(e));
});

// ---------------------------------------------------------------- calls

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async <T>(fn: () => Promise<T>): Promise<T> => {
  await ready;
  await wait(120); // feel like a network
  try { return await fn(); } catch (e: any) { throw new ApiError(e?.code ?? "mock_error", e?.message ?? String(e)); }
};

/** Mock-only helpers for building screens without B1/C. Not part of Api. */
export const mockDev = {
  db,
  /** Create the demo proposal (first active listing → Jo) as if the agents had met. Same handler C's agents call. */
  async triggerEncounter(): Promise<MatchProposal | null> {
    await ready;
    const [jo] = await db.Parent.filter({ key: "jo" });
    const [listing] = await db.Listing.filter({ status: "active" });
    if (!jo || !listing) return null;
    try {
      return await createProposal(db, { listingId: listing.id, buyerId: jo.id, reason: "", transcript: [], source: "local" });
    } catch (e: any) {
      throw new ApiError(e?.code ?? "mock_error", e?.message ?? String(e));
    }
  },
};

export const mockApi: Api = {
  getCloset: (ref) => call(() => getCloset(db, ref)),
  recordPurchase: (req) => call(() => recordPurchase(db, req)),
  listItem: (req) => call(() => listItem(db, req)),
  withdrawListing: (req) => call(() => withdrawListing(db, req)),
  upsertNeed: (req) => call(() => upsertNeed(db, req)),
  resolveNudge: (req) => call(() => resolveNudge(db, req)),

  decideProposal: (req) => call(() => decideProposal(db, req)),
  payProposal: (req) => call(() => payProposal(db, req, { delayMs: 600 })),
  getParties: (req) => call(() => getParties(db, req)),

  demoClock: (req) => call(() => demoClock(db, req ?? {})),
  demoReset: () => call(() => demoReset(db, {})),
  getStats: () => call(() => getStats(db)),
  selfTest: () => call(() => selfTest()),

  suggestCondition: () => call(async () => ({ condition: "gently_used" as const, note: "Light pilling on the cuffs" })),

  uploadPhoto: (file) => call(async () => ({ url: await toSmallDataUrl(file) })),

  // Hears this tab's writes and the other tabs' (BroadcastChannel).
  subscribe: (entity, cb) => {
    const h = (e: ChangeEvent) => { if (e.entity === entity) cb({ type: e.type, id: e.id, data: e.data } as EntityEvent<any>); };
    const off = db._on(h);
    remote.add(h);
    return () => { off(); remote.delete(h); };
  },
};
