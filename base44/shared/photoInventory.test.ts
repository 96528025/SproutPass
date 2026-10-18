import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./testing/fakeDb.ts";
import { completePhotoDetails, savePhotoInventory } from "./c/photoInventory.ts";
import { listItem } from "./logic/closet.ts";

const photo = { isClothing: true, name: "Blue cotton shirt", category: "top", size: "", color: "blue", material: "cotton", condition: "gently_used" };
function setup(result = photo) {
  const db = createFakeDb({ Parent: [{ id: "parent-a" }, { id: "parent-b" }],
    Child: [{ id: "child-a", parentId: "parent-a", birthDate: "2026-03-01T00:00:00Z" }] });
  const InvokeLLM = vi.fn().mockResolvedValue(result);
  return { db, InvokeLLM, base44: { integrations: { Core: { InvokeLLM } } } };
}

describe("iMessage photo inventory", () => {
  it("saves metadata to the sender, reuses a redelivered message and blocks selling unknown details", async () => {
    const { db, base44, InvokeLLM } = setup();
    const item = await savePhotoInventory(base44, db, "parent-a", ["https://files.test/shirt.jpg"], "msg-1", "");
    expect(item).toMatchObject({ currentOwnerId: "parent-a", size: "unknown", status: "in_closet", photoMetadata: { color: "blue", priceConfirmed: false } });
    const again = await savePhotoInventory(base44, db, "parent-a", ["https://files.test/shirt.jpg"], "msg-1", "");
    expect(again.id).toBe(item.id);
    expect(InvokeLLM).toHaveBeenCalledTimes(1);
    await expect(listItem(db, { parentId: "parent-a", itemId: item.id, photo: item.photos[0], condition: "gently_used", conditionNote: "", shared: true })).rejects.toThrow("size and original price");
    const updated = await completePhotoDetails(db, "parent-a", item.id, "6-9M $24");
    expect(updated).toMatchObject({ size: "6-9M", originalPriceCents: 2400, photoMetadata: { priceConfirmed: true } });
    expect(updated.predictedOutgrowDate).toBeTruthy();
    const listing = await listItem(db, { parentId: "parent-a", itemId: item.id, photo: item.photos[0], condition: "gently_used", conditionNote: "", shared: true });
    expect(listing.priceCents).toBe(1440);
    await expect(completePhotoDetails(db, "parent-b", item.id, "2T $30")).rejects.toThrow("isn't in your inventory");
  });

  it("uses a visible label and user supplied price without inventing a price", async () => {
    const { db, base44 } = setup({ ...photo, size: "2T" });
    const item = await savePhotoInventory(base44, db, "parent-a", ["https://files.test/shirt.jpg"], "msg-2", "$30");
    expect(item).toMatchObject({ size: "2T", originalPriceCents: 3000, photoMetadata: { priceConfirmed: true } });
  });

  it("does not create inventory for non-clothing or a failed AI request", async () => {
    const { db, base44, InvokeLLM } = setup();
    InvokeLLM.mockResolvedValueOnce({ ...photo, isClothing: false });
    await expect(savePhotoInventory(base44, db, "parent-a", ["https://files.test/x.jpg"], "msg-3", "")).rejects.toThrow("single garment");
    InvokeLLM.mockRejectedValueOnce(new Error("AI unavailable"));
    await expect(savePhotoInventory(base44, db, "parent-a", ["https://files.test/x.jpg"], "msg-4", "")).rejects.toThrow("AI unavailable");
    expect(await db.ClothingItem.list()).toHaveLength(0);
  });
});
