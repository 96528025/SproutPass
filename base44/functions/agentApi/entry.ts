// (C) agentApi — the agents' single door. Header `x-agent-key: <AGENT_KEY>`.
// Body: { action, ...args }. Every action returns JSON; errors are { error }.
//
//   claimInbox      {parentId?, limit?, types?}   → {rows:[AgentInbox]} (status → claimed). types: ["encounter"] = the
//                                                   Python agents' share; imessage / event rows stay pending for the
//                                                   TypeScript side (Photon webhook, inboxFallback). No types = all.
//                                                   peek {types:["event"], since} (with parentId): + {peeked:[…]} rows
//                                                   NOT claimed (a standalone agent mirrors them to its ASI:One owner).
//   complete        {inboxId}                     → {ok}
//   getState        {parentId, peerOf?}           → B's getCloset; shared-only when peerOf is set
//   fit             {buyerId, sellerId} | {itemId, childId} → {matches} | outgrow prediction. Each match carries the
//                                                   BUYER's pet-rules verdict: blocked {rule, reason, line} when their
//                                                   mandate (price limit, budget, kinds, may-propose) says no
//   suggestCondition{imageUrl, itemName?}         → {condition, note, via:"llm"|"template"}
//   createProposal  {...B's createProposal args, agentLog?}
//                                                 → proposal (+ Encounter.status = proposed, proposalId, transcript,
//                                                   agentLog = the agents' RelayProtocol messages, negotiatedBy "fetch").
//                                                   Refused by the buyer's pet rules → 409 "…not_eligible: pet_rules(<rule>): <why>"
//   noMatch         {encounterId, agentLog?, transcript?, reason?}
//                                                 → Encounter.status = no_match (only while still talking, no proposal),
//                                                   with the agents' log / bubbles (never a propose / ack bubble),
//                                                   negotiatedBy "fetch", and reason → Encounter.noMatchReason
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
import { getSetting, handle, HttpError, readJson, resolveCaller, requireSecret } from "../../shared/c/auth.ts";
import { extractConversationNeed } from "../../shared/c/conversationNeeds.ts";
import { sendToParent } from "../../shared/c/imessage.ts";
import { drainEvents, sweepInbox } from "../../shared/c/inboxFallback.ts";
import { suggestCondition } from "../../shared/c/condition.ts";
import { stampAgents } from "../../shared/c/location.ts";
import { claimInbox, fitForAgents, noMatchFromAgents, proposeFromAgents } from "../../shared/c/encounter.ts"; // pure, vitest-covered
import { callB, predictOutgrow } from "../../shared/cbridge.ts"; // B handlers, C-shaped (shared/cbridge.ts)

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
    case "previewNeed":
      if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "text required");
      return { need: await extractConversationNeed(base44, body.text) };
    case "messageChannelStatus": {
      const parent = await db.Parent.get(body.parentId);
      if (!parent.photonLineUserId) return { connected: false };
      const response = await fetch(`https://api.photon.codes/v1/projects/${encodeURIComponent(requireSecret("PHOTON_PROJECT_ID"))}/users/${encodeURIComponent(parent.photonLineUserId)}`, {
        headers: { Authorization: `Bearer ${requireSecret("PHOTON_API_KEY")}` },
      });
      if (!response.ok) return { connected: true, providerLookupStatus: response.status };
      const line = await response.json();
      return { connected: true, lineType: line.details?.type ?? "unknown", lineHandle: line.handle };
    }
    case "claimInbox":
      // {types:["encounter"]}: the agents negotiate; iMessages and app events are the TypeScript side's (encounter.ts).
      return await claimInbox(db, body);

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
        // B's ranking + the buyer's pet-rules verdict per match (encounter.ts fitForAgents).
        return await fitForAgents(db, { buyerId: body.buyerId, sellerId: body.sellerId });
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
      // B's createProposal, then Encounter → proposed + proposalId + transcript + the agents' protocol log
      // (Encounter.agentLog, negotiatedBy "fetch"): it rides on this call, no extra request (encounter.ts).
      const result = await proposeFromAgents(db, body);
      await drainEvents(base44, db, "agent-proposal");
      return result;
    }

    case "noMatch":
      // A late conversation (the local fallback already proposed, or the agents' own proposal landed) must not
      // flip a proposed encounter to no_match: only a still-talking encounter with no proposal ends here, and only
      // then is the agents' log stored (location.ts endWithoutMatch).
      return await noMatchFromAgents(db, body);

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
