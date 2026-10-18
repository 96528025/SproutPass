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
  PhotonError,
  sendAttachment,
  sendText,
  uploadAttachment,
} from "./photon.ts";
import { senderLineFor } from "./lines.ts";

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
  // Each parent's pet answers from the line that parent texted (Photon's shared pool gives every phone its own
  // number, and a shared line can't send the first message). Learned from the parent's first inbound "hi".
  const senderId = senderLineFor(parent);
  if (!senderId) {
    return { sent: false, skipped: "no iMessage line yet — text your assigned Photon number 'hi' first" };
  }
  const cfg: PhotonCfg = { apiKey, projectId };

  let res: any;
  try {
    // Normally both come with the inbound message; create only what's missing, and write back only what we
    // created so a newer {space, line} from the webhook is never overwritten.
    let userId: string = parent.photonUserId;
    let spaceId: string = parent.photonSpaceId;
    const created: Record<string, string> = {};
    if (!userId) created.photonUserId = userId = await ensureUser(cfg, parent.phone);
    if (!spaceId) created.photonSpaceId = spaceId = await ensureSpace(cfg, senderId, userId);
    if (Object.keys(created).length) await db.Parent.update(parent.id, created).catch(() => {});

    res = await sendText(cfg, { spaceId, senderId, text });
    if (imageUrl) await sendImage(cfg, spaceId, senderId, imageUrl);
  } catch (e) {
    // Photon said no (expired assignment, rate limit, …): report it instead of failing the caller's whole step.
    if (e instanceof PhotonError) {
      console.error("[C] iMessage not sent", e.message);
      return { sent: false, skipped: `photon ${e.status}` };
    }
    throw e;
  }
  return { sent: true, messageId: res?.id };
}

/** The flowers GIF etc.: best effort after the text, same line and space. */
async function sendImage(cfg: PhotonCfg, spaceId: string, senderId: string, imageUrl: string): Promise<void> {
  try {
    const r = await fetch(imageUrl);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const contentType = r.headers.get("content-type") ?? "image/gif";
    const attachmentId = await uploadAttachment(cfg, { bytes, contentType, filename: imageUrl.split("/").pop() ?? "image.gif" });
    await sendAttachment(cfg, { spaceId, senderId, attachmentId });
  } catch (e) {
    console.error("[C] image send failed (text was delivered)", e);
  }
}
