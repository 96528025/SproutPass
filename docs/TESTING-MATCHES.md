# Testing proximity matches (Oct 18, 2026)

How to check that **when two parents walk within 25 m of each other and their lists match, both phones get the
trade popup**, and that every seeded match case works. Three levels: automated tests (2 min), two tabs in mock mode
(10 min), real phones on the live app.

Display names changed on Oct 18: seed key `mina` = **Caesar**, `jo` = **Olivia**, `sam` = **Freja**. URLs use the
keys (`?as=mina`), screens show the names.

## What should happen

- Two parents come within 25 m. If one parent's **shared listing** fits the other's **shared need** (either way),
  the pets talk, then a **TRADE PROPOSAL!** window pops on **both** phones, on any screen (map, bag, …).
- On `/world` the pets' scene plays first; the trade window waits until the scene is done (at most 20 s).
- If nothing fits, the meeting is still recorded (`Encounter.hasMatch: false`). On `/world` the scene ends with
  "Nothing fits today — maybe next walk!" for 15 s, and no trade window opens on either phone.
- One trade per meeting. When both lists match each other, the parent with the smaller id buys first, whoever
  walked; the other direction comes at the next meeting.
- A pair waits 2 min (demo) / 10 min (real GPS) between meetings, except: a meeting where nothing fit doesn't hold
  the wait once something fits, and a paid trade lets them meet again at once. A held demo walk ends with a toast
  ("Your pets can meet again in 1:20").

### The seeded matches (Oct 18 and Sep 20)

| Seller → buyer | Item | Price | Notes |
|---|---|---|---|
| Caesar → Olivia | Yellow duck romper, 6-9M | $18.00 | Listed during the demo (Sep 20 nudge → SELL) |
| Freja → Caesar | Star puffer snowsuit, 9-12M | $33.60 | Pre-listed |
| Freja → Olivia | Fleece bear jacket, 6-9M | $21.60 | Pre-listed; Olivia's need caps it at $25 |
| Caesar → Freja | Spare star sleep sack, 12-18M | $19.20 | Pre-listed; so Caesar ↔ Freja match both ways |

Caesar ↔ Olivia have **no** match until the romper is listed. That is the built-in no-match case.

## 1. Automated tests

```bash
npx tsc -p tsconfig.check.json
```

```bash
npx vitest run
```

```bash
deno test --no-lock -A base44/shared/c/
```

```bash
agents/.venv/bin/python -m pytest -q agents/tests
```

```bash
agents/.venv/bin/python agents/local_demo.py --more-matches
```

(First time on a Mac: `cd agents && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`.)

The tests that prove this feature:

| File | What it proves |
|---|---|
| `base44/shared/proximityMatch.test.ts` | `hasMatch` is set either way and before pet rules; the reproduced bug (no match → list → meet again 30 s later → popup); cooldown held after a popped meeting, lifted after a paid trade; parents standing together still meet when a match appears; WALK AGAIN; smaller id buys first whoever walked; PairState mode and the two-phone race |
| `base44/shared/matchUseCases.test.ts` | Every `DEMO_MATCHES` pair matches at its `priceFor` price within default pet rules; still exactly one nudge; a demo walk for each pair proposes that item; all four trades paid in one run; Caesar ↔ Olivia nothing before the romper |
| `src/agent/useEncounter.test.ts` | Which meeting is on screen (window, dismissed, no-match shrug, newest wins) |
| `src/world/useDemoWalk.test.ts` | What a walk response means: arrive, hold, cooldown toast text |
| `src/trade/tradeLogic.test.ts` | The trade window waits for the scene, pops the next live trade after the first closes, pill count |
| `agents/tests/test_more_matches.py` | The Python agents negotiate each seeded match, both ways for Caesar ↔ Freja |

## 2. Two tabs in mock mode (no backend)

Start the mock server (skip if it's already running on 5174):

```bash
npm run mock
```

Rules of thumb:
- Use **one origin** (`localhost:5174`) for every tab. Each tab is one phone.
- The **walking tab must stay in front** (a hidden tab pauses its walk). Two browser windows side by side are best.
- Start every run with **RESET**, then **OCT 18** in the demo panel.
- `?walk=mina|jo|sam` picks who you walk to. The **WALK TO** buttons under the walk button do the same.

### Test A: Olivia meets Freja (Fleece bear jacket)

1. Tab 1: `http://localhost:5174/world?as=jo&demo=1`, then RESET, then OCT 18.
2. Tab 2: `http://localhost:5174/bag?as=sam&demo=1` (Freja stays on her bag on purpose).
3. Tab 1: WALK TO **FREJA**, then **WALK TOWARD FREJA**.
4. Expect on tab 1: "MET FREJA!", the pets say "Trade proposal! $21.60 …", then the **TRADE PROPOSAL!** window
   (Fleece bear jacket, Olivia BUYER · YOU).
5. Expect on tab 2, without touching it: the same window, with Freja SELLER · YOU.
6. Tab 1: APPROVE. The simulated Visa payment runs; the jacket moves to Olivia's bag.

### Test B: Caesar ↔ Freja, both ways

1. Tab 2: `http://localhost:5174/world?as=sam&demo=1&walk=mina`, then WALK TOWARD CAESAR.
2. Expect: one trade only. The buyer is the parent with the smaller id (in our run Caesar bought the snowsuit, even
   though Freja walked). Caesar's tab (`/bag?as=mina&demo=1`) gets the window too.
3. The buyer APPROVEs. Close the "TRADED!" celebration on the other tab.
4. Freja: WALK AGAIN right away. Expect the reverse trade (Spare star sleep sack, $19.20), with no 2-minute wait.

### Test C: the original bug (no match, then a listing, then meet again)

1. Olivia walks to Caesar before the romper is listed. Nothing fits; no trade window.
2. Caesar: Bag, then the romper nudge, then SELL, then "Use the pixel art", NEXT, NEXT, **LIST FOR $18.00**.
3. Within 2 minutes, Olivia: WALK AGAIN / WALK TOWARD CAESAR.
4. Expect: they meet at once, the pets propose the romper, "TRADE PROPOSAL! They found a fit!", then the trade
   window on **both** tabs.

### Test D: the wait toast

After a meeting that produced a trade (declined or still open), walk to the same family again within 2 minutes.
Expect a toast: "You met Caesar a moment ago. Your pets can meet again in 1:20." and no new meeting.

### Optional edge cases

- **Pet rules stop it:** Olivia's Bag, then PET'S RULES (`/bag/pet`), set the price limit to $10. Walk to Freja: the pets
  meet, Pip declines and names the rule, no trade window.
- **TRIGGER ENCOUNTER** (demo panel): the current parent meets the first family they have a match with, with no walk.
- **Agent Console:** `http://localhost:5174/agents?as=jo&demo=1` lists every meeting, including no-match ones.

## 3. Real phones on the live app

Deploy first (shared rate limit: about 10 calls a minute, so not during a demo):

```bash
npx base44 entities push
```

```bash
npx base44 deploy --build -y
```

```bash
curl -X POST https://base44.app/api/apps/6ad44c7f93f653025c025059/functions/demoReset -H "content-type: application/json" -d "{}"
```

The push matters: `Encounter.hasMatch`, `MatchProposal.visaSimulation` and the new ClothingItem fields are new.
Without it the app degrades to the old behaviour (every meeting treated as unknown).

Then:
1. Phone A: `https://sproutpass-5c025059.base44.app/world?as=mina` (no `demo=1`), allow location.
2. Phone B: `https://sproutpass-5c025059.base44.app/world?as=jo`, allow location.
3. Set the clock to OCT 18 from a laptop (`?demo=1`) and list the romper as Caesar (or test Freja → Olivia with
   `?as=sam`, which needs no listing step).
4. Start more than 40 m apart, keep `/world` open and the screens on, and walk toward each other outdoors (GPS
   accuracy must be 30 m or better).
5. Expect within about 25 m: the scene on both phones, then the trade window on both.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Walk ends, nothing happens | You met this family less than 2 min ago with a trade, so look for the toast. Or the walking tab was hidden. |
| Each tab shows different data | Two origins (5174 vs 5175), or two tabs opened at the same instant seeded separately. RESET in one tab. |
| No trade window on the second tab | It's on `/agents` or `/impact` (projector views never pop). Or it was dismissed in that tab: use the ♥ TRADE OFFER pill. |
| Real phones never meet | GPS accuracy over 30 m (indoors), or `/world` not open on both phones, or one parent has a live trade (their radar pauses). |
