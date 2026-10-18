// (C) updatePresence — GPS in. Called by A's WorldScreen every ~3 s.
// Body: { parentId, lat, lng, accuracyM, simulated? }
// Returns: { ok, encounters: [{id, peerId}], fallback: [encounterIds] }
//
// Presence is one row per parent, overwritten on each update (rule 3). Only
// this function and listNearby/demoWalk ever read it, and nothing here ever
// returns another parent's coordinates.

// deno-lint-ignore-file no-explicit-any
import { handle, HttpError, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { detectEncounters, runLocalFallback } from "../../shared/c/encounter.ts";
import { findMatches } from "../../shared/cbridge.ts"; // B handlers, C-shaped (shared/cbridge.ts)
import { sweepInbox } from "../../shared/c/inboxFallback.ts";

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req);
  const body = await readJson<any>(req);
  const parentId = String(body.parentId ?? "");
  const lat = Number(body.lat), lng = Number(body.lng);
  const accuracyM = Number(body.accuracyM ?? 999);
  const simulated = Boolean(body.simulated);
  if (!parentId || !isFinite(lat) || !isFinite(lng)) {
    throw new HttpError(400, "parentId, lat, lng required");
  }

  const parents: any[] = await db.Parent.list();
  const parentsById = new Map(parents.map((p) => [p.id, p]));
  if (!parentsById.has(parentId)) throw new HttpError(404, "unknown parent");

  const row = {
    parentId,
    lat,
    lng,
    accuracyM,
    simulated,
    updatedAt: new Date().toISOString(),
  };
  const existing = await db.Presence.filter({ parentId }, undefined, 1);
  if (existing?.[0]) await db.Presence.update(existing[0].id, row);
  else await db.Presence.create(row);

  const { created } = await detectEncounters(db, row, parentsById);
  const { resolved } = await runLocalFallback(base44, db, parentId, findMatches);
  // Template agent answers anything the Python agents left pending > 5 s.
  await sweepInbox(base44, db, parentId).catch((e) => console.error("[C] sweep", e));
  return { ok: true, encounters: created, fallback: resolved };
});
