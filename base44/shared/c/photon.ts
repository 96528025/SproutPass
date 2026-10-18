// (C) photon.ts — thin client for Photon 2.0 REST (https://api.photon.codes/v1).
//
// Checked Oct 18 against https://api.photon.codes/openapi.json: the paths below, Bearer auth, the users / spaces /
// messages / webhook-destination bodies, apiVersion "2026-07-01", the idempotency-key header (required on
// messages, attachments, spaces and webhook destinations), and the message.received shape (data.object.sentBy /
// receivedBy / space / content). Every path is a constant here so a rename is a one-line fix.

export const PHOTON_BASE = "https://api.photon.codes/v1";
export const PHOTON_API_VERSION = "2026-07-01";

export interface PhotonCfg {
  apiKey: string; // pho_sk_…
  projectId: string;
}

export const paths = {
  users: (p: string) => `/projects/${p}/users`,
  spaces: (p: string) => `/projects/${p}/spaces`,
  messages: (p: string) => `/projects/${p}/messages`,
  attachments: (p: string) => `/projects/${p}/attachments`,
  attachmentContent: (p: string, id: string) => `/projects/${p}/attachments/${id}/content`,
  webhookDestinations: (p: string) => `/projects/${p}/webhooks/destinations`,
  webhookEventTypes: (p: string) => `/projects/${p}/webhooks/event-types`,
};

export class PhotonError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`photon ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

async function call(
  cfg: PhotonCfg,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: "application/json",
    ...extraHeaders,
  };
  // Photon REQUIRES an idempotency-key (visible ASCII, ≤ 255) on POST /messages, /attachments, /spaces and webhook
  // destinations. Callers pass a stable key where a retry must replay (spaces; users, where it's harmless); every
  // other POST gets a fresh one. Never reuse a key with a different body: Photon answers 422 IDEMPOTENCY_KEY_REUSED.
  if (method === "POST" && !Object.keys(headers).some((h) => h.toLowerCase() === "idempotency-key")) {
    headers["idempotency-key"] = crypto.randomUUID();
  }
  let payload: BodyInit | undefined;
  if (body instanceof Uint8Array || body instanceof Blob) {
    payload = body as BodyInit;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(PHOTON_BASE + path, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new PhotonError(res.status, text);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/** Step 1 of sendImessage: a Photon user for a phone handle. */
export async function ensureUser(cfg: PhotonCfg, handle: string): Promise<string> {
  const r = await call(cfg, "POST", paths.users(cfg.projectId), {
    handle,
    platform: "imessage",
  }, { "idempotency-key": `user:${normalizePhone(handle)}` });   // digits only: the key must be visible ASCII
  return r.id ?? r.userId ?? r.user?.id;
}

/**
 * Step 2: the direct space between our line and that user. iMessage spaces need 2+ participants and a project-owned
 * agent; the creator (our line) goes first. The idempotency key binds the participants for 24 h, so it names both.
 * (Rarely needed: an inbound message already carries its space, and photonWebhook caches it with the line.)
 */
export async function ensureSpace(cfg: PhotonCfg, lineUserId: string, userId: string): Promise<string> {
  const r = await call(cfg, "POST", paths.spaces(cfg.projectId), {
    participantIds: [lineUserId, userId],
    platform: "imessage",
  }, { "idempotency-key": `space:${lineUserId}:${userId}` });
  return r.id ?? r.spaceId ?? r.space?.id;
}

/** Step 3: a text message from our line (senderId = lineUserId). */
export async function sendText(
  cfg: PhotonCfg,
  args: { spaceId: string; senderId: string; text: string; idem?: string },
): Promise<any> {
  return call(cfg, "POST", paths.messages(cfg.projectId), {
    spaceId: args.spaceId,
    senderId: args.senderId,
    content: { type: "text", format: "plain", text: args.text },
  }, args.idem ? { "idempotency-key": args.idem } : {});
}

/**
 * Upload bytes as an attachment: multipart/related, part 1 = JSON metadata,
 * part 2 = the bytes. Returns the attachmentId.
 */
export async function uploadAttachment(
  cfg: PhotonCfg,
  file: { bytes: Uint8Array; contentType: string; filename: string },
): Promise<string> {
  const boundary = `photon-${crypto.randomUUID()}`;
  const meta = JSON.stringify({
    contentType: file.contentType,
    sizeBytes: file.bytes.byteLength,
    filename: file.filename,
  });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head, 0);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  const r = await call(cfg, "POST", paths.attachments(cfg.projectId), body, {
    "Content-Type": `multipart/related; boundary=${boundary}`,
  });
  return r.id ?? r.attachmentId;
}

export async function sendAttachment(
  cfg: PhotonCfg,
  args: { spaceId: string; senderId: string; attachmentId: string },
): Promise<any> {
  return call(cfg, "POST", paths.messages(cfg.projectId), {
    spaceId: args.spaceId,
    senderId: args.senderId,
    content: { type: "attachment", attachmentId: args.attachmentId },
  });
}

/** Download an inbound attachment's bytes (webhook → UploadFile). */
export async function fetchAttachmentContent(
  cfg: PhotonCfg,
  attachmentId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(PHOTON_BASE + paths.attachmentContent(cfg.projectId, attachmentId), {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) throw new PhotonError(res.status, await res.text());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
}

/** One-time setup helper (also runnable from the Photon dashboard). */
export async function registerWebhook(
  cfg: PhotonCfg,
  args: { name: string; url: string },
): Promise<any> {
  return call(cfg, "POST", paths.webhookDestinations(cfg.projectId), {
    name: args.name,
    url: args.url,
    apiVersion: PHOTON_API_VERSION,
    enabledEvents: ["message.received"],
  });
}

export async function listEventTypes(cfg: PhotonCfg): Promise<any> {
  return call(cfg, "GET", `${paths.webhookEventTypes(cfg.projectId)}?apiVersion=${PHOTON_API_VERSION}`);   // apiVersion is a required query
}

/* ---------- inbound event parsing (pure, unit-testable) ---------- */

export interface InboundMessage {
  messageId: string;
  fromHandle: string; // sentBy.handle (phone)
  fromUserId?: string;
  lineUserId?: string; // receivedBy user id: the line this parent texts → Parent.photonLineUserId (lines.ts)
  spaceId?: string;
  text: string;
  attachmentIds: string[];
}

/**
 * Pull what we need out of a `message.received` event. Field paths are kept
 * tolerant (`data.object` per the brief, `data` as a fallback) so a small
 * shape change in Photon doesn't drop messages.
 */
export function parseInbound(event: any): InboundMessage | null {
  if (!event || event.type !== "message.received") return null;
  const m = event.data?.object ?? event.data ?? event.object;
  if (!m) return null;
  const sentBy = m.sentBy ?? {};
  const receivedBy = m.receivedBy ?? {};
  const content: any[] = Array.isArray(m.content) ? m.content : (m.content ? [m.content] : []);
  const text = content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("\n").trim();
  const attachmentIds = content.filter((c) => c?.type === "attachment" && c.attachmentId).map((c) => c.attachmentId);
  const fromHandle = sentBy.handle ?? sentBy.address ?? sentBy.phone ?? "";
  if (!fromHandle) return null;
  return {
    messageId: m.id ?? event.id,
    fromHandle,
    fromUserId: sentBy.userId ?? sentBy.id,
    lineUserId: receivedBy.userId ?? receivedBy.id,
    spaceId: m.spaceId ?? m.space?.id,
    text,
    attachmentIds,
  };
}

/** Normalise phones so "+1 (310) 555-0100" and "13105550100" match the seed. */
export function normalizePhone(h: string): string {
  const digits = (h ?? "").replace(/[^\d]/g, "");
  if (!digits) return (h ?? "").trim().toLowerCase(); // e-mail style handle
  return digits.length === 10 ? `1${digits}` : digits;
}
