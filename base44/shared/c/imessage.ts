// (C) imessage.ts — send a text (and optional image) to one parent over iMessage.
// Used by the sendImessage function and by the inbox fallback sweep.
//
// Guards (rule 12): only Parent rows with a phone are messaged, and if the
// SEED_PHONES secret is set the phone must be in it. Setting.imessage=false
// turns the whole channel into a no-op that still logs the line, so the demo
// runs without Photon credentials.

// deno-lint-ignore-file no-explicit-any
import { getSetting, secret } from "./auth.ts";
import {
  ensureSpace,
  ensureUser,
  normalizePhone,
  type PhotonCfg,
  sendAttachment,
  sendText,
  uploadAttachment,
} from "./photon.ts";

export interface SendResult {
  sent: boolean;
  skipped?: string;
  messageId?: string;
}

export async function sendToParent(
  db: any,
  parentId: string,
  text: string,
  imageUrl?: string,
): Promise<SendResult> {
  const setting = await getSetting(db);
  const parent = await db.Parent.get(parentId).catch(() => null);
  if (!parent) return { sent: false, skipped: "unknown parent" };

  // Always mirror the line into the in-app pet (AgentPet reads PetLine rows),
  // even when iMessage is off, so the dialog box and the thread agree.
  await db.PetLine.create({
    parentId,
    text,
    imageUrl: imageUrl ?? null,
    createdAt: new Date().toISOString(),
  }).catch(() => {/* entity optional, see NEEDS.md */});

  if (!setting.imessage) return { sent: false, skipped: "Setting.imessage=false" };
  if (!parent.phone) return { sent: false, skipped: "parent has no phone" };

  const allow = secret("SEED_PHONES");
  if (allow) {
    const ok = allow.split(/[,\s]+/).filter(Boolean).map(normalizePhone).includes(normalizePhone(parent.phone));
    if (!ok) return { sent: false, skipped: "phone not in SEED_PHONES" };
  }
  const apiKey = secret("PHOTON_API_KEY"), projectId = secret("PHOTON_PROJECT_ID");
  if (!apiKey || !projectId) return { sent: false, skipped: "no PHOTON secrets" };
  if (!setting.lineUserId) {
    // The line's own user id arrives with the first inbound "hi" (rule 12).
    return { sent: false, skipped: "Setting.lineUserId empty — text the line 'hi' first" };
  }
  const cfg: PhotonCfg = { apiKey, projectId };

  let userId: string = parent.photonUserId;
  let spaceId: string = parent.photonSpaceId;
  if (!userId) userId = await ensureUser(cfg, parent.phone);
  if (!spaceId) spaceId = await ensureSpace(cfg, userId);
  if (userId !== parent.photonUserId || spaceId !== parent.photonSpaceId) {
    await db.Parent.update(parent.id, { photonUserId: userId, photonSpaceId: spaceId }).catch(() => {});
  }

  const res = await sendText(cfg, { spaceId, senderId: setting.lineUserId, text });
  if (imageUrl) {
    try {
      const r = await fetch(imageUrl);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const contentType = r.headers.get("content-type") ?? "image/gif";
      const attachmentId = await uploadAttachment(cfg, {
        bytes,
        contentType,
        filename: imageUrl.split("/").pop() ?? "image.gif",
      });
      await sendAttachment(cfg, { spaceId, senderId: setting.lineUserId, attachmentId });
    } catch (e) {
      console.error("[C] image send failed (text was delivered)", e);
    }
  }
  return { sent: true, messageId: res?.id };
}
