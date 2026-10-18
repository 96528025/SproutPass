// The starter mock runs the whole B story: nudge → list $18 → proposal → both accept → pay → Olivia owns it.
// Plus TRIGGER ENCOUNTER's pick: this tab's parent meets the first family whose shared lists fit.
import { describe, expect, it } from "vitest";
import { mockApi, mockDev } from "./api.mock";
import { DEMO_DATES } from "../../base44/shared/seed.ts";

describe("mock api story", () => {
  it("runs end to end", async () => {
    await mockApi.demoReset();
    const nudged = await mockApi.demoClock({ now: DEMO_DATES.nudge });
    expect(nudged.nudgesCreated).toBeGreaterThanOrEqual(1);
    const mina = await mockApi.getCloset({ parentKey: "mina" });
    const nudge = mina.nudges.find((n) => n.kind === "outgrow_check")!;
    const res = await mockApi.resolveNudge({ parentKey: "mina", nudgeId: nudge.id, action: "sell" });
    expect(res.next).toBe("open_listing");
    const listing = await mockApi.listItem({ parentKey: "mina", itemId: res.itemId, photo: "p.jpg", condition: "gently_used", conditionNote: "", shared: true });
    expect(listing.priceCents).toBe(1800);

    await mockApi.demoClock({ now: DEMO_DATES.meet });
    const p = (await mockDev.triggerEncounter())!;   // Olivia (the default) meets Caesar first: the romper now fits
    expect(p.snapshot).toMatchObject({ itemName: "Yellow duck romper", wearWeeksLeft: 4 });
    await mockApi.decideProposal({ parentKey: "mina", proposalId: p.id, decision: "accepted" });
    const both = await mockApi.decideProposal({ parentKey: "jo", proposalId: p.id, decision: "accepted" });
    expect(both.status).toBe("paid");
    const paid = await mockApi.payProposal({ parentKey: "jo", proposalId: p.id });
    expect(paid.proposal.status).toBe("paid");
    expect(paid.item.ownerCount).toBe(2);

    const jo = await mockApi.getCloset({ parentKey: "jo" });
    expect(jo.items.some((i) => i.name === "Yellow duck romper")).toBe(true);
    expect(jo.nudges.some((n) => n.kind === "new_owner_welcome")).toBe(true);
  }, 15000);

  it("TRIGGER ENCOUNTER: this tab's parent meets the first family (seed order) whose shared lists fit", async () => {
    await mockApi.demoReset();
    await mockApi.demoClock({ now: DEMO_DATES.meet });
    const [mina, jo, sam] = await Promise.all(["mina", "jo", "sam"].map(async (k) => (await mockApi.getCloset({ parentKey: k })).parent.id));
    // The romper isn't listed yet, so Caesar and Olivia don't fit: Olivia meets Freja (the fleece jacket).
    const forJo = (await mockDev.triggerEncounter("jo"))!;
    expect(forJo).toMatchObject({ sellerId: sam, buyerId: jo, snapshot: { itemName: "Fleece bear jacket" } });
    // Caesar skips Olivia the same way and meets Freja; they fit both ways, and the smaller parentId buys first.
    const forMina = (await mockDev.triggerEncounter("mina"))!;
    expect(forMina.snapshot.itemName).toBe(mina < sam ? "Star puffer snowsuit" : "Spare star sleep sack");
    expect(forMina).toMatchObject(mina < sam ? { buyerId: mina, sellerId: sam } : { buyerId: sam, sellerId: mina });
    expect(await mockDev.triggerEncounter("nobody")).toBeNull();
  }, 15000);

  it("TRIGGER ENCOUNTER when nobody fits: meets the first other seller anyway and says nothing fits", async () => {
    await mockApi.demoReset();   // May 15: Pea is 2 months old, too small for the fleece jacket; nobody fits Olivia
    await expect(mockDev.triggerEncounter("jo")).rejects.toMatchObject({
      code: "no_match", message: "The pets met, but nothing on either shared list fits." });
    const [enc] = (await mockDev.db.Encounter.list("-startedAt")) as { hasMatch?: boolean; status: string }[];
    expect(enc).toMatchObject({ status: "no_match", hasMatch: false });
  }, 15000);
});
