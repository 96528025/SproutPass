// (C) listNearby — bands + bearing out. Called by A's radar every 2 s.
// Body: { parentId }
// Returns: { me: {accuracyM, simulated, fresh}, nearby: [{parentId, name, sprite, pet, band, bearingDeg, distanceM?}] }
//
// Rule 3: only avatar, band and direction (rounded to 5°) leave this function. No lat/lng,
// no phones; `distanceM` (rounded to 5 m) only when BOTH presences are simulated (demo walk).
// The rules live in shared/c/location.ts (pure, also run by B's mock).

// deno-lint-ignore-file no-explicit-any
import { handle, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { listNearby } from "../../shared/c/location.ts";

export default handle(async (req) => {
  const { db } = await resolveCaller(req);
  return await listNearby(db, await readJson<any>(req));
});
