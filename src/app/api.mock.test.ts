// The starter mock runs the whole B story: nudge → list $18 → proposal → both accept → pay → Jo owns it.
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
    const p = (await mockDev.triggerEncounter())!;
    expect(p.snapshot.wearWeeksLeft).toBe(4);
    await mockApi.decideProposal({ parentKey: "mina", proposalId: p.id, decision: "accepted" });
    const both = await mockApi.decideProposal({ parentKey: "jo", proposalId: p.id, decision: "accepted" });
    expect(both.status).toBe("both_accepted");
    const paid = await mockApi.payProposal({ parentKey: "jo", proposalId: p.id });
    expect(paid.proposal.status).toBe("paid");
    expect(paid.item.ownerCount).toBe(2);

    const jo = await mockApi.getCloset({ parentKey: "jo" });
    expect(jo.items.some((i) => i.name === "Yellow duck romper")).toBe(true);
    expect(jo.nudges.some((n) => n.kind === "new_owner_welcome")).toBe(true);
  }, 15000);
});
