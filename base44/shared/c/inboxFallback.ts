// (C) inboxFallback.ts — the template agent (rule 10).
//
// The Python uAgents are the real "closet agents". If they are offline, any
// AgentInbox row still `pending` 5 s after creation is answered here with the
// same wording (wording.ts) and the same B functions, so the demo never stalls.
// While the agents are on duty (agentApi saw them within 45 s, see location.ts
// stampAgents) a row waits 30 s instead: their Bureau polls every 12 s, and the
// fallback must not take rows (or encounters) away from them.
// Swept for EVERY parent (one AgentInbox read) at most once per 12 s per warm
// isolate from updatePresence / demoWalk, so Mina still hears her nudge while
// she sits on /bag and only Jo is on /world; and from agentApi `now`.
//
// Conversation state is tiny and lives on Parent.convo (see NEEDS.md):
//   { step: "idle"|"await_photo"|"await_condition", itemId?, condition?, photoUrl? }

// deno-lint-ignore-file no-explicit-any
import { sendToParent } from "./imessage.ts";
import { parseCondition, parseIntent, shortDate, t } from "./wording.ts";
import { getSetting, secret } from "./auth.ts";
import { suggestCondition } from "./condition.ts";
import { agentsOnDuty, readSettings } from "./location.ts";
import { callB } from "../cbridge.ts";

export const FALLBACK_AFTER_MS = 5_000;
/** The Fetch agents are on duty: give their 12 s poll room before answering for them. */
export const AGENT_FALLBACK_AFTER_MS = 30_000;
/** One sweep per this long per warm isolate (a cold one sweeps on ticks in the first 3 s of each window). */
export const SWEEP_EVERY_MS = 12_000;
const SWEEP_SLOT_MS = 3_000;

let lastSweepAt = 0;

/** Throttle for the location ticks: true when this tick should sweep. */
export function sweepDue(nowMs: number = Date.now()): boolean {
  if (lastSweepAt) return nowMs - lastSweepAt >= SWEEP_EVERY_MS;
  return nowMs % SWEEP_EVERY_MS < SWEEP_SLOT_MS;
}

/** updatePresence / demoWalk: sweep every parent's rows, at most once per SWEEP_EVERY_MS. */
export async function maybeSweepInbox(base44: any, db: any, nowMs: number = Date.now()): Promise<{ handled: number }> {
  if (!sweepDue(nowMs)) return { handled: 0 };
  lastSweepAt = nowMs;
  return await sweepInbox(base44, db);
}

/** The app's ?as= takes the parent's seed key ("mina"), not its id. */
function tradeLink(prop: any, parent: any): string {
  return `https://${secret("APP_HOST") || "app"}/trade/${prop.id}?as=${parent?.key ?? parent?.id ?? ""}`;
}

export async function sweepInbox(base44: any, db: any, parentId?: string): Promise<{ handled: number }> {
  const nowMs = Date.now();
  const q: any = { status: "pending" };
  if (parentId) q.parentId = parentId;
  const rows: any[] = await db.AgentInbox.filter(q, "createdAt", 20);
  const age = (row: any) => nowMs - (Date.parse(row.createdAt) || 0);
  if (!rows.some((r) => age(r) >= FALLBACK_AFTER_MS)) return { handled: 0 };
  const wait = agentsOnDuty(await readSettings(db), nowMs) ? AGENT_FALLBACK_AFTER_MS : FALLBACK_AFTER_MS;
  let handled = 0;
  for (const row of rows) {
    if (age(row) < wait) continue;
    // Claim first so a late agent doesn't double-answer.
    await db.AgentInbox.update(row.id, { status: "claimed", claimedBy: "fallback", claimedAt: new Date(nowMs).toISOString() });
    try {
      await handleRow(base44, db, row);
    } catch (e) {
      console.error("[C] fallback failed", e);
      // Same as the Python agent under a 429: tell the parent instead of going quiet.
      if (row.type === "imessage" && /rate limit|429/i.test(String((e as Error)?.message ?? e))) {
        await sendToParent(db, row.parentId, t.busy()).catch(() => {});
      }
    }
    await db.AgentInbox.update(row.id, { status: "done", doneBy: "fallback", doneAt: new Date().toISOString() });
    handled++;
  }
  return { handled };
}

// B's handlers run in-process via cbridge. `base44` is the service-role client; its `.entities` is the db.
async function invoke(base44: any, name: string, payload: any): Promise<any> {
  return await callB(base44.entities, name, payload);
}

async function closet(base44: any, parentId: string) {
  return invoke(base44, "getCloset", { parentId });
}

const isRateLimit = (e: unknown) => /rate limit|429/i.test(String((e as Error)?.message ?? e));

/** Same stop words as agents/closet_agent.py _STOP. */
const STOP = new Set(["the", "a", "an", "my", "it", "sell", "list", "pass", "on", "please", "this", "that", "of", "and", "for"]);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)));

/** "sell the sun hat" → the bag item sharing the most words with the text (a tie → none), like Python's _named_item. */
function namedItem(items: any[], text: string): any | null {
  const said = words(text);
  if (!said.size) return null;
  const scored = items
    .filter((i) => i.status !== "transferred_out")
    .map((i) => ({ i, n: [...words(String(i.name ?? ""))].filter((w) => said.has(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!scored.length || (scored[1] && scored[1].n === scored[0].n)) return null;
  return scored[0].i;
}

async function setConvo(db: any, parent: any, convo: any) {
  await db.Parent.update(parent.id, { convo }).catch(() => {});
}

async function handleRow(base44: any, db: any, row: any) {
  const parent = await db.Parent.get(row.parentId);
  const pet = parent?.pet?.name ?? "Pet";
  const say = (text: string, img?: string) => sendToParent(db, row.parentId, text, img);
  const p = row.payload ?? {};

  if (row.type === "event") {
    switch (p.type) {
      case "nudge:new": {
        // The welcome nudge is written right after trade:completed, which already said hi with the flowers.
        if (p.kind === "new_owner_welcome") return;
        const nudge = p.nudgeId ? await db.AgentNudge.get(p.nudgeId).catch(() => null) : null;
        const item = nudge ? await db.ClothingItem.get(nudge.itemId).catch(() => null) : null;
        if (nudge?.kind === "new_owner_welcome" && item) {
          await say(t.completed(item.name, shortDate(item.predictedOutgrowDate ?? "")));
        } else if (item) {
          await say(t.nudge(item.name, item.size));
        } else if (nudge?.message) {
          await say(nudge.message);
        }
        return;
      }
      case "proposal:new": {
        const prop = await db.MatchProposal.get(p.proposalId).catch(() => null);
        if (!prop) return;
        // B's event names the other side's pet (peerPet); older rows → look the other parent up.
        let peerPet: string | undefined = p.peerPet;
        if (!peerPet) {
          const other = prop.buyerId === row.parentId ? prop.sellerId : prop.buyerId;
          peerPet = (await db.Parent.get(other).catch(() => null))?.pet?.name;
        }
        const s = prop.snapshot ?? {};
        // snapshot.previousOwners == the item's current ownerCount (♥♡♡ = 1), which picks the 60/40 rule.
        await say(t.proposal(s.itemName, s.priceCents, s.originalPriceCents, s.previousOwners ?? 1, peerPet ?? "a friend's pet"));
        return;
      }
      case "proposal:updated": {
        // B's event carries status + both decisions + otherName, so this answers each event as it happened
        // (not the proposal's latest state) without reads. Older rows without them → read the proposal.
        let prop: any = null;
        if (!p.status || !p.role) {
          prop = await db.MatchProposal.get(p.proposalId).catch(() => null);
          if (!prop) return;
        }
        const status: string = p.status ?? prop.status;
        const isBuyer = p.role ? p.role === "buyer" : prop.buyerId === row.parentId;
        if (status === "both_accepted") {
          const link = p.payLink ?? tradeLink({ id: p.proposalId }, parent);
          await say(isBuyer ? t.bothAccepted(link) : t.accepted("the buyer to pay"));
        } else if (status === "declined") {
          await say(t.declined());
        } else if (status === "expired") {
          await say(t.expired());
        } else if (status === "payment_failed") {
          await say(t.paymentFailed());
        } else if (status === "open") {
          const mine = isBuyer ? (p.buyerDecision ?? prop?.buyerDecision) : (p.sellerDecision ?? prop?.sellerDecision);
          let otherName: string | undefined = p.otherName;
          if (!otherName) {
            prop ??= await db.MatchProposal.get(p.proposalId).catch(() => null);
            const other = prop ? (isBuyer ? prop.sellerId : prop.buyerId) : null;
            otherName = other ? (await db.Parent.get(other).catch(() => null))?.name : undefined;
          }
          await say(mine === "accepted" ? t.accepted(otherName ?? "the other side") : t.otherAccepted(otherName ?? "The other side"));
        }
        // "paid": trade:completed follows with the flowers.
        return;
      }
      case "trade:completed": {
        // B's event carries the snapshot, both ids and the buyer's new outgrow date; older rows → read them.
        const prop = p.snapshot && p.buyerId ? null : await db.MatchProposal.get(p.proposalId).catch(() => null);
        const s = p.snapshot ?? prop?.snapshot ?? {};
        const buyerId = p.buyerId ?? prop?.buyerId;
        const isBuyer = p.role ? p.role === "buyer" : buyerId === row.parentId;
        const gif = p.flowersUrl ?? `https://${secret("APP_HOST") || "app"}/fx/flowers.gif`;
        if (isBuyer) {
          let until: string = p.predictedOutgrowDate ?? "";
          if (!until && p.itemId) until = (await db.ClothingItem.get(p.itemId).catch(() => null))?.predictedOutgrowDate ?? "";
          await say(t.completed(s.itemName ?? "new item", shortDate(until)), gif);
        } else {
          await say(t.sold(s.itemName ?? "item", s.priceCents ?? p.priceCents ?? 0), gif);
        }
        return;
      }
    }
    return;
  }

  if (row.type === "encounter") {
    // The encounter itself is handled by location.ts runLocalFallback (8 s, or 25 s while the agents are on duty:
    // the pets' lines first, the proposal after the talk); nothing to say yet.
    return;
  }

  if (row.type !== "imessage") return;

  const text: string = p.text ?? "";
  const photos: string[] = p.photoUrls ?? [];
  const convo = parent?.convo ?? { step: "idle" };
  const intent = parseIntent(text);

  // Photo first: a photo during "await_photo" (or any time with an open nudge) starts the condition step.
  if (photos.length) {
    const c = await closet(base44, parent.id);
    const nudge = (c.nudges ?? []).find((n: any) => !n.resolved && n.kind === "outgrow_check") ?? null;
    const itemId = convo.itemId ?? nudge?.itemId;
    if (!itemId) return void await say(t.unknown());
    let condition = "gently_used", note = "";
    // Direct call: invoking agentApi from here would need the agent key (401 otherwise).
    const r = await suggestCondition(base44, photos[0]);
    condition = r.condition ?? condition;
    note = r.note ?? "";
    const itemName = convo.itemName ?? (c.items ?? []).find((i: any) => i.id === itemId)?.name;
    await setConvo(db, parent, { step: "await_condition", itemId, nudgeId: convo.nudgeId ?? nudge?.id, itemName, condition, note, photoUrl: photos[0] });
    return void await say(t.askCondition(condition));
  }

  switch (intent) {
    case "hi":
      return void await say(t.hello(pet));
    case "help":
      return void await say(t.help());
    case "bag": {
      const c = await closet(base44, parent.id);
      const lines = (c.items ?? []).filter((i: any) => i.status !== "transferred_out")
        .map((i: any) => `${i.name} ${i.size} ${"♥".repeat(i.ownerCount)}${"♡".repeat(3 - i.ownerCount)}`);
      return void await say(t.bag(lines));
    }
    case "sell": {
      // Same checks, same order and same lines as the Python agent's _on_sell.
      const c = await closet(base44, parent.id);
      const nudge = (c.nudges ?? []).find((n: any) => !n.resolved && n.kind === "outgrow_check");
      const items: any[] = c.items ?? [];
      const item = namedItem(items, text) ?? (nudge ? items.find((i: any) => i.id === nudge.itemId) : null);
      if (!item) return void await say(t.nothingDue());
      const name = item.name ?? "item";
      if (item.ownerCount >= 3) return void await say(t.finalHome(name));
      if (item.status === "pending_trade") return void await say(t.inTrade(name));
      if (item.status === "listed") {
        const listing = (c.listings ?? []).find((l: any) => l.itemId === item.id && l.status === "active");
        if (listing) return void await say(t.alreadyListed(name, listing.priceCents ?? 0));
      }
      const nudgeId = nudge && nudge.itemId === item.id ? nudge.id : undefined;
      await setConvo(db, parent, { step: "await_photo", itemId: item.id, nudgeId, itemName: name });
      return void await say(t.askPhoto(name));
    }
    case "keep":
    case "later": {
      const c = await closet(base44, parent.id);
      const nudge = (c.nudges ?? []).find((n: any) => !n.resolved && n.kind === "outgrow_check");
      if (nudge) await invoke(base44, "resolveNudge", { nudgeId: nudge.id, decision: intent }).catch(() => {});
      await setConvo(db, parent, { step: "idle" });
      return void await say(intent === "keep" ? t.keep() : t.later());
    }
    case "condition": {
      const cond = parseCondition(text);
      if (convo.step === "await_condition" && cond) {
        await setConvo(db, parent, { ...convo, condition: cond });
        return void await say(t.askCondition(cond));
      }
      return void await say(t.unknown());
    }
    case "yes": {
      if (convo.step !== "await_condition") return void await say(t.unknown());
      let r: any;
      try {
        r = await invoke(base44, "listItem", {
          itemId: convo.itemId,
          sellerId: parent.id,
          condition: convo.condition ?? "gently_used",
          conditionNote: convo.note ?? "",
          photos: convo.photoUrl ? [convo.photoUrl] : [],
          shared: true,
        });
      } catch (e) {
        if (isRateLimit(e)) throw e; // → "busy"; the convo stays, so "yes" again works
        await setConvo(db, parent, { step: "idle" });
        const itemName = convo.itemName ?? (await db.ClothingItem.get(convo.itemId).catch(() => null))?.name ?? "item";
        return void await say(/not_resellable/.test(String((e as Error)?.message ?? e)) ? t.finalHome(itemName) : t.listFailed(itemName));
      }
      const listing = r.listing ?? r;
      const item = r.item ?? await db.ClothingItem.get(convo.itemId).catch(() => null);
      if (convo.nudgeId) await invoke(base44, "resolveNudge", { nudgeId: convo.nudgeId, decision: "sell" }).catch(() => {});
      await setConvo(db, parent, { step: "idle" });
      return void await say(t.listed(listing.priceCents, item?.originalPriceCents ?? 0, item?.ownerCount ?? 1));
    }
    case "no":
      if (convo.step === "await_condition") return void await say(`Okay — tell me "like new", "gently used" or "well loved".`);
      return void await say(t.unknown());
    case "accept":
    case "decline": {
      // Python _on_decide: the first open trade still waiting on me; else say where things stand.
      const c = await closet(base44, parent.id);
      const props: any[] = c.proposals ?? [];
      const mine = (pr: any) => (pr.buyerId === parent.id ? pr.buyerDecision : pr.sellerDecision);
      const live = props.filter((pr: any) => pr.status === "open");
      const todo = live.find((pr: any) => mine(pr) == null || mine(pr) === "pending");
      if (!todo) {
        if (intent === "accept" && live.length) {
          const other = live[0].buyerId === parent.id ? live[0].sellerId : live[0].buyerId;
          const otherName = (await db.Parent.get(other).catch(() => null))?.name;
          return void await say(t.accepted(otherName ?? "the other side"));
        }
        const ready = props.find((pr: any) => pr.status === "both_accepted");
        if (intent === "accept" && ready) {
          return void await say(ready.buyerId === parent.id ? t.bothAccepted(tradeLink(ready, parent)) : t.accepted("the buyer to pay"));
        }
        return void await say(t.noOpenProposal());
      }
      try {
        await invoke(base44, "decideProposal", { proposalId: todo.id, parentId: parent.id, decision: intent === "accept" ? "accepted" : "declined" });
      } catch (e) {
        if (isRateLimit(e)) throw e;
        return void await say(/expired/.test(String((e as Error)?.message ?? e)) ? t.expired() : t.noOpenProposal());
      }
      return; // B's decideProposal emits proposal:updated → we answer there
    }
    case "pay": {
      const c = await closet(base44, parent.id);
      const props: any[] = c.proposals ?? [];
      const ready = props.find((pr: any) => pr.status === "both_accepted" && pr.buyerId === parent.id);
      if (!ready) {
        const waiting = props.some((pr: any) => pr.status === "open" && pr.buyerId === parent.id);
        return void await say(waiting ? t.notYet() : t.noOpenProposal());
      }
      return void await say(t.bothAccepted(tradeLink(ready, parent)));
    }
    default: {
      // Unknown: if LLM is available let it answer in the pet's voice, else template.
      const setting = await getSetting(db);
      try {
        const reply = await base44.integrations.Core.InvokeLLM({
          prompt: `You are ${pet}, a tiny pixel closet pet helping a parent pass on kids' clothes. ` +
            `Reply to this iMessage in at most 2 short friendly sentences, no markdown, no emoji spam. ` +
            `Today in the story is ${setting.now}. Message: """${text.slice(0, 300)}"""`,
        });
        if (typeof reply === "string" && reply.trim()) return void await say(reply.trim().slice(0, 300));
      } catch { /* no LLM key */ }
      return void await say(t.unknown());
    }
  }
}
