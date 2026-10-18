# Hand-Me-Down Relay

**Your pixel pet passes outgrown kids' clothes to families you walk past.**

Live app: https://sproutpass-5c025059.base44.app (one phone at `/?as=mina&demo=1`, another at `/?as=jo&demo=1`).
Code: this repository. Payments in the app are a **demo payment · no real charge**.

---

## Inspiration

A baby goes through a clothing size every few months. Most of those clothes are barely worn, and most of them end
up in a drawer, a donation bag nobody drops off, or the bin. Meanwhile the family two streets away is buying the
same size new. Parents already pass clothes along to friends; it just doesn't scale, because nobody remembers what
fits whom, what it cost, or when it stops fitting.

We wanted the passing-on to happen in the background of a parent's normal day: a walk to the park, a coffee run.
So we gave each parent a small companion that remembers the closet and talks to the companion of the parent next
to them, and that never spends money or makes a decision on its own.

## What it does

- **A closet that remembers.** Each item keeps its size, purchase date, original price and owner history (hearts:
  1st, 2nd, 3rd owner). From the child's birth date and the size label, the app predicts when the item will stop
  fitting and shows it as a fit bar ("Fits until about Aug 27 · 104 days left").
- **A pet that nudges at the right time.** On the predicted date the parent's pet asks "still fit, or want to pass
  it on?" with Sell / Keep / Later. Sell opens a three-step listing: photo (or the pixel art when there's no camera),
  condition (the pet suggests one from the photo), and a fixed price receipt.
- **Snap to list.** A photo of a new item or its size tag goes to a vision model, which suggests the name, category,
  size and price. Every suggested field is marked "PET SUGGESTED" until the parent edits it, and nothing is saved
  until they tap "Add to bag". Offline or without the model, the guess is labelled as a quick guess or demo pick
  with a low confidence, never as AI.
- **Fixed, visible pricing.** The 2nd owner pays 60% of the original price and the 3rd pays 40%. After 3 owners the
  item has reached its final home and can't be sold. There is one price function, `priceFor`, and every screen and
  text quotes it ("2nd owner pays 60% of $30.00 = $18.00").
- **Pets that meet.** With the app open, parents show up on each other's radar only as a distance band and a rough
  direction, never a location. When two parents are within 25 m (real GPS, or the `?demo=1` walk for indoor
  judging), the encounter scene plays and their two agents negotiate: what the buyer's child needs, what the
  seller has shared, how long it will fit, and the price. If something fits, the same trade proposal appears on
  both phones and in both iMessage threads.
- **People decide, the pet only proposes.** Each parent accepts or declines on their own phone. Nothing is
  charged until both accept. The buyer then pays: a demo payment, approved with Face ID if the parent turned that
  on. A golden-flower celebration plays on both screens, and the item moves to the buyer's closet with its history.
- **Spending rules for the pet.** On "Pip's spending rules" a parent sets a price limit per trade, a monthly budget,
  the kinds of clothes the pet may look for, whether the pet may propose at all, and whether every payment needs
  Face ID. The server enforces the rules: a trade that breaks them is never proposed, and the pet says which rule
  stopped it ("Not this one, it's over the price limit Jo set for me"), never the amount.
- **The pet lives in iMessage too.** Through Photon, each parent can text their pet: send a photo to sell, get a
  quote with the fair price, reply "yes" to list, "accept" or "decline" a trade, "status", "help", "stop". The pet
  never pays by text; it sends a link to approve in the app.
- **You can watch the agents.** The Agent Console (`/agents`) is built for a projector. It shows the two agents,
  every protocol message with its latency, the pets' conversation, a privacy check over every message on screen,
  and the outcome. It labels honestly whether a Fetch.ai uAgent, the fallback matcher or the offline mock spoke.
- **Impact you can check.** `/impact` counts new homes, CO₂e, water and landfill avoided, money saved by buyers and
  earned by sellers, with points and badges. Every number comes with its assumption and source, and totals are
  rounded down.

## How we built it

- **Base44** hosts the app, the 13 entities and 29 Deno functions, realtime updates between phones, file uploads
  and the vision model (`InvokeLLM`).
- **One frozen contract.** We wrote `base44/shared/types.ts` and the `Api` interface (`src/app/api.ts`) first, then
  split into three people (A: world and pixel kit, B: closet, trade and backend, C: agents and messages), each
  running several coding-agent sessions in parallel in the same repo. Screens only call `api`, so every screen ran
  against a mock before the backend existed.
- **Pure shared logic.** All business rules live in `base44/shared/**` as plain TypeScript with no runtime imports.
  The Deno functions are thin wrappers, and the browser mock (`api.mock.ts`) runs the *same handlers* on an
  in-memory database shared across tabs. A judge can play both phones on a laptop with no backend at all.
- **Fetch.ai uAgents** (Python, `uagents` 0.26) run one closet agent per parent. They speak `HandMeDownRelay 0.3.0`
  (`LookingFor`, `HaveListings`, `NoFit`, `ProposeTrade`, `TradeAck`, `Decline`), carry only shared data, and hand
  the app a protocol log that the Agent Console shows. They also support ASI:One chat with interactive cards.
- **Photon 2.0** delivers iMessage: a signed webhook in, per-parent lines out, the flowers GIF as an attachment.
- **Passkeys** (WebAuthn via `@simplewebauthn/browser` 14 and `@simplewebauthn/server` 13) approve payments, with a
  challenge bound to one trade and its price.
- **React 19, Vite 8, zustand, Leaflet** for the app. Every sprite, sound and the flowers GIF are original and
  generated by code (`tools/art`). Text uses Atkinson Hyperlegible Next (made for low-vision readers) at 16 px or
  more; the pixel fonts are only for short titles and numbers.

## Challenges we ran into

- **The rate limit is a team-wide budget.** On Base44's Free plan, function calls inside handlers share one token
  bucket with the whole team (and our CLI). During live runs we hit "Rate limit exceeded" with about 10 calls a
  minute in flight. We rewrote the seed with bulk calls, wrapped every handler's database in a retry with backoff,
  made the agents share one call budget (8 a minute for all three) and one inbox poll, sent the pets' whole
  conversation in one call instead of one call per line, and spaced out the live dashboards' reloads.
- **Agents on a slow poll still need to feel instant.** Because the agents can only poll every 12 seconds, an
  encounter could sit silent. The app's own matcher steps in after 8 s when no agent is on duty (25 s when one is,
  60 s at most) and writes the same log shape, labelled `fallback`, so the demo never stalls and never pretends.
- **iMessage lines are per parent.** Photon's shared pool gives each phone its own number, and a shared line can't
  send the first message. We had built one app-wide line. We changed it so each pet answers from the line its parent
  texted (`Parent.photonLineUserId`, learned from the webhook) and stays quiet for a parent who hasn't texted yet.
- **Base44 deploys only `base44/shared/` next to each function.** Our first layout imported from a sibling `_lib`
  folder and failed at deploy, so C's helpers moved to `base44/shared/c/`. Calling one function from another with
  the service role also dropped our agent key header, so the agent API calls B's handlers in process (`cbridge.ts`).
- **Language is harder than it looks.** "No deal" contains "deal", and our first parser read it as accept. We now
  check refusals and negations first, treat questions ("is that a good deal?") as questions, and stamp every
  question the pet asks so a "yes" answers the newest one, not an old listing quote.

## Accomplishments that we're proud of

- The whole story ran end to end on the deployed site with two browser tabs, one per parent: nudge, listing, walk,
  encounter, proposal on both screens, two accepts, demo payment, celebration, and the item in the new closet with
  its history. A second run had the Fetch.ai agents negotiate and create the proposal themselves. A third run, after
  deploying the upgrades, added the pet's spending rules in the trade window, the Agent Console and the impact board.
- 429 vitest tests, 59 Deno tests and 102 Python tests pass, plus an offline Fetch.ai demo with 13 checks. A parity
  test runs the Python agent's wording and intent parser and compares them word for word with the TypeScript side.
- The trust design holds on the server, not just in the UI: the buyer's spending rules are checked in
  `createProposal`, payment needs both accepts, and Face ID approval is verified with `@simplewebauthn/server`
  before any money (demo money) moves.
- The app is readable: WCAG AA contrast measured against our palette, 44 px touch targets, sentence-case copy, and a
  type system chosen after we noticed our first pixel font drew "$15.75" as "$1S.7S".

## What we learned

These are things we got wrong first, and the change each one led to. The evidence is in the code and in `NEEDS.md`,
our running log of findings.

1. **Rate limits shape architecture.** The first live run failed because three agents and two phones spent the
   team's whole Free-plan budget. We now treat function calls as a budget: `withRetry` backoff in every entry file
   (`base44/shared/logic/closet.ts`), bulk seed writes, a shared `CallBudget` and one batched `claimInbox` in
   `agents/live_bureau.py`, startup backoff instead of exiting, and a reloader for `/log` and `/impact` that waits
   3 s after a change and keeps loads 5 s apart (`src/impact/live.ts`, with fake-timer tests).
2. **Read the messaging platform's model before you build on it.** Per-parent Photon lines (`base44/shared/c/lines.ts`)
   came from learning how the shared pool assigns numbers. Photon also requires an `idempotency-key` on every POST
   that creates something; a review caught sends without one. Now `photon.ts` adds a key to every POST, uses stable
   keys where a retry must replay (users, spaces), and the test stub answers 400 to any POST without one, the way the
   real API does.
3. **A fallback is a feature, if it is labelled.** The local matcher and the Fetch.ai agents write the same
   `Encounter.agentLog` shape with `by: "fetch" | "fallback" | "mock"` and `negotiatedBy`, and the Agent Console shows
   which one spoke. In the offline mock the console says outright that a stand-in plays the protocol.
4. **Privacy has to be designed into the wire format.** Other parents only ever get a distance band and a 5°
   bearing, never coordinates. The agents' messages carry only shared listings, shared needs and the child's age in
   months. Log summaries are built from that shared data only, and `cleanAgentLog` masks anything shaped like a
   phone number or email. An early screen fetched the other family's whole closet just to show a name; we replaced it
   with `getParties`, which returns only name, avatar and pet. `publicParent` strips the phone, Photon ids, the pet's
   rules and passkeys from every response, and the phone field is admin-only in the schema.
5. **Rules must fail before the pets promise anything.** When a buyer's price limit blocked a trade, our pets first
   said "Trade proposal!" and then "Nothing fits today". The mandate is now checked before any proposal line is
   staged, the buyer's agent sends a `Decline` that names the rule but not the amount, and the encounter stores the
   reason.
6. **Shared demo identities need a reset path.** On a shared demo, one judge's saved passkey or $10 limit blocked
   every later judge. RESET now restores default rules and forgets passkeys (`trustReset`), saving a sixth passkey
   replaces the oldest, and parents can remove passkeys.
7. **Two clocks.** The story runs May to October on a demo clock (`Setting.now`), but presence freshness, cooldowns
   and the fallback wait must use the real clock, or every phone would look stale.

## What's next

- **Real accounts** instead of `?as=`: bind passkeys and the pet's rules to a signed-in parent, and require a passkey
  before changing those rules.
- **A real payment rail** behind the same gate: keep the mandate check, both accepts and the passkey approval bound
  to trade and price, and replace the demo payment with a tokenized card payment through a payment provider. No card
  data would touch our backend.
- **More of the closet:** shoes and gear, size tags read from two photos, and a charity or textile-recycling "final
  home" for items that have had 3 owners.
- **Event texts without waiting for a sweep:** today "Jo accepted" and the flowers GIF go out on the next inbox sweep
  (a text in, or an open map tab). One line in the decide, pay and list entry files would send them at once.
- **Agentverse and ASI:One** for every parent (mailbox agents), and a paid Base44 plan so live demos aren't bound by
  the Free-plan rate limit.

## Built with

Base44 (entities, Deno functions, realtime, InvokeLLM, UploadFile, hosting) · React 19 · Vite 8 · TypeScript ·
zustand · Leaflet · Fetch.ai uAgents (Python) · ASI:One chat protocol · Photon 2.0 iMessage · WebAuthn passkeys
(@simplewebauthn) · vitest · Deno test · pytest
