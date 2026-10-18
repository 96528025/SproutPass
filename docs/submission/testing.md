# Testing

What we test, how to run it, the counts from the latest run, and every live run we did with what it found.

**Latest run:** Oct 18, 2026, on the current working tree (Windows 11, Node 22, Python 3.13.5, Deno 2 via `npx`).

| Suite | Command (from the repo root) | Result |
|---|---|---|
| TypeScript | `npx tsc -p tsconfig.check.json` | exit 0, no errors |
| vitest (app + shared logic) | `npx vitest run` | **21 files, 429 tests passed** |
| Deno (C's iMessage, webhook, parity) | `npx -y deno@2 test --no-lock -A base44/shared/c/` | **59 passed, 0 failed** |
| Deno type-check of every function | `npx -y deno@2 check --no-lock --node-modules-dir=none base44/functions/*/entry.ts` | all 29 entries pass |
| pytest (Fetch.ai agents) | `agents/.venv/Scripts/python.exe -m pytest -q agents/tests` | **102 passed** |
| Offline agent story | `agents/.venv/Scripts/python.exe agents/local_demo.py` | **LOCAL DEMO PASS**, 13 of 13 checks |

`--node-modules-dir=none` is needed for the four entries that import `npm:@simplewebauthn/server@13`
(`payProposal`, `passkeyRegisterOptions`, `passkeyRegisterVerify`, `passkeyAuthOptions`): the repo's `package.json`
puts Deno in node_modules mode, and that package is a Deno-only import. The other entries pass with or without it.

On macOS or Linux, use `agents/.venv/bin/python` instead of `agents/.venv/Scripts/python.exe`.

---

## vitest: 429 tests in 21 files

Business logic is pure TypeScript, so these tests run the same handlers the Deno functions and the browser mock run.

| File | Tests | What it proves |
|---|---:|---|
| `base44/shared/logic/snap.test.ts` | 80 | Snap-to-list: size from tag text ("9M" → 6-9M), clamped categories and prices, confidence, PII removed from names and notes, template fallback on any model failure, demo picks never claim to be AI |
| `base44/shared/logic/trade.test.ts` | 50 | Proposal state machine, both accepts before pay, only the buyer pays, double pay transfers once, decline and expiry charge $0 and relist, the buyer's mandate in `createProposal`, the Face ID approval gate |
| `src/app/mockWorld.test.ts` | 37 | The mock world: demo walk to 25 m, encounters, the pets' lines, the mock protocol log, pet rules blocking a match, TRIGGER ENCOUNTER through the real path |
| `base44/shared/logic/closet.test.ts` | 36 | Closet, listing, needs, nudges; no phone number anywhere in a closet response |
| `base44/shared/logic/trust.test.ts` | 35 | Mandate defaults and validation, budget counting pending trades, challenges (single use, 5 minutes, bound to trade and price), passkey cap and removal, RESET restores defaults, relying-party pinning |
| `base44/shared/match.test.ts` | 26 | Eligibility and ranking (weeks of wear left, then condition, then newest), 3rd owner never offered |
| `base44/shared/agentApi.test.ts` | 23 | Agent API: inbox claim by type, protocol log on `createProposal` and `noMatch`, never relabelling a decided encounter, fallback log shape, log cleaning, retry when the live schema refuses a new field, mandate-blocked encounters |
| `src/trade/tradeLogic.test.ts` | 22 | Trade window logic: the banner text for every state, receipt lines, mandate fit, "You become / became owner 2 of 3" |
| `base44/shared/logic/demo.test.ts` | 19 | Demo clock nudges exactly the romper on Sep 20, RESET keeps parent ids, seed |
| `src/trust/trustLogic.test.ts` | 19 | Pet-rules screen helpers, biometric names, the mock's demo passkey shape, cancel detection |
| `base44/shared/nudges.test.ts` | 15 | Outgrow nudges and their wording |
| `base44/shared/logic/impact.test.ts` | 15 | Impact totals rounded down, money saved and earned, points and badges, no phone numbers reach the calculation |
| `src/console/consoleModel.test.ts` | 13 | Agent Console: matching log entries to agents, the outcome card, refusals, the encounter chip after payment |
| `base44/shared/cbridge.test.ts` | 9 | C's in-process bridge to B's handlers keeps status codes and argument shapes |
| `src/trust/imessageLine.test.ts` | 8 | The "Text Pip" panel's number, `sms:` link and status |
| `src/trust/qr.test.ts` | 7 | Dependency-free QR encoder for the "Text Pip" panel |
| `src/impact/live.test.ts` | 6 | Live reloader for `/log` and `/impact` (3 s debounce, loads at least 5 s apart, no overlap), friendly durations |
| `src/pixel/components/FitBar.test.tsx` | 4 | Fit bar copy, the year for far dates, daylight-saving-safe day counts |
| `base44/shared/contract.test.ts` | 3 | Contract smoke: romper $18.00, outgrow dates, eligibility |
| `src/app/api.mock.test.ts` | 1 | The whole story through the mock `Api`: nudge → $18 listing → proposal → pay → Jo owns it |
| `src/impact/impact.mock.test.ts` | 1 | `getImpact` through the mock `Api` after a full trade |

## Deno: 59 tests in `base44/shared/c/`

These run C's real webhook handler, B's real handlers on a seeded fake database, and a stubbed Photon that, like the
real API, answers 400 to any POST without an `idempotency-key`. No network.

| File | Tests | What it proves |
|---|---:|---|
| `convo_test.ts` | 29 | Whole iMessage conversations: nudge → photo → quote → "like new" → "yes" lists at $18.00; trade by text with both accepts and the approve-in-app link; "pay" never pays; STOP and its variants; rate limits; "no deal" and "is that a good deal?" never accept; a "yes" answers the newest question; failures still answer; names on labels never reach the listing |
| `imessage_test.ts` | 14 | Per-parent Photon lines, a parent who hasn't texted gets zero Photon calls, the flowers GIF from the same line, Photon refusals reported as not sent, opt-out, phone masking, the outbound cap |
| `c_test.ts` | 9 | Geometry and distance bands, the encounter rule, Photon message parsing, intents |
| `webhook_test.ts` | 5 | Webhook signatures: valid, tampered, stale, missing, rotated, svix aliases, the Standard Webhooks reference vector; redelivery answered once; strangers get nothing |
| `parity_test.ts` | 2 | Runs `agents/.venv` Python and checks that every iMessage line and every intent is word for word the same in `agents/wording.py` / `agents/intents.py` as in TypeScript |

## pytest: 102 tests in `agents/tests`

| File | Tests | What it proves |
|---|---:|---|
| `test_relay.py` | 62 | The closet agents' brain against `mock_base44.py`: intents, ASI:One cards, nudge → list, the relay flow both ways, two-sided accept, decline = $0, 3rd owner can't sell, the pet-rules `Decline`, the ASI:One pay card pointing to the app when Face ID is required. A privacy test asserts that no birth date, parent name, phone, coordinate or parent id crosses the agent wire |
| `test_live.py` | 30 | `live_bureau.py`: the shared call budget, startup backoff on 429, the inbox type filter, a clean Ctrl+C with a real aiohttp session |
| `test_agent_log.py` | 10 | The protocol log: name-free summaries, no duplicates from retried handlers, the 40-entry cap |

## The offline agent story (`agents/local_demo.py`)

Three uAgents (mina, jo, sam) in one Bureau against an in-memory copy of the app's rules. A clearly labelled
stand-in answers the iMessage rows with the live app's wording. It prints every text, the pets' conversation and the
**Fetch.ai protocol log**, for example:

```
Fetch.ai protocol log (Encounter.agentLog) · negotiatedBy=fetch · 5 messages
  start   agent1qfg7…4upj → agent1qdmf…u7vd  LookingFor    Says hello; has no shared need to ask about.
   +0ms   agent1qdmf…u7vd → agent1qfg7…4upj  LookingFor    Asks for size 6-9M (top, onesie).
   +1ms   agent1qfg7…4upj → agent1qdmf…u7vd  HaveListings  Offers 1 shared listing: Yellow duck romper, size 6-9M, $18.00.
 +264ms   agent1qdmf…u7vd → agent1qfg7…4upj  ProposeTrade  Proposes the listing at $18.00. Size 6-9M fits for about 4 more weeks.
   +1ms   agent1qfg7…4upj → agent1qdmf…u7vd  TradeAck      Agrees to the trade; both parents still decide in the app.
```

It ends with 13 checks: the romper is Jo's with 2 owners, the proposal was paid at $18.00 by the fetch agents, the
encounter was proposed with both pets talking, both parents got the proposal, Jo was sent to the app to approve
(never paid by text), flowers for both, one welcome, the protocol log stored, Mina quoted and listed at $18.00, Sam's
3rd-owner item refused, inbox drained, every logged message between the two `agent1q…` addresses, and the agents
claimed only encounter rows. Latencies are 0–1 ms here because all agents share one process; real latencies only
appear on live. Other modes: `--jo-first` (Jo opens) and `--rules` (Jo's price limit blocks the trade and the agents
end with a `Decline`).

---

## Live runs on the deployed site

All on https://sproutpass-5c025059.base44.app (or its API address before the site was published). From our running
log, `NEEDS.md`.

| When (2026) | What we ran | Result and what it taught us |
|---|---|---|
| Oct 17, ~22:00 | Backend story on live | `demoClock` returned "Rate limit exceeded" several times: the limit is a team-wide token bucket. The seed moved to `bulkCreate` / `deleteMany` and every entry file got `withRetry` backoff. |
| Oct 17, ~22:10 | `createProposal` on live | 403 for everyone: the `AGENT_KEY` secret wasn't set. Set it; the key lives only in the gitignored `.env.local`. |
| Oct 17, 22:25 | `node scripts/demo-api.mjs` | **All 12 steps pass on real Base44:** `createProposal` → both accept → pay `DEMO-…` → idempotent re-pay → romper in Jo's bag with a welcome nudge. |
| Oct 17, ~23:07 | Site published | The address is `sproutpass-5c025059.base44.app`, not `sproutpass.base44.app`. |
| Oct 17, 23:45 | First live encounter, two tabs | Sep 20 → Sell → list $18.00 → Oct 18 → demo walk 120 → 70 → 20 m → encounter → local fallback → `createProposal` → **trade window popped on both tabs live**. Found: the other party's name showed "…" and the screen fetched the other family's whole closet (fixed with `getParties`); RESET left stale trade windows open because bulk deletes send no per-row events (fixed); RESET gave parents new ids (now ids are kept); rate limit hit twice. |
| Oct 18, ~00:20 | `getParties` on live | Returns only `{id, name, avatar, pet}`, drops unknown ids and duplicates. |
| Oct 18, ~02:00 | **Full integration, A + B + C** | Two tabs: Sep 20 nudge → Sell → photo (pixel fallback) → "Gently used · pet suggested" → $18.00 listed → Oct 18 → Jo walks toward Mina → encounter scene with the pets' bubbles → trade window on both tabs → accept on both (each tab sees the other's ✓) → demo pay → celebration on both → romper in Jo's bag with Pip's welcome nudge. |
| Oct 18, ~02:00 | **Fetch.ai agents live** (`live_bureau.py`) | The agents negotiated in their Bureau and created the proposal themselves (`source: fetch`, 6-turn transcript), and each pet told its parent. Found: startup exited on a 429 and Ctrl+C left an unclosed session (both fixed since, with tests); Python and TypeScript wording differed (now checked by `parity_test.ts`). |
| Oct 18, ~02:00 | `selfTest` on live | **13 of 13 checks pass** (prices, the Sep 20 nudge, no phone in a closet, $18.00 listing, 3rd owner can't list, decline charges nothing, pay before both accept is refused, accept twice is idempotent, pay twice transfers once, 2 owners, welcome nudge). |
| Oct 18, ~04:30 | **After deploying the upgrades** (entities pushed, all 29 functions, site), three tabs at 430×880 | RESET → Sep 20 nudge → Sell → pixel-art photo → "Gently used · pet suggested" → $18.00 listed → Oct 18 → Jo walks toward Mina → encounter scene with the pets' bubbles → trade window on both tabs with the receipt "You save vs new $12.00 (40% off)" and "Within your pet's rules (up to $50.00 a trade, $82.00 left this month after this)" → accept on both → pay `DEMO-6FCQR4` → celebration. `/agents` on the third tab: the encounter, negotiated by the fallback matcher (agents off to save the rate limit), 4 HandMeDownRelay messages, the pets' 5 lines, a clean privacy check, PAID with both accepts. `/impact`: 5 new homes, 10.3 kg CO₂e, 4,830 litres, $79.20 saved, $98.80 earned, the points leaderboard. Found: `/impact` hit the rate limit right after the payment and loaded a minute later; the console's names showed "A parent" for a while for the same reason and filled in on its next poll. |

## Mock-verified on Oct 18

After the first live runs, nine workstreams added the hackathon upgrades. Each was checked in mock mode (the real
handlers in the browser) and in the tests above, then deployed (see the ~04:30 live run):

- **Pet rules and passkeys:** a $25 limit saved; a $10 limit stops the trade with the rule named; demo passkey set-up
  turns "require Face ID" on; paying without approval is refused; paying with it goes through and the month's spend
  updates. Also a Deno script with a software authenticator (registration, refused unapproved and tampered
  payments, a real signature pays, replay changes nothing) and headless Chrome with a WebAuthn virtual
  authenticator.
- **Agent Console:** a second tab on `/agents` follows a walk live: 4 protocol messages, the pets' lines, a passing
  privacy scan, the outcome with the 60% rule, and the chip changing to PAID.
- **Snap to list:** photo, pixel art and "skip" paths, price edit, the NEW badge in the bag, no horizontal scroll at
  360 px.
- **Impact:** a second tab on `/impact` counts up live after a trade (+1 home, carbon, water, money, points).
- **Readability:** every screen at 390×844 and 360 px, contrast measured against the palette.

Our own pass while writing these docs (mock on port 5193): Sep 20 nudge → Sell → pixel art → "Gently used · pet
suggested" → Confirm $18.00 → Oct 18 → Jo's "Walk toward Mina" → encounter scene ("They found a fit!") → trade window
→ accept as Jo and as Mina → Pay $18.00 → flowers → receipt with a `DEMO-` reference. `/agents` showed the 4 mock
protocol messages labelled Mock, a clean privacy check and PAID; `/impact` showed 5 new homes; `/bag/pet` showed
"$18.00 spent in October · $82.00 left".

### Not verified anywhere yet

- On live: snap-to-list on a real photo (`analyzeItemPhoto`), saving pet rules (`setMandate`), and passkey set-up
  and a passkey-approved payment (`passkey*`, `payProposal`). `getTrust` and `getImpact` ran in the ~04:30 run.
- Face ID on a real phone against the deployed `payProposal`.
- Real Photon deliveries with signatures, Photon's webhook timeout while a photo guess runs, and the GIF upload.
- ASI:One through an Agentverse mailbox.

---

## Rate limit notes

Base44's Free plan gives the whole team one token bucket for function calls (shared with our CLI). We saw failures
at about 10 calls a minute. What we do about it:

- Every entry file wraps the database in `withRetry` (`base44/shared/logic/closet.ts`): a 429 is retried with backoff
  for about 11 seconds.
- The seed uses bulk writes; `getCloset` makes one read per entity, in parallel.
- `live_bureau.py` spends at most `CALLS_PER_MIN` (8) for all three agents, makes one `claimInbox` for all three
  parents every 12 s, skips a poll when only 2 calls are left in the minute, and pauses everything on a 429.
- The agents send the pets' whole conversation with `createProposal` instead of one call per line.
- `/log` and `/impact` reload at most once every 5 seconds.
- For demos: no scripts or deploys while presenting, close extra tabs, and consider a paid plan.

## Going-live checklist

Status on Oct 18, about 04:30: steps 1, 2 and 7 are done, step 3 is safe now, step 4 is done except the iMessage
phone and webhook secrets, and step 6 is done apart from snap-to-list on a real photo and Face ID. What is left needs
a person with Photon access and real phones (steps 4 and 5).

1. **Done. Push entities** (`npx base44 entities push`): `Encounter.json` adds `agentLog`, `negotiatedBy` and
   `noMatchReason`; `Parent.json` adds `mandate`, `passkeys` and `passkeyChallenge` (admin-only).
2. **Done. Deploy functions and the site** (`npx base44 deploy --build -y`). New: `getTrust`, `setMandate`,
   `passkeyRegisterOptions`, `passkeyRegisterVerify`, `passkeyAuthOptions`, `passkeyRemove`, `analyzeItemPhoto`,
   `getImpact`. Changed: `payProposal`, `createProposal`, `demoReset`, `agentApi`, `photonWebhook`, `sendImessage`
   and the location functions (their shared code changed). Confirm on the first deploy that the four passkey
   entries bundle `npm:@simplewebauthn/server@13`. Always build through the CLI; a bare `npm run build` leaves the app
   id unset.
3. **Restart `live_bureau.py` only after `agentApi` is deployed.** An old `agentApi` ignores the inbox type filter,
   and the agents would answer iMessage rows the app already answers.
4. **Secrets:** `APP_HOST=sproutpass-5c025059.base44.app` (pins passkeys and builds links); for iMessage
   `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `WEBHOOK_KEY`, optional `SEED_PHONES`, `MINA_PHONE` / `JO_PHONE` /
   `SAM_PHONE` then one RESET, and optionally `PHOTON_WEBHOOK_SECRET` (the `whsec_…` value) to require signatures.
5. **Photon:** point the webhook at `/functions/photonWebhook?k=<WEBHOOK_KEY>`, give each demo phone its own
   shared-pool number, and have each phone text "hi" to its number once.
6. **Rehearse once:** run `selfTest`, then the [demo script](demo-script.md). Check that `/bag/add` says "AI GUESS"
   on a real photo, `/impact` loads, and Face ID set-up works on `/bag/pet`.
7. **Done. Follow-ups:** the decide, pay, list and demo-clock entry files call `sendEventTexts(db)` after the
   handler, so event texts go out at once; RESET keeps a parent's STOP (`seed.ts` carries `convo.optedOut` over).
