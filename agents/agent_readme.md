![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-LA_Hacks_2026-FFC83D)
![tag:imessage](https://img.shields.io/badge/channel-iMessage-B9A3FF)

# Closet pet — Hand-Me-Down Relay

A tiny pixel companion that helps a parent pass along kids' clothing. One agent per parent
(`mina-closet`, `jo-closet`, `sam-closet`). It remembers every item, size, purchase date and
price, predicts when the child will outgrow it, and nudges when that day comes. When two
parents' phones meet (≤ 25 m), the two pets talk to each other and, if something fits, hand
*both* humans the same trade proposal. **The agent never decides for a person** — a trade
completes only after both sides accept, then a (demo) payment.

## Talk to me (ASI:One or iMessage)

| you say | I do |
|---|---|
| `claim mina-0000` | link this chat to Mina's closet (last 4 digits of the phone; `0000` in the demo) |
| `bag` | show the closet (hearts = owners: ♥♡♡ 1st, ♥♥♡ 2nd, ♥♥♥ final home) |
| `sell` / `sell the sun hat` / `keep` / `later` | answer an outgrow nudge, or pick an item by name |
| *(photo)* | I suggest a condition → `yes` lists it at the fixed price |
| `accept` / `decline` | decide a trade proposal (both sides must accept) |
| `pay` | demo payment · no real charge |
| `help` | this list |

Pricing is fixed and visible: 2nd owner pays **60 %** of the original price, 3rd owner **40 %**,
and a 3rd owner is the item's **final home** (no selling).

On ASI:One I only act for the parent who claimed me: until you `claim`, I just ask you to. Only the
claimed chat gets my later lines (nudges, proposals, pay links).

## Protocols

- **AgentChatProtocol** (ASI:One) with Interactive Cards: nudges are `detail` cards, proposals are `review` cards.
- **HandMeDownRelay 0.2.0** (agent ↔ agent): `LookingFor → HaveListings | NoFit → ProposeTrade → TradeAck`.
  The app picks the opening side by parent id, so a pet with nothing to offer but its own needs answers a
  `LookingFor` with its own `LookingFor` (the roles swap once); `NoFit` ends it only when neither way fits.
  Only *shared* listings, *shared* needs, the child's age in months and the pets' bubble lines cross the wire —
  never names, phones, birth dates or coordinates.

## Links

- App: `https://sproutpass-5c025059.base44.app`
- Code: `agents/` in the SproutPass repo

---

## Running the agents (team notes)

Everything runs from `agents/`. On Windows use `.venv\Scripts\python` where it says `python`; `make` targets are
shortcuts for macOS/Linux.

```sh
python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt   # make venv
python -m pytest -q tests          # make test   — offline, ~2 s
python local_demo.py               # make demo   — whole story offline, same Bureau wiring as live → "LOCAL DEMO PASS"
python live_bureau.py --check      # make live-check — 3 read-only calls: parent ids, pets, registered addresses
python live_bureau.py              # make live   — mina + jo + sam against the LIVE app, Ctrl+C to stop
python live_bureau.py --addresses  # make addresses — MINA_AGENT / JO_AGENT / SAM_AGENT for B's seed (no network)
```

**`make live`** runs all three agents in one uAgents Bureau on this laptop: no Agentverse account, no mailbox. They
talk to each other inside the Bureau and to the app over HTTPS (`agentApi`, `sendImessage`, header `x-agent-key`).
Config comes from the environment, then `agents/.env`, then the repo's `.env.local` (that's where `AGENT_KEY` lives);
values are never printed. Defaults: `BASE44_URL` = the live app, `APP_URL` = the same, `TEAM_SECRET=dev`.
On start it looks the three parents up by name and registers its agent addresses on their Parent rows (only if they
differ), so encounter rows point at these agents.

**Rate limit.** The Base44 Free plan gives the *whole team* about 10 function calls a minute. The Bureau therefore
spends at most `CALLS_PER_MIN` (default 8) for all three agents together, makes **one** `claimInbox` for all three
parents every `POLL_S` (12 s; every `FAST_POLL_S`=4 s for 90 s after something arrives), skips a poll when only 2
calls are left in the minute, and on a 429 / "Rate limit exceeded" pauses every call for Retry-After or
15 → 30 → 60 → 120 s and retries the row later (never at once). Cheaper still: `APPEND_TURNS=0` (default) sends the
pets' whole two-sided conversation with `createProposal` instead of one `appendTurn` per bubble; `SEND_LINES=0`
skips `sendImessage` (then the in-app pet and iMessage don't get the agent's lines). Don't run it while someone
loops scripts against live data. Inbox rows still pending after 5 s are answered by C's Deno fallback in the
same voice (it's swept by the app's `updatePresence` / `demoWalk` ticks), so with a slow poll some lines come
from the fallback; that's expected. Only one runner per app: `claimInbox` without a parent id claims every
parent's rows, so don't run `make live` and `make mina` at the same time.

**Stale rows.** An inbox row older than `INBOX_MAX_AGE_S` (600 s) is completed without a word: after a rehearsal
without RESET the agents would otherwise text "Both of you said yes! Tap to pay…" for trades that are long paid,
or apply an old "accept" to a newer proposal. A `proposal:updated` row older than 60 s is checked against
`getState` first and stays quiet when the proposal has moved on (the later event speaks).

**ASI:One access.** `ASI_OPEN=0` (default): a sender must `claim mina-<code>` before the agent answers anything.
`ASI_OPEN=1` (demo only): an unclaimed sender may also say `hi` / `help` / `bag` (the bag is then visible to
anyone who finds the agent); `sell`, `keep`, `later`, photos, `yes`, `accept`, `decline` and `pay` always need the
claim, and only the claimed chat receives the parent's mirrored lines and pay links.

**Single agents with an Agentverse mailbox** (`make mina` / `make jo` / `make sam`, or
`python closet_agent.py --parent mina`): same brain, own process, own `claimInbox` every `POLL_S`, plus a 60 s
`lookupParent` re-check that re-registers if the Parent id ever changes. Use this when ASI:One must reach the agents.
Each process has its own budget, so give each one `CALLS_PER_MIN=3` when all three run (and `POLL_S=20`).

### Still needs a human

- **Agentverse mailbox + Inspector**: run `make mina` (etc.), open the "Agent inspector" link it prints, sign in
  to Agentverse and click *Connect → Mailbox* once per agent. Not needed for `make live`.
- **ASI:One**: after the mailbox is connected, find `mina-closet` in ASI:One (or @-mention its address), say
  `claim mina-0000` (last 4 of the phone once phones are seeded). Cards render only in ASI:One.
- **Photon iMessage**: Base44 secrets `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `WEBHOOK_KEY`, optional
  `SEED_PHONES`, and `APP_HOST`; `MINA_PHONE` / `JO_PHONE` / `SAM_PHONE` + one `demoReset`; the Photon
  webhook pointed at `/functions/photonWebhook?k=<WEBHOOK_KEY>`; `Setting.imessage = true`; then text the
  line "hi" once so the app learns its `lineUserId`. Until then `sendImessage` still writes the in-app PetLine.
- **Seed addresses (optional)**: `python live_bureau.py --addresses` prints `MINA_AGENT=…` lines for B's seed
  secrets. Not required: the runner registers its addresses itself.
