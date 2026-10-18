// (C) inboxFallback.ts — the template agent (rule 10).
//
// The Python uAgents are the real "closet agents". If they are offline, any
// AgentInbox row still `pending` 5 s after creation is answered here with the
// same wording (wording.ts) and the same B functions, so the demo never stalls.
// Swept from updatePresence / demoWalk (the app ticks every 1–3 s) and from
// agentApi `now`.
//
// Conversation state is tiny and lives on Parent.convo (see NEEDS.md):
//   { step: "idle"|"await_photo"|"await_condition", itemId?, condition?, photoUrl? }

// deno-lint-ignore-file no-explicit-any
import { sendToParent } from "./imessage.ts";
import { parseCondition, parseIntent, shortDate, t } from "./wording.ts";
import { getSetting, secret } from "./auth.ts";
import { suggestCondition } from "./condition.ts";
import { callB } from "../cbridge.ts";

export const FALLBACK_AFTER_MS = 5_000;

/** The app's ?as= takes the parent's seed key ("mina"), not its id. */
function tradeLink(prop: any, parent: any): string {
  return `https://${secret("APP_HOST") || "app"}/trade/${prop.id}?as=${parent?.key ?? parent?.id ?? ""}`;
}

export async function sweepInbox(base44: any, db: any, parentId?: string): Promise<{ handled: number }> {
  const nowMs = Date.now();
  const q: any = { status: "pending" };
  if (parentId) q.parentId = parentId;
  const rows: any[] = await db.AgentInbox.filter(q, "createdAt", 20);
  let handled = 0;
  for (const row of rows) {
    if (nowMs - Date.parse(row.createdAt) < FALLBACK_AFTER_MS) continue;
    // Claim first so a late agent doesn't double-answer.
    await db.AgentInbox.update(row.id, { status: "claimed", claimedBy: "fallback" });
    try {
      await handleRow(base44, db, row);
    } catch (e) {
      console.error("[C] fallback failed", e);
    }
    await db.AgentInbox.update(row.id, { status: "done", doneBy: "fallback" });
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
        const other = prop.buyerId === row.parentId ? prop.sellerId : prop.buyerId;
        const otherParent = await db.Parent.get(other).catch(() => null);
        const s = prop.snapshot ?? {};
        // snapshot.previousOwners == the item's current ownerCount (♥♡♡ = 1), which picks the 60/40 rule.
        await say(t.proposal(s.itemName, s.priceCents, s.originalPriceCents, s.previousOwners ?? 1, otherParent?.pet?.name ?? "a friend's pet"));
        return;
      }
      case "proposal:updated": {
        const prop = await db.MatchProposal.get(p.proposalId).catch(() => null);
        if (!prop) return;
        if (prop.status === "both_accepted") {
          const link = p.payLink ?? tradeLink(prop, parent);
          await say(prop.buyerId === row.parentId ? t.bothAccepted(link) : t.accepted("the buyer to pay"));
        } else if (prop.status === "declined") {
          await say(t.declined());
        } else {
          const other = prop.buyerId === row.parentId ? prop.sellerId : prop.buyerId;
          const op = await db.Parent.get(other).catch(() => null);
          const mine = prop.buyerId === row.parentId ? prop.buyerDecision : prop.sellerDecision;
          await say(mine === "accepted" ? t.accepted(op?.name ?? "the other side") : t.otherAccepted(op?.name ?? "The other side"));
        }
        return;
      }
      case "trade:completed": {
        const prop = await db.MatchProposal.get(p.proposalId).catch(() => null);
        const s = prop?.snapshot ?? {};
        const gif = p.flowersUrl ?? `https://${secret("APP_HOST") || "app"}/fx/flowers.gif`;
        if (prop?.buyerId === row.parentId) {
          const item = p.itemId ? await db.ClothingItem.get(p.itemId).catch(() => null) : null;
          await say(t.completed(s.itemName ?? "new item", shortDate(item?.predictedOutgrowDate ?? "")), gif);
        } else {
          await say(t.sold(s.itemName ?? "item", s.priceCents ?? 0), gif);
        }
        return;
      }
    }
    return;
  }

  if (row.type === "encounter") {
    // The encounter itself is resolved by runLocalFallback after 8 s; nothing to say yet.
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
    await setConvo(db, parent, { step: "await_condition", itemId, condition, note, photoUrl: photos[0] });
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
      const c = await closet(base44, parent.id);
      const nudge = (c.nudges ?? []).find((n: any) => !n.resolved && n.kind === "outgrow_check");
      const item = nudge ? (c.items ?? []).find((i: any) => i.id === nudge.itemId) : null;
      if (!item) return void await say(t.nothingDue());
      if (item.ownerCount >= 3) return void await say(t.finalHome(item.name));
      await setConvo(db, parent, { step: "await_photo", itemId: item.id, nudgeId: nudge.id });
      return void await say(t.askPhoto(item.name));
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
      const r = await invoke(base44, "listItem", {
        itemId: convo.itemId,
        sellerId: parent.id,
        condition: convo.condition ?? "gently_used",
        conditionNote: convo.note ?? "",
        photos: convo.photoUrl ? [convo.photoUrl] : [],
        shared: true,
      });
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
      const c = await closet(base44, parent.id);
      const open = (c.proposals ?? []).find((pr: any) => pr.status === "open");
      if (!open) return void await say(t.noOpenProposal());
      await invoke(base44, "decideProposal", { proposalId: open.id, parentId: parent.id, decision: intent === "accept" ? "accepted" : "declined" });
      return; // B's decideProposal emits proposal:updated → we answer there
    }
    case "pay": {
      const c = await closet(base44, parent.id);
      const open = (c.proposals ?? []).find((pr: any) => pr.status === "both_accepted" && pr.buyerId === parent.id);
      if (!open) return void await say(t.noOpenProposal());
      const link = tradeLink(open, parent);
      return void await say(t.bothAccepted(link));
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
