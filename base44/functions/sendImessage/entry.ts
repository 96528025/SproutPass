// (C) sendImessage — iMessage out. Agents only: header `x-agent-key: <AGENT_KEY>`.
// Body: { parentId, text?, imageUrl? }   (the Python agents call this; B's handlers write AgentInbox events)
// Returns: { sent, skipped?, messageId? }
//
// Never callable from a browser: it texts a parent's real phone and fetches `imageUrl` server-side, and parent
// ids are public (getParties / Parent read). The app has no reason to call it.
// sendToParent (shared/c/imessage.ts) applies the same rules as the pet's own replies: STOP is respected, phone
// numbers are masked, and each parent gets at most OUTBOUND_PER_MINUTE texts a minute.

// deno-lint-ignore-file no-explicit-any
import { handle, HttpError, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { sendToParent } from "../../shared/c/imessage.ts";

export default handle(async (req) => {
  const { db, kind } = await resolveCaller(req);
  if (kind !== "agent") throw new HttpError(401, "x-agent-key required");
  const { parentId, text, imageUrl } = await readJson<any>(req);
  if (!parentId || typeof parentId !== "string") throw new HttpError(400, "parentId required");
  if (!text && !imageUrl) throw new HttpError(400, "text or imageUrl required");
  if (imageUrl && !/^https?:\/\//.test(String(imageUrl))) throw new HttpError(400, "imageUrl must be a web link");
  const line = String(text ?? "").slice(0, 600); // ≤ 2 sentences in practice
  return await sendToParent(db, parentId, line, imageUrl);
});
