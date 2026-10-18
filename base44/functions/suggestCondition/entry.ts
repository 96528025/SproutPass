// (C) suggestCondition — the app's "pet looks at the photo" step on the LIST screen.
// Body: { imageUrl, itemName? }  (any app caller; agents use agentApi's suggestCondition)
// Returns: { condition: "like_new" | "gently_used" | "well_loved", note, via: "llm" | "template" }
//
// One InvokeLLM call (shared/c/condition.ts); any failure answers the template guess
// ("gently_used", empty note) instead of an error, so the screen never blocks on it.
// The parent always confirms or changes the guess — the pet never decides.

// deno-lint-ignore-file no-explicit-any
import { handle, HttpError, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { suggestCondition } from "../../shared/c/condition.ts";

const MAX_URL = 2048;

export default handle(async (req) => {
  const { base44 } = await resolveCaller(req);
  const body = await readJson<any>(req);
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (!imageUrl) throw new HttpError(400, "imageUrl required");
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new HttpError(400, "imageUrl must be a URL");
  }
  // Only fetchable photos (Base44 UploadFile URLs); no data:/file: payloads into the LLM call.
  if ((url.protocol !== "https:" && url.protocol !== "http:") || imageUrl.length > MAX_URL) {
    throw new HttpError(400, "imageUrl must be an http(s) URL");
  }
  const itemName = typeof body.itemName === "string" ? body.itemName.trim().slice(0, 80) : undefined;
  return await suggestCondition(base44, url.toString(), itemName || undefined);
});
