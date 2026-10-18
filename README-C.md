# Part C — Agents & Messages

Everything that talks: GPS encounters, iMessage (Photon 2.0), the Fetch.ai closet agents,
ASI:One cards, and the in-app pet's voice. Scope restated:

1. `base44/functions/_lib/{geo,auth,photon,encounter,imessage,inboxFallback,wording}.ts`
2. `base44/functions/{updatePresence,listNearby,demoWalk,photonWebhook,sendImessage,agentApi}/entry.ts`
3. `agents/` — Python 3.11+ uAgents: `closet_agent.py` (+ `relay_protocol`, `base44_client`, `intents`, `wording`, `cards`, `mock_base44`, `local_demo`, `tests/`)
4. `src/agent/{AgentPet,AgentBubbles,useEncounter,cApi}.tsx|ts` + `src/mocks/c.ts`
5. `NEEDS.md` (requests to A and B), this file.

## Status — what works, what's mocked, what's unverified

| | state |
|---|---|
| `deno check` on all six functions + `_lib` | ✅ passes (with the `match.c-stub.ts` standing in for B's `match.ts`) |
| `deno test _lib/c_test.ts` (geo, bands, encounter rule, Photon parse, intents) | ✅ 5/5 |
| `pytest agents/tests` (intents, cards, nudge→list, relay flow, two-sided accept, decline = $0, 3rd owner can't sell) | ✅ 32/32 |
| `python agents/local_demo.py` — whole story offline in a Bureau | ✅ PASS (~35 s) |
| Base44 deploy | ⏳ needs the project from Hour 0 (`base44 create`), then `base44 deploy` |
| Photon REST paths (`/users`, `/spaces`, `/attachments`, `/webhooks/*`) | ⚠️ from the brief; **confirm at Hour 0** (see below). Auth header, message body, `idempotency-key`, `apiVersion 2026-07-01` are confirmed from photon.codes docs. |
| Agentverse / ASI:One | ⏳ `mailbox=True` + Inspector link once agents run with real keys |
| B's `findMatches`/`predictOutgrow`, `createProposal`, `getCloset` … | 🧪 mocked (`match.c-stub.ts`, `mock_base44.py`) |
| A's `DialogBox`, `Sprite` | 🧪 imported by name/props from Part D; `tsc` passed against stubs |

## Hour 0 checklist (C)

```bash
# 1. Photon: confirm the REST paths the brief assumes (spec too big to read in-session)
curl -s https://api.photon.codes/openapi.json | jq '.paths | keys'
curl -s https://api.photon.codes/openapi.json | jq '.components.securitySchemes'
#    → if a path differs, edit the one constant in base44/functions/_lib/photon.ts `paths`

# 2. Base44 secrets (app settings → environment variables)
AGENT_KEY, WEBHOOK_KEY, PHOTON_API_KEY, PHOTON_PROJECT_ID, SEED_PHONES, APP_HOST

# 3. Webhook destination (Photon dashboard, or the helper in photon.ts `registerWebhook`)
url  = https://<slug>.base44.app/functions/photonWebhook?k=<WEBHOOK_KEY>
apiVersion = 2026-07-01, enabledEvents = ["message.received"]

# 4. Both demo phones text the line "hi"  → Setting.lineUserId gets saved by photonWebhook

# 5. Agents
cd agents && cp .env.example .env && $EDITOR .env && make install
make addresses          # print the three addresses (TEAM_SECRET fixes them) → B's seed
make mina  # make jo / make sam in two more terminals; each prints its Inspector link → connect Mailbox
```

If B's `_lib/match.ts` isn't merged yet: `cp base44/functions/_lib/match.c-stub.ts base44/functions/_lib/match.ts`.

## How the pieces fit

```
phone GPS ──updatePresence (3 s)──▶ Presence (server-only) ──detectEncounters──▶ Encounter{talking}
                                                                     └──▶ AgentInbox{encounter} ×2
                 ┌──────────── claimInbox (1 s) ─────────────┐
   Python agent (buyer side) ── LookingFor ──▶ Python agent (seller side)
        ◀── HaveListings / NoFit ──┘        every turn → agentApi appendTurn → Encounter.transcript → AgentBubbles
        ── ProposeTrade ──▶   ◀── TradeAck ──
        └── agentApi createProposal ──▶ B's createProposal ──▶ MatchProposal (both phones + both iMessage threads)
   8 s without a proposal, or Setting.matchVia="local"  ──▶ runLocalFallback (B's findMatches, source:"local")

iMessage ──Photon webhook──▶ photonWebhook ──▶ AgentInbox{imessage} ──▶ agent ──▶ sendImessage ──▶ Photon
            5 s unclaimed ──▶ inboxFallback.ts answers with the same wording (no LLM needed)
```

Design decisions worth knowing:

- **Two clocks.** Presence TTL, cooldown, the 8 s / 5 s fallbacks use the real clock; everything about the story (outgrow dates, `wearWeeksLeft`) reads `Setting.now` through B's `_lib`. Otherwise a frozen story date would make every presence look stale.
- **Who speaks first.** Both agents learn the same encounter at the same time; the parent with the lexically smaller id is the buyer side and opens with `LookingFor`. No handshake needed. (`useEncounter().myRole` uses the same rule.)
- **Cooldown.** 2 min when the caller's position is simulated (demo), 10 min otherwise.
- **Privacy on the wire.** `getState(peerOf=…)` strips to shared listings, shared needs, child age in months; `listNearby` rounds bearings to 5° and never returns distance beyond the band. A test asserts no birth date / name / coordinates in relay messages.
- **Wording lives twice** (`_lib/wording.ts` ↔ `agents/wording.py`) on purpose: the Deno fallback must sound exactly like the Python pet. Change both.
- **ASI:One cards**: nudge = `detail` (Pass it on / Still fits / Later), proposal = `review` (Accept / Decline), pay = `review`. Replies are parsed `json.loads` first, then prose. `claim mina-<last4>` binds a chat; `ASI_OPEN=1` (default) also lets judges chat without claiming.

## Running the agents live

```bash
cd agents
make mina      # Agent(name="mina-closet", seed="relay-mina-$TEAM_SECRET", port=8101, mailbox=True)
```

On startup each agent calls `agentApi registerAgent` so `Parent.agentAddress` is filled automatically; `lookupParent` resolves the Base44 id from the name (or set `PARENT_ID_MINA` etc.).

## Submission notes (Fetch)

- README: paste the three addresses from `make addresses`, Agentverse profile URLs, the ASI:One shared-chat URL.
- Submission Agent on ASI:One: `@fetch-submission` — team lead creates the team, others join with the Team ID.
- Bonus (not built): AgentPaymentProtocol wrapper around `payProposal` with `payment_method="demo_mock"`.
