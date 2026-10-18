"""local_demo — the whole story offline: three agents in one Bureau, no Base44, no Photon.

    python local_demo.py              # ~35 s, prints every pet line and the pets' conversation, ends PASS/FAIL
    python local_demo.py --jo-first   # same, with Jo's parent id sorting first (Jo's pet opens the encounter)

It runs the SAME wiring as live_bureau.py (build_bureau + InboxHub: one claimInbox for all three agents) against
MockBase44, which answers like the real app (B's handlers, InboxEvent payloads, opaque parent ids).

Story: clock → Sep 20 → Button nudges Mina → "sell it" + photo → "yes" → listed $18.00
       → clock → Oct 18 → Mina meets Jo → Button & Pip talk (RelayProtocol; on live Mina's pet opens and the
         roles swap, since Jo has the need) → proposal → both accept → Jo pays (demo) → flowers
       → romper in Jo's bag ♥♥♡ → Sam can't sell a 3rd-owner cardigan.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

from uagents import Agent, Context

from live_bureau import OfflinePolicy, build_bureau
from mock_base44 import DEFAULT_IDS, MockBase44

log = logging.getLogger("demo")
PARENTS = ("mina", "jo", "sam")
APP_URL = "http://localhost:5173"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jo-first", action="store_true", help="give Jo the smaller parent id (Jo's pet opens)")
    ap.add_argument("--port", type=int, default=8100)
    a = ap.parse_args(argv)
    logging.basicConfig(level=os.environ.get("LOG", "WARNING"))
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)  # pet lines have ♥ and emoji; Windows consoles

    app = MockBase44(ids={"mina": DEFAULT_IDS["jo"], "jo": DEFAULT_IDS["mina"]} if a.jo_first else None)
    parents = {k: {"id": app.id(k), "name": app.parents[app.id(k)]["name"], "pet": app.parents[app.id(k)]["pet"]["name"]} for k in PARENTS}
    bureau, agents, brains, hub = build_bureau(
        app, parents, app_url=APP_URL, seeds={p: f"local-demo-{p}" for p in PARENTS}, port=a.port,
        poll_s=0.5, fast_s=0.5, tick_s=0.5, append_turns=True, peer_wait_s=5.0,
    )
    for k, ag in agents.items():
        app.parents[app.id(k)]["agentAddress"] = ag.address  # what registerAgent does on live

    director = Agent(name="director", seed="local-demo-director", mailbox=False, registration_policy=OfflinePolicy(),
                     publish_agent_details=False, enable_agent_inspector=False)
    step = {"i": 0}
    seen = {"sms": 0}
    name = {app.id(k): k for k in PARENTS}

    def say(line: str) -> None:
        print(f"\n▶ {line}")

    def show_new_lines() -> None:
        for s in app.sent[seen["sms"]:]:
            p = app.parents[s["parentId"]]
            print(f"   📱 {p['pet']['name']} → {p['name']}: {s['text']}" + (f"  [{s['imageUrl']}]" if s.get("imageUrl") else ""))
        seen["sms"] = len(app.sent)

    def lines_for(key: str):
        return [s["text"] for s in app.sent if s["parentId"] == app.id(key)]

    @director.on_interval(period=1.5)
    async def _script(ctx: Context):
        show_new_lines()
        i = step["i"]
        step["i"] += 1
        if i == 1:
            say("Clock → Sep 20 (demoClock) — the nudge scan finds the romper outgrown")
            app.set_clock("2026-09-20T17:00:00.000Z")
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
            opener = "Mina" if app.id("mina") < app.id("jo") else "Jo"
            say(f"Clock → Oct 18. Jo walks toward Mina … < 25 m → encounter ({opener}'s pet opens)")
            app.set_clock("2026-10-18T17:00:00.000Z")
            app.meet("mina", "jo")
        elif i == 14:
            enc = next(iter(app.encounters.values()))
            print(f"\n   💬 Encounter {enc['id']} status={enc['status']}")
            for t in enc["transcript"]:
                print(f"      {t['text']}")
            say('Both accept ("accept" over iMessage)')
            app.push("jo", "imessage", {"text": "accept", "photoUrls": []})
            app.push("mina", "imessage", {"text": "I accept", "photoUrls": []})
        elif i == 18:
            say("Jo taps PAY in the trade window (demo payment · no real charge)")
            prop = next(iter(app.proposals.values()), None)
            if prop:
                await app._api("payProposal", {"proposalId": prop["id"], "parentId": app.id("jo")})
        elif i == 21:
            say('Sam: "sell the cardigan" (it is on its 3rd owner)')
            app.push("sam", "imessage", {"text": "sell the cardigan", "photoUrls": []})
        elif i == 23:
            romper = app.items["romper"]
            prop = next(iter(app.proposals.values()), {})
            enc = next(iter(app.encounters.values()), {})
            pets = {t["text"].split(":")[0] for t in enc.get("transcript", [])}
            checks = {
                "romper is Jo's, 2 owners, in the closet": romper["currentOwnerId"] == app.id("jo") and romper["ownerCount"] == 2 and romper["status"] == "in_closet",
                "proposal paid at $18.00 by the fetch agents": prop.get("status") == "paid" and prop.get("snapshot", {}).get("priceCents") == 1800 and prop.get("source") == "fetch",
                "encounter proposed, both pets talked": enc.get("status") == "proposed" and {"Button", "Pip"} <= pets,
                "Mina: listed at $18.00": "Listed at $18.00 — 2nd owner pays 60% of $30.00." in lines_for("mina"),
                "both got the proposal": any("found a match" in t for t in lines_for("mina")) and any("found a match" in t for t in lines_for("jo")),
                "Jo got the pay link (?as=jo)": any(f"/trade/{prop.get('id')}?as=jo" in t for t in lines_for("jo")),
                "flowers for both": any("found its next home for $18.00" in t for t in lines_for("mina")) and any("fit until ~Nov 17" in t for t in lines_for("jo")),
                "welcome said once": sum("Say hi to the Yellow duck romper" in t for t in lines_for("jo")) == 1,
                "Sam: final home": any("final home" in t for t in lines_for("sam")),
                "inbox drained": all(r["status"] == "done" for r in app.inbox),
            }
            print(f"\n✅ romper owner={name.get(romper['currentOwnerId'])} owners={romper['ownerCount']} status={romper['status']} fits until {romper['predictedOutgrowDate'][:10]}")
            print(f"✅ proposal {prop.get('id')} status={prop.get('status')} price=${prop.get('snapshot', {}).get('priceCents', 0) / 100:.2f} source={prop.get('source')}")
            print(f"   {hub.polls} inbox polls · {len(app.calls)} app calls ({app.calls.count('sendImessage')} pet lines)")
            for label, ok in checks.items():
                print(f"   {'PASS' if ok else 'FAIL'}  {label}")
            ok = all(checks.values())
            print("\nLOCAL DEMO", "PASS" if ok else "FAIL")
            sys.stdout.flush()
            os._exit(0 if ok else 1)

    bureau.add(director)
    bureau.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
