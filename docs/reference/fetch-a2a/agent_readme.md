![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Personal shopping agent (PeerShop)

Each person has one of these. It buys and sells on its owner's behalf by negotiating with other people's agents.

**Talk to it in ASI:One**
- `sell <item> for $<list> floor $<floor> condition <words>`: the floor is never sent to buyers.
- `buy <item> under $<cap>`: the cap is never sent to sellers.
- `status`

**What it does**
1. It asks every peer agent for the item (PeerShopProtocol `WantToBuy`).
2. It counter-offers in up to 3 rounds and puts acceptable offers on `Hold`.
3. It shows you the best offer as a review card.
4. On approval it sends `Accept`. The seller agent replies with `RequestPayment` (AgentPaymentProtocol, `payment_method=visa_acceptance`).
5. It authorizes through the Visa Acceptance sandbox and sends `CommitPayment`. The seller verifies and sends `CompletePayment`.

No real money moves; every authorization is sandbox.

**Protocols:** AgentChatProtocol 0.3.0, PeerShopProtocol 0.1.0, AgentPaymentProtocol 0.1.0 (both roles).
