"""local_demo — the whole story offline: three agents in one Bureau, no Base44, no Photon.

    python local_demo.py              # ~35 s, prints every pet line and the pets' conversation, ends PASS/FAIL
    python local_demo.py --jo-first   # same, with Jo's parent id sorting first (Jo's pet opens the encounter)
    python local_demo.py --rules      # Jo's pet rules: a $10 price limit → Pip declines (says which rule), no trade
    python local_demo.py --more-matches  # + seed.ts's extra rows (MockBase44(more_matches=True)): after the story, Sam
                                         # meets Mina, then Jo, then Mina again — one trade per meeting (~55 s)

It runs the SAME wiring as live_bureau.py (build_bureau + InboxHub: one claimInbox for all three agents) against
MockBase44, which answers like the real app (B's handlers, InboxEvent payloads, opaque parent ids).

Division of labour (as live): the agents claim ONLY "encounter" rows and negotiate agent-to-agent; every message
they exchange is recorded and handed to the app with createProposal / noMatch (Encounter.agentLog, printed below).
"imessage" and "event" rows are the app's TypeScript side's job (the Photon webhook + base44/shared/c/inboxFallback.ts).
Offline there is no TypeScript side, so AppSide below is a SIMPLIFIED PYTHON STAND-IN for it: the Python closet
brain's owner conversation, which says the same lines as the live app (wording.py mirrors wording.ts: the quote with
the fair price after a photo, "Listed!", "approve the payment in the app", a plain "yes" accepts a proposal) but is
not the live code (no AI photo naming, no status / cancel). Payment never happens by text: the script taps PAY the way
the trade window does (demo payment · no real charge).

Story: clock → Sep 20 → Button nudges Mina → "sell it" + photo → "yes" → listed $18.00
       → clock → Oct 18 → Mina meets Jo → Button & Pip talk (RelayProtocol; on live Mina's pet opens and the
         roles swap, since Jo has the need) → proposal → both accept → Jo pays (demo) → flowers
       → romper in Jo's bag ♥♥♡ → Sam can't sell a 3rd-owner cardigan.
--more-matches, then: Sam walks to Mina → the smaller parent id's need first (Mina: the snowsuit) → Sam walks to Jo →
       the fleece jacket → Mina walks to Sam again → the other way (Sam: the sleep sack). Each meeting is ONE proposal
       by the fetch agents, whoever walked (the same rule as the app's planLocalMatch fallback).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

from uagents import Agent, Context

import wording as w
from agent_log import format_log
from closet_agent import ClosetBrain
from live_bureau import OfflinePolicy, build_bureau
from mock_base44 import DEFAULT_IDS, MockBase44

log = logging.getLogger("demo")
PARENTS = ("mina", "jo", "sam")
APP_URL = "http://localhost:5173"


class AppSide:
    """A simplified Python stand-in for the app's TypeScript side (base44/shared/c/inboxFallback.ts), which answers
    "imessage" and "event" AgentInbox rows in production (the agents no longer claim them). It reuses ClosetBrain's
    owner conversation: the same wording as the live app (wording.py mirrors wording.ts), not the same code."""

    def __init__(self, app: MockBase44, directory):
        self.app = app
        self.brains = {app.id(k): ClosetBrain(app, k, app.id(k), APP_URL, directory=directory) for k in PARENTS}
        self.last = {}
        self.busy = False
        self.answered = 0

    async def tick(self) -> None:
        if self.busy:
            return
        self.busy = True
        try:
            for r in [r for r in self.app.inbox if r["status"] == "pending" and r["type"] in ("imessage", "event")]:
                r.update(status="claimed", claimedBy="app")
                brain, p = self.brains[r["parentId"]], r.get("payload") or {}
                if r["type"] == "imessage":
                    replies = await brain.owner_message(p.get("text", ""), p.get("photoUrls") or [])
                else:
                    replies = await brain.event(p)
                for rep_ in replies:
                    if self.last.get(r["parentId"]) == rep_.text:  # two events in one tick → say it once
                        continue
                    self.last[r["parentId"]] = rep_.text
                    await self.app.send_imessage(r["parentId"], rep_.text, rep_.image_url)
                r["status"] = "done"
                self.answered += 1
        finally:
            self.busy = False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jo-first", action="store_true", help="give Jo the smaller parent id (Jo's pet opens)")
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--rules", action="store_true", help="Jo's pet rules allow at most $10: the pets decline, no trade")
    ap.add_argument("--more-matches", action="store_true",
                    help="seed.ts's extra rows: three more meetings after the story (Sam↔Mina, Sam↔Jo, Mina↔Sam again)")
    a = ap.parse_args(argv)
    logging.basicConfig(level=os.environ.get("LOG", "WARNING"))
    if not os.environ.get("LOG"):
        logging.getLogger("closet").setLevel(logging.WARNING)  # the protocol log is printed below, once
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", line_buffering=True)  # pet lines have ♥ and emoji; Windows consoles

    app = MockBase44(ids={"mina": DEFAULT_IDS["jo"], "jo": DEFAULT_IDS["mina"]} if a.jo_first else None, more_matches=a.more_matches)
    asyncio.set_event_loop(asyncio.new_event_loop())  # uAgents wants a current loop at construction (Python 3.14 has none)
    parents = {k: {"id": app.id(k), "name": app.parents[app.id(k)]["name"], "pet": app.parents[app.id(k)]["pet"]["name"]} for k in PARENTS}
    bureau, agents, brains, hub = build_bureau(
        app, parents, app_url=APP_URL, seeds={p: f"local-demo-{p}" for p in PARENTS}, port=a.port,
        poll_s=0.5, fast_s=0.5, tick_s=0.5, append_turns=True, peer_wait_s=5.0,
    )
    for k, ag in agents.items():
        app.parents[app.id(k)]["agentAddress"] = ag.address  # what registerAgent does on live
    app_side = AppSide(app, {app.id(k): {"key": k, "name": parents[k]["name"], "pet": parents[k]["pet"]} for k in PARENTS})

    director = Agent(name="director", seed="local-demo-director", mailbox=False, registration_policy=OfflinePolicy(),
                     publish_agent_details=False, enable_agent_inspector=False)
    step = {"i": 0}
    seen = {"sms": 0}
    name = {app.id(k): k for k in PARENTS}
    # --more-matches: three more walks after Sam's cardigan (step → walker, peer, label), then the checks at `final`.
    more_walks = {23: ("sam", "mina", "first"), 27: ("sam", "jo", "jo"), 31: ("mina", "sam", "again")} if a.more_matches else {}
    more = {}  # label → encounter id
    final = 36 if a.more_matches else 23

    def say(line: str) -> None:
        print(f"\n▶ {line}")

    print("Offline demo: three Fetch.ai uAgents in one Bureau + MockBase44. AppSide is a simplified Python stand-in for "
          "the app's TypeScript iMessage side (same wording, not the live code).")

    def show_new_lines() -> None:
        for s in app.sent[seen["sms"]:]:
            p = app.parents[s["parentId"]]
            print(f"   📱 {p['pet']['name']} → {p['name']}: {s['text']}" + (f"  [{s['imageUrl']}]" if s.get("imageUrl") else ""))
        seen["sms"] = len(app.sent)

    def lines_for(key: str):
        return [s["text"] for s in app.sent if s["parentId"] == app.id(key)]

    @director.on_interval(period=0.5)
    async def _app_side(ctx: Context):
        await app_side.tick()

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
            if a.rules:
                say("Jo's pet rules (Pet rules screen): Pip may propose trades up to $10.00")
                app.parents[app.id("jo")]["mandate"] = {"maxPriceCents": 1000}
            app.meet("mina", "jo")
        elif i == 14:
            enc = next(iter(app.encounters.values()))
            print(f"\n   💬 Encounter {enc['id']} status={enc['status']}")
            for t in enc["transcript"]:
                print(f"      {t['text']}")
            log_ = enc.get("agentLog") or []
            print(f"\n   🔗 Fetch.ai protocol log (Encounter.agentLog) · negotiatedBy={enc.get('negotiatedBy')} · {len(log_)} messages")
            for line in format_log(log_):
                print(f"      {line}")
            if enc.get("noMatchReason"):
                print(f"   🛑 No trade: {enc['noMatchReason']} (Encounter.noMatchReason)")
            if not a.rules:
                say('Both accept ("accept" over iMessage)')
                app.push("jo", "imessage", {"text": "accept", "photoUrls": []})
                app.push("mina", "imessage", {"text": "I accept", "photoUrls": []})
        elif i == 18 and not a.rules:
            say("Jo taps PAY in the trade window (demo payment · no real charge)")
            prop = next(iter(app.proposals.values()), None)
            if prop:
                await app._api("payProposal", {"proposalId": prop["id"], "parentId": app.id("jo")})
        elif i == 21:
            say('Sam: "sell the cardigan" (it is on its 3rd owner)')
            app.push("sam", "imessage", {"text": "sell the cardigan", "photoUrls": []})
        elif i in more_walks:
            walker, peer, label = more_walks[i]
            opener = min((walker, peer), key=app.id)
            again = " again — one trade per meeting, so this one goes the other way" if label == "again" else ""
            say(f"{walker.title()} walks toward {peer.title()}{again} … < 25 m → encounter ({opener.title()}'s pet opens: "
                "the smaller parent id's need first)")
            more[label] = app.meet(walker, peer)
        elif a.more_matches and i == final - 1:
            for enc_id in more.values():
                enc = app.encounters[enc_id]
                print(f"\n   💬 Encounter {enc_id} {name.get(enc['aId'])} → {name.get(enc['bId'])} status={enc['status']}")
                for t in enc["transcript"]:
                    print(f"      {t['text']}")
        elif i == final:
            romper = app.items["romper"]
            prop = next((p for p in app.proposals.values() if p["itemId"] == "romper"), {})  # the story's (--more-matches adds more)
            enc = next(iter(app.encounters.values()), {})
            pets = {t["text"].split(":")[0] for t in enc.get("transcript", [])}
            log_ = enc.get("agentLog") or []
            types = [e["type"] for e in log_]
            pair = {agents["mina"].address, agents["jo"].address}
            common = {
                "Mina: quoted, then listed at $18.00 (the live app's lines)":
                    any("Fair price $18.00 (2nd owner pays 60% of $30.00)" in t for t in lines_for("mina"))
                    and w.listed_now("Yellow duck romper", 1800, 3000, 1) in lines_for("mina"),
                "Sam: final home": any("final home" in t for t in lines_for("sam")),
                "inbox drained": all(r["status"] == "done" for r in app.inbox),
                "every logged message is between the two agents' agent1q… addresses":
                    bool(log_) and all({e["from"], e["to"]} == pair for e in log_),
                "agents claimed only encounter rows; the app side answered the rest":
                    all(r.get("claimedBy") == "live-bureau" for r in app.inbox if r["type"] == "encounter")
                    and all(r.get("claimedBy") == "app" for r in app.inbox if r["type"] != "encounter"),
            }
            kinds = [t.get("kind") for t in enc.get("transcript", [])]
            if a.rules:
                checks = {
                    "no proposal, nothing charged": not prop and romper["currentOwnerId"] == app.id("mina")
                        and romper["status"] == "listed",
                    "encounter ended no_match with the rule as the reason (by the fetch agents)":
                        enc.get("status") == "no_match" and enc.get("negotiatedBy") == "fetch"
                        and enc.get("noMatchReason") == "It costs more than the price limit Jo set for Pip.",
                    "Pip said the rule, nobody said 'Trade proposal!'":
                        enc.get("transcript", [{}])[-1].get("text") == "Pip: Aw, not this one — it's over the price limit Jo set for me."
                        and "propose" not in kinds and "ack" not in kinds,
                    "protocol log ends with Decline (no names, no limit)": types[-1:] == ["Decline"] and "ProposeTrade" not in types
                        and all(e["by"] == "fetch" for e in log_) and "Jo" not in str(log_) and "$10" not in str(log_),
                    **common,
                }
            else:
                checks = {
                    "romper is Jo's, 2 owners, in the closet": romper["currentOwnerId"] == app.id("jo") and romper["ownerCount"] == 2 and romper["status"] == "in_closet",
                    "proposal paid at $18.00 by the fetch agents": prop.get("status") == "paid" and prop.get("snapshot", {}).get("priceCents") == 1800 and prop.get("source") == "fetch",
                    "encounter proposed, both pets talked": enc.get("status") == "proposed" and {"Button", "Pip"} <= pets,
                    "both got the proposal": any("found a match" in t for t in lines_for("mina")) and any("found a match" in t for t in lines_for("jo")),
                    "Jo told to approve the payment in the app (?as=jo), never pay by text":
                        w.approve_in_app(f"{APP_URL}/trade/{prop.get('id')}?as=jo") in lines_for("jo"),
                    "flowers for both": any("found its next home for $18.00" in t for t in lines_for("mina")) and any("fit until ~Nov 17" in t for t in lines_for("jo")),
                    "welcome said once": sum("Say hi to the Yellow duck romper" in t for t in lines_for("jo")) == 1,
                    "protocol log stored with the proposal (LookingFor … ProposeTrade → TradeAck, by fetch)":
                        enc.get("negotiatedBy") == "fetch" and types[:1] == ["LookingFor"] and "HaveListings" in types
                        and types[-2:] == ["ProposeTrade", "TradeAck"] and all(e["by"] == "fetch" for e in log_),
                    **common,
                }
            if a.more_matches:
                first, second = ("mina", "sam") if app.id("mina") < app.id("sam") else ("sam", "mina")
                wants = {"mina": "Star puffer snowsuit", "sam": "Spare star sleep sack"}

                def proposed(label: str, buyer: str, item: str) -> bool:
                    ps = [p for p in app.proposals.values() if p.get("encounterId") == more.get(label)]
                    e = app.encounters.get(more.get(label), {})
                    return (len(ps) == 1 and ps[0]["buyerId"] == app.id(buyer) and ps[0]["snapshot"]["itemName"] == item
                            and ps[0]["source"] == "fetch" and e.get("status") == "proposed" and e.get("negotiatedBy") == "fetch")

                def logged_between(label: str, x: str, y: str) -> bool:
                    log_ = app.encounters.get(more.get(label), {}).get("agentLog") or []
                    return bool(log_) and all({e["from"], e["to"]} == {agents[x].address, agents[y].address} for e in log_)

                jo_sam = app.encounters.get(more.get("jo"), {})
                if a.rules:  # the $21.60 jacket is over Jo's $10 limit too: Pip declines it, the meeting ends no_match
                    jo_sam_label = "Sam ↔ Jo: Jo's pet rules stop the Fleece bear jacket (no_match, the rule as the reason)"
                    jo_sam_ok = (jo_sam.get("status") == "no_match" and not any(p.get("encounterId") == more.get("jo") for p in app.proposals.values())
                                 and jo_sam.get("noMatchReason") == "It costs more than the price limit Jo set for Pip.")
                else:
                    jo_sam_label, jo_sam_ok = "Sam ↔ Jo: one proposal, the Fleece bear jacket for Jo", proposed("jo", "jo", "Fleece bear jacket")
                checks.update({
                    f"Sam ↔ Mina: one proposal, {first.title()}'s need first (smaller parent id): {wants[first]}":
                        proposed("first", first, wants[first]),
                    jo_sam_label: jo_sam_ok,
                    f"Mina ↔ Sam again: the other way round, {wants[second]} for {second.title()}":
                        proposed("again", second, wants[second]),
                    "each new meeting's protocol log is between that pair's agents":
                        logged_between("first", "sam", "mina") and logged_between("jo", "sam", "jo") and logged_between("again", "mina", "sam"),
                })
            print(f"\n✅ romper owner={name.get(romper['currentOwnerId'])} owners={romper['ownerCount']} status={romper['status']} fits until {romper['predictedOutgrowDate'][:10]}")
            if prop:
                print(f"✅ proposal {prop.get('id')} status={prop.get('status')} price=${prop.get('snapshot', {}).get('priceCents', 0) / 100:.2f} source={prop.get('source')}")
            else:
                print(f"✅ no proposal: {enc.get('noMatchReason') or 'nothing fits'} · romper still on Mina's shared list")
            for p in (p for p in app.proposals.values() if p["itemId"] != "romper"):  # --more-matches
                print(f"✅ proposal {p['id']} {p['snapshot']['itemName']} {name.get(p['sellerId'])} → {name.get(p['buyerId'])} "
                      f"status={p['status']} price=${p['snapshot']['priceCents'] / 100:.2f} source={p['source']}")
            print(f"   {hub.polls} inbox polls · {len(app.calls)} app calls ({app.calls.count('sendImessage')} pet lines) · "
                  f"{app_side.answered} imessage/event rows answered by the app side")
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
