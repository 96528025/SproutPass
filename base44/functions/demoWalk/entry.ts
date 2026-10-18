// (C) demoWalk — "WALK TOWARD JO" for indoor judging (rule 5).
// Body: { parentId, targetParentId, stepM? (default 5), reset?: boolean }
// Moves the caller's SIMULATED presence 5 m toward the target and runs the
// same encounter check as updatePresence. A calls it every 1 s until an
// encounter fires. `reset: true` puts the caller back at the seed start
// (120 m from the target, rule "Demo walk start: Jo 120 m from Mina").
//
// The target's position is whatever presence it has (real or simulated). If
// the target has no presence yet, we park it on a fixed demo lawn so a single
// laptop with two tabs always works.

// deno-lint-ignore-file no-explicit-any
import { handle, HttpError, readJson, resolveCaller } from "../_lib/auth.ts";
import { detectEncounters, runLocalFallback } from "../_lib/encounter.ts";
import { haversineM, stepToward } from "../_lib/geo.ts";
import { findMatches } from "../_lib/match.ts"; // (B) see NEEDS.md
import { sweepInbox } from "../_lib/inboxFallback.ts";

// A pixel lawn somewhere in Westwood. Only used for simulated positions.
const DEMO_LAWN = { lat: 34.0709, lng: -118.4446 };
const START_OFFSET_M = 120;

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req);
  const body = await readJson<any>(req);
  const parentId = String(body.parentId ?? "");
  const targetParentId = String(body.targetParentId ?? "");
  const stepM = Math.max(1, Math.min(50, Number(body.stepM ?? 5)));
  if (!parentId || !targetParentId) throw new HttpError(400, "parentId, targetParentId required");

  const parents: any[] = await db.Parent.list();
  const parentsById = new Map(parents.map((p) => [p.id, p]));
  if (!parentsById.has(parentId) || !parentsById.has(targetParentId)) {
    throw new HttpError(404, "unknown parent");
  }
  const nowIso = new Date().toISOString();

  // Target presence (create a simulated one on the lawn if missing).
  let target = (await db.Presence.filter({ parentId: targetParentId }, undefined, 1))?.[0];
  if (!target) {
    target = await db.Presence.create({
      parentId: targetParentId,
      ...DEMO_LAWN,
      accuracyM: 5,
      simulated: true,
      updatedAt: nowIso,
    });
  } else if (target.simulated) {
    // Keep a simulated target "fresh" so it stays on the radar.
    await db.Presence.update(target.id, { updatedAt: nowIso });
  }

  // Caller presence.
  let me = (await db.Presence.filter({ parentId }, undefined, 1))?.[0];
  const startPos = () => {
    // 120 m due north of the target, so the first radar frame shows the 100–300 m ring.
    const p = stepToward(target, { lat: target.lat + 0.01, lng: target.lng }, START_OFFSET_M);
    return p;
  };
  let pos: { lat: number; lng: number };
  if (!me || body.reset || !me.simulated) {
    pos = startPos();
  } else {
    pos = stepToward(me, target, stepM);
  }
  const row = {
    parentId,
    lat: pos.lat,
    lng: pos.lng,
    accuracyM: 5,
    simulated: true,
    updatedAt: nowIso,
  };
  if (me) await db.Presence.update(me.id, row);
  else me = await db.Presence.create(row);

  const { created } = await detectEncounters(db, row, parentsById);
  const { resolved } = await runLocalFallback(base44, db, parentId, findMatches);
  // Template agent answers anything the Python agents left pending > 5 s.
  await sweepInbox(base44, db, parentId).catch((e) => console.error("[C] sweep", e));
  return {
    ok: true,
    distanceM: Math.round(haversineM(row, target)),
    encounters: created,
    fallback: resolved,
  };
});
