// B9: the mock's getImpact runs the real impact handler on the fakeDb (not a placeholder).
import { describe, expect, it } from "vitest";
import { mockApi } from "../app/api.mock";
import type { ImpactDetail } from "../../base44/shared/logic/impact.ts";

describe("mock getImpact", () => {
  it("returns the seed's impact for everyone, and `me` for a parent", async () => {
    await mockApi.demoReset();
    const all = await mockApi.getImpact();
    expect(all.itemsRehomed).toBe(4);
    expect(all.points.map((p) => p.name)).toEqual(["Freja", "Olivia", "Caesar"]);
    expect(all.assumptions.length).toBeGreaterThan(3);
    expect(all.me).toBeUndefined();

    const mina = (await mockApi.getImpact({ parentKey: "mina" })) as ImpactDetail;
    // the sweater from Freja (New Home) + her seeded 9-12M outerwear need (Good Neighbor, POINTS.sharedNeed)
    expect(mina.me).toMatchObject({ points: 40, badges: ["Good Neighbor", "New Home"], nextBadge: "Quick Pass", savedCents: 1440 });
  });
});
