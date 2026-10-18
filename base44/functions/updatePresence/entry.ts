// (C) updatePresence — GPS in. Called by A's WorldScreen (useGps: first fix, then a 10 s keepalive).
// Body: { parentId, lat, lng, accuracyM, simulated?, discoverable? }
// Returns: { ok, encounters: [{id, peerId}], fallback: [encounterIds] }
//
// Presence is one row per parent, overwritten on each update (rule 3). Only
// this function and listNearby/demoWalk ever read it, and nothing here ever
// returns another parent's coordinates. `discoverable` (A's toggle) is written
// to Parent.discoverable when it changes. A `simulated` fix keeps its
// server-owned demo position (see shared/c/geo.ts demoHome), so the heartbeat
// never undoes a demo walk; a real fix can't teleport a parent who is live on
// real GPS. The rules live in shared/c/location.ts (pure, also run by B's mock).

// deno-lint-ignore-file no-explicit-any
import { handle, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { updatePresence } from "../../shared/c/location.ts";
import { findMatches } from "../../shared/cbridge.ts"; // B handlers, C-shaped (shared/cbridge.ts)
import { maybeSweepInbox } from "../../shared/c/inboxFallback.ts";

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req);
  const body = await readJson<any>(req);
  const res = await updatePresence(db, body, { findMatches });
  // Template agent answers what the Python agents left pending (5 s, or 30 s while they're on duty): every
  // parent's rows, at most once per 12 s, so a parent who isn't on /world still hears their pet.
  await maybeSweepInbox(base44, db).catch((e) => console.error("[C] sweep", e));
  return res;
});
