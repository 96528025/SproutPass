// (C) listNearby — bands + bearing out. Called by A's radar every 2 s.
// Body: { parentId }
// Returns: { me: {accuracyM, simulated, fresh}, nearby: [{parentId, name, sprite, band, bearingDeg}] }
//
// Rule 3: only avatar, band and direction leave this function. No lat/lng,
// no exact distance, no phones.

// deno-lint-ignore-file no-explicit-any
import { handle, HttpError, readJson, resolveCaller } from "../_lib/auth.ts";
import { band, bearingDeg, haversineM, isFresh } from "../_lib/geo.ts";

export default handle(async (req) => {
  const { db } = await resolveCaller(req);
  const { parentId } = await readJson<any>(req);
  if (!parentId) throw new HttpError(400, "parentId required");

  const nowMs = Date.now();
  const mine = (await db.Presence.filter({ parentId }, undefined, 1))?.[0];
  if (!mine) return { me: null, nearby: [] };

  const parents: any[] = await db.Parent.list();
  const byId = new Map(parents.map((p) => [p.id, p]));
  const meParent = byId.get(parentId);

  const nearby: any[] = [];
  // You only see others while you are discoverable yourself (symmetry keeps it fair).
  if (meParent?.discoverable) {
    const all: any[] = await db.Presence.list();
    for (const p of all) {
      if (p.parentId === parentId || !isFresh(p, nowMs)) continue;
      const parent = byId.get(p.parentId);
      if (!parent?.discoverable) continue;
      const b = band(haversineM(mine, p));
      if (!b) continue;
      nearby.push({
        parentId: parent.id,
        name: parent.name,
        sprite: parent.avatar?.sprite ?? "parent_a",
        pet: parent.pet?.sprite ?? "pet_a",
        band: b,
        // Rounded to 5° so a bearing can't be inverted into a position.
        bearingDeg: Math.round(bearingDeg(mine, p) / 5) * 5 % 360,
      });
    }
  }
  return {
    me: { accuracyM: mine.accuracyM, simulated: mine.simulated, fresh: isFresh(mine, nowMs) },
    nearby,
  };
});
