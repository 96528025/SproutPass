// (C) agentApi — the agents' single door. Header `x-agent-key: <AGENT_KEY>`.
// Body: { action, ...args }. Every action returns JSON; errors are { error }.
//
//   claimInbox      {parentId, limit?}            → {rows:[AgentInbox]} (status → claimed)
//   complete        {inboxId}                     → {ok}
//   getState        {parentId, peerOf?}           → B's getCloset; shared-only when peerOf is set
//   fit             {buyerId, sellerId} | {itemId, childId} → matches | outgrow prediction
//   suggestCondition{imageUrl, itemName?}         → {condition, note, via:"llm"|"template"}
//   createProposal  {...B's createProposal args}  → proposal (+ Encounter.status = proposed)
//   noMatch         {encounterId}                 → Encounter.status = no_match (only while still talking, no proposal)
//   appendTurn      {encounterId, turn}           → {transcript}
//   now             {}                            → {now, matchVia, imessage}
//   sendImessage    {parentId, text?, imageUrl?}  → sendToParent
//   bindAsiUser     {parentId, code, asiAddress}  → {ok} (ASI:One "claim mina-1234")
//   pass-through: listItem · resolveNudge · decideProposal · payProposal · getCloset · withdrawListing · upsertNeed
//
// Rule 3 guard: getState for a peer strips everything except shared listings,
// shared needs and the child's age in months.
//
// Heartbeat: claimInbox / now / registerAgent / lookupParent stamp Setting {key:"agents", now} (at most every 10 s
// per warm isolate). While that stamp is < 45 s old, C's fallbacks give the agents room: inbox rows wait 30 s
// (not 5 s) and encounters 25 s (not 8 s) before the template pet answers for them.

// deno-lint-ignore-file no-explicit-any
import { getSetting, handle, HttpError, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { sendToParent } from "../../shared/c/imessage.ts";
import { sweepInbox } from "../../shared/c/inboxFallback.ts";
import { suggestCondition } from "../../shared/c/condition.ts";
import { endWithoutMatch, stampAgents } from "../../shared/c/location.ts";
import { callB, findMatches, predictOutgrow } from "../../shared/cbridge.ts"; // B handlers, C-shaped (shared/cbridge.ts)

const PASS_THROUGH = new Set([
  "listItem", "resolveNudge", "decideProposal", "payProposal", "getCloset", "withdrawListing", "upsertNeed", "recordPurchase",
]);

// B's handlers run in-process via cbridge (no HTTP hop; B's createProposal would 403 an SDK call without the agent key).
const invokeB = (db: any, name: string, payload: any): Promise<any> => callB(db, name, payload);

const HEARTBEAT_ACTIONS = new Set(["claimInbox", "now", "registerAgent", "lookupParent"]);
const HEARTBEAT_EVERY_MS = 10_000;
let lastHeartbeatAt = 0;

/** "The agents are on duty" for C's fallbacks (location.ts agentsOnDuty). Best effort, never fails the call. */
async function heartbeat(db: any): Promise<void> {
  const now = Date.now();
  if (now - lastHeartbeatAt < HEARTBEAT_EVERY_MS) return;
  lastHeartbeatAt = now;
  await stampAgents(db, now).catch((e) => console.error("[C] heartbeat", e));
}

export default handle(async (req) => {
  const { base44, db, kind } = await resolveCaller(req);
  if (kind !== "agent") throw new HttpError(401, "x-agent-key required");
  const body = await readJson<any>(req);
  const action = String(body.action ?? "");
  if (HEARTBEAT_ACTIONS.has(action)) await heartbeat(db);

  switch (action) {
    case "claimInbox": {
      const limit = Math.min(20, Number(body.limit ?? 5));
      const q: any = { status: "pending" };
      if (body.parentId) q.parentId = body.parentId;
      const rows: any[] = await db.AgentInbox.filter(q, "createdAt", limit);
      const claimed: any[] = [];
      for (const r of rows) {
        // Best-effort claim; Base44 has no compare-and-set, so the agent also
        // tolerates the rare double delivery (idempotent handlers).
        await db.AgentInbox.update(r.id, { status: "claimed", claimedBy: body.agentAddress ?? "agent", claimedAt: new Date().toISOString() });
        claimed.push({ ...r, status: "claimed" });
      }
      return { rows: claimed };
    }

    case "complete": {
      if (!body.inboxId) throw new HttpError(400, "inboxId required");
      await db.AgentInbox.update(body.inboxId, { status: "done", doneAt: new Date().toISOString() });
      return { ok: true };
    }

    case "getState": {
      if (!body.parentId) throw new HttpError(400, "parentId required");
      const state = await invokeB(db, "getCloset", { parentId: body.parentId });
      if (!body.peerOf) return state;
      // Peer view (rule 3): shared listings + shared needs + child age only.
      const items: any[] = state.items ?? [];
      const listings = (state.listings ?? []).filter((l: any) => l.shared && l.status === "active").map((l: any) => {
        const it = items.find((i: any) => i.id === l.itemId) ?? {};
        return {
          listingId: l.id,
          itemName: it.name,
          icon: it.icon,
          category: it.category,
          size: it.size,
          ownerCount: it.ownerCount,
          condition: l.condition,
          priceCents: l.priceCents,
          originalPriceCents: it.originalPriceCents,
        };
      });
      const needs = (state.needs ?? []).filter((n: any) => n.shared).map((n: any) => ({
        sizes: n.sizes, categories: n.categories ?? [], maxPriceCents: n.maxPriceCents ?? null,
      }));
      return {
        parentId: body.parentId,
        petName: state.parent?.pet?.name,
        childAgeMonths: state.child?.ageMonths ?? null,
        listings,
        needs,
      };
    }

    case "fit": {
      if (body.buyerId && body.sellerId) {
        return { matches: await findMatches(db, { buyerId: body.buyerId, sellerId: body.sellerId }) };
      }
      if (body.itemId && body.childId) {
        const item = await db.ClothingItem.get(body.itemId);
        const child = await db.Child.get(body.childId);
        const now = await getSetting(db);
        const until = predictOutgrow(item, child, new Date(now.now));
        const weeks = Math.max(0, Math.round((until.getTime() - Date.parse(now.now)) / (7 * 86_400_000)));
        return { predictedOutgrowDate: until.toISOString(), wearWeeksLeft: weeks };
      }
      throw new HttpError(400, "fit needs {buyerId, sellerId} or {itemId, childId}");
    }

    case "suggestCondition":
      return await suggestCondition(base44, body.imageUrl, body.itemName);

    case "createProposal": {
      const { action: _a, ...args } = body;
      args.source = args.source ?? "fetch";
      const prop = await invokeB(db, "createProposal", args);
      if (args.encounterId) {
        const patch = { status: "proposed", ...(Array.isArray(args.transcript) ? { transcript: args.transcript } : {}) };
        // + proposalId (A's EncounterScene hands it to the Trade window); retried without it if the schema refuses it.
        await db.Encounter.update(args.encounterId, { ...patch, ...(prop?.id ? { proposalId: prop.id } : {}) })
          .catch(() => db.Encounter.update(args.encounterId, patch))
          .catch(() => {});
      }
      return prop;
    }

    case "noMatch": {
      // A late conversation (the local fallback already proposed, or the agents' own proposal landed) must not
      // flip a proposed encounter to no_match: only a still-talking encounter with no proposal ends here.
      if (!body.encounterId) throw new HttpError(400, "encounterId required");
      return await endWithoutMatch(db, String(body.encounterId));
    }

    case "appendTurn": {
      const { encounterId, turn } = body;
      if (!encounterId || !turn?.text) throw new HttpError(400, "encounterId, turn required");
      const enc = await db.Encounter.get(encounterId);
      const transcript = [...(enc.transcript ?? []), {
        from: turn.from ?? "buyer_agent",
        parentId: turn.parentId ?? "",
        kind: turn.kind ?? "ack",
        text: String(turn.text).slice(0, 200),
        at: turn.at ?? new Date().toISOString(),
      }];
      await db.Encounter.update(encounterId, { transcript });
      return { transcript };
    }

    case "now": {
      const s = await getSetting(db);
      // Piggy-back the fallback sweep (the agents are on duty, so rows wait 30 s for them first).
      await sweepInbox(base44, db).catch(() => {});
      return { now: s.now, matchVia: s.matchVia, imessage: s.imessage };
    }

    case "sendImessage":
      return await sendToParent(db, body.parentId, String(body.text ?? "").slice(0, 600), body.imageUrl);

    case "lookupParent": {
      // Agents start with a name ("mina") and need the seeded Parent id.
      const parents: any[] = await db.Parent.list();
      const p = parents.find((x) => String(x.name ?? "").toLowerCase() === String(body.name ?? "").toLowerCase());
      if (!p) throw new HttpError(404, `no parent named ${body.name}`);
      return { id: p.id, name: p.name, pet: p.pet, agentAddress: p.agentAddress ?? null };
    }

    case "registerAgent": {
      // On startup each agent writes its own address, so nobody copies hashes by hand.
      if (!body.parentId || !body.agentAddress) throw new HttpError(400, "parentId, agentAddress required");
      await db.Parent.update(body.parentId, { agentAddress: body.agentAddress });
      return { ok: true };
    }

    case "bindAsiUser": {
      // "claim mina-1234": the 4 digits are the last 4 of the parent's phone,
      // or "0000" when the seed has no phone (demo).
      const parent = await db.Parent.get(body.parentId).catch(() => null);
      if (!parent) throw new HttpError(404, "unknown parent");
      const last4 = (parent.phone ?? "").replace(/\D/g, "").slice(-4) || "0000";
      if (String(body.code) !== last4) throw new HttpError(403, "bad claim code");
      await db.Parent.update(parent.id, { asiAddress: body.asiAddress }).catch(() => {});
      return { ok: true, parentId: parent.id, name: parent.name };
    }

    default: {
      if (PASS_THROUGH.has(action)) {
        const { action: _a, ...args } = body;
        return await invokeB(db, action, args);
      }
      throw new HttpError(400, `unknown action ${action}`);
    }
  }
});
