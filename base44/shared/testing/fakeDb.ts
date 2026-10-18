// In-memory stand-in for Base44 entities (service role). Used by:
//  - vitest unit tests of logic.ts handlers (agents B1–B3)
//  - the frontend mock API (agent B4) — it also emits subscribe-style events.
// Pure TS. Semantics: filter = equality on given top-level keys; sort "field" / "-field".
import type { Db, EntityApi } from "../db.ts";
import type { EntityName } from "../types.ts";

export type ChangeEvent = { entity: EntityName; type: "create" | "update" | "delete"; id: string; data: any };
type Listener = (e: ChangeEvent) => void;

const ENTITIES: EntityName[] = [
  "Parent", "Child", "ClothingItem", "Listing", "Need", "Presence", "Encounter",
  "MatchProposal", "AgentNudge", "AgentInbox", "Setting",
];

export interface FakeDb extends Db {
  _tables: Record<string, Map<string, any>>;
  _on(listener: Listener): () => void;
  _dump(): Record<string, any[]>;
  _reset(seed?: Partial<Record<EntityName, any[]>>): void;
}

let counter = 0;
const newId = (entity: string) => `${entity.slice(0, 3).toLowerCase()}_${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function sortRows(rows: any[], sort?: string) {
  if (!sort) return rows;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (desc ? -1 : 1));
}

export function createFakeDb(seed: Partial<Record<EntityName, any[]>> = {}): FakeDb {
  const tables: Record<string, Map<string, any>> = {};
  const listeners = new Set<Listener>();
  const emit = (e: ChangeEvent) => listeners.forEach((l) => l(clone(e)));

  const api = (entity: EntityName): EntityApi<any> => ({
    async list(sort, limit) {
      const rows = sortRows([...tables[entity].values()], sort);
      return clone(limit ? rows.slice(0, limit) : rows);
    },
    async filter(query, sort, limit) {
      const rows = [...tables[entity].values()].filter((r) =>
        Object.entries(query ?? {}).every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)),
      );
      const sorted = sortRows(rows, sort);
      return clone(limit ? sorted.slice(0, limit) : sorted);
    },
    async get(id) {
      const row = tables[entity].get(id);
      if (!row) throw new Error(`${entity} ${id} not found`);
      return clone(row);
    },
    async create(data) {
      const row = { ...clone(data), id: (data as any).id ?? newId(entity) };
      tables[entity].set(row.id, row);
      emit({ entity, type: "create", id: row.id, data: row });
      return clone(row);
    },
    async update(id, patch) {
      const row = tables[entity].get(id);
      if (!row) throw new Error(`${entity} ${id} not found`);
      const next = { ...row, ...clone(patch), id };
      tables[entity].set(id, next);
      emit({ entity, type: "update", id, data: next });
      return clone(next);
    },
    async delete(id) {
      const row = tables[entity].get(id);
      tables[entity].delete(id);
      emit({ entity, type: "delete", id, data: row });
      return { ok: true };
    },
  });

  const db: any = { _tables: tables };
  const reset = (s: Partial<Record<EntityName, any[]>> = {}) => {
    for (const e of ENTITIES) {
      tables[e] = new Map((s[e] ?? []).map((r: any) => [r.id ?? newId(e), { ...clone(r), id: r.id ?? undefined }]));
      for (const [id, row] of tables[e]) row.id = id;
      db[e] = api(e);
    }
  };
  reset(seed);
  db._reset = reset;
  db._on = (l: Listener) => (listeners.add(l), () => listeners.delete(l));
  db._dump = () => Object.fromEntries(ENTITIES.map((e) => [e, clone([...tables[e].values()])]));
  return db as FakeDb;
}
