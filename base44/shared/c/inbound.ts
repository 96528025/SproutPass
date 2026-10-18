// (C) inbound.ts — what photonWebhook does with one parsed `message.received`, testable with a fake db:
//   1. dedupe on the Photon message id (webhooks can redeliver),
//   2. map sentBy.handle → Parent by phone (unknown numbers are ignored, rule 12),
//   3. cache the Photon ids on the Parent — user, space AND the line they texted (lines.ts), so the pet replies
//      from that parent's own pool number,
//   4. turn attachments into URLs (the caller's uploader) and write AgentInbox{type:"imessage"} for the agents.

// deno-lint-ignore-file no-explicit-any
import { normalizePhone, type InboundMessage } from "./photon.ts";
import { inboundParentPatch } from "./lines.ts";

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
  if (recent.some((r) => r.payload?.messageId === msg.messageId)) return { result: "duplicate" };

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
    payload: { messageId: msg.messageId, text: msg.text, photoUrls, receivedAt: new Date().toISOString() },
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  return { result: "accepted", parentId: parent.id, inboxId: row?.id };
}
