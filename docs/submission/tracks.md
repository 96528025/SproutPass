# How Hand-Me-Down Relay fits each track

Each section maps our features to the track's judging criteria, with the files and tests a judge can open. Paths are
relative to the repo root. Test counts are from a run on Oct 18, 2026 (see [testing.md](testing.md)).

A note that applies to every section: **payments are a demo payment · no real charge.** We collect no card, store
no card, and integrate no payment network. "Live" below means verified on the deployed site; "mock" means verified
in mock mode, which runs the same server handlers in the browser.

---

## Visa · Future of Shopping: Powered by AI, Secured by Visa

**Our pitch for this track:** agentic shopping between neighbours. Each parent's AI agent finds and negotiates a
second-hand purchase on its own, inside rules the parent set, and then hands the decision back to the person. The
payment step is designed the way trusted agentic checkout should work: a delegated mandate, consent from both
sides, and step-up approval with a passkey bound to this exact trade and price. We do not use Visa's brand or
claim a Visa integration; the payment itself is simulated.

### Innovation (25%)

- **Proximity-triggered agent-to-agent commerce.** When two parents are within 25 m, their two Fetch.ai agents
  negotiate a purchase with each other (`LookingFor → HaveListings → ProposeTrade → TradeAck`), and the result
  appears on both phones at once. Files: `agents/relay_protocol.py`, `agents/closet_agent.py`,
  `base44/shared/c/location.ts` (encounters), `base44/shared/c/encounter.ts` (agent handlers).
- **The agent shops for the buyer and sells for the seller at the same time**, and neither agent can complete a
  purchase: proposing is the agent's job, accepting and paying are the people's.
- **A mandate the agent must obey.** The buyer's pet carries spending rules (price limit per trade, monthly budget,
  allowed categories, "may propose at all", "require Face ID"). The agents check them before they propose and send a
  `Decline` that names the rule but never the amount; the server checks them again in `createProposal`.
  Files: `base44/shared/logic/trust.ts` (`checkMandate`, `enforceMandate`), `base44/shared/logic/trade.ts`.
- **Provenance pricing.** The price is set by the item's ownership history, not by haggling: the 2nd owner pays 60%
  of the original price, the 3rd pays 40%, and after 3 owners the item can't be sold. `base44/shared/pricing.ts`
  is the only price implementation.

### User Experience (25%)

- **Three decisions, all obvious.** Sell / Keep / Later on the nudge; Accept / Decline on the trade; Pay. Everything
  else (finding a buyer, the price, the fit) is done for the parent.
- **A receipt that explains itself** (`src/trust/TrustReceipt.tsx`): how much the buyer saves against new, who gets
  paid, "within your pet's rules (up to $X a trade, $Y left this month)", which owner number the buyer becomes and
  the 60/40 rule, the payment reference, and how the payment was approved.
- **The banner tells the truth at every step** (`tradeBanner` in `src/trade/tradeLogic.ts`, tested): "Nothing is
  charged until you both accept." → "You both said yes. Nothing is charged until you tap Pay." → "Paid · demo
  payment, no real charge", or "No trade · nothing was charged".
- **Recoverable passkey flow** (`src/trade/PayButton.tsx`, `src/trust/passkey.ts`): if this device has no saved
  passkey, the button offers "Add this device, then pay"; cancelling Face ID says "nothing charged"; a double tap
  can't pay twice.
- **Readable for tired parents.** Atkinson Hyperlegible Next at 17 px for every sentence, WCAG AA contrast measured
  against the palette, 44 px touch targets (`src/pixel/tokens.css`).
- **Shopping without opening the app.** By iMessage a parent can sell with a photo and accept with a text; paying
  always goes back to the app for approval.

### Technical Execution (20%)

- **Server-enforced state machine** (`base44/shared/logic/trade.ts`): `open → both_accepted → paid`, with
  `declined`, `expired` and `payment_failed` exits. `payProposal` refuses anything not `both_accepted`, only the
  buyer can pay, and a double tap transfers the item once (the payment is claimed before the wait). Tests:
  `base44/shared/logic/trade.test.ts` (50).
- **Passkeys verified on the server.** `base44/functions/payProposal/entry.ts` verifies the WebAuthn assertion with
  `@simplewebauthn/server` (user verification required) before calling `payProposal`. A request body can't set the
  "approved" flag; only the entry file sets it, after the signature checks out (the localhost mock has its own
  clearly marked stand-in that skips the signature).
- **A challenge bound to the trade.** A payment challenge is 16 random bytes plus the first 16 bytes of a SHA-256 over
  the trade id, buyer, seller, item and price (`paymentChallenge` in `base44/shared/logic/trust.ts`). It is single
  use (cleared before it is checked), expires in 5 minutes, and stops working if the price changes. The signature
  counter is stored, and the relying party is pinned to the app's host. Tests: `base44/shared/logic/trust.test.ts`
  (35) and the Face ID blocks in `trade.test.ts`.
- **The budget counts pending trades too**, so two open offers can't overspend the month together.
- **Same code everywhere.** The rules are pure TypeScript that runs in the Deno functions, in the browser mock and in
  vitest, so the mock judges can try is the real logic.
- Checked beyond unit tests (Oct 18): a Deno script with a software authenticator ran registration, a
  refused unapproved payment, a refused tampered signature, and a paid trade; headless Chrome with a WebAuthn
  virtual authenticator ran the browser flow against the mock. Not yet run on the deployed Base44 functions.

### Commerce Impact (15%)

- **A market that doesn't exist today.** Most outgrown baby clothes are never resold because listing them is more
  work than they are worth. Here listing takes three taps after a nudge, or one photo by text, and the buyer is
  found by walking past.
- **Real savings on both sides.** In the demo, the buyer pays $18.00 for a $30.00 romper and the seller gets $18.00
  back. `/impact` totals money saved by buyers and earned by sellers across every hand-off
  (`base44/shared/logic/impact.ts`, 15 tests).
- **Trust in used goods.** Every item carries its ownership chain (hearts for owners 1 to 3) and its original price,
  so the buyer knows what they're getting. The `/log` hub shows each item's chain.
- **Repeatable loop.** The buyer's pet starts tracking the item the moment it arrives ("It should fit until
  ~Nov 17. I'll check in then."), so today's buyer is a future seller.

### Trust & Responsibility (15%)

- **Privacy.** Other parents see a distance band and a 5° bearing, never coordinates (`base44/shared/c/geo.ts`,
  `listNearby`). Presence rows are server-only. The agents' messages carry only shared listings, shared needs and the
  child's age in months. A parent's phone, Photon ids, pet rules and passkeys are admin-only fields and are removed
  by `publicParent` (`base44/shared/db.ts`) from every response.
- **Transparency.** The Agent Console (`/agents`) shows every agent message with who sent it, and checks every
  message and pet line on screen for names, phone numbers, coordinates and birth dates. It labels whether a Fetch.ai
  agent, the fallback matcher or the offline mock spoke. "Demo payment · no real charge" appears on every pay
  surface.
- **Security.** All entity writes go through functions (clients have no create/update/delete rights). Agent calls
  need `x-agent-key`. Signed Photon webhooks (Standard Webhooks scheme, 5-minute window) when the secret is set.
  Per-parent rate limits on texts.
- **Responsible AI.** AI suggests; people confirm. Snap-to-list marks every guessed field "PET SUGGESTED" and shows
  its confidence; offline guesses are labelled as quick guesses or demo picks, never as AI
  (`base44/shared/logic/snap.ts`, 80 tests). The vision prompts tell the model not to copy names from labels and to
  ignore instructions written in the photo. Every AI feature has a template fallback, so nothing breaks without a
  model.
- **What we state plainly:** there is no sign-in in this demo (`?as=` picks the family), so anyone acting as a demo
  parent could register a passkey for them; the monthly budget is checked when the pet proposes, not again at
  payment; the payment is simulated.

---

## Base44 · Build Something People Want

### Real problem

Kids outgrow clothes every few months and parents already pass clothes along informally. What stops it from
scaling is memory (what fits whom, when) and effort (listing, pricing, meeting up). The app removes both: the pet
remembers and predicts, the price is fixed, and the buyer is found by walking past.

### Working product

- Deployed at https://sproutpass-5c025059.base44.app. On Oct 18 (about 02:00) we ran the whole story there on two
  tabs: nudge, sell, pet-suggested condition, $18.00 listing, demo walk, encounter, trade window on both tabs,
  accept on both, demo pay, celebration on both, item in the buyer's bag. A second run had the Fetch.ai agents
  create the proposal. The backend's `selfTest` passed 13 of 13 checks on live.
- The newer features (pet rules and passkeys, snap-to-list, impact, Agent Console log, the full iMessage
  conversation) are in the repo and verified on the mock and in tests; they need one deploy (checklist in
  [testing.md](testing.md#going-live-checklist)).
- Anyone can try the full product with no account: `npx vite --mode mock`, two tabs.

### Thoughtful decisions

- **Fixed pricing instead of haggling** (60% / 40% / final home): no negotiation stress between neighbours, and an
  item's price tells its story.
- **Agents propose, people decide.** Both parents must accept; only the buyer can pay; the iMessage pet never pays.
- **Privacy by banding.** Distance bands and rounded bearings instead of locations.
- **A fallback that never pretends.** If the agents are slow, the app's matcher proposes the same trade and labels
  itself `fallback`.
- **Readability over style.** We kept the pixel look for titles and numbers and moved every sentence to a font made
  for low-vision readers after noticing the pixel font made "5" look like "S" on prices.

### Creative use of Base44

- **One codebase, three runtimes.** Business logic in `base44/shared/**` is pure TypeScript. The 29 Deno functions
  wrap it, the browser mock runs it on a fake database shared across tabs, and vitest tests it.
- **Entities as the security boundary.** Every entity denies client writes; field-level rules make `phone`,
  Photon ids, `mandate` and `passkeys` admin-only (`base44/entities/Parent.json`).
- **Realtime as the multiplayer layer.** Both phones subscribe to `MatchProposal`, `Encounter` and friends, so a tap
  on one phone shows a ✓ on the other, and the projector screens (`/agents`, `/impact`) update live.
- **InvokeLLM for vision** in three places: snap-to-list (`analyzeItemPhoto`), condition suggestion
  (`suggestCondition`), and recognising which closet item an iMessage photo shows (`guessFromPhoto`). Each one has a
  JSON schema, a timeout and a template fallback.
- **Functions as the agents' API.** One `agentApi` function (with `x-agent-key`) is the Python agents' whole
  interface: claim inbox rows, read shared state, propose, end without a match, register an address.
- **`UploadFile`** for listing photos and the iMessage flowers GIF, and **secrets** for keys and the app host.

### Evidence of learning

From our running log (`NEEDS.md`) and the code:

- **Free-plan rate limit:** a team-wide token bucket. We moved to bulk seed writes, `withRetry` in every entry file,
  a shared agent call budget, one batched inbox poll, and spaced-out dashboard reloads.
- **Deploy layout:** Base44 uploads `base44/shared/` next to each function, so a sibling `_lib` folder failed at
  deploy; C's helpers moved to `base44/shared/c/`.
- **Service-role calls drop custom headers:** function-to-function calls lost `x-agent-key`, so `cbridge.ts` calls
  B's handlers in process (cheaper on the rate limit too).
- **Bulk deletes send no per-row events:** RESET left stale trade windows open, so the window now closes on a
  not-found or a missing trade.
- **Schema strictness:** a field declared as an object may refuse `null`, so cleared challenges are stored as `{}`;
  encounter writes retry without new fields if the live schema hasn't been pushed yet.

### Potential

Any family with young children, in any neighbourhood with foot traffic: parks, daycare pick-up, playgrounds. The
same pattern (an agent that remembers what you own and talks to the agent of the person next to you) works for
kids' gear, books and toys. Next steps are in [devpost.md](devpost.md#whats-next).

---

## Photon · Messaging Agent (iMessage)

Our pet lives in the parent's iMessage thread through Photon 2.0. **Status:** the full conversation is implemented
and tested end to end against Photon's documented API with a stubbed Photon (59 Deno tests). Running it on real
phones needs the Photon set-up steps in [testing.md](testing.md#going-live-checklist).

### Agents that live in conversations

- **Sell by text.** "sell the romper", or just a photo. The pet works out which closet item the photo shows
  (`guessFromPhoto` in `base44/shared/c/condition.ts`), suggests a condition, and quotes the fixed price: "That's the
  Yellow duck romper, gently used (Tiny stain on the cuff). Fair price $18.00 (2nd owner pays 60% of $30.00) — reply
  "yes" to list it, or tell me a different condition." "like new" re-quotes; "yes" lists.
- **Trade by text.** The proposal arrives in both threads with "nothing is charged until you both accept". "accept"
  or "decline" decides; the other parent hears "Jo accepted — your turn!" in the same request.
- **Status, bag, help, stop/start** are all text commands. Each pet answers from its own parent's line.
- **The thread and the app say the same thing.** Every pet line is mirrored to the in-app pet (`PetLine`), and the
  Python agent's wording is checked word for word against the TypeScript side (`parity_test.ts`).

### Human in the loop

- The pet **never pays by text**. When both accept, the buyer gets a link to approve in the app
  (`/trade/<id>?as=<parent>`); texting "pay" just sends the link again. "with Face ID" appears only when the buyer
  actually has a passkey saved.
- A trade needs an explicit accept from both parents. A plain "yes" counts only right after the pet's question, and
  every question carries a stamp so an answer applies to the newest one.
- Items on their 3rd owner are always refused for sale.

### Context-aware

- The pet knows the closet: photo guesses are matched against the parent's own items, and "the corduroy pants"
  finishes an unclear photo quote.
- It knows where the conversation is: a "yes" after an outgrow nudge asks "keep or sell?" instead of guessing; a
  "yes" after a proposal accepts that proposal and never lists an old quote. Selling questions expire after 15
  minutes.
- It reads intent carefully: "no deal", "I don't accept", "not interested" decline; "is that a good deal?" gets
  "reply accept or decline" and decides nothing; "pass it on" means sell, not decline. Curly iPhone apostrophes are
  normalised. Files: `base44/shared/c/wording.ts`, `base44/shared/c/inboxFallback.ts`, mirrored in
  `agents/intents.py`.

### Safe fallbacks

- **No model, no problem.** Every reply has a template; free-text questions go to the model with instructions that it
  can't take actions, must not repeat personal details, and must treat the text as a question, not instructions.
- **STOP is honoured** in its common forms ("STOP please", "unsubscribe me", "don't text me"); after one
  confirmation nothing is sent until START. HELP still gets one answer.
- **Rate limits:** at most 8 answers per parent per minute, then one "slow down" line; at most 20 outgoing texts per
  parent per minute.
- **Phone numbers are masked** ("[number hidden]") in every outgoing text and in model replies. Unknown numbers get
  no reply.
- **Failures still answer.** If handling a text fails, the parent gets a "busy" line instead of silence.
- **Signed webhooks.** With `PHOTON_WEBHOOK_SECRET` set, unsigned, forged or stale deliveries get a 401
  (Standard Webhooks scheme, checked against its reference vector). Redeliveries are answered once.
- **Photon refusals** (for example an expired line assignment) are reported as "not sent", never a crash.

### Craft

- **Per-parent lines.** Photon's shared pool gives each phone its own number, and a shared line can't text first.
  Each pet replies from the line its parent texted (`base44/shared/c/lines.ts`) and stays quiet for a parent who
  hasn't texted yet, so no message ever comes from a number the parent doesn't know.
- **Idempotency.** Every POST to Photon carries an `idempotency-key`; stable keys where a retry must replay (users,
  spaces) (`base44/shared/c/photon.ts`). The test stub rejects any POST without one, as the real API does.
- **The flowers GIF** (original art, 390×300, under 1 MB) goes to both phones after a trade, from the same line and
  thread as the text.
- Tests: `base44/shared/c/convo_test.ts` (29 full conversations through the real webhook handler and B's real
  handlers), `webhook_test.ts` (5), `imessage_test.ts` (14), `c_test.ts` (9), `parity_test.ts` (2).

**Known gap:** event texts ("Jo accepted", the flowers) go out on the next inbox sweep, which runs when a text
arrives or while a map tab is open. A one-line `sendEventTexts` call in the decide, pay and list entry files would
send them at once; it is written (`inboxFallback.ts`) but not wired.

---

## AI for real-world problems

### The problem

Children's clothing is used for a few months and then stored or thrown away. Textile production is a large source
of emissions (the Ellen MacArthur Foundation puts it at about 1.2 billion tonnes of greenhouse gases a year), and
most US textile waste is landfilled (EPA 2018: 11.3 of 17.0 million tons). Every hand-me-down that reaches another
family replaces part of a new purchase.

### Where AI helps, and where it doesn't

| Job | How it's done | Honest note |
|---|---|---|
| When will this stop fitting? | A rule from the size label and the child's birth date, minus a 14-day buffer (`base44/shared/sizes.ts`) | Deterministic, not a model: predictable and explainable |
| What is this item? | Vision model via Base44 `InvokeLLM`, cleaned to known sizes, categories and price range (`base44/shared/logic/snap.ts`) | Shows confidence; parent confirms every field |
| What condition is it in? | Vision model suggestion (`suggestCondition`) | Marked "PET SUGGESTED"; parent picks |
| Who should get it? | Two Fetch.ai agents negotiate over shared needs and listings, ranked by weeks of wear left, then condition, then newest (`base44/shared/match.ts`) | Agents follow the buyer's rules; the outcome is only a proposal |
| Free-text questions by iMessage | Model reply in the pet's voice, no actions allowed | Template answer when no model |

### Impact we can show

`/impact` counts every hand-off with conservative, cited assumptions (`base44/shared/logic/impact.ts`, 15 tests):
each hand-off counts as 0.6 of a new garment (Farrant et al. 2010, low end), 15 kg CO₂e and 7,000 litres of water per
kg of clothing not made (WRAP 2017, making only), and 66% of the garment's weight as landfill avoided (EPA 2018).
Garment weights are our own estimates and the screen says so. Totals are rounded down. Points and badges reward
listing soon after a nudge and sharing needs; nobody can buy them.

### Responsible by design

- People decide every trade; agents only propose.
- Location is never shared; agents share only what the parent marked as shared.
- Low-confidence and offline guesses are labelled as such.
- The app works without any AI model, so nothing depends on an outside service being up.
