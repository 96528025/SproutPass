// (C) condition.ts — the pet's photo → condition guess (InvokeLLM), with a template fallback.
// Shared by agentApi (agents) and inboxFallback (iMessage) so neither calls the other over HTTP.

// deno-lint-ignore-file no-explicit-any
export async function suggestCondition(
  base44: any,
  imageUrl: string | undefined,
  itemName?: string,
): Promise<{ condition: string; note: string; via: "llm" | "template" }> {
  if (!imageUrl) return { condition: "gently_used", note: "", via: "template" };
  try {
    const r = await base44.integrations.Core.InvokeLLM({
      prompt: `This is a photo of a used piece of children's clothing${itemName ? ` (${itemName})` : ""}. ` +
        `Classify its condition as one of: like_new, gently_used, well_loved. ` +
        `Give a one-sentence honest note a buyer would want (stains, pilling, fading). ` +
        `If the photo is unclear, choose gently_used.`,
      file_urls: [imageUrl],
      response_json_schema: {
        type: "object",
        properties: {
          condition: { type: "string", enum: ["like_new", "gently_used", "well_loved"] },
          note: { type: "string" },
        },
        required: ["condition", "note"],
      },
    });
    const cond = ["like_new", "gently_used", "well_loved"].includes(r?.condition) ? r.condition : "gently_used";
    return { condition: cond, note: String(r?.note ?? "").slice(0, 160), via: "llm" };
  } catch (e) {
    console.error("[C] InvokeLLM failed, template fallback", e);
    return { condition: "gently_used", note: "", via: "template" };
  }
}
