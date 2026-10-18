"""local_demo — the whole story offline, three agents in one Bureau, no Base44, no Photon.

    python local_demo.py            # ~15 s, prints the transcript and every "iMessage"

Story: clock → Sep 20 → Button nudges Mina → "sell it" + photo → "yes" → listed $18.00
       → clock → Oct 18 → Mina meets Jo → Button & Pip talk (RelayProtocol) → proposal
       → both accept → Jo pays (demo) → flowers → romper in Jo's bag ♥♥♡.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from uagents import Agent, Bureau, Context
from uagents.registration import AgentRegistrationPolicy, BatchRegistrationPolicy

from closet_agent import ClosetBrain, attach
from mock_base44 import MockBase44

logging.basicConfig(level=os.environ.get("LOG", "WARNING"))
log = logging.getLogger("demo")


class _Offline(AgentRegistrationPolicy):
    """No Almanac calls: everything stays on localhost."""

    async def register(self, *a, **k):  # noqa: D401
        return None


class _OfflineBatch(BatchRegistrationPolicy):
    async def register(self, *a, **k):
        return None

    def add_agent(self, *a, **k):
        return None


def make(parent: str, port: int, app: MockBase44) -> Agent:
    agent = Agent(name=f"{parent}-closet", seed=f"local-demo-{parent}", port=port, endpoint=[f"http://127.0.0.1:{port}/submit"],
                  mailbox=False, registration_policy=_Offline())
    attach(agent, ClosetBrain(app, parent, parent, app_url="http://localhost:5173"))
    return agent


def main() -> int:
    app = MockBase44()
    agents = {p: make(p, 8100 + i, app) for i, p in enumerate(("mina", "jo", "sam"), 1)}
    for p, a in agents.items():
        app.parents[p]["agentAddress"] = a.address  # what registerAgent would do
    bureau = Bureau(agents=list(agents.values()), port=8100, endpoint=["http://127.0.0.1:8100/submit"], registration_policy=_OfflineBatch())

    director = Agent(name="director", seed="local-demo-director", port=8099, endpoint=["http://127.0.0.1:8099/submit"], mailbox=False, registration_policy=_Offline())
    step = {"i": 0}

    def say(line: str) -> None:
        print(f"\n▶ {line}")

    def show_new_sms(since: int) -> int:
        for s in app.sent[since:]:
            print(f"   📱 {app.parents[s['parentId']]['pet']['name']} → {app.parents[s['parentId']]['name']}: {s['text']}" + (f"  [{s['imageUrl']}]" if s.get("imageUrl") else ""))
        return len(app.sent)

    seen = {"sms": 0}

    @director.on_interval(period=1.5)
    async def _script(ctx: Context):
        i = step["i"]
        step["i"] += 1
        if i == 1:
            say("Clock → Sep 20 (demoClock) — nudge scan finds the romper outgrown")
            app.set_clock("2026-09-20T12:00:00Z")
        elif i == 3:
            say('Mina texts "sell it"')
            app.push("mina", "imessage", {"text": "sell it", "photoUrls": []})
        elif i == 5:
            say("Mina sends a photo")
            app.push("mina", "imessage", {"text": "", "photoUrls": ["https://example.com/romper.jpg"]})
        elif i == 7:
            say('Mina: "yes"')
            app.push("mina", "imessage", {"text": "yes", "photoUrls": []})
        elif i == 9:
            say("Clock → Oct 18. Mina walks toward Jo … <25 m → encounter (updatePresence/demoWalk)")
            app.set_clock("2026-10-18T12:00:00Z")
            app.meet("mina", "jo")
        elif i == 13:
            enc = next(iter(app.encounters.values()))
            print(f"\n   💬 Encounter {enc['id']} status={enc['status']}")
            for t in enc["transcript"]:
                print(f"      {t['text']}")
            say('Both accept ("accept" over iMessage)')
            app.push("jo", "imessage", {"text": "accept", "photoUrls": []})
            app.push("mina", "imessage", {"text": "I accept", "photoUrls": []})
        elif i == 16:
            say("Jo pays (demo payment · no real charge)")
            prop = next(iter(app.proposals.values()))
            await app._api("payProposal", {"proposalId": prop["id"], "parentId": "jo"})
        elif i == 19:
            say("Sam tries to sell the 3rd-owner sun hat")
            app.push("sam", "imessage", {"text": "sell", "photoUrls": []})
        elif i == 21:
            romper = app.items["romper"]
            print(f"\n✅ romper owner={romper['currentOwnerId']} owners={romper['ownerCount']} status={romper['status']} fits until {romper['predictedOutgrowDate']}")
            prop = next(iter(app.proposals.values()))
            print(f"✅ proposal {prop['id']} status={prop['status']} price=${prop['snapshot']['priceCents']/100:.2f} source={prop['source']}")
            ok = romper["currentOwnerId"] == "jo" and romper["ownerCount"] == 2 and prop["status"] == "paid" and prop["snapshot"]["priceCents"] == 1800
            print("\nLOCAL DEMO", "PASS" if ok else "FAIL")
            os._exit(0 if ok else 1)
        seen["sms"] = show_new_sms(seen["sms"])

    bureau.add(director)
    bureau.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
