// Typed view of `serviceRole(req).entities` + small helpers. Pure: no npm:/base44: imports.
import type {
  AgentInbox, AgentNudge, Child, ClothingItem, Encounter, ID, ISODate, InboxEvent, Listing,
  MatchProposal, Need, Parent, ParentRef, Presence, Setting,
} from "./types.ts";
import { bad, notFound } from "./errors.ts";

export interface EntityApi<T extends { id: ID }> {
  list(sort?: string, limit?: number): Promise<T[]>;
  filter(query: Partial<Record<keyof T, unknown>>, sort?: string, limit?: number): Promise<T[]>;
  get(id: ID): Promise<T>;
  create(data: Omit<T, "id">): Promise<T>;
  update(id: ID, patch: Partial<T>): Promise<T>;
  delete(id: ID): Promise<unknown>;
}

export interface Db {
  Parent: EntityApi<Parent>;
  Child: EntityApi<Child>;
  ClothingItem: EntityApi<ClothingItem>;
  Listing: EntityApi<Listing>;
  Need: EntityApi<Need>;
  Presence: EntityApi<Presence>;
  Encounter: EntityApi<Encounter>;
  MatchProposal: EntityApi<MatchProposal>;
  AgentNudge: EntityApi<AgentNudge>;
  AgentInbox: EntityApi<AgentInbox>;
  Setting: EntityApi<Setting>;
}

/** get() that throws a 404 HttpError instead of returning undefined / throwing a raw error. */
export async function mustGet<T extends { id: ID }>(api: EntityApi<T>, id: ID | undefined, label: string): Promise<T> {
  if (!id) throw bad(`${label} id required`);
  try {
    const row = await api.get(id);
    if (!row) throw notFound(label);
    return row;
  } catch {
    throw notFound(label);
  }
}

/** Resolve { parentId } or { parentKey: "mina" } to a Parent. */
export async function resolveParent(db: Db, ref: ParentRef): Promise<Parent> {
  if (ref.parentId) return mustGet(db.Parent, ref.parentId, "parent");
  if (ref.parentKey) {
    const [p] = await db.Parent.filter({ key: ref.parentKey });
    if (!p) throw notFound(`parent '${ref.parentKey}'`);
    return p;
  }
  throw bad("parentId or parentKey required");
}

export async function getSetting(db: Db): Promise<Setting | null> {
  const [s] = await db.Setting.filter({ key: "demo" });
  return s ?? null;
}

/** Demo clock "now" (rule 6). Falls back to real time if no Setting row exists yet. */
export async function getNow(db: Db): Promise<ISODate> {
  return (await getSetting(db))?.now ?? new Date().toISOString();
}

/** Queue an event for a parent's Fetch agent (C's agents poll AgentInbox). */
export async function writeInbox(db: Db, parentId: ID, event: InboxEvent): Promise<AgentInbox> {
  return db.AgentInbox.create({
    parentId,
    type: "event",
    payload: event as unknown as Record<string, unknown>,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
}

/**
 * Strip private fields before returning a Parent to a client. The pet's mandate (spending rules), saved passkeys and
 * the live passkey challenge are server-only too: the parent reads their own rules through getTrust.
 */
export function publicParent(p: Parent & { passkeyChallenge?: unknown }) {
  const {
    phone: _phone, photonUserId: _u, photonSpaceId: _s, photonLineUserId: _l, convo: _c, asiAddress: _a,
    mandate: _m, passkeys: _pk, passkeyChallenge: _pc, ...rest
  } = p;
  return rest;
}
