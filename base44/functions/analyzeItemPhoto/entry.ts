// base44/functions/analyzeItemPhoto/entry.ts — AI snap-to-list.
// Body: { imageUrl, hint? }   imageUrl: the Base44 UploadFile URL of the item (or its size tag);
//                              hint: optional words about it (the photo's file name).
// Returns ItemPhotoGuess { name, category, size, condition, note, icon, estimatedRetailCents, confidence, via }.
//
// One Base44 InvokeLLM call (vision + JSON schema). The answer is clamped to known values in
// shared/logic/snap.ts; any LLM failure or timeout answers the template guess ({ via: "template" }) instead of
// an error, so the screen never blocks on the AI. Nothing is written: the parent checks every field and saves
// with recordPurchase. Only a bad imageUrl is an error (400, before any LLM call).
import { serviceRole, wrap } from "../../shared/http.ts";
import { analyzeItemPhoto, type InvokeLLM } from "../../shared/logic/snap.ts";
import type { AnalyzeItemPhotoReq } from "../../shared/types.ts";

export default wrap((_db, body: AnalyzeItemPhotoReq, req) => {
  const invoke: InvokeLLM = (args) => serviceRole(req).integrations.Core.InvokeLLM(args);
  return analyzeItemPhoto(body, invoke, { log: (msg, e) => console.error(msg, e) });
});
