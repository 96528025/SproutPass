// OWNER: B1. Handlers for demo + stats functions. Pure TS (see closet.ts header).
import type { Db } from "../db.ts";
import { getSetting, writeInbox } from "../db.ts";
import { bad, HttpError } from "../errors.ts";
import type {
  AgentNudge, ClothingItem, DemoClockReq, DemoClockRes, ID, ISODate, Listing, MatchProposal, RelayStats, SelfTestRes,
} from "../types.ts";
import { applySeed, DEMO_DATES, seedPlan, type SeedEnv } from "../seed.ts";
import { scanForNudges } from "../nudges.ts";
import { priceFor } from "../pricing.ts";
import { createFakeDb } from "../testing/fakeDb.ts";
import { getCloset, listItem } from "./closet.ts";
import { createProposal, decideProposal, payProposal } from "./trade.ts";

const MANY = 1000; // explicit page size: real Base44 pages list()/filter()

/** Wipe everything and re-create the demo seed. Missing secrets just leave phone/agent fields empty. */
export async function demoReset(db: Db, env: SeedEnv = {}): Promise<{ ok: true }> {
  const clean: SeedEnv = {};
  for (const [k, v] of Object.entries(env)) if (v) clean[k as keyof SeedEnv] = v;
  await applySeed(db, seedPlan(clean));
  return { ok: true };
}

/** Base44 created_date has no zone suffix ("2026-10-18T04:44:00.332000"); it is UTC. */
export function realTime(row: { created_date?: string }): number | null {
  const s = row.created_date;
  if (!s) return null;
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).getTime();
  return Number.isNaN(t) ? null : t;
}
const byRowAge = (a: { id: ID; created_date?: string }, b: { id: ID; created_date?: string }) =>
  (realTime(a) ?? 0) - (realTime(b) ?? 0) || a.id.localeCompare(b.id);

/**
 * Read or move the demo clock, then scan for nudges. Each new nudge also goes to the owner's agent inbox.
 * Running it twice at the same time creates nothing new.
 */
export async function demoClock(db: Db, body: DemoClockReq = {}): Promise<DemoClockRes> {
  if (body?.now != null && (typeof body.now !== "string" || Number.isNaN(new Date(body.now).getTime()))) {
    throw bad("now must be an ISO date");
  }
  let setting = await getSetting(db);
  const target = body?.now ? new Date(body.now).toISOString() : setting?.now ?? new Date().toISOString();
  if (!setting) setting = await db.Setting.create({ key: "demo", now: target, matchVia: "fetch", imessage: true });
  else if (setting.now !== target) setting = await db.Setting.update(setting.id, { now: target });
  const now = target;

  const [items, listings, children, parents, existing] = await Promise.all([
    db.ClothingItem.list(undefined, MANY), db.Listing.filter({ status: "active" }, undefined, MANY),
    db.Child.list(undefined, MANY), db.Parent.list(undefined, MANY), db.AgentNudge.list(undefined, MANY),
  ]);
  const parentsById = Object.fromEntries(parents.map((p) => [p.id, { name: p.name, petName: p.pet?.name ?? "" }]));
  const drafts = scanForNudges({ items, listings, children, parentsById, existing, now });

  let nudgesCreated = 0;
  for (const d of drafts) {
    const nudge = await db.AgentNudge.create(d);
    // Double-click guard: if a parallel call created the same nudge, the oldest one wins and the rest are removed.
    const twins = (await db.AgentNudge.filter({ itemId: d.itemId, kind: d.kind, parentId: d.parentId }))
      .filter((n) => d.kind === "outgrow_check" || !n.resolved).sort(byRowAge);
    if (twins.length > 1 && twins[0].id !== nudge.id) { await db.AgentNudge.delete(nudge.id); continue; }
    await writeInbox(db, d.parentId, { type: "nudge:new", nudgeId: nudge.id, itemId: d.itemId, kind: d.kind, message: d.message });
    nudgesCreated++;
  }
  return { now, nudgesCreated };
}

const EARLIER = "Earlier family";

export async function getStats(db: Db): Promise<RelayStats> {
  const [listings, nudges, encounters, proposals, items, parents] = await Promise.all([
    db.Listing.list(undefined, MANY), db.AgentNudge.filter({ kind: "outgrow_check" }, undefined, MANY),
    db.Encounter.list(undefined, MANY), db.MatchProposal.list(undefined, MANY), db.ClothingItem.list(undefined, MANY),
    db.Parent.list(undefined, MANY),
  ]);

  // Seconds from "still fit?" to listed, in real time (Base44 created_date); demo-clock createdAt as a fallback.
  const secondsToList: number[] = [];
  for (const l of [...listings].sort(byRowAge)) {
    const n = nudges.filter((x) => x.itemId === l.itemId && x.parentId === l.sellerId).sort(byRowAge)[0];
    if (!n) continue;
    const lt = realTime(l as Listing & { created_date?: string }) ?? new Date(l.createdAt).getTime();
    const nt = realTime(n as AgentNudge & { created_date?: string }) ?? new Date(n.createdAt).getTime();
    if (Number.isNaN(lt) || Number.isNaN(nt)) continue;
    secondsToList.push(Math.max(0, Math.round((lt - nt) / 100) / 10));
  }

  const names = Object.fromEntries(parents.map((p) => [p.id, p.name]));
  const lastMove = (i: ClothingItem) => (i.ownershipHistory ?? []).reduce((m, h) => (h.from > m ? h.from : m), "");
  const chained = [...items].sort((a, b) => b.ownerCount - a.ownerCount || lastMove(b).localeCompare(lastMove(a)) ||
    a.name.localeCompare(b.name));

  return {
    secondsToList,
    encounters: encounters.length,
    proposals: proposals.length,
    trades: proposals.filter((p) => p.status === "paid").length,
    declinedWithZeroCharge: proposals.filter((p) => p.status === "declined" && !p.paymentRef).length,
    items: chained.map((i) => ({
      itemId: i.id, name: i.name, icon: i.icon, ownerCount: i.ownerCount,
      chain: (i.ownershipHistory ?? []).map((h) => ({
        ownerName: names[h.ownerId] ?? EARLIER, from: h.from,
        ...(h.to ? { to: h.to } : {}), ...(h.priceCents != null ? { priceCents: h.priceCents } : {}),
      })),
    })),
  };
}

// ---------------------------------------------------------------- selfTest (judges see this live)

type Check = { name: string; run: () => Promise<string | void> };
const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const rejects = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(() => null, (e) => e);
  assert(err, `expected ${code}, but it succeeded`);
  assert(err instanceof HttpError && err.code === code, `expected ${code}, got ${err?.code ?? err?.message ?? err}`);
};
/** TODO handlers throw "name: TODO(Bn)": report them as not implemented. */
const why = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return /TODO\(B\d\)/.test(msg) ? `not implemented (${msg})` : msg;
};

/**
 * Runs the real closet + trade handlers on a fresh in-memory seed (never touches the live database)
 * and checks the rules that matter: prices, final home, nothing charged until both accept, one transfer.
 */
export async function selfTest(_db?: Db): Promise<SelfTestRes> {
  const db = createFakeDb();
  const { parentIds, itemIds } = await applySeed(db, seedPlan({ MINA_PHONE: "+15550000001" }));
  const mina = parentIds.mina, jo = parentIds.jo;
  const romper = itemIds["Yellow duck romper"];
  const setNow = async (now: ISODate) => {
    const [s] = await db.Setting.filter({ key: "demo" });
    await db.Setting.update(s.id, { now });
  };
  let listing: Listing | null = null;
  let proposal: MatchProposal | null = null;
  const needProposal = () => { assert(proposal, "no proposal (an earlier step failed)"); return proposal!; };

  const checks: Check[] = [
    { name: "Price: 1st→2nd owner pays 60% ($30.00 → $18.00)", run: async () => {
      const p = priceFor({ ownerCount: 1, originalPriceCents: 3000 });
      assert(p === 1800, `got ${p}`);
    } },
    { name: "Price: 2nd→3rd owner pays 40% ($30.00 → $12.00)", run: async () => {
      const p = priceFor({ ownerCount: 2, originalPriceCents: 3000 });
      assert(p === 1200, `got ${p}`);
    } },
    { name: "Price: no resale after 3 owners", run: async () => {
      const p = priceFor({ ownerCount: 3, originalPriceCents: 3000 });
      assert(p === null, `got ${p}`);
    } },
    { name: "Sep 20: the demo clock nudges exactly one item (the romper)", run: async () => {
      const r = await demoClock(db, { now: DEMO_DATES.nudge });
      assert(r.nudgesCreated === 1, `created ${r.nudgesCreated}`);
      const again = await demoClock(db, { now: DEMO_DATES.nudge });
      assert(again.nudgesCreated === 0, `second run created ${again.nudgesCreated}`);
      const [n] = await db.AgentNudge.filter({ itemId: romper, kind: "outgrow_check" });
      assert(n, "romper nudge missing");
    } },
    { name: "A closet never exposes a phone number", run: async () => {
      const json = JSON.stringify(await getCloset(db, { parentKey: "mina" }));
      assert(!json.includes("phone") && !json.includes("+1555"), "phone leaked");
    } },
    { name: "Listing the romper prices it at $18.00", run: async () => {
      listing = await listItem(db, { parentKey: "mina", itemId: romper, photo: "selftest.jpg", condition: "gently_used",
        conditionNote: "", shared: true });
      assert(listing.priceCents === 1800, `got ${listing.priceCents}`);
    } },
    { name: "A 3rd-owner item can't be listed (final home)", run: async () => {
      await rejects(listItem(db, { parentKey: "sam", itemId: itemIds["Oatmeal knit cardigan"], photo: "x.jpg",
        condition: "well_loved", conditionNote: "", shared: true }), "not_resellable");
    } },
    { name: "Decline charges nothing and puts the item back on the market", run: async () => {
      assert(listing, "no listing (an earlier step failed)");
      await setNow(DEMO_DATES.meet);
      const p = await createProposal(db, { listingId: listing!.id, buyerId: jo, reason: "", transcript: [], source: "local" });
      const d = await decideProposal(db, { parentId: jo, proposalId: p.id, decision: "declined" });
      assert(d.status === "declined", `status ${d.status}`);
      assert(!d.paymentRef, "a payment was created");
      const item = await db.ClothingItem.get(romper);
      assert(item.status === "listed" && item.currentOwnerId === mina, `item ${item.status}`);
      const l = await db.Listing.get(listing!.id);
      assert(l.status === "active", `listing ${l.status}`);
    } },
    { name: "Paying before both accept is rejected", run: async () => {
      assert(listing, "no listing (an earlier step failed)");
      proposal = await createProposal(db, { listingId: listing!.id, buyerId: jo, reason: "", transcript: [], source: "local" });
      await decideProposal(db, { parentId: mina, proposalId: proposal.id, decision: "accepted" });
      await rejects(payProposal(db, { parentId: jo, proposalId: proposal.id }, { delayMs: 0 }), "invalid_transition");
      assert((await db.ClothingItem.get(romper)).currentOwnerId === mina, "item moved");
    } },
    { name: "Accepting twice is idempotent", run: async () => {
      const p = needProposal();
      const a = await decideProposal(db, { parentId: jo, proposalId: p.id, decision: "accepted" });
      const b = await decideProposal(db, { parentId: jo, proposalId: p.id, decision: "accepted" });
      assert(a.status === "both_accepted" && b.status === "both_accepted", `${a.status} / ${b.status}`);
    } },
    { name: "Paying twice transfers the item exactly once", run: async () => {
      const p = needProposal();
      const first = await payProposal(db, { parentId: jo, proposalId: p.id }, { delayMs: 0 });
      const second = await payProposal(db, { parentId: jo, proposalId: p.id }, { delayMs: 0 });
      assert(first.proposal.status === "paid" && second.proposal.status === "paid", "not paid");
      const item = await db.ClothingItem.get(romper);
      const joEntries = item.ownershipHistory.filter((h) => h.ownerId === jo);
      assert(joEntries.length === 1, `${joEntries.length} ownership entries for the buyer`);
      assert(item.currentOwnerId === jo, "buyer doesn't own it");
      assert((await db.Listing.get(p.listingId)).status === "sold", "listing not sold");
    } },
    { name: "The romper ends with 2 owners", run: async () => {
      const item = await db.ClothingItem.get(romper);
      assert(item.ownerCount === 2, `ownerCount ${item.ownerCount}`);
      return `${item.ownershipHistory.length} history entries`;
    } },
    { name: "The new owner gets a welcome nudge", run: async () => {
      const n = (await db.AgentNudge.filter({ parentId: jo, itemId: romper, kind: "new_owner_welcome" }));
      assert(n.length === 1, `${n.length} welcome nudges`);
      return n[0].message;
    } },
  ];

  const results: SelfTestRes["results"] = [];
  for (const c of checks) {
    try {
      const detail = await c.run();
      results.push(detail ? { name: c.name, pass: true, detail } : { name: c.name, pass: true });
    } catch (e) {
      results.push({ name: c.name, pass: false, detail: why(e) });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, failed: results.length - passed };
}

