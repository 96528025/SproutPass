// (C) inbound.ts — what photonWebhook does, testable with a fake db and a stubbed Photon.
//
// handlePhotonWebhook (one delivery):
//   0. when PHOTON_WEBHOOK_SECRET is set, the delivery must carry a valid signature (photon.ts
//      verifyWebhookSignature) — on top of the ?k= key auth.ts already checked,
//   1. parse `message.received` events (Photon may batch: {events:[…]}),
//   2. recordInbound each one (below),
//   3. answer each new text right away (inboxFallback answerInboxNow: same request, no app tick needed),
//   4. then drain the events those answers caused (a text "accept" → proposal:updated for both parents).
//
// recordInbound (one message):
//   1. dedupe on the Photon message id (webhooks can redeliver),
//   2. map sentBy.handle → Parent by phone (unknown numbers are ignored and never answered, rule 12),
//   3. cache the Photon ids on the Parent — user, space AND the line they texted (lines.ts), so the pet replies
//      from that parent's own pool number,
//   4. turn attachments into URLs (the caller's uploader) and write AgentInbox{type:"imessage"}.
// Phone numbers never leave this file: not in the response, not in logs, not in the inbox row.

// deno-lint-ignore-file no-explicit-any
import { normalizePhone, parseInbound, type InboundMessage, verifyWebhookSignature } from "./photon.ts";
import { inboundParentPatch } from "./lines.ts";
import { answerInboxNow, drainEvents } from "./inboxFallback.ts";
import { HttpError } from "./auth.ts";

export type InboundOutcome =
  | { result: "duplicate" }
  | { result: "unknown_handle" }
  | { result: "accepted"; parentId: string; inboxId?: string };

export async function recordInbound(
  db: any,
  msg: InboundMessage,
  uploadPhotos: (attachmentIds: string[]) => Promise<string[]>,
): Promise<InboundOutcome> {
  // (nested-field filters aren't documented for Base44, so compare in JS)
  const recent: any[] = await db.AgentInbox.filter({ type: "imessage" }, "-createdAt", 50).catch(() => []);
  if (msg.messageId && recent.some((r) => r.payload?.messageId === msg.messageId)) return { result: "duplicate" };

  const parents: any[] = await db.Parent.list();
  const parent = parents.find((p) => p.phone && normalizePhone(p.phone) === normalizePhone(msg.fromHandle));
  if (!parent) return { result: "unknown_handle" };

  // Written before the inbox row, so the reply to this very "hi" already goes out from the right line.
  const patch = inboundParentPatch(parent, msg);
  if (Object.keys(patch).length) await db.Parent.update(parent.id, patch).catch(() => {});

  const photoUrls = msg.attachmentIds.length ? await uploadPhotos(msg.attachmentIds.slice(0, 3)) : [];
  const row = await db.AgentInbox.create({
    parentId: parent.id,
    type: "imessage",
    payload: { messageId: msg.messageId, text: msg.text.slice(0, 2000), photoUrls, receivedAt: new Date().toISOString() },
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  return { result: "accepted", parentId: parent.id, inboxId: row?.id };
}

export interface WebhookInput {
  base44: any;            // service-role client (inboxFallback runs B's handlers on base44.entities)
  db: any;
  rawBody: string;        // the exact bytes Photon signed
  headers: Headers;
  signingSecret?: string; // PHOTON_WEBHOOK_SECRET ("whsec_…", several allowed during a rotation)
  uploadPhotos: (attachmentIds: string[]) => Promise<string[]>;
  nowMs?: number;
}

export interface WebhookResult { ok: true; accepted: number; answered: number }

export async function handlePhotonWebhook(input: WebhookInput): Promise<WebhookResult> {
  if (input.signingSecret) {
    const check = await verifyWebhookSignature(input.signingSecret, input.headers, input.rawBody, input.nowMs);
    if (!check.ok) throw new HttpError(401, `bad webhook signature: ${check.reason}`);
  }
  let body: any;
  try {
    body = JSON.parse(input.rawBody || "{}");
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
  const events: any[] = Array.isArray(body?.events) ? body.events : [body];
  let accepted = 0, answered = 0;
  for (const ev of events) {
    const msg = parseInbound(ev);
    if (!msg) continue;
    const out = await recordInbound(input.db, msg, input.uploadPhotos);
    if (out.result === "unknown_handle") console.log("[C] ignoring an iMessage from a number that isn't a demo parent");
    if (out.result !== "accepted") continue;
    accepted++;
    try {
      if (out.inboxId && await answerInboxNow(input.base44, input.db, out.inboxId)) answered++;
    } catch (e) {
      // Only the inbox read / claim can throw here (a failed answer already sent "busy" and closed the row), so
      // the row is still pending and the next sweep answers it.
      console.error("[C] immediate reply failed, row left pending", (e as Error)?.message ?? e);
    }
  }
  if (accepted) await drainEvents(input.base44, input.db).catch((e) => console.error("[C] drain", (e as Error)?.message ?? e));
  return { ok: true, accepted, answered };
}
