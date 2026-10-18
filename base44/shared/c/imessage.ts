// (C) imessage.ts — send a text (and optional image) to one parent over iMessage.
// Used by the sendImessage function and by the inbox fallback sweep.
//
// Guards (rule 12): only Parent rows with a phone are messaged, and if the
// SEED_PHONES secret is set the phone must be in it. Setting.imessage=false
// turns the whole channel into a no-op that still logs the line, so the demo
// runs without Photon credentials.
// Trust: a parent who texted STOP (Parent.convo.optedOut) gets no iMessage until START (the in-app pet still
// speaks); anything that looks like a phone number is masked before it leaves (wording.ts redactPhones); and a
// per-parent cap (OUTBOUND_PER_MINUTE) stops a runaway loop from flooding anyone's phone.

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
import { redactPhones } from "./wording.ts";

/** At most this many iMessages per parent per minute (per warm isolate); more are skipped, not queued. */
export const OUTBOUND_PER_MINUTE = 20;
const OUTBOUND_WINDOW_MS = 60_000;
const sentAt = new Map<string, number[]>();

/** The outbound cap: true (and counted) when this parent may get one more text now. */
export function outboundAllowed(parentId: string, nowMs: number = Date.now()): boolean {
  const recent = (sentAt.get(parentId) ?? []).filter((t) => nowMs - t < OUTBOUND_WINDOW_MS && t <= nowMs);
  const ok = recent.length < OUTBOUND_PER_MINUTE;
  if (ok) recent.push(nowMs);
  sentAt.set(parentId, recent);
  return ok;
}

/** Tests: forget the outbound counts. */
export function resetOutboundLimiter(): void {
  sentAt.clear();
}

export interface SendOpts {
  /** The one line a parent who texted STOP may still get: the answer to their HELP. */
  evenIfOptedOut?: boolean;
  /** Only set from a verified inbound webhook, never from a browser-supplied destination. */
  replyTo?: { spaceId: string; lineUserId: string };
}

export interface SendResult {
  sent: boolean;
  skipped?: string;
  messageId?: string;
}

export async function sendToParent(
  db: any,
  parentId: string,
  rawText: string,
  imageUrl?: string,
  opts: SendOpts = {},
): Promise<SendResult> {
  const setting = await getSetting(db);
  const parent = await db.Parent.get(parentId).catch(() => null);
  if (!parent) return { sent: false, skipped: "unknown parent" };
  const text = redactPhones(rawText);
  let petLineId: string | undefined;
  const finish = async (result: SendResult, imageSent = false): Promise<SendResult> => {
    try { if (petLineId) await db.PetLine?.update?.(petLineId, {
      deliveryStatus: result.sent ? "submitted" : "not_sent",
      deliveryReason: result.skipped ?? "",
      photonMessageId: result.messageId ?? "",
      imageSubmitted: imageSent,
    }); } catch { /* Send result remains valid even if the audit write fails. */ }
    return result;
  };

  // Always mirror the line into the in-app pet (AgentPet reads PetLine rows),
  // even when iMessage is off, so the dialog box and the thread agree.
  try {
    const line = await db.PetLine?.create({
      parentId,
      text,
      imageUrl: imageUrl ?? null,
      createdAt: new Date().toISOString(),
      deliveryStatus: "pending",
    });
    petLineId = line?.id;
  } catch { /* entity optional, see NEEDS.md */ }

  if (!setting.imessage) return finish({ sent: false, skipped: "Setting.imessage=false" });
  if (!parent.phone) return finish({ sent: false, skipped: "parent has no phone" });
  if (parent.convo?.optedOut && !opts.evenIfOptedOut) return finish({ sent: false, skipped: "parent texted STOP" });

  const allow = secret("SEED_PHONES");
  if (allow) {
    const ok = allow.split(/[,\s]+/).filter(Boolean).map(normalizePhone).includes(normalizePhone(parent.phone));
    if (!ok) return finish({ sent: false, skipped: "phone not in SEED_PHONES" });
  }
  const apiKey = secret("PHOTON_API_KEY"), projectId = secret("PHOTON_PROJECT_ID");
  if (!apiKey || !projectId) return finish({ sent: false, skipped: "no PHOTON secrets" });
  // Each parent's pet answers from the line that parent texted (Photon's shared pool gives every phone its own
  // number, and a shared line can't send the first message). Learned from the parent's first inbound "hi".
  const senderId = opts.replyTo?.lineUserId ?? senderLineFor(parent);
  if (!senderId) {
    return finish({ sent: false, skipped: "no iMessage line yet — text your assigned Photon number 'hi' first" });
  }
  if (!outboundAllowed(parent.id)) return finish({ sent: false, skipped: "rate limited" });
  const cfg: PhotonCfg = { apiKey, projectId };

  let res: any;
  let imageSubmitted = false;
  try {
    // Normally both come with the inbound message; create only what's missing, and write back only what we
    // created so a newer {space, line} from the webhook is never overwritten.
    let userId: string = parent.photonUserId;
    let spaceId: string = opts.replyTo?.spaceId ?? parent.photonSpaceId;
    const created: Record<string, string> = {};
    if (!userId && !opts.replyTo) created.photonUserId = userId = await ensureUser(cfg, parent.phone);
    if (!spaceId) created.photonSpaceId = spaceId = await ensureSpace(cfg, senderId, userId);
    if (Object.keys(created).length) await db.Parent.update(parent.id, created).catch(() => {});

    res = await sendText(cfg, { spaceId, senderId, text });
    if (imageUrl) imageSubmitted = await sendImage(cfg, spaceId, senderId, imageUrl);
  } catch (e) {
    // Photon said no (expired assignment, rate limit, …): report it instead of failing the caller's whole step.
    if (e instanceof PhotonError) {
      console.error("[C] iMessage not sent", e.message);
      return finish({ sent: false, skipped: `photon ${e.status}` });
    }
    await finish({ sent: false, skipped: "send failed" });
    throw e;
  }
  return finish({ sent: true, messageId: res?.id }, imageSubmitted);
}

/** The flowers GIF etc.: best effort after the text, same line and space. */
async function sendImage(cfg: PhotonCfg, spaceId: string, senderId: string, imageUrl: string): Promise<boolean> {
  try {
    const r = await fetch(imageUrl);
    if (!r.ok) throw new Error(`Image unavailable (${r.status})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const contentType = r.headers.get("content-type") ?? "image/gif";
    const attachmentId = await uploadAttachment(cfg, { bytes, contentType, filename: imageUrl.split("/").pop() ?? "image.gif" });
    await sendAttachment(cfg, { spaceId, senderId, attachmentId });
    return true;
  } catch (e) {
    console.error("[C] image send failed (text was submitted)", e);
    return false;
  }
}
