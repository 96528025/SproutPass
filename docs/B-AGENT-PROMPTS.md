# Person B (Closet & Trade) — 3 parallel agent prompts

## How to run (Caesar)

Three tabs, three agents, **one folder (`C:\SproutPass`)**, all running at the same time. Nobody waits for anybody:
- The contract pack is already in the folder (frozen types, pricing, outgrow, fake database, API interface, starter mock, pixel-kit stand-in).
- Each agent owns separate files.

**Steps:**
1. Do the README setup once (Base44 template files merged in, `npm i`, `npx vitest run` → 4 passing).
2. Open three Claude Code / Fable tabs in `C:\SproutPass`.
3. Paste **Shared preamble + Agent N section** into tab N.
4. **You commit** at checkpoints **10:30, 11:30, 12:30, 2:00 and 4:00** (`git add -A && git commit`). Agents never run git, which avoids three processes fighting over the git lock.
5. **Deploys:** only you run `base44 site deploy` / `base44 deploy`. Each agent deploys only its own functions with `base44 functions deploy <name>`.

| Agent | Owns (only these files) | Load |
|---|---|---|
| **Agent 1 — Backend: data, closet & demo** | `base44/entities/*`, `base44/shared/{nudges,match,seed}.ts`, `base44/shared/logic/{closet,demo}.ts`, functions `getCloset recordPurchase listItem withdrawListing upsertNeed resolveNudge demoReset demoClock getStats selfTest`, tests `base44/shared/**/*.test.ts` except `contract.test.ts` and `logic/trade.test.ts` | ~7 h |
| **Agent 2 — Trade, full stack** | `base44/shared/logic/trade.ts` + `logic/trade.test.ts`, functions `createProposal decideProposal payProposal`, `scripts/demo-api.mjs`, `src/trade/*` (TradeWindow, PayButton, TradeWatcher, useProposals, RelayLog) | ~6–7 h |
| **Agent 3 — App shell & Closet UI** | `src/app/*` (except `types.ts` and the `Api` interface signatures in `api.ts`), `src/closet/*` (Bag, ItemCard, NudgeDialog, NeedsScreen, ListingFlow), `src/styles/b.css`, **`package.json` dependencies** | ~7 h |

- **Frozen for all three:** `base44/shared/{types,pricing,sizes,errors,db,http}.ts`, `base44/shared/testing/fakeDb.ts`, the `Api` interface, `src/app/types.ts`. Changes go through a request in `NEEDS.md`; Caesar decides.
- **Code comments say B1–B5:** `TODO(B1)` / `TODO(B2)` = Agent 1, `TODO(B3)` = Agent 2, `B4` = Agent 3.

---

## Shared preamble (paste first in every agent)

You are one of **three parallel coding agents** working on Person B's slice of a hackathon app, **in the same folder at the same time** (`C:\SproutPass`). The other two are editing other files right now. Rules for sharing the folder:

- **Edit only the files you own** (listed in your section).
- **Never run git:** Caesar commits at checkpoints.
- **Never `npm install` new packages** unless you're Agent 3. Ask in `NEEDS.md`.
- Build against the frozen contract, use mocks and fakes for anything you don't own, and never wait for another agent.

**Product:** *SproutPass*, a pixel-art, Pokémon-Go-style game for parents to pass along kids' clothing.
- Each parent has a closet agent (a Fetch.ai agent in iMessage + a pixel pet in the app) that predicts when a child will outgrow an item and nudges "still fit? pass it on?".
- When two parents walk within 25 m, their agents talk and create a trade proposal shown on both phones at once.
- Both accept, the buyer pays (demo payment, no real money), golden flowers burst, and the item moves to the buyer's closet.
- Other people own the rest: A owns the pixel kit, world and encounter scene; C owns GPS encounters, iMessage and the agents.
- **Person B (you) owns items, prices, proposals and money, from screen to database.**

**Stack:** a Base44 CLI project (React/Vite frontend in `src/`, entities in `base44/entities/*.json`, Deno backend functions in `base44/functions/<name>/entry.ts`, shared code in `base44/shared/`). Hosted at `https://<slug>.base44.app`.

**Contract pack (already in the folder; read it before coding):**
- `base44/shared/types.ts`: every entity and function request/response type. **Frozen.**
- `base44/shared/pricing.ts`: `priceFor` is the *only* price implementation (owner 1→2 pays 60%, 2→3 pays 40%, no resale at 3 owners). `priceRuleText`, `formatCents`.
- `base44/shared/sizes.ts`: `predictOutgrow`, `wearWeeksLeft`, `ageInMonths`, `fitsNow`. Seed checks: Mina's romper 2026-08-27, Jo 2026-11-17, 4 weeks left on 2026-10-18.
- `base44/shared/db.ts`: the typed `Db`, plus `mustGet`, `resolveParent` (`{parentId}` or `{parentKey:"mina"}`), `getNow` (the demo clock), `writeInbox` (events for C's agents), `publicParent`.
- `base44/shared/errors.ts`: throw `HttpError(code, message, status)` with `bad / notFound / forbidden / invalid` helpers. Codes are `ErrorCode` in types.ts.
- `base44/shared/match.ts`: `checkEligibility` (complete) and `findMatches`.
- `base44/shared/testing/fakeDb.ts`: in-memory entities (`list / filter / get / create / update / delete`, `_on` change events).
- `base44/shared/seed.ts`: `seedPlan()` + `applySeed(db, plan)`, which works on fakeDb and on real Base44.
- `src/app/api.ts`: the frozen `Api` interface the frontend uses. `VITE_USE_MOCK=1` selects `api.mock.ts`.
- `src/app/ui.tsx`: a shim with A's pixel component names and props (`PixelPanel`, `PixelButton`, `DialogBox`, `Chip`, `Hearts`, `FitBar`, `ItemIcon`, `Sprite`, `Modal`, `Toast`, `PriceReceipt`). It's swapped for A's real kit at ~10:30 PM, so use the props exactly.

**Backend pattern (Agents 1 and 2):**
- All logic lives in `base44/shared/logic/<area>.ts` as pure TS handlers: `export async function listItem(db: Db, body: ListItemReq): Promise<Listing>`.
  - **No `npm:` or `base44:` imports in logic or shared files** (only `shared/http.ts` has them).
  - This keeps handlers runnable in vitest, in `selfTest`, and in the frontend mock.
- Each Base44 function is a 3-line wrapper:
  ```ts
  // base44/functions/listItem/entry.ts
  import { wrap } from "../../shared/http.ts";
  import { listItem } from "../../shared/logic/closet.ts";
  export default wrap(listItem);                       // wrap(fn, { agentOnly: true }) for agent-only functions
  ```
- `wrap` parses JSON, passes service-role entities as `db`, returns JSON, and maps `HttpError` to `{ error: { code, message } }` with the status.
- **Time = `await getNow(db)`** (the demo clock), never `new Date()`. The exception is `AgentInbox.createdAt` and anything that measures real seconds; use the entity's built-in `created_date` for that.
- **Never compute a price yourself.** Call `priceFor(item)`.
- **Never trust the caller for rules.** Re-check status, ownership and eligibility in the handler.
- Base44 has no transactions. Write in the order that leaves a safe state if a later write fails, and make handlers **idempotent** (calling twice gives the same result, never double-transfers).
- **Tests:** vitest next to the code (`*.test.ts`), using `createFakeDb()` + `applySeed(db, seedPlan())`. Run with `npx vitest run`. Every rule you enforce gets a test.
- **Deploy** only your own functions: `base44 functions deploy <name>`. Never run `base44 deploy` or `base44 site deploy` (Caesar only).

**Frontend pattern (Agents 2 and 3):**
- Mobile-first 390 px, pixel style (Part D of the team doc): 4 px grid, hard 4 px ink shadows, no blur, no gradients, no rounded corners. Palette CSS vars `--ink --paper --cream --grass --path --sky --peach --pink --gold --lav --red --mint`. Fonts: `Pixelify Sans` (body), `Silkscreen` (labels, uppercase).
- UI comes only from `src/app/ui` and data only from `api` in `src/app/api`. Never import the Base44 SDK in screens.
- Develop on the mock: `VITE_USE_MOCK=1 npx vite --port <yours>` (Agent 3 on 5174, Agent 2 on 5175). `mockDev.triggerEncounter()` creates the demo proposal.
- Every screen handles loading, empty and error states. Errors show `Toast` with the `ApiError.message`.
- Realtime: `api.subscribe("MatchProposal", cb)` etc. Unsubscribe on unmount.
- Respect `prefers-reduced-motion`.

**Rules that are never broken:**
1. Nothing is charged until **both** accept.
2. ownerCount 3 can never be listed or offered.
3. Agents and screens never decide for a person.
4. A parent's phone number never leaves the backend (`publicParent`).
5. "Demo payment · no real charge" appears on every pay surface.

**Working style:**
- Before coding, write your plan in 5 lines plus the exact files you'll create, then build.
- Don't run git; keep a short running changelog at the top of your report instead.
- If you need something you don't own, add a line to `NEEDS.md` under the owner and mock it on your side.
- Report at each checkpoint (10:30, 11:30, 12:30, 2:00) in this format:
  ```
  DONE: …
  MOCKED: …
  BLOCKED/NEEDS: …
  NEXT: …
  ```

---

## Agent 1 — Backend: data, closet & demo

You own the database shape, the seed, the rules for nudges and matching, and every closet and demo function. Agent 2 (trade functions) and Agent 3 (screens) start on the fake database and mock right away; your **seed going live by 10:00 PM** is what lets them test against real Base44.

### Part 1 — Rules, seed, demo

You make the data real first, because everyone's real-backend testing starts when your seed is live.

**Build in this order:**

1. **By 10:00 PM, push entities and get a seeded database:**
   - Review the 11 files in `base44/entities/`. Keep the field names identical to `types.ts`. Adjust only if the CLI rejects the schema format: an untyped `object` for `AgentInbox.payload` → store `payload` as a JSON string and note it in `NEEDS.md`; `rls: false` values → use the closest supported rule.
   - Push them (check `base44 --help` for the entities push command).
   - Implement `logic/demo.ts → demoReset(db, env)` = `applySeed(db, seedPlan(env))`, plus the function `base44/functions/demoReset/entry.ts`:
     ```ts
     import { wrap } from "../../shared/http.ts";
     import { secrets } from "base44:runtime";
     import { demoReset } from "../../shared/logic/demo.ts";
     const k = ["MINA_PHONE","JO_PHONE","SAM_PHONE","MINA_AGENT","JO_AGENT","SAM_AGENT"] as const;
     export default wrap((db) => demoReset(db, Object.fromEntries(k.map((n) => [n, secrets.get(n)]))));
     ```
   - Deploy, call it once, and confirm rows in the Base44 dashboard. Post "SEED LIVE" in the team chat.
2. **`shared/seed.ts`:** add 10–15 believable items across sizes, icons from the sprite list:
   - Icons: `item_romper item_onesie item_tee item_pants item_jacket item_dress item_set item_hat item_socks item_sweater item_bib item_sleepsack`.
   - Give Mina, Jo and Sam each a believable closet. Keep the romper, Jo's need and Sam's third-owner cardigan exactly as they are.
3. **`shared/nudges.ts → scanForNudges(input)`:**
   - `outgrow_check`: `in_closet`, ownerCount < 3, `now ≥ predictedOutgrowDate − 14 days`, and no `outgrow_check` nudge ever created for this item with this owner.
   - `listing_reminder`: listing `active` for 30+ days, and no unresolved reminder for the item.
   - Never "sell" for ownerCount 3.
   - Make `nudgeMessage` warmer: ≤ 2 sentences, plain text, deterministic, uses the pet's name.
   - Add `nudges.test.ts`.
4. **`logic/demo.ts → demoClock(db, {now?})`:**
   - Set `Setting.now` if given, run `scanForNudges` over all items, listings and children, and create each `AgentNudge`.
   - For each new nudge, `writeInbox(db, parentId, {type:"nudge:new", nudgeId, itemId, kind, message})`.
   - Return `{ now, nudgesCreated }`. Running it twice at the same time creates nothing new.
5. **`shared/match.ts`:**
   - Keep `checkEligibility` behaviour (it's the server's rulebook). Tune `findMatches` ranking: wear weeks left > condition > newest.
   - Vary `reasonLine` deterministically.
   - Add **`match.test.ts`, the eval table: 15+ cases**, each `{ name, setup, expected }`: fits; size miss; category miss; over max price; listing not shared; need not shared; own listing; third owner; withdrawn listing; sold listing; child too young; child too old; two listings ranked by weeks left; ties broken by condition; ties broken by date.
6. **`logic/demo.ts → getStats(db)` → `RelayStats`:**
   - `secondsToList`: listing `created_date` − its outgrow nudge `created_date` (real time).
   - Counts of encounters, proposals and paid trades; declined count.
   - For each item, the owner chain with names (map ids to `Parent.name`; former owners show as "Earlier family").
   - Function `getStats`.
7. **`base44/functions/selfTest/entry.ts`:**
   - Builds a `createFakeDb()`, seeds it, and runs the real handlers from `logic/closet.ts` and `logic/trade.ts` (they may still be TODO; report those as FAIL "not implemented").
   - Checks: price at 1/2/3 owners; no listing at 3; decline charges nothing; double accept is idempotent; pay before both accept is rejected; transfer happens exactly once; ownerCount ends at 2; the buyer gets a welcome nudge.
   - Returns `SelfTestRes`. Judges see this live.

**Done =**
- seed live on Base44
- `npx vitest run` all green (contract + nudges + match eval)
- `demoClock` to 2026-09-20 on real Base44 creates exactly one romper nudge + one inbox event
- `selfTest` returns a PASS list once Agent 1 and Agent 2 finish their handlers

### Part 2 — Closet functions

Implement the handlers in `base44/shared/logic/closet.ts` (signatures are already there), plus one `entry.ts` wrapper per function. Test everything on fakeDb first, then deploy each function.

1. **`getCloset(db, ref) → ClosetView`:**
   - Resolve the parent. Child = first child of the parent. `childAgeMonths` via `ageInMonths(child.birthDate, now)`.
   - `items` = owned and not `transferred_out`. `passedOn` = items whose `ownershipHistory` has this parent with a `to` date and a different current owner.
   - `listings` = this parent's listings. `needs` = this parent's needs. `nudges` = unresolved nudges for this parent.
   - `proposals` = buyer or seller, all non-terminal plus the last 5 terminal, newest first.
   - `parent` = `publicParent(p)`; never return the phone.
2. **`recordPurchase`:**
   - `ownerCount 1`, history `[{ownerId, from: purchaseDate ?? now}]`, `status "in_closet"`.
   - `predictedOutgrowDate = predictOutgrow(size, child.birthDate, purchaseDate ?? now)`, photos from `photo`.
   - Validate: price ≥ 0 and the size is a known `SizeLabel`.
3. **`listItem`:**
   - The parent must own the item; status must be `in_closet` (`listed` → `invalid_transition`).
   - `priceFor(item) === null` → `HttpError("not_resellable", "Final home: this item has had its 3 owners.", 409)`.
   - Prepend the photo to `item.photos`, set the item to `listed`, create a Listing with `priceCents = priceFor(item)` and `createdAt = now`.
   - Resolve any open `outgrow_check` nudge for the item.
   - Idempotent: if an active listing already exists for the item, return it.
4. **`withdrawListing`:** only the seller, only from `active`. The listing goes to `withdrawn` and the item to `in_closet`. Refuse while the item is `pending_trade` (an open proposal exists).
5. **`upsertNeed`:** create or update (`needId`). The child defaults to the parent's first child, and sizes must be non-empty and valid.
6. **`resolveNudge`:**
   - The nudge must belong to the parent; mark it resolved.
   - `sell` → `{ next: "open_listing" }` (the frontend opens ListingFlow; C's agent continues in iMessage).
   - `keep` / `snooze` → `{ next: "none" }`.
   - Idempotent on an already-resolved nudge.
7. **Tests** (`logic/closet.test.ts`): every bullet above, including the romper listing at exactly 1800, Sam's cardigan refusing to list, and `getCloset` never containing `phone`.
8. **Deploy** each function and test with curl:
   ```bash
   curl -s -X POST https://<slug>.base44.app/functions/getCloset \
     -H 'content-type: application/json' -d '{"parentKey":"mina"}' | jq
   ```

**Done =** vitest green, all 6 functions deployed, and on real Base44: `demoClock` (Agent 1) → `getCloset` shows the nudge → `resolveNudge` sell → `listItem` returns `priceCents: 1800`.

**Order:** Part 1 steps 1–2 (seed live) → Part 2 (all six closet handlers + tests, deploy) → Part 1 steps 3–7. Agent 3's real-backend screens need `getCloset`, `listItem` and `resolveNudge` by ~11:30.

---

## Agent 2 — Trade, full stack

You own the money moment end to end: the proposal state machine on the server, and the Trade window both phones see. Start on the fake database (backend) and the mock (frontend, `VITE_USE_MOCK=1`, port 5175). Use `mockDev.triggerEncounter()` from `src/app/api.mock` to create a proposal, and open two browser tabs (`?as=mina`, `?as=jo`) to test both sides live. Agent 3 owns `src/app/*` (routes, store, mock): ask in `NEEDS.md` if you need a route or a mock change. Export `TradeWatcher` from `src/trade/TradeWatcher.tsx`, and Agent 3 mounts it at the app root.

### Part 1 — Trade functions

Implement `base44/shared/logic/trade.ts` + wrappers. `createProposal` is **agent-only**: `wrap(createProposal, { agentOnly: true })`, checked against header `x-agent-key` = secret `AGENT_KEY`. The `payProposal` wrapper must pass the delay explicitly, because `wrap` passes `req` as the third argument: `export default wrap((db, body) => payProposal(db, body, { delayMs: 1000 }));`

1. **`createProposal(db, body)`** (called by C's agents, or by C's local fallback):
   - Load the listing, item, buyer parent and the buyer's first child.
   - Need: the buyer's first **shared** need where `checkEligibility` passes (try each).
   - No eligible need → `HttpError("not_eligible", reason, 409)`, using the reason from `checkEligibility`.
   - An `open` or `both_accepted` proposal already exists for the listing → return it (idempotent, `already_open` is not an error for the same buyer; it is a 409 for a different buyer).
   - If `encounterId` is given: the encounter must exist, contain both parties, and have `status "talking"`. Afterwards set its `status "proposed"` and copy the `transcript`.
   - Create the proposal:
     - the `snapshot` from item + listing (`previousOwners = item.ownerCount`, `wearWeeksLeft` from eligibility)
     - `sellerDecision` and `buyerDecision` `"pending"`, `status "open"`, `handover "now"`
     - `createdAt = now`, `expiresAt = now + 30 min` (demo clock)
   - Set the item to `pending_trade`.
   - `writeInbox` `proposal:new` for the seller (`role "seller"`) and the buyer (`role "buyer"`).
2. **`decideProposal(db, {parentId|parentKey, proposalId, decision, handover?, handoverNote?})`:**
   - The caller must be the buyer or the seller.
   - Expired (now > expiresAt while open) → set `expired`, the item back to `listed`, then throw `expired`.
   - Only from `open`. Same decision twice → return unchanged (idempotent). A changed decision after accept → `invalid_transition`.
   - `declined` → proposal `declined`, item `listed` (listing stays active). **No payment is ever created.**
   - Both accepted → `both_accepted`. `handover` / `handoverNote` may be set by either side.
   - `writeInbox` `proposal:updated` for both sides with the current decisions.
3. **`payProposal(db, {…, proposalId, fail?}, {delayMs = 1000})`:**
   - Only the buyer, only from `both_accepted`. Already `paid` → return the current state (idempotent, no second transfer).
   - Wait `delayMs`.
   - `fail` → `payment_failed`, item `listed`, listing `active`, inbox `proposal:updated`.
   - Otherwise, in this order:
     1. Item: close the seller's open history entry (`to: now`), append `{ownerId: buyer, from: now, priceCents}`, `ownerCount + 1`, `currentOwnerId` and `childId` = the buyer's child, `predictedOutgrowDate` for the buyer's child, `status "in_closet"`.
     2. Listing → `sold`.
     3. Proposal → `paid`, `paymentRef "DEMO-" + 6 chars`.
     4. A `new_owner_welcome` nudge for the buyer (`nudgeMessage`).
     5. Inbox `trade:completed` for both, plus `nudge:new` for the buyer.

     A crash between steps must not allow a second transfer: if the item's `currentOwnerId` is already the buyer, skip step 1.
4. **Tests** (`logic/trade.test.ts`, `delayMs: 0`):
   - The happy path ends with ownerCount 2, Jo owning the romper and the listing sold.
   - Decline charges nothing and re-lists the item.
   - Pay before both accept → 409.
   - Double accept is idempotent; double pay transfers once.
   - A third-owner item can't be proposed.
   - A non-party can't decide; an expired proposal can't be accepted.
   - `fail: true` re-lists the item.
   - Inbox events are written for both sides.
5. **`scripts/demo-api.mjs`:** a Node script that drives the whole story over HTTP against `BASE_URL` with `AGENT_KEY`:
   ```
   demoReset → demoClock Sep 20 → getCloset mina (nudge) → resolveNudge sell → listItem ($18.00)
   → demoClock Oct 18 → createProposal (agent key) → decide ×2 → payProposal → getCloset jo
   ```
   Print one line per step with ✓/✗. This is the team's backend smoke test before every demo run.

**Done =** vitest green, 3 functions deployed, and `node scripts/demo-api.mjs` all ✓ on real Base44 (after Agent 1's functions are deployed).

### Part 2 — Trade UI

2. **`useProposals()`** (`src/trade/useProposals.ts`):
   - Subscribe to `MatchProposal` for the current parent (buyer or seller).
   - Expose `active` (newest `open` / `both_accepted`) and `justPaid`.
   - When a new `open` proposal appears, open the Trade window automatically from any screen (mount a `<TradeWatcher/>` at the app root; Agent 3 imports it from `src/trade/TradeWatcher.tsx`).
3. **`TradeWindow`** (modal over any screen, and the route `/trade/:proposalId`):
   - **Layout:** a two-column header with the seller avatar (left) ⇄ the buyer avatar (right) and the item in the middle: `ItemIcon size 2` + photo thumbnail.
   - **Details:** name, size, "BOUGHT MAY 15 · $30.00", the condition with stars + note, `Hearts filled={previousOwners}` "1 PREVIOUS OWNER", `PriceReceipt`, the agent's `reason` in a `DialogBox` from the pet, and "FITS ~4 MORE WEEKS".
   - **Collapsible "HOW OUR PETS FOUND THIS":** the transcript lines (C's `AgentBubbles` may replace this later).
   - **Status row** for both sides: `WAITING… / ACCEPTED ✓ / DECLINED ✗`, live.
   - **Actions:** ACCEPT / DECLINE (`api.decideProposal`) and an optional "HAND OVER LATER" + note.
   - **Banner, always visible:** "NOTHING IS CHARGED UNTIL YOU BOTH ACCEPT."
   - **Terminal states:** `declined` → "NO TRADE · $0 CHARGED", then close. `expired` → "THIS OFFER TIMED OUT". `payment_failed` → "PAYMENT DIDN'T GO THROUGH · NOTHING CHARGED · TRY AGAIN".
4. **`PayButton`** (buyer only, when `both_accepted`):
   - Gold button "PAY $18.00" with the chip "DEMO PAYMENT · NO REAL CHARGE".
   - Pressed → a pixel spinner for 1 s → `api.payProposal`.
   - In demo mode (`?demo=1`), a small "SIMULATE FAILURE" link sends `fail: true`.
   - On `paid`: `window.dispatchEvent(new CustomEvent("trade:paid", {detail: proposal}))` (A's Celebration listens), close the window after 1.5 s, and toast "THE ROMPER FOUND A NEW HOME!".
5. **`RelayLog`** `/log` (the end card judges see):
   - big pixel counters: SECONDS TO LIST (median), ENCOUNTERS → PROPOSALS → TRADES, DECLINED · $0 CHARGED
   - below, each item's owner chain as a horizontal pixel timeline (owner name nodes with dates and the price paid), with ♥ counts
   - Data from `api.getStats()`, refreshed on `MatchProposal` changes.

**Done =** on the mock with two tabs: list the romper → trigger encounter → the Trade window pops on **both** tabs → both accept (each tab sees the other's ✓ live) → Jo pays → `trade:paid` fires → the romper is in Jo's bag → RelayLog shows 1 trade. Then the same on real Base44 after the 2:00 checkpoint.

**Order:** Part 1 steps 1–4 on the fake database (by 11:00) → Part 2 on the mock (by 1:00) → deploy your three functions and write `scripts/demo-api.mjs` → real backend at the 2:00 checkpoint.

---

## Agent 3 — App shell & Closet UI

You own the app frame and every closet screen, including listing an item. Work on the mock (`VITE_USE_MOCK=1`, port 5174) until 11:30, then make the real adapter work. You are the only agent who adds npm packages (`react-router-dom`, `zustand`, anything the screens need). Add them first thing so Agent 2's screens can use them.

### Part 1 — Shell, API, Bag, Nudge, Needs

1. **App shell:**
   - `src/app/main.tsx` + `routes.tsx`: routes `/`, `/world`, `/bag`, `/bag/needs`, `/bag/list/:itemId`, `/trade/:proposalId`, `/log`.
   - Use placeholders for A's routes (`/`, `/world`) and C's pet. Mount Agent 2's components at their routes (`/trade/:proposalId` → `TradeWindow`, `/log` → `RelayLog`, `<TradeWatcher/>` at the root). Use a placeholder until their files exist.
   - Bottom tab bar: WORLD · BAG · LOG, plus a pet button slot (C).
   - Projector frame: on screens wider than 600 px, centre a 430 px "handheld" column.
2. **`store.ts`** (zustand): `parentKey` from `?as=` (persist in sessionStorage), `closet: ClosetView | null`, `refreshCloset()`, and `toast(text, tone)`.
   - Subscribe once to `ClothingItem`, `Listing`, `AgentNudge` and `MatchProposal` changes. On any change touching this parent, call `refreshCloset()` (debounce 200 ms).
3. **`ParentPicker`:** three pixel cards (Mina, Jo, Sam) with avatar placeholders → sets `?as=`. Shown when `?as` is missing.
4. **`DemoPanel`** (`?demo=1`, collapsible pixel panel at the top):
   - Clock buttons MAY 15 / SEP 20 / OCT 18 (`api.demoClock`) and RESET (`api.demoReset`). Show the current demo date as a chip.
   - On the mock, also "TRIGGER ENCOUNTER" (`mockDev.triggerEncounter`).
5. **`api.real.ts`:**
   - Implement every `Api` method over the template's Base44 client:
     - functions via `base44.functions.invoke(name, payload)`: unwrap the data, and map an `{error:{code,message}}` body or a non-2xx response to `ApiError`
     - `uploadPhoto` via the Base44 file-upload integration → `{url}`
     - `subscribe(entity, cb)` via `base44.entities[entity].subscribe(ev => cb({type, id, data}))` → returns the unsubscribe function
   - `suggestCondition` calls C's frontend function `suggestCondition` (until it exists, return `{}`).
6. **`api.mock.ts`:**
   - Once Agent 1 and Agent 2 finish their handlers, replace the starter handlers with the real ones from `base44/shared/logic/closet.ts`, `trade.ts` and `demo.ts` on the fakeDb (`payProposal` with `delayMs: 600`), so the mock behaves exactly like the server.
   - Keep `mockDev.triggerEncounter()`, rewritten to call `createProposal`.
   - Keep `src/app/api.mock.test.ts` passing.
7. **`ClosetScreen` "BAG"** `/bag`:
   - Header `PixelPanel`: the child card ("BEAN · 9 MONTHS") and a chip with the demo date.
   - A pixel inventory grid, 4 columns of `ItemIcon` slots with a 4 px gap. Status badges sit on the slot: LISTED (gold), TRADING (pink), FINAL HOME (lav).
   - Tapping a slot selects it and shows an `ItemCard` below.
   - "PASSED ON" shelf (greyed slots) and a NEEDS button.
8. **`ItemCard`:**
   - name, size chip, `Hearts filled={ownerCount}`, `FitBar until={predictedOutgrowDate} now={closet.now} from={ownedSince}`, purchase date and original price, status
   - **SELL** (→ `/bag/list/:itemId`) unless ownerCount 3 ("FINAL HOME 💛 — this one stays") or already listed (then show the price and WITHDRAW)
9. **`NudgeDialog`:**
   - When `closet.nudges` has an unresolved nudge, show the pet `DialogBox` (speaker = `{name: parent.pet.name, sprite: parent.pet.sprite}`) with the nudge message.
   - Choices SELL / KEEP / LATER → `api.resolveNudge`. Sell navigates to the listing flow; `new_owner_welcome` gets a single OK.
   - One nudge at a time, oldest first.
10. **`NeedsScreen`** `/bag/needs`:
    - size chips (multi-select, ordered by `SIZE_ORDER`), category chips, optional max price, a SHARE toggle with the explanation "Your pet only tells other pets what's shared", SAVE → `api.upsertNeed`
11. **When A's kit merges:** change `src/app/ui.tsx` to `export * from "../pixel/components";` and fix any prop mismatch on your screens (tell A in `NEEDS.md` if their prop differs from Part D).

**Done =**
- on the mock: pick Mina → SEP 20 → the nudge dialog → SELL opens the listing route
- the bag shows statuses live
- on real Base44: the same flow with real data, and `npx vitest run` green

### Part 2 — Listing flow

**`ListingFlow`** `/bag/list/:itemId`: three steps in `PixelPanel`s with a 3-dot step indicator.
   - **PHOTO:** camera or file input (`accept="image/*" capture="environment"`) → `api.uploadPhoto`. Show it in a pixel "polaroid" frame with a 4 px border and a caption strip. A retake button.
   - **CONDITION:** call `api.suggestCondition({imageUrl})` and pre-select the result with a "PET SUGGESTED" chip, or nothing if empty.
     - Three big options: LIKE NEW ★★★, GENTLY USED ★★☆, WELL LOVED ★☆☆.
     - A note field (placeholder "tiny stain on the cuff").
   - **PRICE:**
     - `PriceReceipt` with `original = item.originalPriceCents`, `pct` from the owner count (0.6 / 0.4), `price` = `priceFor(item)` imported from `src/app/types` (display only, since the server sets the real price), and `ownerAfter`.
     - The text line `priceRuleText(item)`.
     - SHARE toggle (default on; "Only shared listings can be found by other pets").
     - CONFIRM → `api.listItem`. Then a toast "LISTED!" and a coin sound hook (`window.dispatchEvent(new CustomEvent("sfx", {detail: "coin"}))`, which A's sound system listens for), and navigate back to `/bag`.
   - Errors: `not_resellable` → a "FINAL HOME" panel and a back button.

**Order:** packages + shell + store + picker + demo panel (by 10:30) → Bag + ItemCard + NudgeDialog → ListingFlow (by 12:00, so the team's 12:00 gate "list the romper at $18.00" works) → `api.real.ts` → mock on real handlers → Needs.

---

## Checkpoints (Caesar commits at each)

- [ ] **10:30:** `npx vitest run` green; the mock app runs (shell + Bag); "SEED LIVE" on Base44; trade handlers green on the fake database. Swap `src/app/ui.tsx` to A's kit if it's in.
- [ ] **11:30:** closet functions deployed; `api.real.ts` works for `getCloset` / `listItem`.
- [ ] **12:30:** trade functions deployed; `node scripts/demo-api.mjs` all ✓; the real app lists the romper at $18.00 on Sep 20.
- [ ] **2:00:** C's encounter calls `createProposal` → the Trade window on both phones.
- [ ] **4:00:** full demo with A's flowers and C's agents; `selfTest` all PASS on the projector.
