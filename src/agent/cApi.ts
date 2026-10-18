// C: everything src/agent needs from the backend, in one adapter over B's api.ts.
// B's `src/app/api.ts` must export the Base44 client as `base44` (NEEDS.md).
// Swap `import { base44 } from "../app/api"` for `../mocks/c` to develop offline.

import { base44 } from "../app/api";

export type AgentTurn = {
  from: "buyer_agent" | "seller_agent";
  parentId: string;
  kind: "looking_for" | "have" | "no_fit" | "fit_check" | "propose" | "ack" | "decline";
  text: string;
  at: string;
};

export type Encounter = {
  id: string;
  aId: string;
  bId: string;
  band: "<25m";
  simulated: boolean;
  status: "talking" | "proposed" | "no_match";
  startedAt: string;
  transcript: AgentTurn[];
};

export type AgentNudge = {
  id: string;
  parentId: string;
  itemId: string;
  kind: "outgrow_check" | "listing_reminder" | "new_owner_welcome";
  message: string;
  createdAt: string;
  resolved: boolean;
};

export type PetLine = { id: string; parentId: string; text: string; imageUrl?: string | null; createdAt: string };

export type SubEvent<T> = { type: "create" | "update" | "delete"; id: string; data: T; timestamp: string };
export type Unsubscribe = () => void;

/** Realtime: entity subscriptions return the unsubscribe function itself. */
export function subscribe<T>(entity: "Encounter" | "AgentNudge" | "MatchProposal" | "PetLine", cb: (e: SubEvent<T>) => void): Unsubscribe {
  try {
    return base44.entities[entity].subscribe(cb) as Unsubscribe;
  } catch {
    return () => {};
  }
}

export async function listEncountersFor(parentId: string): Promise<Encounter[]> {
  const [a, b] = await Promise.all([
    base44.entities.Encounter.filter({ aId: parentId }, "-startedAt", 5),
    base44.entities.Encounter.filter({ bId: parentId }, "-startedAt", 5),
  ]);
  return [...a, ...b].sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
}

export async function listOpenNudges(parentId: string): Promise<AgentNudge[]> {
  return base44.entities.AgentNudge.filter({ parentId, resolved: false }, "-createdAt", 10);
}

export async function listPetLines(parentId: string, limit = 5): Promise<PetLine[]> {
  try {
    return await base44.entities.PetLine.filter({ parentId }, "-createdAt", limit);
  } catch {
    return []; // PetLine entity not added yet (NEEDS.md) — AgentPet falls back to templates
  }
}

export async function countOpenProposals(parentId: string): Promise<number> {
  const [asBuyer, asSeller] = await Promise.all([
    base44.entities.MatchProposal.filter({ buyerId: parentId, status: "open" }, undefined, 5),
    base44.entities.MatchProposal.filter({ sellerId: parentId, status: "open" }, undefined, 5),
  ]);
  return asBuyer.length + asSeller.length;
}

export async function getParent(parentId: string): Promise<any> {
  return base44.entities.Parent.get(parentId);
}
