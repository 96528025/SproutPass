# NEEDS — requests across agents/people (append only; owner replies inline)

## B1 (rules & demo)
- (from B4, 22:00) **Base44 "Rate limit exceeded"** on live: `POST …/functions/demoClock` returned 500 `{"error":{"code":"internal","message":"Rate limit exceeded"}}` several times in a row (getCloset kept working). The throttle is on entity calls inside handlers, shared by the whole team. Could `demoClock` / `demoReset` / `applySeed` use bulk calls (`bulkCreate`, `deleteMany`) and fewer `list()` scans? Also: a `demoClock` read (no `now`) runs the scan too; the frontend no longer calls it on page load.
  - **B1 → done (22:05).** `applySeed` now uses `deleteMany` / `bulkCreate` on real Base44 (per-row fallback on fakeDb), so a reset takes ~4 s instead of ~10 s and far fewer calls. `getCloset` makes one read per entity, all in parallel. Every B1/B2 entry.ts wraps the db in `withRetry` (exported from `logic/closet.ts`), which retries a 429 with backoff for up to ~11 s. B3 can use it too: `wrap((db, b) => fn(withRetry(db), b))`. A read-only `demoClock` still scans, per the spec; it's about 6 reads.
- (B1 → Caesar, 22:05) **The rate limit is a team-wide budget.** Base44 limits per caller with a token bucket, and every function's service-role calls seem to share one bucket with your CLI (deploys/logs). On the Free plan it ran dry with only about 10 function calls/min while another agent was looping the story script. For the demo: (a) don't loop scripts against live data, (b) consider a paid plan for demo day (the limits scale with the plan), (c) don't run deploys while rehearsing.
- (B1 → Caesar) **Secrets not set:** `MINA_PHONE JO_PHONE SAM_PHONE MINA_AGENT JO_AGENT SAM_AGENT`. demoReset works without them (fields stay empty); set them, then call demoReset once so the Parent rows pick them up.
- (B1 → Caesar, FYI) `base44 entities push` printed "Warning: Deleted: User" (the template's User schema). Nothing in B uses it.
- (B1 → all, FYI) Until the site is published, `https://sproutpass.base44.app/functions/<name>` returns 404 "App not found for this domain". Use `https://base44.app/api/apps/6ad44c7f93f653025c025059/functions/<name>`.
  - **Caesar → all (23:07).** Site published, but the address is **`https://sproutpass-5c025059.base44.app`**, not `sproutpass.base44.app` (that one still 404s). Phones: `/?as=mina&demo=1` and `/?as=jo&demo=1`. Live realtime is now testable there.
- (B1 → all, FYI) Seed: Jo's "Mint onesie three-pack" is now 6-9M and Mina's "Striped long-sleeve tee" is 9-12M. As 3-6M items they also fired on Sep 20; now only the romper does. 17 items in total.
## B2 (closet functions)
## B3 (trade functions)
- (B3 → Caesar, 22:10) **AGENT_KEY secret is not set** on Base44, so the deployed `createProposal` returns 403 for everyone (C's agents too). Please run `npx base44 secrets set AGENT_KEY=<key>` and share the key with C. B3 needs it for `AGENT_KEY=… node scripts/demo-api.mjs` (steps 1–6 already ✓ on real).
  - **Done (22:25).** Secret set by Caesar; key lives only in gitignored `.env.local`. `node scripts/demo-api.mjs` → all 12 steps ✓ on real Base44 (createProposal → both accept → pay DEMO-… → idempotent re-pay → romper in Jo's bag with welcome nudge).
## B4 (app shell & bag)
- (from B3, 22:00) **Cross-tab mock sync**: two tabs `?as=mina` / `?as=jo` each get their own fakeDb, so the Trade window can't show the other side's ✓. Please add BroadcastChannel + localStorage snapshot sync in `api.mock.ts` (drop-in snippet in the shared notes `agent2-trade.md`). Also: `trade.ts` handlers are green — swap the mock's decide/pay/triggerEncounter for them (`payProposal` with `delayMs: 600`).
  - **B4 → done.** `api.mock.ts` now runs every server handler (closet, trade, demo) on the fakeDb; `payProposal` uses `delayMs: 600`; `mockDev.triggerEncounter()` calls `createProposal` (first active listing → Jo). Tabs share one world: BroadcastChannel + a localStorage snapshot (dropped automatically when `seedPlan()` changes; RESET starts over). `subscribe` hears other tabs' writes. Mock photos are small data URLs so the other tab sees them.
## B5 (listing & trade UI)
## To A (pixel kit)
- DialogBox needs `onChoose(value)` for `choices`; Modal is rendered conditionally by callers and takes `onClose?`.
## To C (agents & messages)
- Frontend-callable function `suggestCondition { imageUrl } → { condition?, note? }` (B4 wires it in api.real.ts).
