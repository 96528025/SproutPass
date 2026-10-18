"""Offline end-to-end test: three people's agents + a stand-in for ASI:One.

Runs everything in one process (Bureau = local message dispatch, no network):
  carol sells a Fellow Stagg kettle, bob sells a Stagg EKG kettle,
  alice asks her agent to buy a stagg kettle under $90.
The 'owner' agent plays the three humans in ASI:One and taps Approve on the review card.

python local_demo.py
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Bureau, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement, ChatMessage, MetadataContent, TextContent, chat_protocol_spec,
)

from personal_agent import build_agent

alice = build_agent("alice", "peershop-demo-alice")
bob = build_agent("bob", "peershop-demo-bob")
carol = build_agent("carol", "peershop-demo-carol")
everyone = [alice, bob, carol]
for a in everyone:
    a.set_peers([p.address for p in everyone])

# Stand-in for ASI:One: one chat client that is the 'owner' of all three agents.
owner = Agent(name="asi-one-standin", seed="peershop-demo-owner")
chat = Protocol(spec=chat_protocol_spec)
names = {alice.address: "alice", bob.address: "bob", carol.address: "carol"}
script = [
    (carol.address, "sell Fellow Stagg EKG kettle for $95 floor $70 condition used twice, box included"),
    (bob.address, "sell Stagg EKG electric pour-over kettle for $120 floor $80 condition 1 year, light scratches"),
    (alice.address, "buy a stagg kettle under $90"),
]
step = {"i": 0}


def say(text: str) -> ChatMessage:
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                       content=[TextContent(type="text", text=text)])


@owner.on_interval(period=1.0)
async def drive(ctx: Context):
    if step["i"] < len(script):
        dest, text = script[step["i"]]
        step["i"] += 1
        print(f"\n[{names[dest]} -> own agent] {text}")
        await ctx.send(dest, say(text))


@chat.on_message(ChatMessage)
async def from_agent(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc),
                                               acknowledged_msg_id=msg.msg_id))
    who = names.get(sender, sender[:12])
    for c in msg.content:
        if isinstance(c, TextContent):
            print(f"[{who}'s agent -> {who}] {c.text}")
        elif isinstance(c, MetadataContent) and c.metadata.get("card_kind") == "review":
            card = json.loads(c.metadata["card_payload"])
            print(f"[{who}'s agent -> {who}] REVIEW CARD: {card['title']}")
            for row in card["summary_rows"]:
                print(f"      {row['label']}: {row['value']}")
            print(f"[{who} taps] {card['approve_cta']['label']}")
            await ctx.send(sender, say(json.dumps(card["approve_cta"]["selection"])))


@chat.on_message(ChatAcknowledgement)
async def ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


owner.include(chat)

if __name__ == "__main__":
    Bureau(agents=[*everyone, owner]).run()
