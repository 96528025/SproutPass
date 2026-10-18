// A4 stubs: C's api (updatePresence, listNearby, demoWalk, useEncounter) with an animated Jo walk, and A5's
// EncounterScene / Celebration as full-screen panels. Delete each stub when its owner merges and point the
// imports in WorldScreen / useGps / useNearby / useDemoWalk at the real files.
import { useSyncExternalStore, type ReactNode } from "react";
import { PixelButton } from "@/pixel/components/PixelButton";
import { PixelPanel } from "@/pixel/components/PixelPanel";
import type { SpriteName } from "@/pixel/sprites";
import type { ParentId } from "@/world/query";

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
}

export interface MatchProposal {
  id: string;
  listingId: string;
  sellerId: ParentId;
  buyerId: ParentId;
  source: "local";
  snapshot: {
    itemName: string;
    icon: string;
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

interface SimState {
  distance: number;
  lastWalkAt: number;
  encounter: Encounter | null;
}
let sim: SimState = { distance: START_DISTANCE_M, lastWalkAt: 0, encounter: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

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

/** Each call walks the other parent in by (time since last call, capped) — so ~20 s of 1 s calls = arrival. */
export async function demoWalk({ parentId, towardParentId }: { parentId: ParentId; towardParentId: ParentId }): Promise<void> {
  const now = Date.now();
  const dt = sim.lastWalkAt ? Math.min(now - sim.lastWalkAt, STEP_CAP_MS) : 1000;
  const distance = Math.max(8, sim.distance - ((START_DISTANCE_M - 8) * dt) / WALK_MS);
  const encounter =
    sim.encounter ?? (distance < 25 ? { id: "enc_1", parentAId: parentId, parentBId: towardParentId, status: "talking" as const } : null);
  sim = { distance, lastWalkAt: now, encounter };
  emit();
}

export function useEncounter(_parentId: ParentId): { encounter: Encounter | null; proposal: MatchProposal | null } {
  const encounter = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sim.encounter,
  );
  return { encounter, proposal: null };
}

// ---- A5 stubs: full-screen overlays with a Close button ------------------------------------------------------------
const overlay = { position: "fixed", inset: 0, zIndex: "var(--z-overlay)" as unknown as number, background: "var(--ink)", display: "grid", placeItems: "center", padding: 16 } as const;

export interface EncounterSceneProps {
  encounter: Encounter;
  me: Parent;
  peer: Parent;
  bubbles?: ReactNode;
  onProposed: (proposalId: string) => void;
  onClosed: () => void;
}
export function EncounterScene({ encounter, me, peer, bubbles, onClosed }: EncounterSceneProps) {
  return (
    <div style={overlay} data-stub="EncounterScene">
      <PixelPanel title="ENCOUNTER (A5 STUB)">
        <p style={{ margin: "0 0 12px" }}>
          {me.name} meets {peer.name} — {encounter.status}
        </p>
        {bubbles}
        <PixelButton onClick={onClosed}>Close</PixelButton>
      </PixelPanel>
    </div>
  );
}

export interface CelebrationProps {
  proposal: MatchProposal;
  me: Parent;
  peer: Parent;
  onDone: () => void;
}
export function Celebration({ proposal, onDone }: CelebrationProps) {
  return (
    <div style={overlay} data-stub="Celebration">
      <PixelPanel title="TRADED! (A5 STUB)">
        <p style={{ margin: "0 0 12px" }}>{proposal.snapshot.itemName}</p>
        <PixelButton onClick={onDone}>Close</PixelButton>
      </PixelPanel>
    </div>
  );
}
