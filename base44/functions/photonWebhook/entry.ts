// (C) photonWebhook — iMessage in. Photon POSTs `message.received` here.
// URL: https://<slug>.base44.app/functions/photonWebhook?k=<WEBHOOK_KEY>
//
// Does as little as possible and returns 200 fast (Photon retries on non-2xx):
//   1. parse the event, map sentBy.handle → Parent (ignore unknown numbers, rule 12)
//   2. attachments → Photon content → Base44 UploadFile → url
//   3. remember the line's own user id (Setting.lineUserId) the first time
//   4. write AgentInbox{type:"imessage"} for the Python agent to claim
//   5. write a "fallback due" marker: if the agent hasn't marked it done in 5 s,
//      the next sendImessage/agentApi tick answers with a template line.

// deno-lint-ignore-file no-explicit-any
import { handle, readJson, resolveCaller, requireSecret, getSetting } from "../_lib/auth.ts";
import { fetchAttachmentContent, normalizePhone, parseInbound } from "../_lib/photon.ts";

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req, { allowWebhook: true });
  const event = await readJson<any>(req);

  // Photon may batch or wrap; accept {events:[...]} too.
  const events: any[] = Array.isArray(event?.events) ? event.events : [event];
  let accepted = 0;
  for (const ev of events) {
    const msg = parseInbound(ev);
    if (!msg) continue;

    // Dedupe on message id (webhooks can redeliver).
    // (nested-field filters aren't documented for Base44, so compare in JS)
    const recent: any[] = await db.AgentInbox.filter({ type: "imessage" }, "-createdAt", 50).catch(() => []);
    if (recent.some((r) => r.payload?.messageId === msg.messageId)) continue;

    const parents: any[] = await db.Parent.list();
    const parent = parents.find((p) => p.phone && normalizePhone(p.phone) === normalizePhone(msg.fromHandle));
    if (!parent) {
      console.log("[C] ignoring iMessage from unknown handle");
      continue;
    }

    // Cache the Photon ids on the Parent so sendImessage can skip steps 1–2.
    const patch: any = {};
    if (msg.fromUserId && parent.photonUserId !== msg.fromUserId) patch.photonUserId = msg.fromUserId;
    if (msg.spaceId && parent.photonSpaceId !== msg.spaceId) patch.photonSpaceId = msg.spaceId;
    if (Object.keys(patch).length) await db.Parent.update(parent.id, patch).catch(() => {});

    // Save the line's own user id once.
    if (msg.lineUserId) {
      const s = await getSetting(db);
      if (s.id && !s.lineUserId) await db.Setting.update(s.id, { lineUserId: msg.lineUserId });
    }

    // Attachments → public URLs the agent (and InvokeLLM) can read.
    const photoUrls: string[] = [];
    if (msg.attachmentIds.length) {
      const cfg = { apiKey: requireSecret("PHOTON_API_KEY"), projectId: requireSecret("PHOTON_PROJECT_ID") };
      for (const id of msg.attachmentIds.slice(0, 3)) {
        try {
          const { bytes, contentType } = await fetchAttachmentContent(cfg, id);
          const ext = contentType.includes("png") ? "png" : contentType.includes("heic") ? "heic" : "jpg";
          const file = new File([new Blob([bytes as unknown as ArrayBuffer])], `imsg-${id}.${ext}`, { type: contentType });
          const up = await base44.integrations.Core.UploadFile({ file });
          if (up?.file_url) photoUrls.push(up.file_url);
        } catch (e) {
          console.error("[C] attachment fetch failed", e);
        }
      }
    }

    await db.AgentInbox.create({
      parentId: parent.id,
      type: "imessage",
      payload: {
        messageId: msg.messageId,
        text: msg.text,
        photoUrls,
        receivedAt: new Date().toISOString(),
      },
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    accepted++;
  }
  return { ok: true, accepted };
});
