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

## Live encounter test (Caesar, 23:45) — what worked, what to fix
Ran on https://sproutpass-5c025059.base44.app with two tabs (?as=mina / ?as=jo): SEP 20 → SELL → list romper ($18.00) → OCT 18 → `demoWalk` Jo 120 → 70 → 20 m → encounter → 12 s later C's local fallback → B's createProposal (via cbridge) → **Trade window popped on both tabs live** (seller/buyer, $18.00, pet's reason, 5-turn transcript, WAITING… ×2). Then demoReset.
- **(→ Agent 2)** Other party's name shows "…": `usePublicParent` fetches the other parent's whole `getCloset` just for the name; under the rate limit it fails once and never retries. Also sends the other family's full closet to this browser. Suggest reading the name from `Parent` (public read) or the proposal snapshot.
  - **Agent 2 → fixed (00:00, mock-verified).** The name lookup retries with backoff (1/2/4/8 s), is deduped across windows, and is cached per tab (sessionStorage `relay:trade:parties`: only `{id, name, avatar, pet}`). Until it arrives the card shows the role ("SELLER" / "BUYER") instead of "…". It still calls `getCloset({parentId})`, because the frozen `Api` has nothing lighter, and I didn't read `Parent` directly: screens never touch the SDK, and a raw Parent row could carry `phone`. The snapshot has no names (frozen types).
  - **(Agent 2 → Caesar, proposal)** For a clean fix, add a tiny function `getParties { parentIds: ID[] } → { id, name, avatar, pet }[]`. B3 writes the handler (~15 lines in `logic/trade.ts`, built on `publicParent`) plus its entry.ts. Add `Api.getParties(ids)` to the frozen interface (Caesar's call), and Agent 3 wires `api.real` / `api.mock`. Then `usePublicParent` changes one line in `src/trade/tradeKit.ts`. Say go and I'll write the backend half.
    - **Done (00:20).** Approved by Caesar (contract in 12fae27). `getParties` in `logic/trade.ts` (5 tests) is deployed and checked once on live: it returns only `{id, name, avatar, pet}`, drops unknown ids and duplicates, and reads Parent once per call. Agent 3 wired `Api.getParties`. `usePublicParent` now calls it, keeping the backoff retry and the per-tab cache, with no `getCloset` calls left in `src/trade`.
- **(→ Agent 2)** After RESET (proposal deleted) an open Trade window stays up with stale data. Close it on a `delete` event / not-found.
  - **Agent 2 → fixed (00:00, mock-verified).** Root cause on live: RESET wipes with `deleteMany`, which sends no per-row delete events. The window now closes with the toast "THIS TRADE WAS CLEARED · NOTHING CHARGED" when any of these happens: (1) a `delete` event arrives; (2) a fresh closet stops listing a live trade, confirmed by one re-fetch (at most one check per trade every 15 s, so it can't loop under the rate limit); (3) RESET re-seeds this parent with a new id, so the open trade isn't theirs anymore; (4) ACCEPT/DECLINE/PAY answers `not_found`. FYI: while the trade modal is open it covers the demo panel, so on a phone close the window before tapping RESET.
- **(→ Agent 1)** `wipe()` doesn't clear C's new `PairState` / `PetLine`. Harmless now (RESET re-creates parents with new ids, so old rows are orphans) but they pile up; add them to `ALL` (fakeDb has no tables for them: skip missing).
  - **Agent 1 → done (00:00, live-verified).** `wipe()` now also clears `PairState` / `PetLine` (skipped where the db has no such table, e.g. fakeDb). And RESET now **keeps Parent and Child rows (same ids)**, rewritten to the seed; agentAddress / Photon ids / ASI claim survive, `convo` restarts. demoReset, demoClock, getStats, selfTest redeployed.
- **(→ C)** RESET gives parents **new ids**. The Python agents cache ids from `lookupParent` at startup → restart them (or re-lookup) after every RESET.
  - **Fixed on B's side (above): ids no longer change on RESET.** ⚠ **C: Agent 1 edited three of your files on main** — pull before you change them: `agents/closet_agent.py` (pay link `?as=<name>`, a 60 s `lookupParent` re-check that re-registers if the id ever changes), `src/agent/AgentPet.tsx` (30 s backstop poll, only this family's realtime events, one refresh in flight, pauses while hidden), `src/agent/useEncounter.ts` (6 s poll, pauses while hidden, refresh on visibilitychange). Python change is syntax-checked only (`uagents` isn't installed here): please run `pytest agents/tests`.
- **(→ C / all)** Rate limit hit twice during the test (both tabs showed "Couldn't open the bag · Rate limit exceeded" until retried). `AgentPet` polls 4 reads every 5 s per tab on top of realtime; consider 15–30 s or realtime only.

---

# From Person A (merged from github.com/96528025/SproutPass main @ 7931231)

---

Requests between owners. Write under your own name; the owner ticks it off.

## A

### A1 (Kit)

- **B:** import `@/pixel/fonts.css` and `@/pixel/tokens.css` once in `src/app/main.tsx` (currently done in the temporary `src/main.tsx`, which B replaces).
- **B:** mount `/kit` → `KitPage` from `@/world/KitPage` in `routes.tsx` (temporary entry has it).
- **B:** the Vite `@` → `src/` alias is set in `vite.config.ts` + `tsconfig.app.json` on the scaffold; keep it when moving into the Base44 template.
- **A2:** `Sprite` and `ItemIcon` are stubbed in `src/mocks/a1.tsx`; `KitPage` and `DialogBox` portrait switch to the real ones after `world-art` merges.
- **A2:** `public/sfx/*.wav` names: start, blip, alert, select, accept, decline, coin, jingle, step. `blip` is played at volume 0.4 and throttled to ~15/s by the player.
- **All:** `DialogBox` sits above the 64px bottom bar (`--bottom-bar` token); A3's `BottomBar` must be exactly that tall.

### A2 (Art)

- **All A:** `world-art` has merged-ready assets. Import `Sprite` from `@/pixel/components/Sprite` and `ItemIcon` from `@/pixel/components/ItemIcon`; names/anims come from `@/pixel/sprites` (`SpriteName`, `ItemIconName`, `AnimName`, `SPRITES`, `ITEM_ICONS`). `Sprite` also takes an optional `once` (play once, hold last frame) and any integer `scale`; it falls back to `idle`, then frame 0, if an anim is missing. `sprites.ts` additionally exports `frameCount(def)`.
- **A1:** after merge, delete the Sprite/ItemIcon stubs in `src/mocks/a1.tsx` and point `KitPage` / `DialogBox` at the real files (props are a superset of your stub; `name` is now typed `SpriteName`, `icon` is `ItemIconName`).
- **All:** every `Sprite` strip is a horizontal PNG, parents 32 px x 8 frames, pets 16 px x 7, `prop_tree` is 32 px, everything else 16 px. Tiles are seamless; `tile_path` has no grass edges (place tiles, no autotiling). Extra file not in the contract: `public/sprites/ui_frame.png` (24x24, 8-px 9-slice).
- **B:** `package.json` gained devDeps `pngjs`, `gifenc`, `tsx`, `@types/pngjs`, `@types/node` and scripts `art` (rebuild every PNG/WAV/GIF from `tools/art`) and `art:check` (palette check). Generated files are committed, so nobody has to run them. Keep these when moving to the Base44 template.
- **B/A3:** `index.html` should link `/icon-180.png` as apple-touch-icon (A3 does that). `public/fx/flowers.gif` is the iMessage GIF for C (390x300, 3 s, 12 fps, under 1 MB).
- **Sound levels:** all wavs are peak-normalised to -3 dBFS except `blip` (-9 dBFS, soft) and `step` (-14 dBFS, quiet) as the brief asks for those to be quiet.
- **Route:** `/dev/art` is added in the `// A:` block of the temporary `src/main.tsx`; B should mount `ArtPage` from `@/world/ArtPage` in `routes.tsx`.

### A3 (Shell)

- **All:** inside `HandheldFrame` use `height: 100%` / `min-height: var(--screen-h)` instead of `100vh`/`100dvh` — on screens ≥ 600 px the app viewport is `--screen-h` (≤ 844 px), not the browser window. `position: fixed` children (BottomBar, DialogBox, Modal, A5's overlays) are fixed to the handheld screen, not the window.
- **All:** `--bottom-bar` is redefined inside the frame as `64px + env(safe-area-inset-bottom)` on phones (home-indicator room in standalone mode) and plain `64px` on the desktop bezel; keep using the variable, never a literal 64.
- **All:** `import { withQuery, useQueryParent, useDemo, type ParentId } from "@/world/query"`; `withQuery("/world", { as: "jo" })` overrides carried params. Delete your local copies.
- **A4:** `<BottomBar />` and `<MuteToggle />` are `position: fixed`, so mount each once from `/world`. The temporary entry only mounts them on its `/world`, `/bag`, `/log` placeholders and `/kit`; a placeholder route for `/world` in `src/main.tsx` is yours to replace.
- **A2:** `public/icon-180.png` is referenced by `index.html` (apple-touch-icon, favicon) and `manifest.webmanifest`; BottomBar icons are CSS-pixel placeholders (swap to your tile/pet/coin sprites after merge); TitleScreen uses the stub `Sprite` from `src/mocks/a3.tsx`.
- **B:** `<ParentPicker onPick(id: "mina"|"jo"|"sam")>` is stubbed in `src/mocks/a3.tsx`; TitleScreen imports it from there until yours merges. `FrameLayout` (HandheldFrame around `<Outlet />`) in the same file must wrap every route in your `routes.tsx`; `src/main.tsx` also needs `import "@/pixel/fonts.css"` / `tokens.css` (already there).
- **B:** `/bag` and `/log` are placeholders in the temporary entry; the bottom bar links there with `?as=` / `?demo=` kept.

### A4 (World)

- **C:** `listNearby` result: please add an optional `distanceM: number` per parent (the demo button reads "WALKING… 84 M"; without it the label falls back to the band, e.g. "100-300 M").
- **C/B:** `updatePresence` payload gets one extra optional field, `discoverable: boolean`, driven by the DISCOVERABLE toggle on /world. B's `Parent.discoverable` update should go through C's function; today the toggle only flips a local flag that rides along in each `updatePresence` call.
- **C:** `demoWalk({ parentId, towardParentId })` is called once a second from the web while ?demo=1 "WALK TOWARD …" is active, until `useEncounter(parentId).encounter` is non-null. The stub in `src/mocks/a4.tsx` models "each call moves them ~12 m closer"; the real one should end by creating the encounter when they are < 25 m apart.
- **C:** `useEncounter(parentId)` -> `{ encounter, proposal }`; /world mounts `<EncounterScene>` when `encounter` is set (and not dismissed) and `<Celebration>` when `proposal.status === "paid"`. The `bubbles` slot is passed `null`: drop C's `<AgentBubbles>` in `WorldScreen.tsx` where the comment says so.
- **A5 / Freja:** when `world-encounter` merges, in `src/world/WorldScreen.tsx` change the `@/mocks/a4` import for `EncounterScene` / `Celebration` to `@/world/EncounterScene` / `@/world/Celebration`. Props already match the contract. The HUD (chips, discoverable, walk button) uses z-index 4, below `--z-overlay` (10), so A5's `position: fixed` overlays must use `z-index: var(--z-overlay)` or higher to cover it.
- **C/B (when real):** replace the imports of `updatePresence` / `listNearby` / `demoWalk` / `useEncounter` (+ the types) from `@/mocks/a4` in `useGps.ts`, `useNearby.ts`, `useDemoWalk.ts`, `WorldScreen.tsx`, `NearbySprites` types, then delete `src/mocks/a4.tsx`.
- **B:** `src/main.tsx` `/world` now renders `WorldScreen` (one route line plus its import, in the `// A:` block). It mounts `<BottomBar />` and `<MuteToggle />` itself, so `/world` must not be wrapped with them again.

### A5 (Encounter)

- **A4:** mount `<EncounterScene encounter me peer bubbles onProposed onClosed />` and `<Celebration proposal me peer onDone />` straight from `@/world/EncounterScene` / `@/world/Celebration`; both are `position: fixed; inset: 0; z-index: var(--z-overlay)` and cover the bottom bar. Types `Encounter`, `MatchProposal`, `Parent` are temporarily exported from `src/mocks/a5.tsx`; swap them for C's/B's real ones when they land (shape used: `encounter {id, status: "meeting"|"talking"|"proposed"|"no_match", proposalId?}`).
- **A4:** `EncounterScene` has one optional extra prop beyond the contract, `talking?: boolean` (pets switch to "talk" while a bubble types; defaults to `encounter.status === "talking"`). Peers enter from the right edge; no world positions are passed.
- **C:** drop `<AgentBubbles>` into the `bubbles` prop (any ReactNode; slot is 358 px wide, centred above the parents, bottom-anchored). Pass `talking` while a bubble types if you want the pets to move their mouths.
- **C/B:** the scene calls `onProposed(encounter.proposalId)` 1.2 s after status becomes "proposed" (the pets must already be out, so ≥ 2.2 s after mount at worst); `Celebration` plays once per `proposal.id` and its button calls `onDone`.
- **Files beyond the contract list:** `src/world/encounter.css` and `src/world/celebration.css` (styles for A5's components). `/dev/encounter?as=jo` flips the point of view (Jo as buyer).

## B

## C

---

# Integration status (Caesar, Oct 18 ~02:00) — A + B + C on main, deployed
**Verified live** on https://sproutpass-5c025059.base44.app (two tabs): SEP 20 nudge → SELL → photo (pixel fallback) → GENTLY USED · PET SUGGESTED (C's new suggestCondition) → $18.00 listed → OCT 18 → Jo /world WALK TOWARD MINA → A's encounter scene + C's AgentBubbles → Trade window on both tabs (names via getParties) → accept ×2 (each tab sees the other's ✓) → PAY (demo) → A's Celebration on both → romper in Jo's bag + Pip's welcome nudge. Second run with **C's Fetch agents** (`agents/live_bureau.py`): they negotiated in their Bureau and created the proposal themselves (`source: fetch`, 6-turn transcript) and each pet told its parent. Live selfTest 13/13; vitest 179, tsc, deno check (21 functions), C's deno tests 8, pytest 73 all green.

Open items found while running it live:
- **(→ Caesar) Base44 Free-plan rate limit is the #1 demo risk.** Agents (8 calls/min) + two phones on /world → 429s on updatePresence / listNearby / payProposal (pay needed one retry). Upgrade the plan for demo day, or run agents with `CALLS_PER_MIN=3 POLL_S=20` and keep only the phones that are on stage open.
- **(→ C / W4)** `live_bureau.py` exits with "setup failed: lookupParent 429" if the budget is empty at start: retry the setup with backoff instead of exiting. Also "Unclosed client session" on Ctrl+C (close the aiohttp session on shutdown).
- **(→ C)** Python wording still says the buyer's pet "Your little one fits it…" (fit_check); the TS fallback now says "My little one…". Align `agents/wording.py`.
- **(→ C)** On live, `AgentPet` refreshes (4 entity reads) about every 5 s per tab, not every 30 s: some realtime events pass the `mine()` filter (events without `data`?). Entity reads, not function calls, but worth tightening.
- **(→ B4)** suggestCondition on the pixel-art fallback photo writes a note like "The image is pixelated and unclear…" into the listing: skip the suggestion (or the note) when the fallback image is used.
- **(known, demo-only)** Location functions trust the caller's parentId; the demo walk loads the target's closet to learn its id; mock mode logs an analytics 404.
- **(→ Caesar, human steps)** Photon iMessage: `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `WEBHOOK_KEY`, `SEED_PHONES`, `MINA_PHONE`/`JO_PHONE`/`SAM_PHONE` + one demoReset, Photon webhook → `/functions/photonWebhook?k=<WEBHOOK_KEY>`, one shared-pool assignment per demo phone, then each phone texts "hi" to its own assigned number (the pet replies from that parent's line, `Parent.photonLineUserId`). Agentverse mailbox / ASI:One: run `make mina` etc. and connect each agent in the Inspector (not needed for `live_bureau.py`). `APP_HOST` is set.
