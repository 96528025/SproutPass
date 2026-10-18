// (C) photonWebhook — iMessage in. Photon POSTs `message.received` here.
// URL: https://<slug>.base44.app/functions/photonWebhook?k=<WEBHOOK_KEY>
//
// Auth: the ?k= key always (auth.ts), plus the delivery's signature when the PHOTON_WEBHOOK_SECRET secret is set
// (the "whsec_…" secret Photon returns when the webhook destination is created or its secret rotated).
//
// Per message (shared/c/inbound.ts handlePhotonWebhook):
//   1. dedupe on the Photon message id, map sentBy.handle → Parent (ignore unknown numbers, rule 12)
//   2. remember the parent's Photon user, space and the line they texted (Parent.photonLineUserId): Photon's
//      shared pool gives each phone its own number, and the pet must answer from it
//   3. attachments → Photon content → Base44 UploadFile → url
//   4. write AgentInbox{type:"imessage"} and answer it in this same request (inboxFallback.ts), then send the
//      texts that answer caused (e.g. "Mina accepted — your turn!" to the other parent).
// Returns 200 with counts only (never a phone number); a redelivery of the same message is a no-op.

// deno-lint-ignore-file no-explicit-any
import { handle, requireSecret, resolveCaller, secret } from "../../shared/c/auth.ts";
import { fetchAttachmentContent } from "../../shared/c/photon.ts";
import { handlePhotonWebhook } from "../../shared/c/inbound.ts";

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req, { allowWebhook: true });
  const rawBody = await req.text(); // the exact bytes Photon signed
  return await handlePhotonWebhook({
    base44,
    db,
    rawBody,
    headers: req.headers,
    signingSecret: secret("PHOTON_WEBHOOK_SECRET") || undefined,
    uploadPhotos: (ids) => uploadPhotos(base44, ids),
  });
});

/** Attachments → public URLs the pet's photo guess (InvokeLLM) can read. */
async function uploadPhotos(base44: any, attachmentIds: string[]): Promise<string[]> {
  const cfg = { apiKey: requireSecret("PHOTON_API_KEY"), projectId: requireSecret("PHOTON_PROJECT_ID") };
  const urls: string[] = [];
  for (const id of attachmentIds) {
    try {
      const { bytes, contentType } = await fetchAttachmentContent(cfg, id);
      if (!contentType.startsWith("image/")) continue;
      const ext = contentType.includes("png") ? "png" : contentType.includes("heic") ? "heic" : "jpg";
      const file = new File([new Blob([bytes as unknown as ArrayBuffer])], `imsg-${id}.${ext}`, { type: contentType });
      const up = await base44.integrations.Core.UploadFile({ file });
      if (up?.file_url) urls.push(up.file_url);
    } catch (e) {
      console.error("[C] attachment fetch failed", (e as Error)?.message ?? e);
      throw e; // Let Photon retry; never acknowledge a photo that wasn't stored.
    }
  }
  return urls;
}
