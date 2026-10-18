// A4 stubs: C's api (updatePresence, listNearby, demoWalk, useEncounter) with an animated Jo walk. After the
// encounter starts, the stub plays the whole demo on its own: 6 transcript turns → "proposed" → proposal "paid",
// so the walk → encounter → flowers loop runs on one laptop. Delete when C's functions and B's proposals land.
// A5's EncounterScene / Celebration are real now (imported directly in WorldScreen).
import { useSyncExternalStore } from "react";
import type { ItemIconName, SpriteName } from "@/pixel/sprites";
import type { ParentId } from "@/world/query";
import { PROPOSAL, TRANSCRIPT } from "@/mocks/a5";

// ---- Contract types (A-team contract; the real ones come from packages/contracts) -----------------------------------
export interface Parent {
  id: ParentId;
  name: string;
  avatar: { sprite: SpriteName; palette: string };
  pet: { sprite: SpriteName; name: string };
  discoverable: boolean;
}

export const PARENTS: Record<ParentId, Parent> = {
  mina: { id: "mina", name: "Mina", avatar: { sprite: "parent_a", palette: "peach" }, pet: { sprite: "pet_a", name: "Button" }, discoverable: true },
  jo: { id: "jo", name: "Jo", avatar: { sprite: "parent_b", palette: "sky" }, pet: { sprite: "pet_b", name: "Pip" }, discoverable: true },
  sam: { id: "sam", name: "Sam", avatar: { sprite: "parent_c", palette: "mint" }, pet: { sprite: "pet_c", name: "Moss" }, discoverable: true },
};

export type Band = "<25m" | "25-100m" | "100-300m";

export interface NearbyParent {
  parentId: ParentId;
  name: string;
  sprite: SpriteName;
  band: Band;
  bearingDeg: number; // 0 = north, clockwise
  /** Not in the contract: lets the demo button read "WALKING… 84 M". Optional; falls back to the band. */
  distanceM?: number;
}

export interface PresenceUpdate {
  parentId: ParentId;
  lat: number;
  lng: number;
  accuracyM: number;
  simulated: boolean;
  /** Not in the contract: the DISCOVERABLE toggle. */
  discoverable?: boolean;
}

export interface Encounter {
  id: string;
  parentAId: ParentId;
  parentBId: ParentId;
  status: "talking" | "proposed" | "no_match";
  proposalId?: string;
  /** Not in the contract's Encounter shape exactly (real one is AgentTurn[]); enough for the bubbles stub. */
  transcript: { speaker: string; text: string }[];
}

export interface MatchProposal {
  id: string;
  listingId: string;
  sellerId: ParentId;
  buyerId: ParentId;
  source: "local";
  snapshot: {
    itemName: string;
    icon: ItemIconName;
    size: string;
    originalPurchaseDate: string;
    originalPriceCents: number;
    condition: string;
    previousOwners: number;
    priceCents: number;
    wearWeeksLeft: number;
  };
  reason: string;
  status: "open" | "both_accepted" | "paid" | "declined" | "expired" | "payment_failed";
  sellerDecision: "pending" | "accepted" | "declined";
  buyerDecision: "pending" | "accepted" | "declined";
}

// ---- C stub: one tiny shared world --------------------------------------------------------------------------------
const START_DISTANCE_M = 250;
const WALK_MS = 20_000;
const STEP_CAP_MS = 1500;
// Same lawn C's demoWalk uses (Westwood, inside the UCLA 10-minute zone). My simulated position starts here and
// moves WALK_STEP_M per demoWalk call toward the other parent, so the map pans while walking. The other parent is
// never given coordinates: listNearby still returns band + bearing only.
export const DEMO_LAWN = { lat: 34.0709, lng: -118.4446 };
const WALK_STEP_M = 5;

export interface LatLng {
  lat: number;
  lng: number;
}

interface SimState {
  me: LatLng;
  distance: number;
  lastWalkAt: number;
  encounter: Encounter | null;
  proposal: MatchProposal | null;
}
let sim: SimState = { me: DEMO_LAWN, distance: START_DISTANCE_M, lastWalkAt: 0, encounter: null, proposal: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const TURN_MS = 1500;
const PAY_MS = 3000;
let scripted = false;

/** Once the encounter exists, play the agents' talk, propose, then (stand-in for both accepts + Pay) mark it paid. */
function runEncounterScript(aId: ParentId, bId: ParentId) {
  if (scripted) return;
  scripted = true;
  // the contract fixture is Mina selling to Jo; keep that whichever phone we are on
  const seller: ParentId = aId === "jo" ? bId : aId;
  const buyer: ParentId = seller === aId ? bId : aId;
  TRANSCRIPT.forEach((turn, i) => {
    window.setTimeout(() => {
      if (!sim.encounter) return;
      sim = { ...sim, encounter: { ...sim.encounter, transcript: [...sim.encounter.transcript, turn] } };
      emit();
    }, TURN_MS * (i + 1));
  });
  window.setTimeout(() => {
    if (!sim.encounter) return;
    const proposal: MatchProposal = { ...PROPOSAL, sellerId: seller, buyerId: buyer, source: "local" };
    sim = { ...sim, encounter: { ...sim.encounter, status: "proposed", proposalId: proposal.id }, proposal };
    emit();
  }, TURN_MS * (TRANSCRIPT.length + 1));
  window.setTimeout(() => {
    if (!sim.proposal) return;
    sim = { ...sim, proposal: { ...sim.proposal, status: "paid", sellerDecision: "accepted", buyerDecision: "accepted" } };
    emit();
  }, TURN_MS * (TRANSCRIPT.length + 1) + PAY_MS);
}

const bandOf = (m: number): Band => (m < 25 ? "<25m" : m < 100 ? "25-100m" : "100-300m");
/** Drifts 40° -> 70° as she walks in, so bearing smoothing is visible too. */
const bearingOf = (m: number) => 40 + ((START_DISTANCE_M - m) / START_DISTANCE_M) * 30;

export async function updatePresence(_p: PresenceUpdate): Promise<void> {
  /* stub: nothing to store */
}

export async function listNearby({ parentId }: { parentId: ParentId }): Promise<NearbyParent[]> {
  const other: ParentId = parentId === "jo" ? "mina" : "jo";
  if (parentId === "sam") return [];
  const o = PARENTS[other];
  return [
    {
      parentId: other,
      name: o.name,
      sprite: o.avatar.sprite,
      band: bandOf(sim.distance),
      bearingDeg: bearingOf(sim.distance),
      distanceM: Math.round(sim.distance),
    },
  ];
}

/** Move a point `m` metres along a compass bearing (flat-earth is fine at this scale). */
function stepAlong(p: LatLng, bearingDeg: number, m: number): LatLng {
  const b = (bearingDeg * Math.PI) / 180;
  return { lat: p.lat + (m * Math.cos(b)) / 110_540, lng: p.lng + (m * Math.sin(b)) / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

/**
 * Each call walks the other parent in by (time since last call, capped) — so ~20 s of 1 s calls = arrival — and moves
 * my simulated position 5 m toward them. Same shape as C's demoWalk: { ok, distanceM, encounters }.
 */
export async function demoWalk({
  parentId,
  towardParentId,
}: {
  parentId: ParentId;
  towardParentId: ParentId;
}): Promise<{ ok: true; distanceM: number; encounters: Encounter[] }> {
  const now = Date.now();
  const dt = sim.lastWalkAt ? Math.min(now - sim.lastWalkAt, STEP_CAP_MS) : 1000;
  const distance = Math.max(8, sim.distance - ((START_DISTANCE_M - 8) * dt) / WALK_MS);
  const encounter =
    sim.encounter ??
    (distance < 25 ? { id: "enc_1", parentAId: parentId, parentBId: towardParentId, status: "talking" as const, transcript: [] } : null);
  const me = stepAlong(sim.me, bearingOf(distance), WALK_STEP_M);
  sim = { ...sim, me, distance, lastWalkAt: now, encounter };
  emit();
  if (encounter) runEncounterScript(parentId, towardParentId);
  return { ok: true, distanceM: Math.round(distance), encounters: encounter ? [encounter] : [] };
}

/** My simulated lat/lng (demo mode only): the map follows this while WALK TOWARD runs. */
export function useSimPosition(): LatLng {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sim.me,
  );
}

export function useEncounter(_parentId: ParentId): { encounter: Encounter | null; proposal: MatchProposal | null } {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sim,
  );
  return { encounter: state.encounter, proposal: state.proposal };
}
