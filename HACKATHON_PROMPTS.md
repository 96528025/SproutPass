# Hand-Me-Down Relay — Hackathon Build Prompts

How to use: every teammate opens their own Fable session in the same repo and pastes
**Part 0 (General)** followed by **their own role part (A, B, or C)**.
Hour 0 is done together (contract freeze); after that the three sessions work in parallel.

---

## Part 0 — General prompt (everyone pastes this first)

You are one of three parallel coding agents building a hackathon MVP. Two other agents are
building other parts of the same repo at the same time. Stay inside your own folders, build
against the shared contract, and use mocks for anything another person owns.

### Product in one paragraph

A location-based social game for parents to pass along kids' clothing. Each parent has an
original cartoon avatar and an AI "closet agent". From the moment a clothing item is bought, the
agent records item, size, purchase date, and original price, and uses the child's age in months
and the size label to predict when the child will outgrow it. When that date comes, the agent
nudges: "Does this still fit? Want to sell it?" If the parent says yes, she uploads a fresh photo,
fills in condition, and confirms the listing. The listing stays live until it sells or she takes
it down. The core play happens in real shared places: when two parents are checked in at the same
rack in the same venue (for example "Learning Center, Rack 3"), their agents look through what
both have chosen to share (listings and needs) and, if they find a fit, show **both** of them a
trade proposal at the same time. Both decide for themselves. When both accept and payment
succeeds, golden flowers burst above both avatars, and the item moves from the seller's digital
closet to the buyer's, where the buyer's agent takes over.

### Rules that apply everywhere

1. **The agent never decides for a person.** A match only creates a *proposal*. It never charges
   anyone and never accepts a sale for the seller. A trade completes only after an explicit accept
   from **both** sides, then payment.
2. **Fixed, visible pricing (v1):**
   - `ownerCount` = how many owners the item has had, counting the current one (the first buyer = 1).
   - Selling at `ownerCount == 1`, the buyer becomes owner 2 → price = **60%** of original price.
   - Selling at `ownerCount == 2`, the buyer becomes owner 3 → price = **40%** of original price.
   - Selling at `ownerCount == 3` → **not allowed** (max 3 owners, max 2 resales). The UI must not
     offer "sell" for these items.
   - Money is stored as integer cents. Price = `Math.round(originalPriceCents * pct)`.
   - The only implementation is `priceFor(item)` in `packages/contracts`. No one else computes price.
3. **Privacy:** matching only reads listings and needs the user has marked `shared: true`.
   Presence (being at a rack) exists only while checked in and expires after 30 minutes.
4. **Location for the demo = QR check-in at a rack**, not GPS. Each rack has a QR code / URL like
   `/checkin/learning-center/rack-3`. A venue picker counts as a fallback.
5. **Demo clock.** The story spans May → October, so the server has a controllable "now".
   All time logic reads `now()` from the server clock, never `Date.now()` directly.
6. **Payment is mocked** (a "Pay" button that succeeds after 1s; it can fail when `?fail=1` is
   set). Real payments are out of scope.
7. **Off-day handover:** if the item isn't physically there, the trade can still complete with
   `handover: "later"`, and both see "arrange handover" with a free-text note.
8. **Original art only.** Do not use Pokémon, Pikmin, or any other existing IP, names, or assets.
9. **Must run without an API key.** Every LLM feature has a deterministic template fallback, so
   the demo never depends on network.

### Stack and repo layout

- TypeScript everywhere, pnpm workspaces, Node 20.
- `packages/contracts/` — **shared, frozen after Hour 0.** Types, zod schemas, `priceFor`,
  event names, seed fixtures. Changes need all three people to agree; announce them in the team chat.
- `apps/web/` — **Person A.** Next.js (App Router) + Tailwind + Framer Motion, mobile-first.
- `apps/server/` — **Person B.** Fastify + Socket.IO, in-memory store with JSON-file persistence.
- `packages/agent/` — **Person C.** Pure functions imported by the server, plus LLM calls.
- Ports: web 3000, server 4000. Web reads `NEXT_PUBLIC_API_URL`.
- Never edit another person's folder. If you need something from them, mock it on your side
  and write a note in `NEEDS.md` under your name.

### Shared contract (create this in `packages/contracts` at Hour 0)

```ts
type ID = string;

interface Parent   { id: ID; name: string; avatar: AvatarConfig; childIds: ID[] }
interface AvatarConfig { body: string; color: string; accessory?: string } // original art keys
interface Child    { id: ID; parentId: ID; nickname: string; birthDate: string /* ISO */ }

type SizeLabel = "0-3M" | "3-6M" | "6-9M" | "9-12M" | "12-18M" | "18-24M" | "2T" | "3T" | "4T";
// SIZE_RANGES: SizeLabel -> { minMonths, maxMonths } lives in contracts.

interface ClothingItem {
  id: ID;
  name: string;              // "Yellow duck romper"
  category: "top" | "bottom" | "onesie" | "outerwear" | "dress" | "set" | "other";
  size: SizeLabel;
  originalPriceCents: number;
  originalPurchaseDate: string;   // first owner's purchase date, never changes
  ownerCount: 1 | 2 | 3;
  currentOwnerId: ID;
  childId: ID;                    // child currently wearing it
  photos: string[];               // URLs; latest first
  ownershipHistory: { ownerId: ID; from: string; to?: string; priceCents?: number }[];
  predictedOutgrowDate?: string;  // set by agent
  status: "in_closet" | "listed" | "pending_trade" | "transferred_out";
}

interface Listing {
  id: ID; itemId: ID; sellerId: ID;
  condition: "like_new" | "gently_used" | "well_loved";
  conditionNote: string;
  priceCents: number;             // = priceFor(item), snapshotted at listing time
  shared: boolean;
  status: "active" | "withdrawn" | "sold";
  createdAt: string;
}

interface Need {
  id: ID; parentId: ID; childId: ID;
  sizes: SizeLabel[]; categories?: ClothingItem["category"][];
  maxPriceCents?: number; shared: boolean; createdAt: string;
}

interface Presence { parentId: ID; venueId: string; rackId: string; checkedInAt: string; expiresAt: string }

interface MatchProposal {
  id: ID; listingId: ID; sellerId: ID; buyerId: ID;
  venueId: string; rackId: string;
  snapshot: {                     // exactly what the popup shows
    itemName: string; photo: string; size: SizeLabel;
    originalPurchaseDate: string; originalPriceCents: number;
    condition: Listing["condition"]; conditionNote: string;
    previousOwners: number;       // = item.ownerCount
    priceCents: number;
  };
  reason: string;                 // agent's one-line "why this fits"
  sellerDecision: "pending" | "accepted" | "declined";
  buyerDecision:  "pending" | "accepted" | "declined";
  status: "open" | "both_accepted" | "paid" | "declined" | "expired" | "payment_failed";
  handover: "now" | "later";
  createdAt: string; expiresAt: string;
}

interface AgentNudge {
  id: ID; parentId: ID; itemId: ID;
  kind: "outgrow_check" | "listing_reminder" | "new_owner_welcome";
  message: string; createdAt: string; resolved: boolean;
}

function priceFor(item: ClothingItem): number | null; // null when ownerCount === 3
```

**REST (server, owned by B):**

| Method | Path | Purpose |
|---|---|---|
| GET  | `/me/:parentId` | parent, children, closet items, listings, needs, nudges |
| POST | `/items` | record a purchase (agent sets `predictedOutgrowDate`) |
| POST | `/items/:id/list` | `{ photo, condition, conditionNote, shared }` → Listing |
| POST | `/listings/:id/withdraw` | take down |
| POST | `/needs` | create / update a need |
| POST | `/checkin` | `{ parentId, venueId, rackId }` → Presence; triggers matching |
| POST | `/checkout` | leave the rack |
| POST | `/proposals/:id/decide` | `{ parentId, decision: "accepted" \| "declined" }` |
| POST | `/proposals/:id/pay` | mock payment (buyer); on success → transfer |
| POST | `/nudges/:id/resolve` | `{ action: "sell" \| "keep" \| "snooze" }` |
| POST | `/demo/clock` | `{ now }` jump the clock; re-runs nudge scan |
| POST | `/demo/reset` | reload seed |

**Socket.IO events (server → client, room = `parent:<id>`):**
`nudge:new`, `proposal:new`, `proposal:updated`, `trade:completed` (payload includes both
parent ids → both clients play the golden flower animation), `closet:updated`.

### Seed fixtures (in contracts, used by everyone)

- Parent A "Mina" + child born 2025-12-10 (5 months old in May 2026).
- Parent B "Jo" + child born 2026-03-01; has a shared Need for `6-9M`, tops/onesies.
- Item: "Yellow duck romper", `6-9M`, $30.00, bought by Mina 2026-05-15, ownerCount 1.
- Venue `learning-center` with racks `rack-1..rack-4`.
- A third parent "Sam" and a few extra items so the closet doesn't look empty, including one
  item at `ownerCount: 3` (to show "can't be resold").

### Demo script (the whole team builds toward this, 3 minutes)

1. Mina's closet: the duck romper, bought May 15, $30, predicted outgrow ≈ September.
2. Presenter jumps the demo clock to 2026-09-20 → Mina's agent: "Is the duck romper still fitting?
   Want to pass it on?" → Sell → photo + "gently used" → listing shows **$18.00 (60%)**.
3. Clock → 2026-10-18. Mina and Jo both scan the Rack 3 QR at the Learning Center.
4. On **both** phones, at the same moment: a trade proposal with photo, size, original date +
   price, condition, "1 previous owner", $18.00, and the agent's reason.
5. Both tap Accept → Jo pays (mock) → golden flowers over **both** avatars.
6. Romper is now in Jo's closet, ownerCount 2, and Jo's agent says hello and predicts its next
   outgrow date. Mina's closet shows it as passed on.
7. Bonus: show Sam's ownerCount-3 item with no Sell button, and a declined proposal that charged nobody.

### Timeline (adjust to your hackathon length)

- **H0–H1 (together):** create repo, write `packages/contracts` + seed, freeze it.
- **H1–H8 (parallel):** each person builds against contracts + mocks.
- **H8–H10:** integrate (web → real server, server → real agent). Fix the contract only together.
- **H10+:** run the demo script end to end at least 5 times on two real phones; polish; record a
  backup video.

### Working style for you, the agent

- Before writing code, restate your role's scope in 5 lines and list the files you will create.
- Build the demo path first, edge cases second, polish last.
- Commit small and often, with messages describing the change. Never force-push `main`; work on
  a branch named after your area (`web-…`, `server-…`, `agent-…`).
- Every part has a `pnpm dev` that runs alone with mocks, plus a short README section.
- When you finish a milestone, tell me what works, what's mocked, and what you're unsure about.

---

## Part A — Frontend & game feel (`apps/web`)

You own everything the user sees. Mobile-first (390px wide), playful, rounded, big type,
hand-drawn feel, light motion. Original characters only.

Build, in this order:

1. **Mock layer:** `lib/api.ts` with the same functions as the REST table, switchable between a
   local mock (seed fixtures + fake socket that emits events on a timer) and the real server via
   `NEXT_PUBLIC_USE_MOCK`. You must be able to run the full demo script on mocks alone.
2. **Parent picker** (`/?as=mina`, `/?as=jo`) so two phones / two tabs can be two parents.
3. **Home / closet:** avatar at top, child card (age in months), item grid with size, "fits until
   ~Sep" chip, owner-count dots (●○○), status badges. Items at ownerCount 3 show
   "final owner 💛" and no Sell action.
4. **Agent nudge:** a chat-bubble card from the closet agent ("Does this still fit?") with
   Sell / Keep / Remind me later.
5. **Listing flow:** photo (camera input or file), condition picker, note, a price panel that
   explains the rule ("2nd owner pays 60% of $30.00 = $18.00"), Share toggle, Confirm. Price comes
   from `priceFor` in contracts, never typed by the user.
6. **Needs:** simple form for sizes/categories, Share toggle.
7. **Venue / rack screen** `/checkin/[venue]/[rack]`: "You're at Learning Center · Rack 3",
   other checked-in parents shown as avatars around the rack (just their avatars, no personal
   details), Check out button. Also generate printable QR codes for each rack at `/qr`.
8. **Trade proposal modal:** shows every `snapshot` field + `reason`, Accept / Decline, live status
   of the other side ("Jo accepted ✓ — waiting for you"). Buyer then sees Pay. Clearly says
   "Nothing is charged until you both accept."
9. **Golden flower celebration:** on `trade:completed`, flowers burst above both avatars, the item
   card flies from one closet to the other. Use Framer Motion or canvas confetti with custom flower
   shapes; respect `prefers-reduced-motion`.
10. **Demo panel** (hidden behind `?demo=1`): clock jump buttons (May 15 / Sep 20 / Oct 18) and Reset.

Done = the demo script runs on mocks in two tabs with no console errors, then runs again against B's
server by flipping one env var.

---

## Part B — Server, state, realtime (`apps/server`)

You own the source of truth: data, state transitions, pricing enforcement, presence, realtime,
mock payment, and the demo clock.

Build, in this order:

1. **Store:** in-memory maps loaded from contracts seed, persisted to `data/state.json` on change.
   `POST /demo/reset` reloads seed.
2. **Demo clock:** `clock.now()` used everywhere; `POST /demo/clock` sets it and runs the nudge scan.
3. **All REST endpoints** from the contract, with zod validation from contracts. Return 400 with a
   readable message on invalid transitions.
4. **State machines (enforce on the server, not just in UI):**
   - Item: `in_closet → listed → pending_trade → transferred_out` (and `listed → in_closet` on
     withdraw). Listing rejected if `ownerCount === 3`.
   - Proposal: `open → both_accepted → paid`, or `declined` / `expired` / `payment_failed`
     (payment failure returns listing to `active`). Either side declining closes it.
   - One open proposal per listing at a time.
5. **Presence + matching trigger:** on `/checkin`, store Presence (30-min expiry), find everyone else
   at the **same venue and rack**, and call `agent.findMatches(...)` (from C) for each pair in both
   directions. Create proposals for the results and emit `proposal:new` to **both** parents' rooms.
   Until C's package is ready, use a stub: size ∈ need.sizes, both `shared`, price ≤ maxPrice.
6. **Payment + transfer (atomic):** `/proposals/:id/pay` → after a mock 1s delay, in one step:
   close the ownership history entry for the seller, add the buyer, `ownerCount += 1`, change
   `currentOwnerId` / `childId`, listing `sold`, item `in_closet` for the buyer, call
   `agent.predictOutgrow` for the new child, create a `new_owner_welcome` nudge, then emit
   `trade:completed` + `closet:updated` to both. `?fail=1` simulates failure.
7. **Nudge scan:** on clock change and every 60s, call `agent.scanForNudges(items, children, now)`
   and emit `nudge:new` for any new ones (no duplicates per item+kind).
8. **Tests (vitest):** pricing at ownerCount 1/2/3, can't list at 3, no charge on decline, double
   accept from the same side is idempotent, pay before both accept is rejected, transfer moves the
   item exactly once, presence at a different rack produces no match.

Done = a script `pnpm demo:api` that drives the whole demo script over HTTP and prints each step,
and the tests pass.

---

## Part C — Closet agent (`packages/agent`)

You own the "intelligence": outgrow prediction, nudge wording, condition help, matching, and the
reason line in proposals. Export pure, typed functions the server imports. Every function works
offline with deterministic logic; the LLM only improves wording.

Build, in this order:

1. **`predictOutgrow(item, child, sizeRanges) → ISO date`:** date when the child's age passes the
   size's `maxMonths`, minus a small buffer (e.g. 2 weeks), never earlier than purchase date.
   Document the rule in the README; unit test with the seed (romper bought May for a 5-month-old in
   6-9M → about September).
2. **`scanForNudges(items, children, now) → AgentNudge[]`:** outgrow check when `now` is within
   14 days of (or past) `predictedOutgrowDate` and the item is `in_closet` with `ownerCount < 3`;
   listing reminder if a listing has been active 30+ days. Never nudge to sell an ownerCount-3 item.
3. **`composeMessage(nudge, context) → string`:** warm, short, conversational parent-facing text.
   Template version first; optional LLM version via the Anthropic SDK using model from env
   `AGENT_MODEL` (default `claude-haiku-5-5`), with a 3s timeout falling back to the template.
4. **`suggestCondition(photoUrl) → { condition, note }`:** optional vision call that *suggests*
   a condition; the seller always confirms or edits it. Fallback returns no suggestion.
5. **`findMatches(sellerState, buyerState, ctx) → { listingId, reason }[]`:** only `shared`
   listings × `shared` needs; size must be in need sizes; category filter if given; price ≤
   maxPrice if given; skip `ownerCount === 3`, non-active listings, and the seller's own needs.
   Rank by size fit, then condition, then newest. Max 1 proposal per pair per check-in for the demo.
   `reason` is one friendly line ("Jo's little one needs 6-9M tops, and this romper is 6-9M").
6. **Agent eval file:** a table of 15+ hand-written cases (fits / doesn't fit / not shared /
   third owner / wrong rack is server-side so skip) run with vitest, so judges can see the agent is
   tested, not just prompted.
7. **Seed realism:** help B's seed with 10–15 extra believable items across sizes for the closet
   screens (no real brands needed).

Done = `pnpm test` in `packages/agent` passes, the server can import every function, and with
no API key everything still returns sensible output.
