# CHANGELOG — Part C (for independent verification)

## 2026-10-17 · v1 — first complete drop

### Added (all new files; nothing of A's or B's touched)

| file | what | verified by |
|---|---|---|
| `base44/functions/_lib/geo.ts` | haversine, bearing, bands, `stepToward`, encounter rule (≤25 m, acc ≤30 m, simulated skip), constants | `c_test.ts` |
| `base44/functions/_lib/auth.ts` | caller resolution (app / `x-agent-key` / `?k=` webhook), `secrets` with `Deno.env` fallback, `handle()` JSON wrapper, `Setting` helpers | `deno check` |
| `base44/functions/_lib/encounter.ts` | `detectEncounters` (fresh+discoverable, re-arm >40 m, cooldown 10/2 min, one open per pair, inbox rows with role), `runLocalFallback` (8 s / `matchVia:"local"`, both directions, template transcript, `no_match`) | `deno check`; logic mirrored in `mock_base44.meet` |
| `base44/functions/_lib/photon.ts` | Photon 2.0 client: users/spaces/messages/attachments (multipart/related)/webhooks + tolerant `parseInbound`, `normalizePhone` | `c_test.ts` (parse); paths ⚠️ unverified, see README-C |
| `base44/functions/_lib/imessage.ts` | `sendToParent`: PetLine mirror, `Setting.imessage` gate, SEED_PHONES allow-list, lineUserId guard, cached Photon ids, optional image | `deno check` |
| `base44/functions/_lib/wording.ts` | pet voice templates + intent parser (twin of `agents/wording.py` / `intents.py`) | `c_test.ts` |
| `base44/functions/_lib/inboxFallback.ts` | template agent: answers any inbox row pending >5 s (nudge/proposal/trade events, owner conversation incl. photo→condition→list) | `deno check` |
| `base44/functions/_lib/match.c-stub.ts` | stand-in for B's `match.ts` with the agreed signatures | `deno check` |
| `base44/functions/_lib/c_test.ts` | 5 unit tests | `deno test` ✅ |
| `base44/functions/updatePresence/entry.ts` | upsert presence → detect → local fallback → inbox sweep | `deno check` |
| `base44/functions/listNearby/entry.ts` | bands + 5°-rounded bearing, discoverable symmetry | `deno check` |
| `base44/functions/demoWalk/entry.ts` | 5 m step toward target, 120 m reset, parks target on a demo lawn | `deno check`, `c_test` (19–20 steps) |
| `base44/functions/photonWebhook/entry.ts` | parse → parent by phone → attachments→UploadFile → lineUserId → inbox; dedupe by messageId | `deno check` |
| `base44/functions/sendImessage/entry.ts` | thin wrapper over `sendToParent` | `deno check` |
| `base44/functions/agentApi/entry.ts` | 15 actions (incl. `lookupParent`, `registerAgent`, `noMatch` beyond the brief) | `deno check` |
| `agents/relay_protocol.py` | `LookingFor/HaveListings/NoFit/ProposeTrade/TradeAck`, protocol `HandMeDownRelay 0.1.0` | pytest |
| `agents/closet_agent.py` | `ClosetBrain` (pure logic) + `attach()` (uAgents wiring: inbox loop, relay handlers, chat protocol + cards, claim) + CLI | pytest + local_demo |
| `agents/base44_client.py` | aiohttp client with retry; method per agentApi action | local_demo (mock subclass) |
| `agents/intents.py`, `agents/wording.py`, `agents/cards.py` | parsing, voice, ASI:One card payloads | pytest |
| `agents/mock_base44.py` | in-memory app with B's rules condensed (60/40, max 3, two-sided accept, pay) | pytest + local_demo |
| `agents/local_demo.py` | Bureau of 3 agents + director, offline registration policy, exits 0 on PASS | ✅ PASS |
| `agents/tests/test_relay.py` | 32 tests | ✅ |
| `agents/{requirements.txt,Makefile,.env.example,agent_readme.md}` | tooling + Agentverse README with badges | — |
| `src/agent/{cApi.ts,useEncounter.ts,AgentBubbles.tsx,AgentPet.tsx,agent.css,index.ts}` | frontend | `tsc --strict` against stubs ✅ |
| `src/mocks/c.ts` | offline `base44` with a scripted encounter (`startMockEncounter()`) | `tsc` |
| `NEEDS.md`, `README-C.md` | requests + status | — |

### Deviations from the brief (deliberate)

- Added agentApi actions `lookupParent`, `registerAgent`, `noMatch` so agents need no hand-copied ids/addresses and can close a no-fit encounter.
- `demoWalk` creates a simulated presence for the *target* if it has none, so one laptop with two tabs works (brief only says "move the caller").
- Cooldown is keyed on the caller's `simulated` flag rather than a separate demo-mode setting (the only demo-mode signal the backend sees).
- Deno fallback keeps conversation state on `Parent.convo` (a requested field) instead of a new entity.
- `listNearby` rounds `bearingDeg` to 5°.

### Known gaps / to confirm

- Photon REST paths (see README-C "Hour 0 checklist") — the `openapi.json` and the `api.photon.codes` host were not reachable from this session's network; shapes follow the brief + photon.codes docs.
- Base44 nested-field filters are undocumented, so dedupe and lookups filter in JS after a 50-row fetch.
- `claimInbox` is not atomic (no compare-and-set in Base44); handlers are idempotent and the Deno sweep only takes rows >5 s old.
- AgentPaymentProtocol bonus not built.
- `ASI_OPEN=1` default lets unclaimed ASI:One users drive the parent's closet — fine for judging, set `0` for anything real.
