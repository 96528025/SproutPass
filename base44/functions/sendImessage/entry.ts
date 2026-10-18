// (C) sendImessage — iMessage out.
// Body: { parentId, text?, imageUrl? }   (agents and B's functions call this)
// Returns: { sent, skipped?, messageId? }

// deno-lint-ignore-file no-explicit-any
import { handle, HttpError, readJson, resolveCaller } from "../_lib/auth.ts";
import { sendToParent } from "../_lib/imessage.ts";

export default handle(async (req) => {
  const { db } = await resolveCaller(req);
  const { parentId, text, imageUrl } = await readJson<any>(req);
  if (!parentId) throw new HttpError(400, "parentId required");
  if (!text && !imageUrl) throw new HttpError(400, "text or imageUrl required");
  const line = String(text ?? "").slice(0, 600); // ≤ 2 sentences in practice
  return await sendToParent(db, parentId, line, imageUrl);
});
