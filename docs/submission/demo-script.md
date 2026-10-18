# Demo script

A 3-minute live demo, a 60-second version, optional segments for specific judges, and the backup plan.

**Base URL (live):** `https://sproutpass-5c025059.base44.app`. In mock mode, replace it with
`http://localhost:5174` (see [Backup plan](#backup-plan)).

**Cast:** Mina (seller, child Bean, pet **Button**) and Jo (buyer, child Pea, pet **Pip**). The item is Mina's
**yellow duck romper**, size 6-9M, bought new for $30.00. Jo pays **$18.00** (2nd owner pays 60%).

**Heads-up:** this script follows the code in the repo. Some of it is not on live yet: the pets' own voices, the
agents' chat on phones ("See the agents' chat", AGENTS' CHAT) and a few labels (**LIST FOR $18.00** was
**CONFIRM $18.00**). Until the next deploy, live shows the older wording; mock mode has everything.

---

## Before the demo (15 minutes ahead)

| Device | Open | Notes |
|---|---|---|
| Phone A (Mina) | `<base>/bag?as=mina&demo=1` | Seller. The DEMO panel sits at the top (tap `▶ DEMO` if it is folded). |
| Phone B (Jo) | `<base>/world?as=jo&demo=1` | Buyer. Shows the map with "WALK TOWARD MINA". |
| Laptop on the projector | `<base>/agents` | Agent Console. On a window 1024 px or wider it fills the screen. |

1. **Close every other tab of the app** on every device. Each open map tab polls the backend, and the Free-plan rate
   limit is shared by the whole team.
2. On Phone A, in the DEMO panel, tap **RESET**. This restores the seed, sets the story clock to May 15, and clears
   trades, the pets' spending rules and saved passkeys.
3. On Phone B, open `<base>/bag/pet?as=jo&demo=1` and tap **SET UP FACE ID**. Approve with Face ID. The passkey shows
   in the list and "Require Face ID to pay" turns on. Go back to `<base>/world?as=jo&demo=1`.
   (Do this *after* RESET, because RESET forgets passkeys. If you skip it, the Pay button is a plain tap.)
4. Optional: start the Fetch.ai agents on the laptop: `agents/.venv/Scripts/python.exe agents/live_bureau.py`. If
   they are not running, the app's fallback matcher proposes after 8 s and the console labels it "Fallback matcher".
5. Optional (iMessage): each phone has texted "hi" once to its own Photon number, and Messages is one swipe away.
6. Do not deploy, run scripts, or reload in a loop during the demo.

---

## The 3-minute demo

### 0:00–0:20 · The problem (Phone A on the bag)

> "A baby goes through a clothing size every few months. Most of those clothes sit in a drawer while the family two
> streets away buys the same size new. Hand-Me-Down Relay gives every parent a pixel pet that is also their AI
> closet agent. This is Mina's bag. Button, her pet, knows what each item cost and when Bean will outgrow it."

Point at the fit bar on the duck romper if a judge asks ("Fits until about…").

### 0:20–0:55 · The nudge and a fixed price (Phone A)

1. In the DEMO panel tap **SEP 20**. A toast says "Clock set to Sep 20 · 1 new nudge".
2. Button's dialog types out: "The yellow duck romper (6-9M) is probably getting snug — still fit, or want to pass
   it on?" Tap **SELL**.
3. Step 1 · Photo: tap **TAKE PHOTO** (or **No camera? Use the pixel art**), then **NEXT**.
4. Step 2 · Condition: "GENTLY USED" carries a **PET SUGGESTED** chip. Tap **NEXT**.
5. Step 3 · Price: the receipt reads "2nd owner pays 60% of $30.00 = $18.00", sharing is on. Tap **LIST FOR $18.00**.
   Toast: "Listed for $18.00!"

> "The pet suggested the condition; Mina decided. The price isn't negotiated: the 2nd owner pays 60% of the
> original, the 3rd pays 40%, and after three owners the item has reached its final home."

### 0:55–1:35 · Two pets meet, two agents negotiate (Phone B + projector)

1. On Phone A's DEMO panel tap **OCT 18** (the story clock is shared).
2. On Phone B tap **WALK TOWARD MINA**. The chip counts down ("WALKING… 60 M"). We use the simulated walk indoors;
   outside it is real GPS.
3. At 25 m Phone B plays the encounter: "You're near Mina!", then "Pip and Button are talking", with the pets'
   bubbles, each pet in its own voice ("Looking for 6-9M…", "I have a Yellow duck romper in 6-9M, neatly folded.",
   "Sniff sniff! My little one fits it for about 4 more weeks.") and the tag **PETS SUGGEST · YOU DECIDE**. With
   the TRADE PROPOSAL! banner comes a **See the agents' chat** button; leave it, the trade window opens by itself
   about a second later.
4. On the projector the Agent Console follows the encounter live: Pip (Jo, Buying, "Curious and bouncy") and
   Button (Mina, Selling, "Tidy and warm"), then **Looking for → Have listings → Propose trade → Trade ack**, each
   with a one-line summary and its latency.

> "Each parent's pet is an AI agent with its own personality. Within 25 metres they negotiate on their own: what
> Pea needs, what Mina has shared, how long it will fit, and the fixed price. The voice changes, the facts never do.
> The Privacy card checks every message on screen: no names, no phone numbers, no location. They never even learn
> each other's coordinates, only that they're within 25 metres."

If the agents are running, the badge says Fetch.ai uAgent and the addresses start with `agent1q`; otherwise it says
Fallback matcher. Say which one it is.

### 1:35–2:25 · Both decide, the buyer approves (both phones)

1. The trade window opens on both phones. Read the banner: **"Nothing is charged until you both accept."**
2. On Phone B scroll to the RECEIPT: "You save vs new $12.00 (40% off)", "Paid to Mina, the seller", "Within your
   pet's rules", and "You become owner 2 of 3".
3. Phone A taps **ACCEPT**. Phone B sees Mina's ✓ appear. Phone B taps **ACCEPT**. The banner changes to "You both
   said yes. Nothing is charged until you tap Pay."
4. Phone B taps **PAY $18.00 WITH FACE ID** and approves with Face ID.
5. Golden flowers burst on both phones. Phone B: "Now in your bag: Yellow duck romper." The panel says
   **Demo payment · no real charge**. Tap **SEE IT IN MY BAG**; the receipt stays open with PAID ✓, the DEMO-XXXXXX
   reference and "Approved with Face ID".

> "The agents can find and propose, but only people can say yes, and only the buyer can pay. Face ID signs a
> challenge that is bound to this exact trade and price, and the server checks the signature before anything moves.
> The payment is a demo; no card is collected or stored."

### 2:25–2:45 · The pet lives in iMessage (Phone B's Messages)

If Photon is set up, open Jo's thread with Pip: the match ("Nothing is charged until you both accept — reply
"accept" or "decline""), "Both of you said yes! Approve the payment in the app with Face ID (demo payment · no real
charge)" with the link, and the flowers GIF.

> "Parents can do all of this by text: send a photo to sell, reply accept or decline. The pet never pays by text; it
> sends you back to the app to approve."

If Photon isn't set up, skip this beat and use the time on the receipt.

### 2:45–3:00 · Impact (projector)

Open `<base>/impact` on the laptop (the title screen also links to it as "Our impact"). New homes count up by one,
with the carbon, water and landfill tiles, money saved by buyers and earned by sellers, and the points leaderboard.

> "Every hand-off is counted with cited, conservative assumptions, rounded down. Agents propose, parents decide,
> and outgrown clothes find their next home."

---

## The 60-second version

Start with the romper already listed (do steps 1–5 of "The nudge" before you go on) and the clock on OCT 18.

| Time | Do | Say |
|---|---|---|
| 0:00 | Phone A bag | "Every parent gets a pixel pet that is their AI closet agent. It knows when your kid outgrows something and lists it at a fixed fair price." |
| 0:10 | Phone B: **WALK TOWARD MINA** | "When two parents walk within 25 metres, their agents negotiate a hand-me-down." |
| 0:20 | Point at the encounter and the projector console | "They share only what you marked as shared. No names, no location." |
| 0:35 | **ACCEPT** on both phones | "Nothing is charged until both parents accept." |
| 0:45 | Phone B: **PAY $18.00 WITH FACE ID** | "Only the buyer can pay, approved with Face ID for this exact trade. Demo payment, no real charge." |
| 0:55 | Flowers | "The romper has its second home, and its history goes with it." |

---

## Optional segments

**For Visa judges: the pet's spending rules (30 s).** Run this while the romper is listed and before the main walk
(or after a RESET and a fresh listing; RESET also restores the default rules). On Phone B open
`<base>/bag/pet?as=jo&demo=1`, tap the **$10** preset under "Max price a trade", then **SAVE RULES**. Go back to the
map and tap **WALK TOWARD MINA**. The pets meet. On Phone B the scene ends with Pip's "Nothing fits today"; on the
projector the console shows Pip's line "Aw, not this one — it's over the price limit Jo set for me.", a **Decline**
and "Stopped by Jo's pet rules" (on Phone B, **See the agents' chat** in that box opens the same page). Nothing is
proposed or charged. Heads-up: the console's privacy check flags Jo's first name in that pet line (the pet says whose
rule it follows); say so if a judge asks, and point out that the amount is never shared. Set the limit back to $50
and save; the next walk (after the 2-minute demo cooldown) proposes the trade.

**For Base44 and AI judges: snap to list (30 s).** On Phone A open `<base>/bag/add?as=mina&demo=1`, tap **Take
photo**, and photograph any piece of kids' clothing or its size tag. "Button is looking…", then the check card with
the pet's guess, a confidence meter and **PET SUGGESTED** chips. Change a field and its chip disappears. Tap **Add
to bag**. (On the live site the guess comes from `analyzeItemPhoto`; in mock mode the card honestly says "Quick
guess" or "Demo pick".)

**For Fetch.ai-minded judges: the agents offline (35 s, laptop terminal).**
`agents/.venv/Scripts/python.exe agents/local_demo.py` prints the pets' conversation in their own voices ("Button:
Hello, hello! My closet's all tidy…", "Pip: Looking for 6-9M top or onesie! Got any?"), the Fetch.ai protocol log
between two `agent1q…` addresses, and 13 PASS checks.

**For anyone with a phone in hand: the agents' chat (20 s).** After the trade, tap the pet in the corner of
Phone B, then **AGENTS' CHAT**. The Agent Console opens on that meeting (`/agents?enc=<id>`) and reads top to bottom:
each agent card with its pet's personality, then the buttons **Agents' messages**, **Pets' chat** and **Outcome**
to jump down. **‹ Back to the game** returns to the map.

---

## Backup plan

### If the venue Wi-Fi fails

1. Put the laptop on a phone hotspot and continue live if the phones can reach it too.
2. Otherwise switch to **mock mode on the laptop**. It needs no backend; the whole story runs in the browser.

   ```bash
   npx vite --mode mock --port 5174
   ```

   Open three windows side by side:
   - `http://localhost:5174/bag?as=mina&demo=1` (Mina)
   - `http://localhost:5174/world?as=jo&demo=1&passkey=demo` (Jo; `passkey=demo` uses the clearly labelled demo
     passkey instead of the laptop's Windows Hello or Touch ID prompt)
   - `http://localhost:5174/agents` (console)

   Windows on the same origin share one world, so accepts show up across them. Run the same script. In mock mode the
   DEMO panel also has **TRIGGER ENCOUNTER**, which skips the 15-second walk and still plays the pets' conversation
   and the protocol messages. The console says "Mock world" and labels its messages "Mock", and says so out loud.
3. Fonts (Google Fonts) and map tiles (Esri) need the internet. Open the mock once while you still have Wi-Fi so the
   browser caches the fonts; without them the text falls back to a system font and the map is blank, but every step
   still works.

### If the rate limit bites ("Rate limit exceeded", the bag won't open, the walk stalls)

1. Stop `live_bureau.py` (Ctrl+C). The fallback matcher proposes after 8 s and the console says "Fallback matcher".
2. Close every extra tab of the app; keep only the two phones and the projector.
3. Wait 15–30 seconds and tap again. The functions retry a rate-limited call with backoff for about 11 seconds on
   their own.
4. Still stuck: switch to mock mode (above). Same story, same code.

### Other things that can go wrong

| Problem | What to do |
|---|---|
| Face ID fails or this phone has no saved passkey | Pay offers **ADD THIS DEVICE, THEN PAY**. Cancelling says "nothing charged". Or RESET and skip the passkey set-up so Pay is a tap. |
| A trade window is stuck from a rehearsal | DEMO panel → **RESET**. Open trade windows close with "This trade was cleared · nothing was charged". |
| The encounter doesn't fire | Check the clock is on OCT 18 and the romper is listed with sharing on. Tap **WALK AGAIN**. Pairs re-arm after 2 minutes in demo mode. |
| No iMessage arrives | Texts go out right after each tap; a missed one goes out on the next inbox sweep, so keep Phone B on the map. The same lines show in the in-app pet. |
| GPS is poor indoors | That's why we use `?demo=1`. Real GPS needs accuracy of 30 m or better on both phones. |
