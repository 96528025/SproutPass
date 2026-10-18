// (C) photonWebhook — iMessage in. Photon POSTs `message.received` here.
// URL: https://<slug>.base44.app/functions/photonWebhook?k=<WEBHOOK_KEY>
//
// Does as little as possible and returns 200 fast (Photon retries on non-2xx). Per message (shared/c/inbound.ts):
//   1. dedupe on the Photon message id, map sentBy.handle → Parent (ignore unknown numbers, rule 12)
//   2. remember the parent's Photon user, space and the line they texted (Parent.photonLineUserId): Photon's
//      shared pool gives each phone its own number, and the pet must answer from it
//   3. attachments → Photon content → Base44 UploadFile → url
//   4. write AgentInbox{type:"imessage"} for the Python agent to claim; if nobody has answered in 5 s the next
//      updatePresence/demoWalk/agentApi tick answers with a template line (inboxFallback.ts).

// deno-lint-ignore-file no-explicit-any
import { handle, readJson, resolveCaller, requireSecret } from "../../shared/c/auth.ts";
import { fetchAttachmentContent, parseInbound } from "../../shared/c/photon.ts";
import { recordInbound } from "../../shared/c/inbound.ts";

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req, { allowWebhook: true });
  const event = await readJson<any>(req);

  // Photon may batch or wrap; accept {events:[...]} too.
  const events: any[] = Array.isArray(event?.events) ? event.events : [event];
  let accepted = 0;
  for (const ev of events) {
    const msg = parseInbound(ev);
    if (!msg) continue;
    const out = await recordInbound(db, msg, (ids) => uploadPhotos(base44, ids));
    if (out.result === "accepted") accepted++;
    else if (out.result === "unknown_handle") console.log("[C] ignoring iMessage from unknown handle");
  }
  return { ok: true, accepted };
});

/** Attachments → public URLs the agent (and InvokeLLM) can read. */
async function uploadPhotos(base44: any, attachmentIds: string[]): Promise<string[]> {
  const cfg = { apiKey: requireSecret("PHOTON_API_KEY"), projectId: requireSecret("PHOTON_PROJECT_ID") };
  const urls: string[] = [];
  for (const id of attachmentIds) {
    try {
      const { bytes, contentType } = await fetchAttachmentContent(cfg, id);
      const ext = contentType.includes("png") ? "png" : contentType.includes("heic") ? "heic" : "jpg";
      const file = new File([new Blob([bytes as unknown as ArrayBuffer])], `imsg-${id}.${ext}`, { type: contentType });
      const up = await base44.integrations.Core.UploadFile({ file });
      if (up?.file_url) urls.push(up.file_url);
    } catch (e) {
      console.error("[C] attachment fetch failed", e);
    }
  }
  return urls;
}
