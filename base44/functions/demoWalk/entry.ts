// (C) demoWalk — "WALK TOWARD JO" for indoor judging (rule 5).
// Body: { parentId, targetParentId, stepM? (default 5), reset?: boolean }
// Moves the caller's SIMULATED presence 5 m toward the target and runs the
// same encounter check as updatePresence. A calls it every 1 s until an
// encounter fires. `reset: true` puts the caller back at the start
// (120 m due north of the target, rule "Demo walk start: Jo 120 m from Mina").
//
// The target's position is whatever fresh presence it has (real or simulated).
// If the target has no presence, or a real-GPS one gone stale, we park it on
// its demo spot (simulated) so a single laptop with two tabs always works.
// Returns: { ok, distanceM, encounters: [{id, peerId, hasMatch?}], fallback, cooldown? } (types.ts DemoWalkRes):
// A ends the walk with a Toast when every meeting has hasMatch false, or when an arrived pair is in `cooldown`.
// The rules live in shared/c/location.ts (pure, also run by B's mock).

// deno-lint-ignore-file no-explicit-any
import { handle, readJson, resolveCaller } from "../../shared/c/auth.ts";
import { demoWalk } from "../../shared/c/location.ts";
import { findMatches } from "../../shared/cbridge.ts"; // B handlers, C-shaped (shared/cbridge.ts)
import { maybeSweepInbox, sendEventTexts } from "../../shared/c/inboxFallback.ts";

export default handle(async (req) => {
  const { base44, db } = await resolveCaller(req);
  const body = await readJson<any>(req);
  const res = await demoWalk(db, body, { findMatches });
  if (res.fallback.length) await sendEventTexts(db);
  // Template agent answers what the Python agents left pending (5 s, or 30 s while they're on duty): every
  // parent's rows, at most once per 12 s, so a parent who isn't on /world still hears their pet.
  await maybeSweepInbox(base44, db).catch((e) => console.error("[C] sweep", e));
  return res;
});
