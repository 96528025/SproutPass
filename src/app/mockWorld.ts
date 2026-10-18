// C (W3): the location half of B's mock. updatePresence / listNearby / demoWalk run C's real handlers
// (base44/shared/c/location.ts: presence per parent, 25/100/300 m bands, 5° bearings, encounter at ≤ 25 m once
// per pair until they walk > 40 m apart, the 120 m demo walk) on the mock's in-browser fakeDb, so /world?demo=1
// works offline exactly like live. fakeDb has no PairState, so location.ts keeps the pair bookkeeping on the
// Encounter rows (`rearmedAt`), which every tab shares and a reload keeps: parked parents never re-meet.
//
// The pets' conversation follows the same two steps as C's live fallback (location.ts runLocalFallback), only
// without the live 8 s wait for the Fetch agents (the mock has none): the moment an encounter starts, the pets'
// lines go onto it (still "talking", so AgentBubbles type them while the pets are out); once they've had time to
// say them (talkMs), B's createProposal runs with those lines (source "local") → "proposed" → the Trade window
// pops on both tabs. Nothing fits → "no_match" at once. A safety net finishes any encounter still talking after
// 15 s on the next presence/walk tick (e.g. the tab that started it was closed). `mockWorldTiming.instant = true`
// (tests) does all of it inside the same call.
import type { DemoWalkReq, DemoWalkRes, ListNearbyReq, ListNearbyRes, UpdatePresenceReq, UpdatePresenceRes } from "./types";
import {
  demoWalk as cDemoWalk,
  type FindMatches,
  listNearby as cListNearby,
  type LocationDeps,
  resolveEncounter,
  stageEncounter,
  TALK_TIMING,
  talkMs as cTalkMs,
  updatePresence as cUpdatePresence,
} from "../../base44/shared/c/location.ts";
import { findMatches as bFindMatches } from "../../base44/shared/cbridge.ts";
import type { FakeDb } from "../../base44/shared/testing/fakeDb.ts";

export const mockWorldTiming = {
  /** Resolve encounters inside the call that created them (tests). */
  instant: false,
  ...TALK_TIMING,
  /** Safety net for an encounter nobody resolved (its tab closed): next tick after this long. */
  fallbackAfterMs: 15_000,
};

const findMatches: FindMatches = bFindMatches;

/** How long the pets need to "say" these lines before the proposal lands (3–12 s): same rule as live. */
export function talkMs(transcript: { text?: string }[]): number {
  return cTalkMs(transcript, mockWorldTiming);
}

export function createMockWorld(db: FakeDb) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  async function finish(encounterId: string): Promise<void> {
    timers.delete(encounterId);
    const enc = await db.Encounter.get(encounterId).catch(() => null);
    if (enc?.status !== "talking") return; // a tick or another tab got there first
    await resolveEncounter(db, enc, findMatches);
  }

  /** The mock's stand-in for the two Fetch agents: see the header. */
  async function converse(encounterId: string): Promise<void> {
    const enc = await db.Encounter.get(encounterId).catch(() => null);
    if (enc?.status !== "talking") return;
    if (mockWorldTiming.instant) {
      await resolveEncounter(db, enc, findMatches);
      return;
    }
    const step = await stageEncounter(db, enc, findMatches);
    if (step.status !== "staged") return; // no_match + the pets' no-fit lines
    timers.set(enc.id, setTimeout(() => {
      finish(enc.id).catch((e) => console.error("[mock] encounter", e));
    }, talkMs(step.transcript)));
  }

  async function afterTick<T extends { encounters: { id: string }[] }>(res: T): Promise<T> {
    for (const { id } of res.encounters) await converse(id);
    return res;
  }

  // Reads are free here, so every tick reads everything (`recheck`); the live 8 s/25 s agent wait doesn't apply.
  const deps = (): LocationDeps => ({
    findMatches,
    recheck: true,
    fallbackAfterMs: mockWorldTiming.instant ? 0 : mockWorldTiming.fallbackAfterMs,
    talkMs: mockWorldTiming.instant ? () => 0 : talkMs,
  });

  return {
    async updatePresence(req: UpdatePresenceReq): Promise<UpdatePresenceRes> {
      return afterTick(await cUpdatePresence(db, req, deps()));
    },
    async listNearby(req: ListNearbyReq): Promise<ListNearbyRes> {
      return (await cListNearby(db, req)) as ListNearbyRes;
    },
    async demoWalk(req: DemoWalkReq): Promise<DemoWalkRes> {
      return afterTick(await cDemoWalk(db, req, deps()));
    },
    /** Pending conversation timers (tests / RESET). */
    cancelAll(): void {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    },
  };
}

export type MockWorld = ReturnType<typeof createMockWorld>;
