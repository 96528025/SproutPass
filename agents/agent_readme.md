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
| `sell` / `keep` / `later` | answer an outgrow nudge |
| *(photo)* | I suggest a condition → `yes` lists it at the fixed price |
| `accept` / `decline` | decide a trade proposal (both sides must accept) |
| `pay` | demo payment · no real charge |
| `help` | this list |

Pricing is fixed and visible: 2nd owner pays **60 %** of the original price, 3rd owner **40 %**,
and a 3rd owner is the item's **final home** (no selling).

## Protocols

- **AgentChatProtocol** (ASI:One) with Interactive Cards: nudges are `detail` cards, proposals are `review` cards.
- **HandMeDownRelay 0.1.0** (agent ↔ agent): `LookingFor → HaveListings | NoFit → ProposeTrade → TradeAck`.
  Only *shared* listings, *shared* needs and the child's age in months cross the wire — never names, phones, birth dates or coordinates.

## Links

- App: `https://<slug>.base44.app`
- Repo: `hand-me-down-relay/agents/`
