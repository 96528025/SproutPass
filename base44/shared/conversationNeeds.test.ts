import { expect, it, vi } from "vitest";
import { createFakeDb } from "./testing/fakeDb.ts";
import { extractConversationNeed, saveConversationNeed, describeNeed } from "./c/conversationNeeds.ts";
import { parseInbound } from "./c/photon.ts";
import { inboundParentPatch } from "./c/lines.ts";

it("extracts a need, normalizes categories, and saves only for the confirmed sender without duplicates", async () => {
  const db = createFakeDb({ Parent: [{ id: "mina" }, { id: "jo" }], Child: [
    { id: "a", parentId: "mina", birthDate: "2026-01-01" }, { id: "b", parentId: "jo", birthDate: "2026-04-01" },
  ] });
  const InvokeLLM = vi.fn().mockResolvedValue({ isNeed: true, sizes: ["9-12M", "fake"], categories: ["outerwear", "fake"], maxPriceCents: 2500 });
  const need = await extractConversationNeed({ integrations: { Core: { InvokeLLM } } }, "I need a jacket in 9-12M under $25");
  expect(need).toEqual({ sizes: ["9-12M"], categories: ["outerwear"], maxPriceCents: 2500 });
  expect(await db.Need.list()).toHaveLength(0);
  const saved = await saveConversationNeed(db, "mina", need!);
  expect((await saveConversationNeed(db, "mina", need!)).id).toBe(saved.id);
  expect(await db.Need.filter({ parentId: "jo" })).toHaveLength(0);
  expect(describeNeed(need!)).toContain("$25.00");
  await expect(saveConversationNeed(db, "mina", { sizes: [], categories: ["top"] })).rejects.toThrow("size");
});

it("keeps missing sizes unknown and ignores messages classified as not a need", async () => {
  const InvokeLLM = vi.fn().mockResolvedValueOnce({ isNeed: true, sizes: [], categories: ["top"], maxPriceCents: -1 })
    .mockResolvedValueOnce({ isNeed: false });
  const client = { integrations: { Core: { InvokeLLM } } };
  expect(await extractConversationNeed(client, "Our shirts are too small")).toEqual({ sizes: [], categories: ["top"] });
  expect(await extractConversationNeed(client, "We don't need jackets")).toBeNull();
});

it("recognizes a real group snapshot and keeps private message routing unchanged", () => {
  const msg = parseInbound({ type: "message.received", data: { object: {
    id: "message-1", space: { id: "group-1", kind: "group", participantIds: ["mina", "jo", "pet"] },
    sentBy: { id: "mina", handle: "+13105550101" }, receivedBy: { id: "pet" },
    content: { type: "text", text: "I need a jacket in 9-12M" },
  } } });
  expect(msg).toMatchObject({ isGroup: true, spaceId: "group-1", lineUserId: "pet" });
  expect(inboundParentPatch({ photonSpaceId: "private-1", photonLineUserId: "private-line" }, msg!)).toEqual({});
});
