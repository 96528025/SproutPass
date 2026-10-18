# PeerShop: one Fetch.ai agent per person, agents trade with each other

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Every person gets the same agent code with a different seed, which gives each person a different agent address.

| Channel | Protocol | Who is on each end |
|---|---|---|
| Owner ↔ own agent | AgentChatProtocol 0.3.0 (ASI:One, Interactive Cards) | a human and their agent |
| Agent ↔ agent | PeerShopProtocol 0.1.0 (`protocol.py`, ours) | buyer agent and seller agent |
| Settlement | AgentPaymentProtocol 0.1.0 (`uagents_core`), both roles on every agent | seller agent invoices, buyer agent pays |
| Money | Visa Acceptance sandbox authorization (`capture:false`) through your own server (`visa.py`) | buyer agent → your server → Cybersource |

## Message sequence

```
Alice (ASI:One)      Alice's agent                 Bob's agent / Carol's agent        Bob, Carol (ASI:One)
     | "buy stagg kettle under $90"                                                    | "sell ... for $95 floor $70"
     |------------------>|                                                             |-------->|
     |                   |--WantToBuy(query, opening_bid=$54)--> every peer            |
     |                   |<--Offer(round 0, list price) | NoDeal("nothing matching")   |
     |                   |--Counter($72, round 1)------->                              |
     |                   |<--Offer($83.50, round 1)       seller: max(floor, midpoint)  |
     |                   |--Hold("waiting for my owner")->                              |
     |  review card      |   (all peers answered, or a 12 s window)                    |
     |<------------------|   cheapest offer under the cap wins                         |
     | tap "Buy $83.50"  |                                                             |
     |------------------>|--Accept(item, $83.50)-------> winner; NoDeal --> the others |
     |                   |<--RequestPayment(visa_acceptance, USD 83.50, ref=intent)     |
     |                   |  POST your /visa/authorize -> processorId                   |
     |                   |--CommitPayment(transaction_id=processorId)-->               |
     |                   |                              GET /visa/verify -> AUTHORIZED |
     |                   |<--CompletePayment(transaction_id)                           |
     | "Bought for $83.50"                               "Sold for $83.50" ----------->|
```

Private numbers stay with their owner's agent:
- The buyer's cap and the seller's floor are never in a message.
- Only offers and counters go over the wire.

## Files

```
fetch-a2a/
├─ protocol.py        PeerShopProtocol models + ProtocolSpecification (identical on every agent)
├─ personal_agent.py  build_agent(): chat + PeerShop + payment(seller) + payment(buyer); __main__ runs one person
├─ visa.py            visa_authorize / visa_verify → your server; simulated when env vars are unset
├─ local_demo.py      offline test: alice, bob, carol + an ASI:One stand-in in one Bureau
├─ agent_readme.md    published to the agent's Agentverse profile (badges, commands)
└─ README.md
```

## 1. Offline test (no network, ~10 s)

```bash
pip install "uagents>=0.25.5"          # tested: uagents 0.26.1, uagents-core 0.4.12, Python 3.13
python local_demo.py
```

Expected output (abridged):

```
[alice's agent -> alice] Asking 2 agents for 'stagg kettle'. Your cap $90.00 stays private; opening at $54.00.
[alice's agent -> alice] REVIEW CARD: Buy: Fellow Stagg EKG kettle
      Price: $83.50 (listed $95.00)   Other offers: $85.50   Your cap: $90.00
[carol's agent -> carol] Sold Fellow Stagg EKG kettle for $83.50 (floor was $70.00). Visa sandbox auth SIMULATED-…
[alice's agent -> alice] Bought Fellow Stagg EKG kettle for $83.50 (listed $95.00). …
```

## 2. Real deployment (each person's agent reachable from ASI:One)

One process per person. Each process can run on any laptop or on one Railway box with different ports. `mailbox=True` means no public IP is needed: Agentverse holds messages.

```bash
# 1. print the addresses (deterministic from seeds)
python -c "from uagents import Agent; [print(p, Agent(seed=f'lahacks-peershop-{p}-SECRET').address) for p in ['alice','bob','carol']]"

# 2. start each person's agent with the other addresses as PEERS
PERSON=alice AGENT_SEED=lahacks-peershop-alice-SECRET PORT=8101 PEERS=agent1…bob,agent1…carol python personal_agent.py
PERSON=bob   AGENT_SEED=lahacks-peershop-bob-SECRET   PORT=8102 PEERS=agent1…alice,agent1…carol python personal_agent.py
PERSON=carol AGENT_SEED=lahacks-peershop-carol-SECRET PORT=8103 PEERS=agent1…alice,agent1…bob python personal_agent.py

# 3. each log prints "Agent inspector available at https://agentverse.ai/inspect/?…"
#    open it, Connect → Mailbox (once per agent)
```

4. In ASI:One: open the agent's Agentverse profile and use "Chat with agent", or @mention it. The first account that messages an agent becomes its owner (see Limits).

5. Connect Visa: set `VISA_AUTH_URL`, `VISA_VERIFY_URL` and `VISA_SERVER_TOKEN` to two routes on your existing Hono server. That server already signs Cybersource requests; reuse the same signer.
   - `/visa/authorize` → `POST /pts/v2/payments` with `capture:false`.
   - `/visa/verify` → `GET /pts/v2/payments/{id}`.

How agents find each other:
- Now: `PEERS` env.
- Next options:
  - a registry agent that every personal agent `Register`s with on startup, or
  - an Agentverse search for agents that publish the PeerShopProtocol manifest (every agent calls `include(..., publish_manifest=True)`).

## 3. Checks to run in the first 30 minutes

1. **Delayed message.** The review card arrives 2–12 s after "buy …". Confirm ASI:One renders an agent message sent after the reply turn. If not, make "buy" reply immediately with "negotiating…", then have the owner send `status`, which returns the card.
2. **Stable sender.** Confirm ASI:One's sender address is stable per user across new chats. If not, add `claim <code>` to bind the owner instead of first-sender.
3. **Card JSON.** Paste the review payload from `finalize()` into asi1.ai/developer/card-playground.
4. **Mailbox delivery.** Run two laptops on different networks. The negotiation still completes over mailbox; expect each hop to be slower than local.

## Limits (say them before judges find them)

- Owner binding is first-sender. Add a claim code before judges message the agents.
- Matching is token overlap on titles. Swap in Gemini or ASI1 tool calling for parsing and embeddings for matching.
- The negotiation policy is deterministic:
  - buyer counters at 60/80/95/100% of the cap
  - seller answers with max(floor, midpoint) and meets the buyer at round ≥ 2
  - an LLM can phrase the reasons, but must not set prices.
- Seller sales are auto-approved at or above the floor. Add a seller review card if the owner wants to confirm each sale.
- `handle_messages_concurrently=False` (the default) keeps `ctx.storage` read-modify-write safe. Keep it.
