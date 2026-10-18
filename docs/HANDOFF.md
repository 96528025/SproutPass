# Handoff: SproutPass / Hand-Me-Down Relay (Oct 18, 2026, about 07:15 PDT)

Read this first. It says what is live, what is half-built, and the next steps in order.

## 1. Status in one minute

| | State |
|---|---|
| **Live app** | https://sproutpass-5c025059.base44.app. Deployed about 06:40 PDT and checked. |
| **iMessage** | Works on a real iPhone. Mina's phone is the owner's iPhone, and the pet Button answers from the Photon number **+1 (628) 263-4622**. |
| **main** | `9472f60` (committed; tests green at that commit). |
| **Big build** | **Half done, NOT committed, NOT deployed.** A Claude workflow (`sproutpass-open-world`) is still writing about 124 files in `C:\SproutPass`. |
| **Map privacy** | Decided: rough 250 m areas, labelled with pet names. The real-location commit `779fed3` is NOT merged (§5). |

**Do not edit, commit or deploy in `C:\SproutPass` until the build workflow has finished.** Ten agents are writing files there.
- The workflow runs inside the original Claude Code session ("Person B"), which must stay open.
- When it finishes, that session gets the result: the reviewer's test results and a list of follow-ups.

## 2. What is live (and verified)

Everything at `main` 9472f60:
- **The story on two tabs:** Sep 20 still-fit nudge → sell → $18.00 listing → Oct 18 walk → the pets meet → the trade window opens on both tabs → both parents accept → demo payment → celebration → the romper moves to Jo's bag.
- **Fetch.ai uAgents** (`agents/live_bureau.py`) negotiate over the HandMeDownRelay protocol. When they're off, the app's local matcher makes the proposal instead. The Agent Console `/agents` shows every protocol message and works on phones: "Back to the game", deep links `/agents?enc=<id>`, and links from the encounter scene and the pet's dialog.
- **Pet personalities:** Button (Mina) is tidy and warm, Pip (Jo) curious and bouncy, Moss (Sam) calm and thrifty. They're defined in `base44/shared/c/personality.ts` and mirrored word for word in `agents/personality.py` (checked by `parity_test.ts`). Safety lines never change.
- **Pet rules and approval:** per-trade price limit, monthly budget and kinds of items, enforced on the server. Face ID passkey approval for payment exists but hasn't been tried on a real iPhone yet.
- **Snap to list** (`/bag/add`) and the impact board (`/impact`).
- **iMessage (Photon shared pool):**
  - verified on a real phone: hi → Button replies; a photo gets a quote.
  - Since the 9472f60 fix, the AI first says what the photo shows. A water bottle is said back, never quoted as an item in the bag.
  - Not tried on the real phone yet: accept and decline by text, STOP.
- **Phones:** regular screens scroll as a whole page, and a new screen opens at its top.
- **PR review fixes:** at most one live proposal per listing even when two calls race; the pet hears other tabs in mock mode.

## 3. What the build is adding (in progress)

The designs came from three read-only design agents. The build has one contract step, then seven packages in parallel, each owning its own files:

1. **Contract (done).** New types and fields; `base44/shared/kinds.ts`, `safety.ts`, `joinRules.ts`; entity schemas (new `MapPin`; Parent/Child/Need reads closed to clients); `Api.joinWorld`, `leaveWorld`, `listPlayers`.
2. **Gear and toys, backend.**
   - Items get a kind: clothes / gear / toys. Gear and toys use age ranges (`0-6M`, `6M-3Y`, `1-3Y`, `3-5Y`, `5+`).
   - Matching works by age.
   - Car seats, cribs, sleepers, breast pumps, pacifiers and helmets can't be listed (with a kind explanation). Gear and toys need a recall check before listing.
   - New seed items: stroller, board books, LEGO Duplo, and a high chair Sam already has listed at $48. Jo gets a high-chair need.
   - RESET keeps joined families.
3. **Join and presence, backend.**
   - `joinWorld` / `leaveWorld`: a device token whose hash is stored, unique pet names, caps on joins.
   - MapPin pins snapped to 250 m cells.
   - `updatePresence` with `withNearby` + `nextInS` replaces the `listNearby` polling: about 1 call a minute per player instead of about 16.
   - Pet-rule declines say "my family" instead of the parent's name.
4. **iMessage memory.**
   - "Our baby clothes are too small now, I want help to find bigger clothes" becomes a saved need (with undo).
   - **Remote matching without a walk:** an `Encounter` with `band:"imessage"`.
   - Offers go into the sell flow. Group-chat handling is coded defensively; groups need a paid Photon dedicated line.
   - "SIMULATE A TEXT" in the mock demo panel.
   - Agent lookup by family key, not first name.
5. **Gear and toys, screens.** 9 new pixel icons, the snap-to-list kind toggle and a refusal panel for blocked items, needs by kind, the "PET'S MEMORY" panel, the listing recall checkbox, the trade window "See the agents' chat" link, and "Matched via iMessage" labels.
6. **Join and onboarding UI.** The title screen gets CONTINUE AS <PET>, JOIN THE WORLD, DEMO FAMILIES and an invite QR. The pet's onboarding questions are skippable, at most one a day afterwards.
7. **The map.** Everyone active in the last 15 minutes as pins (one read, then realtime), a WORLD view, a player card (pet only: no name, phone or position), smaller sprites (avatar 160→96 px, corner pet 48→32 px), and 44 px tap targets.
8. **Python agents and wording.** Kinds in the agents, `PROTOCOL_VERSION 0.4.0` (restart all agents together), gear/toy lines in TS and Python with parity.

Then an **integration reviewer** runs every suite, fixes cross-package breaks and smoke-tests at phone size, and a **docs** agent updates README and `docs/submission/*`.

## 4. Next steps, in order (after the workflow finishes)

1. Read the workflow result: the reviewer's test lines and follow-ups.
2. Run all suites yourself (commands in §7). They must be green.
3. Check at phone size in mock mode: `npx vite --mode mock --port 5197`, then browser at 375×812. Things to check:
   - RESET, then the romper story still ends in a trade.
   - JOIN THE WORLD → the pet's questions.
   - `/world` shows pins and the player card.
   - `/bag/add` accepts a stroller and refuses a car seat.
   - `/bag/needs` shows the pet's memory.
   - SIMULATE A TEXT as Jo: "Our baby clothes are too small now, I want help to find bigger clothes".
4. Commit (never commit `.env*` or `.claude/launch.json`).
5. Do NOT merge `779fed3` (§5).
6. **Deploy** (the shared rate limit is about 10 calls a minute, so don't deploy during a demo):
   1. `npx base44 entities push` (new MapPin entity, new fields, closed reads)
   2. `npx base44 deploy --build -y`
   3. RESET the live app: `curl -X POST https://base44.app/api/apps/6ad44c7f93f653025c025059/functions/demoReset -H "content-type: application/json" -d "{}"`. RESET re-reads `MINA_PHONE`, so iMessage keeps working.
   4. If you use the Fetch.ai agents, restart `agents/live_bureau.py` (all agents together, because of protocol 0.4.0).
7. Push main to the PR branch: `git push c main:integration` (PR #2 on github.com/96528025/SproutPass). Auto-fix for PR #2 is on in the Person B session.
8. Re-check on the phone: hi → Button; a photo; "Our baby clothes are too small…" → saved need.

## 5. Map privacy: decided

- **The build** shows other players' pets in a rough 250 m cell, labelled with the **pet's name only**. Exact distance only appears as "within 25 m" when two players meet. Exact pins could reveal where a parent lives.
- **Commit `779fed3`** (another session, branch `Caesar/recursing-chaplygin-569fa2`, worktree `.claude/worktrees/recursing-chaplygin-569fa2`) would add two things:
  - on real GPS, only a meeting that produces a trade pops up;
  - everyone is pinned at their exact location.
- **Decided by the user (about 07:40): do NOT merge, deploy or push `779fed3`.** It stays on its own branch. Everything else goes to GitHub `integration` (PR #2). This replaces the earlier "merge with exact locations" decision.

## 6. Accounts, secrets and setup (names only, never values)

- **Base44 app id** `6ad44c7f93f653025c025059`.
- **Base44 secrets set:** `APP_HOST`, `AGENT_KEY`, `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `WEBHOOK_KEY`, `PHOTON_WEBHOOK_SECRET`, `MINA_PHONE`, `SEED_PHONES` (only that phone may receive texts).
- **Local gitignored files:** `.env.local` (`AGENT_KEY`), `.env.photon` (Photon key and project id, `MINA_PHONE`, `WEBHOOK_KEY`, `PHOTON_WEBHOOK_SECRET`, `PHOTON_LINE_MINA`), `.env.real`.
- **Photon:**
  - shared iMessage pool, 25 seats, 1 used (Mina).
  - Webhook destination "sproutpass-live" → `…base44.app/functions/photonWebhook?k=<WEBHOOK_KEY>`, `message.received`, signed.
  - To add another phone, create an assignment (`POST /v1/projects/{id}/platforms/imessage/assignments {handle}`), set `JO_PHONE` / `SAM_PHONE` and `SEED_PHONES` (comma-separated), then RESET. Each phone texts "hi" first.
- **Rotate the Photon API key after the hackathon.** It was pasted into a chat.
- **Cleanup:** the merged worktree `C:/SproutPass-pr2` (branch `fix/pr2-review`) can go. Its `node_modules` is a **junction** to the main checkout's `node_modules`, so remove the junction first: `cmd /c rmdir C:\SproutPass-pr2\node_modules`. Then run `git worktree remove C:/SproutPass-pr2`. Never delete that folder recursively.

## 7. Commands

```bash
npm i
npx vite --mode mock --port 5197          # mock mode, no backend; ?as=mina&demo=1 / ?as=jo&demo=1 in two tabs
npx tsc -p tsconfig.check.json
npx vitest run
npx -y deno@2 test --no-lock -A base44/shared/c/
agents/.venv/Scripts/python.exe -m pytest -q agents/tests
agents/.venv/Scripts/python.exe agents/local_demo.py
npx -y deno@2 check --no-lock --node-modules-dir=none base44/functions/<name>/entry.ts
npx base44 logs --function photonWebhook --since 30m   # live function logs
```

On Windows PowerShell, `npm run x -- --flag` drops the `--`, so start Vite with `npx vite …` directly.

## 8. Known risks and follow-ups

- **Rate limit.** The Base44 Free plan allows about 10 function calls a minute for the whole app. This is the biggest demo risk: close extra tabs and avoid scripts during judging, and consider a paid plan for the day.
- **Not tried live yet:** Face ID on a real iPhone, snap-to-list on a real photo, accept and decline by text.
- **iMessage groups** need a Photon dedicated line (paid). The shared pool is direct chats only.
- **Python agents** serve only mina/jo/sam. Joined families negotiate through the app's local matcher (same rules, labelled "fallback").
- **Submission material:** `docs/submission/` (devpost, tracks, demo-script, architecture, testing). Track mapping: Visa (Future of Shopping), Base44 (Build Something People Want), Fetch.ai (agents), Photon (iMessage), AI for real-world problems.

## 9. House rules for anyone (or any Claude session) working here

- **Secrets:** never print or commit keys. Phone numbers go in `.env.photon`, not chat or code.
- **Payments:** demo only ("Demo payment · no real charge" on every pay surface). Nothing is charged until both parents accept. Agents only propose.
- **Pricing:** fixed: the 2nd owner pays 60%, the 3rd pays 40%, and the 3rd owner is the final home (`base44/shared/pricing.ts`).
- **No names in agent lines:** no agent line names a parent or child, and a parent's phone never leaves the backend.
- **Wording parity:** TS and Python pet wording must stay word for word equal (`parity_test.ts`).
- **Deploy order:** entity push → `base44 deploy --build -y` (never a bare `npm run build`) → RESET.
