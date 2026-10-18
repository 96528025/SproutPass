# Hand-Me-Down Relay — Hackathon Build Prompts (v4: 3-person split, pixel frontend)

How to use: every teammate opens their own Fable session in the same git repo and pastes
**Part 0 (General)** + **Part D (Design system)** + **their own role part (A, B or C)**.
Hour 0 is done together; after that the three sessions work in parallel.

| Person | Owns | Frontend | Backend | Load |
|---|---|---|---|---|
| **A — World & Art** | the look, the game world, the "wow" | pixel design kit, all sprites + sounds, World/radar screen, encounter cutscene, golden-flower celebration, title screen | — | ~9–10 h |
| **B — Closet & Trade** | everything about items and money | Closet (inventory bag), item card, listing flow, needs, nudge dialog, Trade window, Pay, Relay Log (stats), Demo panel | entities, pricing, outgrow, nudges, listings, proposals, payment + transfer, demo clock, seed, self-test | ~10 h |
| **C — Agents & Messages** | everything that talks | in-app agent pet dialog + "agents talking" bubbles feed | presence + encounter functions, Photon iMessage functions, agentApi, Python Fetch agents, ASI:One cards | ~10 h |

Prize targets:
- Visa "Future of Shopping" ($2,000)
- Base44 ($1,500 / $500)
- Fetch.ai ($1,500 / $1,000 / $500)
- Photon iMessage ($700)
- Paper (design)
- Main track: Applied Intelligence or Beyond the Digital

---

## Part 0 — General prompt (everyone pastes this first)

You are one of three parallel coding agents building a hackathon MVP in one git repo. Two other agents are building other parts at the same time. Stay inside the folders you own (see "Repo and ownership"), build against the shared contract, and mock anything another person owns.

### Product in one paragraph

A pixel-art, Pokémon-Go-style game for parents to pass along kids' clothing.

Each parent has an original pixel avatar and an AI "closet agent": a tiny pixel companion in the app, and a Fetch.ai uAgent that lives in their **iMessage**. From the moment a clothing item is bought, the agent records item, size, purchase date and original price, and predicts from the child's age and the size label when the child will outgrow it. When that date comes, the agent texts: "Does this still fit? Want to pass it on?" The parent replies with a photo, confirms the condition, and the listing goes live.

The core play happens **outside, phone to phone**. Parents keep the app open as they walk around, and their position comes from GPS. When two parents come within **25 m**, their avatars meet on screen and **their agents talk**:
- "I'm looking for 6-9M tops." "I have a duck romper in 6-9M."
- "Your little one fits it for about 4 more weeks."

If they find a fit, both parents get the same trade proposal at the same moment, in the app and in iMessage. Both decide for themselves. When both accept and the (demo) payment succeeds, golden pixel flowers burst over both avatars. The item then moves to the buyer's closet, and the buyer's agent texts hello.

### Rules that apply everywhere

1. **The agent never decides for a person.** A match only creates a *proposal*. A trade completes only after an explicit accept from **both** sides, then payment.
2. **Fixed, visible pricing:**
   - Selling at `ownerCount == 1` → buyer becomes owner 2 → **60%** of original price.
   - Selling at `ownerCount == 2` → owner 3 → **40%**.
   - Selling at `ownerCount == 3` → **not allowed** (max 3 owners). No screen or agent offers "sell".
   - Integer cents, `Math.round`.
   - The only implementation is `priceFor(item)` in B's `base44/functions/_lib/pricing.ts`; everyone else asks the backend.
3. **Location privacy:**
   - A parent is visible only while the app is open and "Discoverable" is on.
   - Others never receive coordinates: only an avatar, a distance band (`<25 m`, `25–100 m`, `100–300 m`) and a direction, computed in C's `listNearby`.
   - `Presence` is one row per parent, overwritten on each update and server-read only, and counts as gone after 30 s without an update.
   - Agents exchange only `shared: true` listings and needs plus the child's age in months.
4. **Encounters:** an encounter starts when two Discoverable parents are ≤ **25 m** apart with both GPS accuracies ≤ 30 m. It re-arms after > 40 m and fires at most once per pair per 10 min (2 min in demo mode).
5. **Demo location mode** (`?demo=1`, for indoor judging): "Walk toward …" buttons move a *simulated* position, and the world shows a "SIMULATED GPS" chip. Real GPS is shown in the outdoor video.
6. **Demo clock:** the story spans May → October. All time logic, agents included, reads `Setting.now` via the backend.
7. **Payment is mocked:** Pay succeeds after 1 s (fails with `fail: true`), and every pay surface says "Demo payment · no real charge".
8. **Off-day handover:** `handover: "later"` + a free-text note.
9. **Original art only.** No Pokémon/Nintendo/Pikmin characters, items, UI layouts, fonts, sounds or names. "Like Pokémon Go" describes the play, not the look. Every sprite and sound is made by us.
10. **Runs without an LLM key:** every LLM feature has a template fallback. `Setting.matchVia: "fetch" | "local"`, `Setting.imessage: boolean`.
11. **Fetch eligibility:** the whole workflow also completes inside **ASI:One** with a closet agent (cards, no custom frontend). Record it.
12. **iMessage hygiene:** only message seed phone numbers, and each demo phone texts the line "hi" first.
13. **iPhone web limits:**
    - no `navigator.vibrate` (the buzz comes from iMessage)
    - audio only after the first tap
    - GPS only while the page is open and the screen is on (Auto-Lock → Never on demo phones)

### Stack

- **Base44 CLI project** (Node ≥ 20.19, `npm i -g base44@latest`, created with `base44 create` → React template).
  - Base44 provides the database (entities), realtime `subscribe`, backend functions (Deno), file upload, LLM calls (`InvokeLLM`) and hosting at `https://<slug>.base44.app`.
  - The frontend is our own **Vite + React + TypeScript** in `src/`, deployed by Base44 (`site` block in `base44/config.jsonc`, `base44 deploy --build`).
  - Run everything locally with `base44 dev`.
- Frontend libraries: `react-router`, `zustand`, `framer-motion` (stepped transitions only); everything pixel is our own CSS + canvas. No UI kit.
- **Agents:** Python 3.11 + `uagents>=0.25.5` in `agents/` (run on a laptop or Railway; outbound HTTPS only).
- **iMessage:** Photon 2.0 REST (`https://api.photon.codes/v1`), called from C's functions.

### Repo and ownership

```
hand-me-down-relay/
├─ base44/
│  ├─ config.jsonc                  (B) name, visibility: "public", site {installCommand, buildCommand, outputDirectory:"./dist", serveCommand}
│  ├─ entities/*.jsonc              (B) all entities — follow the template's task.jsonc format
│  └─ functions/
│     ├─ _lib/pricing.ts outgrow.ts nudges.ts match.ts seed.ts        (B)
│     ├─ _lib/geo.ts photon.ts auth.ts                                 (C)
│     ├─ recordPurchase listItem withdrawListing upsertNeed resolveNudge
│     │  decideProposal payProposal demoClock demoReset getCloset selfTest   (B)
│     └─ updatePresence listNearby demoWalk photonWebhook sendImessage agentApi (C)
├─ src/
│  ├─ pixel/      (A) tokens.css fonts.css components/ sprites.ts sfx.ts particles.ts
│  ├─ world/      (A) TitleScreen WorldScreen Radar Sprite EncounterScene Celebration
│  ├─ closet/     (B) ClosetScreen ItemCard ListingFlow NeedsScreen NudgeDialog
│  ├─ trade/      (B) TradeWindow PayButton RelayLog
│  ├─ agent/      (C) AgentPet AgentBubbles useEncounter
│  ├─ app/        (B) main.tsx routes.tsx api.ts store.ts ParentPicker DemoPanel
│  └─ mocks/      each person: mocks/<a|b|c>.ts
├─ public/sprites/ public/sfx/      (A)
├─ agents/                           (C) Python
├─ NEEDS.md  README.md
```

- Never edit another person's files; write requests in `NEEDS.md` under your name.
- `src/app/api.ts` (B) wraps every `base44.functions.invoke` and entity `subscribe`. A and C import from it and add their own functions to it only by asking B (or in a clearly marked `// C:` block).
- Branches: `world-…` (A), `closet-…` (B), `agent-…` (C). Merge to `main` at every gate.

### Shared contract (types)

```ts
type SizeLabel = "0-3M"|"3-6M"|"6-9M"|"9-12M"|"12-18M"|"18-24M"|"2T"|"3T"|"4T";
Parent       { id; name; avatar: { sprite: "parent_a"|"parent_b"|"parent_c"; palette: string };
               pet: { sprite: "pet_a"|"pet_b"|"pet_c"; name: string };
               phone?: string; agentAddress?: string; discoverable: boolean }
Child        { id; parentId; nickname; birthDate }
ClothingItem { id; name; category: "top"|"bottom"|"onesie"|"outerwear"|"dress"|"set"|"other";
               icon: string /* sprite key, e.g. "item_romper" */; size: SizeLabel;
               originalPriceCents; originalPurchaseDate; ownerCount: 1|2|3; currentOwnerId; childId;
               photos: string[]; ownershipHistory: { ownerId; from; to?; priceCents? }[];
               predictedOutgrowDate?; status: "in_closet"|"listed"|"pending_trade"|"transferred_out" }
Listing      { id; itemId; sellerId; condition: "like_new"|"gently_used"|"well_loved"; conditionNote;
               priceCents; shared: boolean; status: "active"|"withdrawn"|"sold"; createdAt }
Need         { id; parentId; childId; sizes: SizeLabel[]; categories?: string[]; maxPriceCents?; shared: boolean }
Presence     { parentId; lat; lng; accuracyM; simulated: boolean; updatedAt }          // server-only reads
Encounter    { id; aId; bId; band: "<25m"; simulated: boolean; status: "talking"|"proposed"|"no_match";
               startedAt; transcript: AgentTurn[] }
AgentTurn    { from: "buyer_agent"|"seller_agent"; parentId; kind: "looking_for"|"have"|"no_fit"|"fit_check"|"propose"|"ack"|"decline"; text; at }
MatchProposal{ id; listingId; sellerId; buyerId; encounterId?;
               snapshot: { itemName; icon; photo; size; originalPurchaseDate; originalPriceCents;
                           condition; conditionNote; previousOwners; priceCents; wearWeeksLeft? };
               reason; transcript: AgentTurn[]; source: "fetch"|"local";
               sellerDecision: "pending"|"accepted"|"declined"; buyerDecision: "pending"|"accepted"|"declined";
               status: "open"|"both_accepted"|"paid"|"declined"|"expired"|"payment_failed";
               handover: "now"|"later"; handoverNote?; createdAt; expiresAt }
AgentNudge   { id; parentId; itemId; kind: "outgrow_check"|"listing_reminder"|"new_owner_welcome"; message; createdAt; resolved }
AgentInbox   { id; parentId; type: "imessage"|"encounter"|"event"; payload; status: "pending"|"claimed"|"done"; createdAt }
Setting      { key: "demo"; now; matchVia: "fetch"|"local"; imessage: boolean; lineUserId? }
```

**Functions** (frontend: `base44.functions.invoke`; agents/Photon: `https://<slug>.base44.app/functions/<name>` with header `x-agent-key`)

| Function | Owner | Purpose |
|---|---|---|
| `getCloset` | B | `{parentId}` → parent, child (age in months), items, listings, needs, open nudges, open proposals |
| `recordPurchase`, `listItem`, `withdrawListing`, `upsertNeed`, `resolveNudge` | B | as named; `listItem` sets price via `priceFor` |
| `decideProposal`, `payProposal` | B | two-sided accept; 1 s mock pay; atomic transfer |
| `createProposal` | B | internal (C's agentApi calls it): re-validates every rule, creates the proposal |
| `demoClock`, `demoReset`, `selfTest` | B | clock get/set + nudge scan; reseed; PASS/FAIL checks |
| `updatePresence`, `listNearby`, `demoWalk` | C | GPS in; bands + bearing out; simulated walk; encounter detection |
| `photonWebhook`, `sendImessage` | C | iMessage in/out (Photon 2.0) |
| `agentApi` | C | agents' single door: `claimInbox`, `complete`, `getState`, `fit`, `suggestCondition`, `createProposal`, `appendTurn`, `now`, pass-through actions |

**Realtime (`subscribe`) used by the app:**
- `Encounter`: A's cutscene, C's bubbles
- `MatchProposal`: B's Trade window
- `ClothingItem` / `Listing`: B's closet
- `AgentNudge`: B's NudgeDialog / C's pet

### Seed (B)

- Mina: child born 2025-12-10, sprite `parent_a`, pet "Button".
- Jo: child born 2026-03-01, shared Need `6-9M` tops/onesies, sprite `parent_b`, pet "Pip".
- Sam: sprite `parent_c`, pet "Moss", with one item at ownerCount 3.
- "Yellow duck romper" `6-9M` $30, bought by Mina 2026-05-15, ownerCount 1, icon `item_romper`.
- 10–15 more items across sizes with icons.
- Demo walk start: Jo 120 m from Mina.

### Demo script (3 minutes)

1. **0:00 Title.** "HAND-ME-DOWN RELAY · PRESS START". The tap unlocks sound and asks for location. Mina's World: her avatar on a pixel lawn, radar rings, and Jo's sprite far off (100–300 m band).
2. **0:15 Closet.** The bag shows the duck romper icon, ♥♡♡ owners, and a "fits until ~Aug 27" bar.
3. **0:25 The nudge.**
   - The clock jumps to Sep 20. Mina's pet Button pops up in a dialog box, and at the same moment her iPhone buzzes with the iMessage: "The yellow duck romper (6-9M) is probably getting snug — still fit? Want to pass it on?"
   - She replies "sell it" + photo. The agent asks "Looks gently used — right?", she says "yes", and gets "Listed at $18.00 — 2nd owner pays 60% of $30."
4. **1:00 The walk.**
   - Clock → Oct 18. Mina walks toward Jo (outdoors: real GPS; at the table: "Walk toward Jo" + SIMULATED GPS chip).
   - Jo's sprite moves to the 25–100 m ring, then <25 m: the screen flashes, a "!" pops over both heads, and the two avatars face each other.
   - Button and Pip hop out and talk in dialog bubbles (live transcript), ending with "Trade proposal!"
5. **1:40 Trade window** on both phones at once, and in both iMessage threads:
   - item icon + photo, size, original date and price, condition, ♥♡♡ previous owner, $18.00, the reason
   - "Nothing is charged until you both accept."
6. **2:00 Accept + pay.** Both accept, and Jo taps Pay (demo payment). Golden pixel flowers burst over both avatars with a jingle; both threads get the flower GIF.
7. **2:20 New owner.** The romper hops into Jo's bag (♥♥♡). Jo's pet: "Say hi to the duck romper! It should fit until ~Nov 17. I'll check in then."
8. **2:35 Trust.** Sam's third-owner item shows "FINAL HOME" and has no Sell. A declined proposal charged $0. Others only ever saw "<25 m".
9. **2:50 Relay Log** (stats screen) + the ASI:One run in the video.

### Gates (merge to `main` at each)

| Time | Gate |
|---|---|
| 9:00–9:45 PM | **Together:** `base44 create` (React template) → publish → `visibility public` → URL opens logged-out on both iPhones → Add to Home Screen. Entities pushed. Photon project + iMessage line + webhook. Agent addresses printed. Both demo phones text the line "hi". A shows the palette + font + one sprite. |
| 10:30 PM | A: pixel kit v1 merged (B and C switch to it). C: two phones outside see each other in `listNearby` within ±10 m. B: `getCloset` + Closet screen on real data. |
| 12:00 AM | B: list the romper at $18.00 from the app. C: iMessage round trip (phone → agent → phone). A: World screen with real sprites + radar. |
| 2:00 AM | Simulated walk → encounter → agents talk → proposal on both phones. |
| 4:00 AM | Full demo on two phones with flowers, transfer, and sound. Test with 3–5 people and write down what you changed (Base44 "evidence of learning"). |
| 4:00–7:00 AM | Polish, fallbacks, ASI:One cards, 5 full runs; sleep in 90-min rotation. |
| 7:00–8:30 AM | Outdoor video in daylight (real GPS); ASI:One shared chat. |
| 8:30–10:00 AM | Devpost (all tracks), Fetch Submission Agent, README, submit. |

### Working style for you, the agent

- Restate your scope in 5 lines and list your files before coding.
- Demo path first, edge cases second, polish last.
- Commit small and often on your branch, and never force-push `main`.
- At each gate, report what works, what's mocked, and what you're unsure about.

---

## Part D — Pixel design system (everyone pastes this; A owns it)

**Feel:** a cozy 16-bit handheld game on a sunny park morning. Cute, warm, readable, a little bouncy. Hand-made, not template-made.

**Pixel rules**
- Base unit **4 px**. Everything (padding, borders, sizes) is a multiple of 4.
- Sprites are drawn small (16×16 or 32×32) and scaled by **integers only** (×3 or ×4), with `image-rendering: pixelated`.
- **No blur, no soft shadows, no gradients, no rounded CSS corners.** Use:
  - hard offset shadows: `box-shadow: 4px 4px 0 var(--ink)`
  - stepped corners: clip-path or a 9-slice `border-image` frame from `public/sprites/ui_frame.png`
  - dithered patterns for shading
- Motion uses `steps()` timing: sprite animation at 8–12 fps, idle bob 2 frames, button press = move 4 px down and drop the shadow. Respect `prefers-reduced-motion` (no screen flash, no particles).

**Palette** (`src/pixel/tokens.css`, our own; add colors only through A)

```css
:root{
  --ink:#2B2140;      /* outlines, text */
  --paper:#FFF4D6;    /* panels */
  --cream:#FFE8B8;    /* panel shade */
  --grass:#7BC96F; --grass-dark:#4E9A57;
  --path:#E9C38A;
  --sky:#8FD3FF;
  --peach:#FFB38A;
  --pink:#FF8FAB;     /* hearts, accept */
  --gold:#FFC83D;     /* flowers, price, highlights */
  --lav:#B9A3FF;      /* agent/pet color */
  --red:#E85D5D;      /* decline, errors */
  --mint:#8EE3C8;     /* success */
}
```

**Type** (Google Fonts, open license):
- `Pixelify Sans` for body and UI (16/20/24 px).
- `Silkscreen` for labels, numbers and chips (12/16 px, uppercase).
- `Press Start 2P` only for the title wordmark.
- Text in dialog boxes types out at ~40 chars/s with a soft blip.

**Components** (`src/pixel/components`, A builds; B and C use these names and props)

| Component | Props | Notes |
|---|---|---|
| `PixelPanel` | `title?`, `tone?: "paper"\|"cream"\|"lav"` | 9-slice frame, 4 px ink outline, hard shadow |
| `PixelButton` | `variant: "primary"\|"ghost"\|"danger"`, `icon?`, `onClick` | pressed state drops 4 px; primary = gold |
| `DialogBox` | `speaker: {name, sprite}`, `lines: string[]`, `onDone?`, `choices?: {label, value}[]` | RPG text box at the bottom: portrait left, typewriter, blinking ▼, choices as a pixel menu |
| `Chip` | `tone`, `children` | Silkscreen uppercase (e.g. `GPS ±12M`, `SIMULATED GPS`, `DEMO PAYMENT`) |
| `Hearts` | `filled: 1\|2\|3` | owner count ♥♥♡ |
| `FitBar` | `until: date`, `now: date` | pixel progress bar "fits until ~Nov 17" |
| `Sprite` | `name`, `anim: "idle"\|"walk"\|"cheer"`, `scale: 3\|4`, `facing?: "left"\|"right"` | spritesheet animation with steps() |
| `ItemIcon` | `icon`, `size: 1\|2` | 16×16 item sprite in a slot |
| `Toast` | `text`, `tone` | slides down from the top in 4 px steps |
| `Modal` | `title`, `children` | `PixelPanel` over a dithered backdrop |
| `PriceReceipt` | `original`, `pct`, `price`, `ownerAfter` | receipt-paper look: "2ND OWNER PAYS 60% OF $30.00 = $18.00" |

**Sprites** (`public/sprites/`, A draws them, all original; Piskel or Aseprite, export PNG strips)
- **Parents** `parent_a/b/c` 32×32: idle 2 frames, walk 4 frames, cheer 2 frames.
- **Pets** `pet_a/b/c` 16×16 (original closet critters, e.g. a sock bunny, a hanger bird, a button moth): idle 2, talk 2, hop 3.
- **Items** 16×16: romper, onesie, tee, pants, jacket, dress, set, hat, socks, sweater, bib, sleep sack.
- **World:** grass tile, path tile, flower-bed tile, bench, tree, the "!" alert bubble, radar dot ring.
- **FX:** golden flower bloom (4 frames), petal particle (2 frames), sparkle (3 frames).
- **UI:** `ui_frame.png` (9-slice), cursor arrow, heart full/empty, coin.
- App icon (180×180 pixel-art) for Add to Home Screen.

**Sounds** (`public/sfx/`, A makes them with jsfxr/sfxr, all original, ≤ 1 s each):
- `start`, `blip` (typewriter), `alert` (encounter "!"), `select`, `accept`, `decline`, `coin` (pay), `jingle` (trade complete, ~2 s), `step` (soft, during walk)
- A mute toggle in the corner; audio unlocks on the title tap.

**Screens:** 390 px wide mobile; also good at 1440 px on the projector (centred 430 px "handheld" frame with a pixel bezel on wide screens).

---

## Part A — World & Art (`src/pixel`, `src/world`, `public/sprites`, `public/sfx`)

You own the look and the game world: the parts judges remember. Use Paper (paper.design, promo `LAHACKS26`) for the three hero screens (World, Encounter, Trade complete) if you can, since that counts toward the Paper design prize.

Build, in this order:

1. **9:00–10:30 PM, pixel kit v1** (B and C are waiting on it):
   - `tokens.css`, fonts, `PixelPanel`, `PixelButton`, `DialogBox`, `Chip`, `Hearts`, `FitBar`, `Sprite` (with a placeholder 32×32 box sprite), `ItemIcon`, `Toast`, `Modal`, `PriceReceipt`.
   - A `/kit` page showing every component (handy for judging and for B and C).
   - Merge at 10:30.
2. **Sprites + sounds, first pass by 12:00 AM:** the parents (idle + walk), the pets (idle + talk), 6 item icons, grass/path tiles, the "!" bubble, the flower bloom, and all sfx. Second pass later (cheer, more items, polish).
3. **TitleScreen** `/`: wordmark, bobbing pets, "PRESS START".
   - The tap unlocks audio, requests location (explain why in one line), shows the parent picker (`?as=mina` also works), then opens the World.
4. **WorldScreen** `/world` (the Pokémon Go part):
   - A tiled pixel lawn with a path. Your avatar sits in the centre and plays its walk animation while your GPS position is changing.
   - Radar rings (dotted pixel circles) labelled 25 M / 100 M / 300 M.
   - Other parents come from `listNearby` every 2 s, placed by `bearingDeg` and band. They slide between rings in 4 px steps, with names in Silkscreen.
   - GPS: `watchPosition({enableHighAccuracy:true, maximumAge:0})` → `updatePresence` every ~3 s (C's function); resume on `visibilitychange`; a "KEEP THIS SCREEN OPEN WHILE YOU WALK" hint.
   - Chips: `GPS ±12M` / `WEAK GPS — STEP OUTSIDE` / `SIMULATED GPS`, plus a Discoverable toggle.
   - Bottom bar: World · Bag (Closet) · Pet · Log.
   - `?demo=1` adds "WALK TOWARD JO/MINA" (calls C's `demoWalk` every 1 s until the encounter fires).
5. **EncounterScene** (subscribe to `Encounter` via `api.ts`):
   - Screen flash, `alert` sound, and a "!" over both heads; the two avatars walk to face each other in the centre.
   - Both pets hop out, and C's `AgentBubbles` component renders the transcript between them. You own the stage and layout; C owns the bubble content.
   - When `status` becomes `proposed`, show the "TRADE PROPOSAL!" banner and hand off to B's `TradeWindow`.
   - On `no_match`: the pets shrug ("Nothing fits today — maybe next walk!").
6. **Celebration** (B's `payProposal` → proposal `status: "paid"`):
   - A canvas particle burst of golden flowers + petals over both avatars, plus the `jingle`.
   - The item icon arcs from the seller's side to the buyer's.
   - Export a 3-second GIF/PNG (`public/fx/flowers.gif`) for C to send over iMessage.
7. **Projector frame:** on screens wider than 600 px, centre the app in a pixel "handheld" bezel.

Done = `/kit` shows every component. On two phones outside, the avatars approach as you walk. With `?demo=1` on one laptop (two tabs), the walk → encounter → flowers loop plays with sound.

---

## Part B — Closet & Trade, full stack (`src/closet`, `src/trade`, `src/app`, `base44/entities`, B's functions)

You own items, prices, proposals and money, from the screen to the database. Until A's kit merges at 10:30 PM, build with plain elements using the component names and props from Part D, then switch.

**Backend first (9:45–11:30 PM)**, Base44 functions in Deno (`entry.ts` per function, `createClientFromRequest(req)`, `asServiceRole` for writes, `secrets.get()` inside handlers):

1. **Entities** (`base44/entities/*.jsonc`, following the template's `task.jsonc` format) for every type in the contract. Push them at Hour 0 with A and C watching.
2. **`_lib`:**
   - `priceFor`, `SIZE_RANGES`
   - `predictOutgrow(item, child)`: the child passes the size's `maxMonths`, minus 2 weeks, never before purchase. Seed checks: Mina's romper ≈ 2026-08-27, Jo ≈ 2026-11-17.
   - `scanForNudges`: within 14 days of / past the predicted date, `in_closet`, ownerCount < 3; a listing reminder after 30 days.
   - `findMatches` (the local fallback): shared × shared, size ∈ need, category / maxPrice, skip ownerCount 3 and inactive listings; rank size → condition → newest; `wearWeeksLeft`.
   - `seed`.

   If functions can't import `_lib`, copy the file into each function.
3. **Functions:** `getCloset`, `recordPurchase`, `listItem`, `withdrawListing`, `upsertNeed`, `resolveNudge`, `decideProposal`, `payProposal`, `createProposal`, `demoClock`, `demoReset`, `selfTest`.
   - State machines are enforced here:
     - Items: `in_closet → listed → pending_trade → transferred_out`; withdraw goes `listed → in_closet`; no listing at ownerCount 3.
     - Proposals: `open → both_accepted → paid | declined | expired | payment_failed`. Payment failure re-activates the listing. One open proposal per listing.
   - `createProposal` re-validates every rule (agents are trusted for wording only).
   - `payProposal`, after 1 s, in one step:
     - close the seller's history entry and add the buyer
     - `ownerCount += 1`, new owner and child
     - listing `sold`, item `in_closet` for the buyer
     - new outgrow date, a `new_owner_welcome` nudge
     - `AgentInbox` events for both agents (`trade:completed`)
   - `demoClock` set → nudge scan → new `AgentNudge` + `AgentInbox{type:"event", payload:{type:"nudge:new"}}`.
   - `decideProposal` and `createProposal` also write `AgentInbox` events (`proposal:new`, `proposal:updated`).
4. **`selfTest`:**
   - pricing at 1/2/3 owners, no listing at 3, no charge on decline
   - double accept idempotent, pay before both accept rejected, transfer exactly once
   - prints PASS/FAIL (Base44 judges want evidence of testing)

**Frontend (11:30 PM →):**

5. **`src/app`:** routes, `api.ts` (typed wrappers for every function + entity subscriptions), `store.ts`, `ParentPicker`, and `DemoPanel` (`?demo=1`: clock jumps May 15 / Sep 20 / Oct 18, Reset, matchVia / imessage toggles).
6. **ClosetScreen "Bag"** `/bag`:
   - A pixel inventory grid (4 columns of `ItemIcon` slots). The selected slot shows an `ItemCard`: name, size, `Hearts` (owners), `FitBar`, status chip, Sell button.
   - Third-owner items show "FINAL HOME 💛" and no Sell.
   - A child card in a `PixelPanel`: nickname + age in months.
7. **NudgeDialog:** subscribe to `AgentNudge`, then the pet appears in a `DialogBox` with choices SELL / KEEP / LATER (C's `AgentPet` supplies the portrait; you own the flow).
8. **ListingFlow** (3 steps in `PixelPanel`s):
   - photo (camera input → Base44 `UploadFile`) in a pixel "polaroid" frame
   - condition picker (3 options with star icons), pre-filled from C's `agentApi suggestCondition` and tagged "PET SUGGESTED"
   - `PriceReceipt` (price from the backend) + Share toggle → Confirm, with the `coin` sound and a toast "LISTED!"
9. **Needs** `/bag/needs`: size chips, category chips, Share toggle.
10. **TradeWindow** (subscribe to `MatchProposal`, opens on both phones):
    - Two halves (seller | buyer avatars) with the item in the middle: icon + photo, size, original date and price, condition, `Hearts`, `PriceReceipt`, reason, "fits ~4 weeks".
    - Collapsible "HOW OUR PETS FOUND THIS" (transcript).
    - ACCEPT / DECLINE, with the other side's live status ("JO ACCEPTED ✓ — WAITING FOR YOU").
    - The buyer then sees **PAY · DEMO PAYMENT · NO REAL CHARGE**.
    - "NOTHING IS CHARGED UNTIL YOU BOTH ACCEPT."
    - On paid, hand off to A's Celebration.
11. **RelayLog** `/log` (end card): seconds to list, encounters → proposals → trades, owners per item, declined proposals with $0 charged, and each item's ownership chain as a pixel timeline.

Done = `selfTest` all PASS, and on two phones: Sep 20 nudge → list at $18.00 → (C's encounter) → Trade window on both → accept, pay → romper in Jo's bag with ♥♥♡.

---

## Part C — Agents & Messages (`src/agent`, C's functions, `agents/`)

You own everything that talks: GPS encounters, iMessage, the Fetch agents, ASI:One, and the in-app pet's voice.

**Base44 functions first** (Deno; `secrets`: `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `AGENT_KEY`, `WEBHOOK_KEY`, seed phones):

1. **10:30 PM, location** (A is waiting on these):
   - `_lib/geo.ts`: haversine, bearing, band.
   - `updatePresence`:
     - upsert the caller's Presence
     - for each other Discoverable presence updated in the last 30 s: `d ≤ 25`, both accuracies ≤ 30 (skip when both are simulated), the pair is re-armed and past cooldown → create an `Encounter{status:"talking"}` and one `AgentInbox{type:"encounter", payload:{encounterId, peer:{parentId, agentAddress}}}` row for each parent
     - track re-arm (> 40 m)
   - `listNearby` → `[{parentId, name, sprite, band, bearingDeg}]`.
   - `demoWalk`: move the caller's simulated presence 5 m toward the target and run the same check.
   - **Fallback:** if an encounter has no proposal after 8 s, or `matchVia` is `local`, call B's `findMatches` both ways and `createProposal{source:"local"}` (or set `status:"no_match"`).
2. **12:00 AM, Photon 2.0 iMessage** (REST `https://api.photon.codes/v1`, `Authorization: Bearer pho_sk_…`; check against `https://api.photon.codes/openapi.json`):
   - **Webhook destination** (dashboard or `POST /projects/{projectId}/webhooks/destinations`): `{name, url:"https://<slug>.base44.app/functions/photonWebhook?k=<WEBHOOK_KEY>", apiVersion:"2026-07-01", enabledEvents:["message.received"]}`. Confirm event names with `GET …/webhooks/event-types`.
   - **`photonWebhook`:**
     - Event `type:"message.received"`, `source:"imessage.photon"`; the message is in `data.object`.
     - `sentBy.handle` → parent (ignore unknown). Text items: `content[]{type:"text", text}`. Attachments: `{type:"attachment", attachmentId}` → `GET /projects/{id}/attachments/{attachmentId}/content` → `UploadFile` → url.
     - Save the line's own user id from `receivedBy` into `Setting.lineUserId` the first time.
     - Write `AgentInbox{type:"imessage"}` and return 200 fast.
   - **`sendImessage{parentId, text?, imageUrl?}`:**
     1. `POST /projects/{id}/users {handle, platform:"imessage"}` → userId
     2. `POST …/spaces {participantIds:[userId], platform:"imessage"}` → spaceId (cache both on Parent)
     3. `POST …/messages {spaceId, senderId: lineUserId, content:{type:"text", format:"plain", text}}`

     Images: `POST …/attachments` (`multipart/related`: part 1 JSON `{contentType, sizeBytes, filename}`, part 2 the bytes) → `content:{type:"attachment", attachmentId}`. Seed numbers only.
   - **Fallback:** if an `AgentInbox` event isn't `done` within 5 s, send a template line yourself.
3. **`agentApi`** (header `x-agent-key`): `claimInbox`, `complete`, `getState` (calls B's `getCloset` logic, shared-only for peers), `fit` (B's `findMatches` / `predictOutgrow`), `suggestCondition` (Base44 `InvokeLLM` with the image → `{condition, note}`), `createProposal` (calls B's), `appendTurn` (pushes to `Encounter.transcript`), `now`, plus pass-through `listItem` / `resolveNudge` / `decideProposal`.

**Fetch agents** (`agents/`, Python 3.11, `uagents>=0.25.5`, one process per parent):

```bash
python closet_agent.py --parent mina   # also jo, sam
```

`Agent(name="<parent>-closet", seed=f"relay-{parent}-{TEAM_SECRET}", port=8101..8103, mailbox=True, readme_path="agent_readme.md", description=…)`. Connect each to Agentverse via the Inspector link (Mailbox). Print the addresses at Hour 0 for B's seed.

```
agents/
├─ relay_protocol.py   # LookingFor, HaveListings, NoFit, ProposeTrade, TradeAck + spec
├─ closet_agent.py     # inbox poller + RelayProtocol + Chat Protocol (ASI:One)
├─ base44_client.py    # aiohttp → agentApi / sendImessage with x-agent-key
├─ intents.py  wording.py  cards.py
├─ agent_readme.md     # ![tag:innovationlab] ![tag:hackathon] badges, commands, protocols
├─ local_demo.py       # Bureau: three agents offline with a mocked base44_client
└─ requirements.txt  Makefile  tests/test_relay.py
```

4. **Inbox loop:** `on_interval(1.0)` → `claimInbox` → handle → `complete`.
5. **Owner conversation:** `sell` / `keep` / `later`; photo → `suggestCondition` → "Looks gently used — right?" → `yes` → `listItem`; `accept` / `decline`; `pay` → app link; `bag`; `help`. Replies via `sendImessage` (≤ 2 sentences, in the pet's voice, no markdown).
6. **Events:** `nudge:new`, `proposal:new` (price, rule, "Nothing is charged until you both accept"), `proposal:updated`, `trade:completed` (+ the flowers GIF) → one warm text each.
7. **RelayProtocol on `encounter`:**
   - The buyer side sends `LookingFor{needs (shared), childAgeMonths}`.
   - The seller side answers `HaveListings` / `NoFit`.
   - The buyer side runs `fit` and sends `ProposeTrade`.
   - The seller side re-checks and sends `TradeAck`.
   - The buyer side calls `createProposal` with the transcript.

   Every send and receive calls `appendTurn` with a human line in the pet's voice ("Pip: Looking for 6-9M tops or onesies!"). Never send phones, names or birth dates between agents.
8. **ASI:One:**
   - `chat_protocol_spec` with `publish_manifest=True`; same intents.
   - The nudge is a `detail` card and the proposal a `review` card: `MetadataContent` with `card_protocol_version:"1"`, `requires_card_interaction:"true"`, `card_kind`, `card_payload: json.dumps(…)`.
   - Parse replies with `json.loads` first, then prose.
   - `claim <parent>-<4 digits>` binds an ASI:One user.
9. **Bonus:** AgentPaymentProtocol wrapper around the demo payment (`payment_method="demo_mock"`).

**Frontend (`src/agent`, after 2:00 AM):**

10. **`AgentPet`:** the pet sprite in the corner of World and Bag. It bobs, and it shows a dot when there's an open nudge or proposal. Tapping it opens a `DialogBox` with its latest line (mirrors the iMessage thread).
11. **`AgentBubbles`:** renders `Encounter.transcript` as alternating pixel speech bubbles between the two pets on A's EncounterScene stage, typewriter + `blip`.
12. **`useEncounter`:** a hook that subscribes to the active encounter for A and B.

**Submission (you lead Fetch):**
- README: agent names + addresses + Agentverse profile URLs, badges, the ASI:One shared chat URL.
- The team lead registers on the **LA Hacks ASI:One Submission Agent** (Create team → fields → agent URLs + shared chats → Confirm → share the Team ID), and teammates join with the ID.

Reference: the project doc `claude/fetch-a2a-peershop.md` (tested chat protocol + agent-to-agent protocol + payment protocol, uagents 0.26.1).

Done:
- Two phones outside → encounter → agents talk → proposal on both.
- iMessage round trip with the pet's voice.
- `python local_demo.py` works offline.
- One ASI:One chat completes nudge → sell → proposal → accept.
