// B9: the mock's getImpact runs the real impact handler on the fakeDb (not a placeholder).
import { describe, expect, it } from "vitest";
import { mockApi } from "../app/api.mock";
import type { ImpactDetail } from "../../base44/shared/logic/impact.ts";

describe("mock getImpact", () => {
  it("returns the seed's impact for everyone, and `me` for a parent", async () => {
    await mockApi.demoReset();
    const all = await mockApi.getImpact();
    expect(all.itemsRehomed).toBe(4);
    expect(all.points.map((p) => p.name)).toEqual(["Sam", "Jo", "Mina"]);
    expect(all.assumptions.length).toBeGreaterThan(3);
    expect(all.me).toBeUndefined();

    const mina = (await mockApi.getImpact({ parentKey: "mina" })) as ImpactDetail;
    expect(mina.me).toMatchObject({ points: 30, badges: ["New Home"], nextBadge: "Good Neighbor", savedCents: 1440 });
  });
});
