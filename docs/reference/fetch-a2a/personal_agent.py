"""One personal shopping agent per person.

The same file runs for every person (PERSON=alice, PERSON=bob, ...). Each agent:
  * talks to its OWNER through the Agent Chat Protocol (ASI:One, or any ACP client)
  * talks to OTHER PEOPLE'S AGENTS through PeerShopProtocol (protocol.py)
  * settles through AgentPaymentProtocol, as buyer and as seller
    (payment_method="visa_acceptance"; transaction_id = Visa sandbox authorization id)

Owner commands (plain text in ASI:One; swap the regexes for an LLM tool call later):
  sell <title> for $<list> floor $<floor> [condition <words>]
  buy <query> under $<cap>
  status
Review-card replies arrive as JSON ({"action": "approve_deal", "intent_id": ...})
when the owner @mentions the agent, or as prose when the ASI:One planner routed it.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from protocol import Accept, Counter, Hold, NoDeal, Offer, WantToBuy, shop_spec
from visa import visa_authorize, visa_verify

NEGOTIATION_WINDOW_S = 12          # finalize with whatever offers exist after this
BUYER_COUNTER_SCHEDULE = [0.60, 0.80, 0.95, 1.00]   # fraction of the private cap, per round
SELLER_MAX_ROUNDS = 3
STOPWORDS = {"the", "and", "for", "with", "used", "new", "a", "an", "my", "me", "some", "any"}


# ---------------------------------------------------------------- helpers

def now() -> float:
    return time.time()


def dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2 and t not in STOPWORDS}


def matches(query: str, title: str) -> bool:
    q = tokens(query)
    return bool(q) and len(q & tokens(title)) >= math.ceil(len(q) / 2)


def text_msg(text: str) -> ChatMessage:
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                       content=[TextContent(type="text", text=text)])


def card_msg(narration: str, kind: str, payload: dict) -> ChatMessage:
    """ASI:One Interactive Card: one text bubble + one MetadataContent block."""
    return ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=[
            TextContent(type="text", text=narration),
            MetadataContent(type="metadata", metadata={
                "card_protocol_version": "1",
                "requires_card_interaction": "true",
                "card_kind": kind,
                "card_payload": json.dumps(payload),
            }),
        ],
    )


def parse_selection(text: str) -> dict:
    try:
        sel = json.loads(text)
        return sel if isinstance(sel, dict) else {}
    except (ValueError, TypeError):
        pass
    sel: dict = {}
    m = re.search(r"(intent_[0-9a-f]{8})", text)
    if m:
        sel["intent_id"] = m.group(1)
    low = text.lower()
    if any(w in low for w in ("approve", "confirm", "buy it")):
        sel["action"] = "approve_deal"
    elif any(w in low for w in ("reject", "cancel", "decline")):
        sel["action"] = "reject_deal"
    return sel


SELL_RE = re.compile(
    r"sell\s+(?:my\s+)?(?P<title>.+?)\s+(?:for|at|list)\s+\$?(?P<list>\d+(?:\.\d+)?)"
    r"(?:.*?(?:floor|min(?:imum)?|lowest)\s+\$?(?P<floor>\d+(?:\.\d+)?))?"
    r"(?:.*?condition\s+(?P<cond>.+))?$", re.I)
BUY_RE = re.compile(
    r"(?:buy|find(?:\s+me)?|get(?:\s+me)?)\s+(?:a\s+|an\s+)?(?P<query>.+?)\s+"
    r"(?:under|below|max|up to)\s+\$?(?P<cap>\d+(?:\.\d+)?)", re.I)


# ---------------------------------------------------------------- agent factory

def build_agent(person: str, seed: str, peers: list[str] | None = None, **agent_kwargs) -> Agent:
    agent = Agent(name=f"{person}-shopper", seed=seed, **agent_kwargs)
    peer_list: list[str] = list(peers or [])

    chat = Protocol(spec=chat_protocol_spec)
    shop = Protocol(spec=shop_spec)
    pay_seller = Protocol(spec=payment_protocol_spec, role="seller")
    pay_buyer = Protocol(spec=payment_protocol_spec, role="buyer")

    # ---- storage accessors (ctx.storage is a JSON key-value store per agent)
    def get(ctx: Context, key: str, default):
        val = ctx.storage.get(key)
        return default if val is None else val

    def owner(ctx: Context) -> str | None:
        return ctx.storage.get("owner")

    async def tell_owner(ctx: Context, msg: ChatMessage) -> None:
        addr = owner(ctx)
        if addr:
            await ctx.send(addr, msg)
        else:
            ctx.logger.info(f"(no owner yet) {msg.content[0].text}")

    def set_peers(addresses: list[str]) -> None:
        peer_list[:] = [a for a in addresses if a and a != agent.address]

    agent.set_peers = set_peers  # used by local_demo.py after all addresses are known

    # ================================================================ OWNER <-> AGENT (Chat Protocol)

    @chat.on_message(ChatMessage)
    async def on_owner_message(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc),
                                                   acknowledged_msg_id=msg.msg_id))
        # First human to talk to this agent becomes its owner. Replace with a claim code
        # ("claim 4821") before letting judges talk to it.
        if not owner(ctx):
            ctx.storage.set("owner", sender)
        if sender != owner(ctx):
            await ctx.send(sender, text_msg(f"I'm {person}'s agent. Ask your own agent to message me."))
            return

        text = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
        if not text:
            return

        sel = parse_selection(text)
        if sel.get("action") in ("approve_deal", "reject_deal"):
            await handle_review(ctx, sel)
            return

        if m := SELL_RE.search(text):
            items = get(ctx, "inventory", {})
            item_id = f"item_{uuid4().hex[:6]}"
            list_c = int(float(m["list"]) * 100)
            floor_c = int(float(m["floor"]) * 100) if m["floor"] else int(list_c * 0.85)
            items[item_id] = {"title": m["title"].strip(), "list": list_c, "floor": floor_c,
                              "condition": (m["cond"] or "used, good").strip(), "sold": False}
            ctx.storage.set("inventory", items)
            await ctx.send(sender, text_msg(
                f"Listed '{m['title'].strip()}' at {dollars(list_c)}. I won't go below "
                f"{dollars(floor_c)}, and I never tell buyers that number."))
            return

        if m := BUY_RE.search(text):
            await start_intent(ctx, m["query"].strip(), int(float(m["cap"]) * 100))
            return

        if text.lower().startswith("status"):
            await ctx.send(sender, text_msg(json.dumps({
                "inventory": get(ctx, "inventory", {}),
                "intents": {k: {"status": v["status"], "query": v["query"]}
                            for k, v in get(ctx, "intents", {}).items()},
            }, indent=1)))
            return

        await ctx.send(sender, text_msg(
            "Try: 'sell <item> for $120 floor $80' or 'buy <item> under $90'."))

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    # ================================================================ BUYER SIDE

    async def start_intent(ctx: Context, query: str, cap_cents: int) -> None:
        intent_id = f"intent_{uuid4().hex[:8]}"
        opening = int(cap_cents * BUYER_COUNTER_SCHEDULE[0])
        intents = get(ctx, "intents", {})
        intents[intent_id] = {
            "query": query, "cap": cap_cents, "status": "negotiating", "created": now(),
            "peers": {p: {"state": "asked", "last_counter": opening} for p in peer_list},
            "candidates": {},          # peer -> {item_id, title, price, list, rounds, condition}
        }
        ctx.storage.set("intents", intents)
        await tell_owner(ctx, text_msg(
            f"Asking {len(peer_list)} agents for '{query}'. Your cap {dollars(cap_cents)} stays private; "
            f"opening at {dollars(opening)}."))
        for peer in peer_list:
            await ctx.send(peer, WantToBuy(intent_id=intent_id, query=query,
                                           opening_bid_cents=opening, buyer_name=person))

    def save_intent(ctx: Context, intent_id: str, intent: dict) -> None:
        intents = get(ctx, "intents", {})
        intents[intent_id] = intent
        ctx.storage.set("intents", intents)

    @shop.on_message(Offer)
    async def on_offer(ctx: Context, sender: str, msg: Offer):
        intent = get(ctx, "intents", {}).get(msg.intent_id)
        if not intent or intent["status"] != "negotiating":
            await ctx.send(sender, NoDeal(intent_id=msg.intent_id, reason="intent closed"))
            return
        peer = intent["peers"].setdefault(sender, {"state": "asked", "last_counter": 0})
        cap = intent["cap"]
        nxt = msg.round + 1
        next_counter = int(cap * BUYER_COUNTER_SCHEDULE[min(nxt, len(BUYER_COUNTER_SCHEDULE) - 1)])

        if msg.price_cents <= cap and (msg.final or msg.price_cents <= next_counter):
            intent["candidates"][sender] = {
                "item_id": msg.item_id, "title": msg.title, "price": msg.price_cents,
                "list": msg.list_price_cents, "rounds": msg.round, "condition": msg.condition}
            peer["state"] = "candidate"
            await ctx.send(sender, Hold(intent_id=msg.intent_id, item_id=msg.item_id,
                                        reason="acceptable; waiting for my owner's approval"))
        elif msg.final or nxt >= len(BUYER_COUNTER_SCHEDULE):
            peer["state"] = "done"
            await ctx.send(sender, NoDeal(intent_id=msg.intent_id, reason="above my limit"))
        else:
            counter = max(next_counter, peer["last_counter"] + 1)
            peer["last_counter"] = counter
            peer["state"] = "countering"
            await ctx.send(sender, Counter(intent_id=msg.intent_id, item_id=msg.item_id,
                                           price_cents=counter, round=nxt))
        save_intent(ctx, msg.intent_id, intent)
        if all(p["state"] in ("candidate", "done") for p in intent["peers"].values()):
            await finalize(ctx, msg.intent_id)

    @shop.on_message(NoDeal)
    async def on_no_deal(ctx: Context, sender: str, msg: NoDeal):
        intents = get(ctx, "intents", {})
        intent = intents.get(msg.intent_id)
        if intent and sender in intent["peers"] and intent["status"] == "negotiating":
            intent["peers"][sender]["state"] = "done"
            save_intent(ctx, msg.intent_id, intent)
            if all(p["state"] in ("candidate", "done") for p in intent["peers"].values()):
                await finalize(ctx, msg.intent_id)
        # seller side: buyer walked away
        holds = get(ctx, "holds", {})
        if msg.intent_id in holds:
            holds.pop(msg.intent_id)
            ctx.storage.set("holds", holds)

    @agent.on_interval(period=2.0)
    async def sweep(ctx: Context):
        for intent_id, intent in get(ctx, "intents", {}).items():
            if intent["status"] == "negotiating" and now() - intent["created"] > NEGOTIATION_WINDOW_S:
                await finalize(ctx, intent_id)

    async def finalize(ctx: Context, intent_id: str) -> None:
        intent = get(ctx, "intents", {})[intent_id]
        if intent["status"] != "negotiating":
            return
        cands = intent["candidates"]
        if not cands:
            intent["status"] = "no_offers"
            save_intent(ctx, intent_id, intent)
            await tell_owner(ctx, text_msg(f"No agent offered '{intent['query']}' under your cap."))
            return
        winner_addr, best = min(cands.items(), key=lambda kv: kv[1]["price"])
        intent["status"] = "awaiting_owner"
        intent["winner"] = winner_addr
        save_intent(ctx, intent_id, intent)
        others = sorted((c["price"] for a, c in cands.items() if a != winner_addr))
        await tell_owner(ctx, card_msg(
            f"{len(cands)} of {len(intent['peers'])} agents made offers under your cap. Best one:",
            "review",
            {
                "title": f"Buy: {best['title']}",
                "summary_rows": [
                    {"label": "Price", "value": f"{dollars(best['price'])} (listed {dollars(best['list'])})"},
                    {"label": "Condition", "value": best["condition"]},
                    {"label": "Seller agent", "value": winner_addr[:16] + "…"},
                    {"label": "Negotiation", "value": f"{best['rounds']} counter round(s)"},
                    {"label": "Other offers", "value": ", ".join(dollars(p) for p in others) or "none"},
                    {"label": "Your cap", "value": dollars(intent["cap"])},
                    {"label": "Payment", "value": "Visa sandbox authorization, no real money"},
                ],
                "approve_cta": {"label": f"Buy for {dollars(best['price'])}", "primary": True,
                                "selection": {"action": "approve_deal", "intent_id": intent_id}},
                "reject_cta": {"label": "Not now",
                               "selection": {"action": "reject_deal", "intent_id": intent_id}},
            }))

    async def handle_review(ctx: Context, sel: dict) -> None:
        intents = get(ctx, "intents", {})
        intent_id = sel.get("intent_id") or next(
            (k for k, v in intents.items() if v["status"] == "awaiting_owner"), None)
        intent = intents.get(intent_id) if intent_id else None
        if not intent or intent["status"] != "awaiting_owner":
            await tell_owner(ctx, text_msg("Nothing is waiting for your approval."))
            return
        winner = intent["winner"]
        losers = [a for a in intent["candidates"] if a != winner]
        if sel["action"] == "reject_deal":
            intent["status"] = "rejected"
            save_intent(ctx, intent_id, intent)
            for a in intent["candidates"]:
                await ctx.send(a, NoDeal(intent_id=intent_id, reason="buyer declined"))
            await tell_owner(ctx, text_msg("Okay, dropped it. Every seller agent was told."))
            return
        best = intent["candidates"][winner]
        intent["status"] = "accepted"
        save_intent(ctx, intent_id, intent)
        await ctx.send(winner, Accept(intent_id=intent_id, item_id=best["item_id"], price_cents=best["price"]))
        for a in losers:
            await ctx.send(a, NoDeal(intent_id=intent_id, reason="buyer chose another offer"))

    # ---- payment, buyer role
    @pay_buyer.on_message(RequestPayment)
    async def on_request_payment(ctx: Context, sender: str, msg: RequestPayment):
        intent = get(ctx, "intents", {}).get(msg.reference or "")
        funds = next((f for f in msg.accepted_funds if f.payment_method == "visa_acceptance"), None)
        if not intent or intent["status"] != "accepted" or sender != intent["winner"] or not funds:
            await ctx.send(sender, RejectPayment(reason="no approved deal matches this request"))
            return
        amount_c = int(round(float(funds.amount) * 100))
        agreed = intent["candidates"][sender]["price"]
        if amount_c != agreed or amount_c > intent["cap"]:
            await ctx.send(sender, RejectPayment(reason=f"amount {amount_c} != agreed {agreed} or over cap"))
            return
        auth_id = await visa_authorize(amount_c, reference=msg.reference, description=msg.description or "")
        intent["status"] = "committed"
        intent["auth_id"] = auth_id
        save_intent(ctx, msg.reference, intent)
        await ctx.send(sender, CommitPayment(
            funds=funds, recipient=msg.recipient, transaction_id=auth_id,
            reference=msg.reference, description=msg.description,
            metadata={"rail": "visa_acceptance_sandbox", "capture": "false"}))

    @pay_buyer.on_message(CompletePayment)
    async def on_complete(ctx: Context, sender: str, msg: CompletePayment):
        for intent_id, intent in get(ctx, "intents", {}).items():
            if intent.get("auth_id") == msg.transaction_id:
                intent["status"] = "paid"
                save_intent(ctx, intent_id, intent)
                best = intent["candidates"][sender]
                await tell_owner(ctx, text_msg(
                    f"Bought {best['title']} for {dollars(best['price'])} "
                    f"(listed {dollars(best['list'])}). Visa sandbox authorization {msg.transaction_id}. "
                    f"No real money moved."))

    @pay_buyer.on_message(CancelPayment)
    async def on_cancel(ctx: Context, sender: str, msg: CancelPayment):
        await tell_owner(ctx, text_msg(f"Seller agent cancelled: {msg.reason}"))

    # ================================================================ SELLER SIDE

    @shop.on_message(WantToBuy)
    async def on_want(ctx: Context, sender: str, msg: WantToBuy):
        items = get(ctx, "inventory", {})
        hit = next(((iid, it) for iid, it in items.items()
                     if not it["sold"] and matches(msg.query, it["title"])), None)
        if not hit:
            await ctx.send(sender, NoDeal(intent_id=msg.intent_id, reason="nothing matching"))
            return
        item_id, item = hit
        holds = get(ctx, "holds", {})
        holds[msg.intent_id] = {"buyer": sender, "item_id": item_id, "last_offer": item["list"]}
        ctx.storage.set("holds", holds)
        await ctx.send(sender, Offer(intent_id=msg.intent_id, item_id=item_id, title=item["title"],
                                     condition=item["condition"], list_price_cents=item["list"],
                                     price_cents=item["list"], round=0))

    @shop.on_message(Counter)
    async def on_counter(ctx: Context, sender: str, msg: Counter):
        holds = get(ctx, "holds", {})
        hold = holds.get(msg.intent_id)
        item = get(ctx, "inventory", {}).get(msg.item_id)
        if not hold or hold["buyer"] != sender or not item or item["sold"]:
            await ctx.send(sender, NoDeal(intent_id=msg.intent_id, reason="no longer available"))
            return
        floor, last = item["floor"], hold["last_offer"]
        if msg.price_cents >= last:
            price = last
        elif msg.round >= 2 and msg.price_cents >= floor:
            price = msg.price_cents                       # meet the buyer, still above floor
        else:
            price = max(floor, math.ceil((last + msg.price_cents) / 2))
        final = price == floor or msg.round >= SELLER_MAX_ROUNDS or price == msg.price_cents
        hold["last_offer"] = price
        ctx.storage.set("holds", holds)
        await ctx.send(sender, Offer(intent_id=msg.intent_id, item_id=msg.item_id, title=item["title"],
                                     condition=item["condition"], list_price_cents=item["list"],
                                     price_cents=price, round=msg.round, final=final))

    @shop.on_message(Hold)
    async def on_hold(ctx: Context, sender: str, msg: Hold):
        ctx.logger.info(f"buyer {sender[:14]}… holding {msg.item_id}: {msg.reason}")

    @shop.on_message(Accept)
    async def on_accept(ctx: Context, sender: str, msg: Accept):
        hold = get(ctx, "holds", {}).get(msg.intent_id)
        item = get(ctx, "inventory", {}).get(msg.item_id)
        if not hold or hold["buyer"] != sender or not item or item["sold"] \
                or msg.price_cents != hold["last_offer"] or msg.price_cents < item["floor"]:
            await ctx.send(sender, NoDeal(intent_id=msg.intent_id, reason="accept does not match my offer"))
            return
        await ctx.send(sender, RequestPayment(
            accepted_funds=[Funds(amount=f"{msg.price_cents / 100:.2f}", currency="USD",
                                  payment_method="visa_acceptance")],
            recipient=ctx.agent.address,
            deadline_seconds=300,
            reference=msg.intent_id,
            description=item["title"],
            metadata={"item_id": msg.item_id},
        ))

    # ---- payment, seller role
    @pay_seller.on_message(CommitPayment)
    async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
        holds = get(ctx, "holds", {})
        hold = holds.get(msg.reference or "")
        items = get(ctx, "inventory", {})
        amount_c = int(round(float(msg.funds.amount) * 100))
        if not hold or hold["buyer"] != sender or amount_c != hold["last_offer"] \
                or not await visa_verify(msg.transaction_id, amount_c):
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="verification failed"))
            return
        items[hold["item_id"]]["sold"] = True
        ctx.storage.set("inventory", items)
        holds.pop(msg.reference)
        ctx.storage.set("holds", holds)
        await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))
        await tell_owner(ctx, text_msg(
            f"Sold {items[hold['item_id']]['title']} for {dollars(amount_c)} "
            f"(floor was {dollars(items[hold['item_id']]['floor'])}). Visa sandbox auth {msg.transaction_id}."))

    @pay_seller.on_message(RejectPayment)
    async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
        ctx.logger.info(f"buyer rejected payment request: {msg.reason}")

    # publish_manifest=True puts the protocol on Agentverse so ASI:One and other
    # agents can see which messages this agent speaks
    agent.include(chat, publish_manifest=True)
    agent.include(shop, publish_manifest=True)
    agent.include(pay_seller, publish_manifest=True)
    agent.include(pay_buyer, publish_manifest=True)
    return agent


# ---------------------------------------------------------------- run one person's agent

if __name__ == "__main__":
    person = os.environ["PERSON"]                                   # alice
    seed = os.environ.get("AGENT_SEED", f"lahacks-peershop-{person}-change-me")
    peers = [p.strip() for p in os.environ.get("PEERS", "").split(",") if p.strip()]
    port = int(os.environ.get("PORT", "8100"))
    a = build_agent(
        person, seed, peers,
        port=port,
        mailbox=True,                                 # reachable through Agentverse; no public IP needed
        readme_path=os.path.join(os.path.dirname(__file__), "agent_readme.md"),
        description=f"{person}'s personal shopping agent. Buys and sells for {person} by negotiating "
                    f"with other people's agents; pays with a Visa sandbox authorization.",
        publish_agent_details=True,
    )
    print(f"{person}'s agent address: {a.address}")
    a.run()
