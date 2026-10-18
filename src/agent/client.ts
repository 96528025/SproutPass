// C: which Base44 client src/agent reads. Real mode → the app's SDK client. Mock mode (VITE_USE_MOCK=1) →
// B's in-browser fakeDb (mockDev.db), so the pet sees the same nudges and proposals as the bag.
// (src/mocks/c.ts is still there for A to build the EncounterScene fully offline.)
import { USE_MOCK } from "../app/api";
import { mockApi, mockDev } from "../app/api.mock";
import type { EntityName } from "../app/types";
import { base44 as real } from "../api/base44Client";

type Row = Record<string, unknown> & { id: string };
type SubEvent = { type: "create" | "update" | "delete"; id: string; data: Row; timestamp: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockClient(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = mockDev.db as any;
  const table = (name: string) => {
    if (!db[name]) throw new Error(`mock has no ${name} entity`); // e.g. PetLine: cApi falls back to templates
    return db[name];
  };
  const entities = new Proxy({}, {
    get: (_t, name: string) => ({
      list: (sort?: string, limit?: number) => table(name).list(sort, limit),
      filter: (q: object, sort?: string, limit?: number) => table(name).filter(q, sort, limit),
      get: (id: string) => table(name).get(id),
      // B's mock subscribe hears this tab's writes AND the other tabs' (BroadcastChannel), like Base44 realtime;
      // db._on alone misses the other tab's encounter, so its scene would wait for the 10 s poll.
      subscribe: (cb: (e: SubEvent) => void) =>
        mockApi.subscribe<Row>(name as EntityName, (e) =>
          cb({ type: e.type, id: e.id, data: e.data, timestamp: new Date().toISOString() })),
    }),
  });
  return { entities };
}

export const base44 = USE_MOCK ? mockClient() : real;
