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

---

# From Person C (merged from github.com/96528025/SproutPass agent-part-c)

<!-- C original header: NEEDS.md — cross-team requests -->

## C → B (Closet & Trade)

**Entities** (add to `base44/entities/`, template `task.jsonc` format)

1. `PairState` — encounter re-arm/cooldown bookkeeping (one row per unordered pair). C degrades gracefully without it (every pair counts as armed; cooldown falls back to `Encounter.startedAt`), but re-arm after 40 m only works with it.
   ```json
   { "pairKey": "string", "armed": "boolean", "lastEncounterAt": "string", "lastDistanceM": "number" }
   ```
2. `PetLine` — the pet's spoken lines, mirrored from iMessage so `AgentPet` can show the same text in-app. Optional; `AgentPet` falls back to templates.
   ```json
   { "parentId": "string", "text": "string", "imageUrl": "string", "createdAt": "string" }
   ```
3. `Parent` — four optional fields: `photonUserId: string`, `photonSpaceId: string` (Photon ids cached by `sendImessage`), `convo: object` (Deno fallback conversation state), `asiAddress: string` (ASI:One claim). All writes are wrapped in `.catch(() => {})`, so missing fields don't break anything, only slow the first iMessage.
4. `AgentInbox` — three optional fields for debugging: `claimedBy`, `claimedAt`, `doneAt` (strings).

**`_lib/match.ts` exports C imports** (stub with the same signatures: `_lib/match.c-stub.ts` — `cp match.c-stub.ts match.ts` if yours isn't there yet):

```ts
export async function findMatches(db, { buyerId, sellerId }): Promise<{ listingId; itemId; itemName; size; category; priceCents; condition; wearWeeksLeft?; reason }[]>
export function predictOutgrow(item, child, now: Date): Date
```

**Event payloads** your functions write to `AgentInbox{type:"event"}` — C's agents read these fields:

| event | payload fields C reads |
|---|---|
| `nudge:new` | `nudgeId` |
| `proposal:new` | `proposalId`, `peerPet` (other side's pet name, optional) |
| `proposal:updated` | `proposalId`, **`status`** (getCloset only returns open proposals, so C can't look up a declined one), `otherName` |
| `trade:completed` | `proposalId`, `itemId`, `buyerId`, `sellerId`, `snapshot`, `predictedOutgrowDate`, `role: "buyer"\|"seller"` |

**`getCloset` shape C relies on:** `{ parent, child: {…, ageMonths}, items[], listings[], needs[], nudges[] (open), proposals[] (open + both_accepted) }`.

**`createProposal` args C sends:** `{ listingId, sellerId, buyerId, encounterId, reason, transcript, source: "fetch"|"local" }`. Returns the proposal (or `{error}`).

**`decideProposal` args:** `{ proposalId, parentId, decision: "accepted"|"declined" }`. **`payProposal`:** `{ proposalId, parentId }`. **`listItem`:** `{ itemId, sellerId, condition, conditionNote, photos[], shared }` → `{ listing, item }`. **`resolveNudge`:** `{ nudgeId, decision }`.

**`src/app/api.ts`:** `export { base44 }` (the client) — `src/agent/cApi.ts` imports it. Please add a `// C:` block calling `updatePresence`, `listNearby`, `demoWalk` if you wrap all functions (A uses them).

**Secrets** (Base44 app settings → environment variables): `AGENT_KEY`, `WEBHOOK_KEY`, `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `SEED_PHONES` (comma-separated, optional allow-list), `APP_HOST` (e.g. `hand-me-down-relay.base44.app`, used in pay links / flowers GIF URL).

## C → A (World & Art)

1. `DialogBox` needs an `onChoice?: (value: string) => void` prop (Part D lists `choices` but no callback). `AgentPet` uses it.
2. `Sprite` with `anim: "cheer"` for the pet when it wants attention (listed in Part D, just confirming).
3. `public/fx/flowers.gif` — C sends it over iMessage after `trade:completed` (`https://<APP_HOST>/fx/flowers.gif`).
4. `EncounterScene`: mount `<AgentBubbles transcript={encounter.transcript} me={parentId} onBlip={() => sfx("blip")} />` from `src/agent`. `useEncounter(parentId)` gives you `{ encounter, peerId, myRole, dismiss }`.
5. WorldScreen: call `updatePresence` every ~3 s with `{ parentId, lat, lng, accuracyM, simulated }`; `listNearby` returns `{ me: { accuracyM, simulated, fresh }, nearby: [{ parentId, name, sprite, pet, band, bearingDeg }] }`; `demoWalk` takes `{ parentId, targetParentId, stepM?, reset? }` and returns `{ distanceM, encounters, fallback }`.

## A → … / B → …

(add yours below)

## B → C (integration, 23:20 — Caesar merged agent-part-c into main)
What changed in your code so it runs against B's real backend (all in the commit after the merge):
- **`base44/functions/_lib/` → `base44/shared/c/`.** Base44 only uploads `base44/shared/` next to each function; `../_lib/*` imports fail at deploy. Function entries now import `../../shared/c/*`.
- **B is called in-process, not over HTTP:** `base44/shared/cbridge.ts` → `callB(db, name, args)`, `findMatches(db, {buyerId, sellerId})`, `predictOutgrow(item, child, now)` with your NEEDS.md shapes. Reasons: `base44.functions.invoke("createProposal")` from the service role doesn't carry `x-agent-key` → B answers 403; plus it doubled rate-limit cost. Your arg shapes are accepted: `listItem {sellerId, photos[]}`, `resolveNudge {nudgeId, decision: sell|keep|later}` (parent looked up from the nudge), `getCloset` also returns `child.ageMonths`. Errors keep B's status + code (`"listItem: not_resellable: …"`); `handle()` now passes any error's numeric `status` through. 9 tests in `cbridge.test.ts`.
- **`match.c-stub.ts` removed** (bridge uses B's real `checkEligibility` ranking: weeks left > condition > newest).
- **suggestCondition** moved to `shared/c/condition.ts`; `inboxFallback` calls it directly (invoking `agentApi` from there would 401 without the key).
- **Pay / trade links** in iMessage use `?as=<parent.key>` (the app takes `mina`, not the id).
- **Entities added** (not pushed yet): `PairState`, `PetLine`, `Parent.convo` + `Parent.asiAddress` (admin-only; `publicParent` strips them), `AgentInbox.claimedBy / doneBy / doneAt`.
- **Frontend:** `src/agent/client.ts` gives `cApi` the real SDK client, or B's mock world when `VITE_USE_MOCK=1` (so the pet sees the bag's nudges). `AgentPet` imports `DialogBox`/`Sprite` from `src/app/ui` (B's shim now, A's kit later) and uses **`onChoose`** (B's name — A: please support `onChoose`, C asked for `onChoice`). `AgentPet` listens for the PET tab's `pet:open` event and is mounted in B's shell.
- Verified: `deno check` on all 6 C functions ✓, `deno test shared/c/c_test.ts` 5/5 ✓, vitest 131/131, tsc clean, pet renders on the mock (nudge dot, PET tab opens it).
- **Not done yet:** `AgentBubbles` isn't mounted (A's EncounterScene; or Agent 2's TradeWindow "HOW OUR PETS FOUND THIS"). Python agents untouched and not run here.
- **For your `agents/.env`:** `BASE44_URL=https://sproutpass-5c025059.base44.app`, `APP_URL` the same. `AGENT_KEY` comes from Caesar privately.
- **Secrets still unset on Base44:** `WEBHOOK_KEY PHOTON_API_KEY PHOTON_PROJECT_ID SEED_PHONES APP_HOST` (`APP_HOST=sproutpass-5c025059.base44.app`).
