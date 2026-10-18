// C: offline stand-in for `../app/api` (export `base44`) so A and B can build the
// EncounterScene / NudgeDialog without the backend. Plays a scripted encounter:
// 2 s after `startMockEncounter()` the transcript grows one bubble per 1.2 s, then
// status → "proposed". Use:   import { base44 } from "../mocks/c";

type Cb = (e: { type: "create" | "update" | "delete"; id: string; data: any; timestamp: string }) => void;

const subs: Record<string, Set<Cb>> = {};
const rows: Record<string, any[]> = {
  Parent: [
    { id: "mina", name: "Mina", avatar: { sprite: "parent_a", palette: "a" }, pet: { sprite: "pet_a", name: "Button" }, discoverable: true },
    { id: "jo", name: "Jo", avatar: { sprite: "parent_b", palette: "b" }, pet: { sprite: "pet_b", name: "Pip" }, discoverable: true },
    { id: "sam", name: "Sam", avatar: { sprite: "parent_c", palette: "c" }, pet: { sprite: "pet_c", name: "Moss" }, discoverable: true },
  ],
  Encounter: [],
  AgentNudge: [
    { id: "n1", parentId: "mina", itemId: "romper", kind: "outgrow_check", message: "The yellow duck romper (6-9M) is probably getting snug — still fit? Want to pass it on?", createdAt: new Date().toISOString(), resolved: false },
  ],
  MatchProposal: [],
  PetLine: [],
};

function emit(entity: string, type: "create" | "update", data: any) {
  for (const cb of subs[entity] ?? []) cb({ type, id: data.id, data, timestamp: new Date().toISOString() });
}

function matches(row: any, q: any) {
  return Object.entries(q ?? {}).every(([k, v]) => row[k] === v);
}

function entity(name: string) {
  return {
    async list() { return rows[name] ?? []; },
    async get(id: string) { return (rows[name] ?? []).find((r) => r.id === id); },
    async filter(q: any, sort?: string, limit?: number) {
      let out = (rows[name] ?? []).filter((r) => matches(r, q));
      if (sort) {
        const desc = sort.startsWith("-"), key = sort.replace(/^[-+]/, "");
        out = out.sort((a, b) => (a[key] < b[key] ? -1 : 1) * (desc ? -1 : 1));
      }
      return limit ? out.slice(0, limit) : out;
    },
    async create(data: any) { const r = { id: `${name}_${Date.now()}`, ...data }; (rows[name] ??= []).push(r); emit(name, "create", r); return r; },
    async update(id: string, patch: any) { const r = (rows[name] ?? []).find((x) => x.id === id); Object.assign(r, patch); emit(name, "update", r); return r; },
    subscribe(cb: Cb) { (subs[name] ??= new Set()).add(cb); return () => subs[name].delete(cb); },
  };
}

export const base44 = {
  entities: new Proxy({}, { get: (_t, name: string) => entity(name) }) as any,
  functions: {
    async invoke(name: string, payload: any) {
      if (name === "listNearby") return { data: { me: { accuracyM: 12, simulated: true, fresh: true }, nearby: [{ parentId: "jo", name: "Jo", sprite: "parent_b", pet: "pet_b", band: "100-300m", bearingDeg: 45 }] } };
      if (name === "updatePresence" || name === "demoWalk") return { data: { ok: true, encounters: [], fallback: [] } };
      return { data: { ok: true, mock: name, payload } };
    },
  },
};

const SCRIPT = [
  { from: "buyer_agent", parentId: "jo", kind: "looking_for", text: "Pip: Looking for 6-9M tops or onesies!" },
  { from: "seller_agent", parentId: "mina", kind: "have", text: "Button: I have a Yellow duck romper in 6-9M." },
  { from: "buyer_agent", parentId: "jo", kind: "fit_check", text: "Pip: Your little one fits it for about 4 more weeks." },
  { from: "buyer_agent", parentId: "jo", kind: "propose", text: "Pip: Trade proposal! $18.00 — nothing is charged until you both accept." },
  { from: "seller_agent", parentId: "mina", kind: "ack", text: "Button: Sounds good — over to the humans!" },
];

/** Kick off a scripted Mina ↔ Jo encounter (call from a `?demo=1` button or the console). */
export async function startMockEncounter(aId = "mina", bId = "jo") {
  const enc = await base44.entities.Encounter.create({ aId, bId, band: "<25m", simulated: true, status: "talking", startedAt: new Date().toISOString(), transcript: [] });
  let i = 0;
  const tick = async () => {
    if (i < SCRIPT.length) {
      const t = { ...SCRIPT[i++], at: new Date().toISOString() };
      await base44.entities.Encounter.update(enc.id, { transcript: [...enc.transcript, t] });
      enc.transcript.push(t);
      setTimeout(tick, 1200);
    } else {
      await base44.entities.Encounter.update(enc.id, { status: "proposed" });
      await base44.entities.MatchProposal.create({ listingId: "l1", sellerId: aId, buyerId: bId, encounterId: enc.id, status: "open", sellerDecision: "pending", buyerDecision: "pending", source: "local", reason: "6-9M is on the wish list.", snapshot: { itemName: "Yellow duck romper", icon: "item_romper", size: "6-9M", originalPurchaseDate: "2026-05-15", originalPriceCents: 3000, condition: "gently_used", previousOwners: 1, priceCents: 1800, wearWeeksLeft: 4 }, transcript: enc.transcript, createdAt: new Date().toISOString() });
    }
  };
  setTimeout(tick, 2000);
  return enc;
}
