"""The protocol log: every RelayProtocol message of an encounter, sent to the app with createProposal / noMatch.

No network, no uAgents runtime: ClosetBrains talk to each other through on_relay (with real agent1q… addresses
from the same seeds live_bureau uses) against MockBase44, which stores the log like agentApi does.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agent_log import MAX_ENTRIES, AgentLog, format_log, short_address, summarize  # noqa: E402
from base44_client import RateLimited  # noqa: E402
from closet_agent import ClosetBrain  # noqa: E402
from live_bureau import agent_addresses  # noqa: E402
from mock_base44 import DEFAULT_IDS, MockBase44  # noqa: E402
from relay_protocol import HaveListings, ListingCard, LookingFor, Need, NoFit, ProposeTrade, TradeAck  # noqa: E402

ADDR = agent_addresses("log-test")
JO_FIRST = {"mina": DEFAULT_IDS["jo"], "jo": DEFAULT_IDS["mina"]}
PRIVATE = ("Mina", "Jo ", "Jo'", "Sam", "Bean", "Pea", "Sprout", "2025-12-10", "2026-03-01", "phone", "lat", "lng", "month")


def run(coro):
    return asyncio.run(coro)


def brains_for(app, **kw):
    directory = {app.id(k): {"key": k, "name": app.parents[app.id(k)]["name"], "pet": app.parents[app.id(k)]["pet"]["name"]}
                 for k in ("mina", "jo", "sam")}
    out = {}
    for k in ("mina", "jo", "sam"):
        b = ClosetBrain(app, k, app.id(k), "http://app", directory=directory, **kw)
        b.address = ADDR[k]  # attach() does this with agent.address
        out[k] = b
    return out


def list_romper(app, brains):
    app.set_clock("2026-09-20T17:00:00.000Z")
    for r in app.inbox:
        r["status"] = "done"
    run(brains["mina"].owner_message("sell it"))
    run(brains["mina"].owner_message("", ["https://x/p.jpg"]))
    run(brains["mina"].owner_message("yes"))
    app.set_clock("2026-10-18T17:00:00.000Z")


def converse(app, brains, a, b):
    """meet(a, b); each side opens with its encounter row (peer address from the Bureau's address book), then the
    messages travel with their real sender address, exactly like the uAgents handlers call on_relay."""
    enc = app.meet(a, b)
    by_id = {br.parent_id: br for br in brains.values()}
    wire = []
    for r in [r for r in app.inbox if r["type"] == "encounter" and r["payload"]["encounterId"] == enc]:
        r["status"] = "done"
        me, peer = by_id[r["parentId"]], by_id[r["payload"]["peer"]["parentId"]]
        out = run(me.open_encounter(r["payload"], peer_address=peer.address))
        if out is not None:
            wire.append((me, peer, out))
    while wire:
        sender, receiver, msg = wire.pop(0)
        reply = run(receiver.on_relay(msg, sender.address))
        if reply is not None:
            wire.append((receiver, sender, reply))
    return enc


# ---- summaries ----------------------------------------------------------------------

def test_summaries_are_one_plain_sentence_from_shared_data():
    looking = LookingFor(encounter_id="e", needs=[Need(sizes=["6-9M"], categories=["top", "onesie"], max_price_cents=2000)],
                         child_age_months=7, line="Pip: Looking for 6-9M onesie!")
    assert summarize(looking) == "Asks for size 6-9M (top, onesie), up to $20.00."
    assert summarize(LookingFor(encounter_id="e", needs=[])) == "Says hello; has no shared need to ask about."
    card = ListingCard(listing_id="l1", item_name="Yellow duck romper", size="6-9M", price_cents=1800)
    assert summarize(HaveListings(encounter_id="e", listings=[card])) == "Offers 1 shared listing: Yellow duck romper, size 6-9M, $18.00."
    assert summarize(HaveListings(encounter_id="e", listings=[card, card])).startswith("Offers 2 shared listings: Yellow duck romper")
    assert summarize(NoFit(encounter_id="e")) == "No fit: nothing in my closet fits today."
    assert summarize(ProposeTrade(encounter_id="e", listing_id="l1", price_cents=1800, reason="Size 6-9M fits for about 4 more weeks.")) \
        == "Proposes the listing at $18.00. Size 6-9M fits for about 4 more weeks."
    assert summarize(TradeAck(encounter_id="e", listing_id="l1", ok=True)) == "Agrees to the trade; both parents still decide in the app."
    assert summarize(TradeAck(encounter_id="e", listing_id="l1", ok=False, reason="listing changed")) == "Declines: listing changed."
    # the child's age travels on the wire (rule 3 allows it) but never into the stored, readable log
    assert "7" not in summarize(looking).replace("$20.00", "")


def test_log_measures_latency_skips_retries_and_caps():
    t = [datetime(2026, 10, 18, 17, 0, tzinfo=timezone.utc)]
    log = AgentLog(clock=lambda: t[0])
    first = log.record("e1", NoFit(encounter_id="e1"), "agent1qa", "agent1qb")
    assert first["at"] == "2026-10-18T17:00:00Z" and "ms" not in first and first["by"] == "fetch"
    t[0] += timedelta(milliseconds=250)
    assert log.record("e1", NoFit(encounter_id="e1"), "agent1qa", "agent1qb") is None  # a retried handler
    second = log.record("e1", NoFit(encounter_id="e1"), "agent1qb", "agent1qa")
    assert second["ms"] == 250
    for i in range(MAX_ENTRIES + 5):
        log.record("e2", NoFit(encounter_id="e2", reason=f"r{i}"), "a", "b")
    assert len(log.entries("e2")) == MAX_ENTRIES and log.entries("e2")[-1]["summary"] == f"No fit: r{MAX_ENTRIES + 4}."
    assert log.entries("nope") == [] and "e1" in log
    assert short_address(ADDR["mina"]).startswith("agent1q") and "…" in short_address(ADDR["mina"])
    assert "NoFit" in format_log(log.entries("e1"))[1] and "+250ms" in format_log(log.entries("e1"))[1]


# ---- the whole conversation reaches the app with the call that ends it --------------------

def test_trade_log_rides_on_create_proposal():
    app = MockBase44()
    brains = brains_for(app)
    list_romper(app, brains)
    calls_before = len(app.calls)
    enc = converse(app, brains, "mina", "jo")
    e = app.encounters[enc]
    assert e["status"] == "proposed" and e["negotiatedBy"] == "fetch"
    log = e["agentLog"]
    assert [x["type"] for x in log] == ["LookingFor", "LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
    m, j = ADDR["mina"], ADDR["jo"]  # Mina's pet opens (smaller id) and the roles swap: Jo has the need
    assert [(x["from"], x["to"]) for x in log] == [(m, j), (j, m), (m, j), (j, m), (m, j)]
    assert all(x["by"] == "fetch" for x in log) and "ms" not in log[0] and all(isinstance(x["ms"], int) for x in log[1:])
    assert all(datetime.fromisoformat(x["at"].replace("Z", "+00:00")) for x in log)
    assert log[2]["summary"] == "Offers 1 shared listing: Yellow duck romper, size 6-9M, $18.00."
    assert log[3]["summary"].startswith("Proposes the listing at $18.00. Size 6-9M fits for about")
    blob = json.dumps(log)
    for secret in (*PRIVATE, app.id("mina"), app.id("jo")):
        assert secret not in blob
    # no extra request: the log went in the createProposal call itself
    assert "agentApi:createProposal" in app.calls[calls_before:]
    assert not [c for c in app.calls[calls_before:] if "Log" in c or "log" in c]
    # the buyer (Jo) holds the full log; the seller's own copy has the same messages
    assert [x["type"] for x in brains["mina"].protocol_log(enc)] == [x["type"] for x in log]


def test_trade_log_when_jo_opens():
    app = MockBase44(ids=JO_FIRST)
    brains = brains_for(app)
    list_romper(app, brains)
    enc = converse(app, brains, "mina", "jo")
    log = app.encounters[enc]["agentLog"]
    assert [x["type"] for x in log] == ["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
    assert log[0]["from"] == ADDR["jo"] and log[0]["summary"] == "Asks for size 6-9M (top, onesie)."


def test_no_match_log_and_bubbles_ride_on_no_match():
    app = MockBase44()
    brains = brains_for(app)
    enc = converse(app, brains, "mina", "jo")  # nothing listed → nothing either way
    e = app.encounters[enc]
    assert e["status"] == "no_match" and e["negotiatedBy"] == "fetch"
    assert [x["type"] for x in e["agentLog"]] == ["LookingFor", "LookingFor", "NoFit"]
    assert [t["kind"] for t in e["transcript"]] == ["looking_for", "looking_for", "no_fit"]
    assert all(t["parentId"] for t in e["transcript"])  # the peer's id filled in
    assert app.calls.count("agentApi:noMatch") == 1


def test_late_no_match_never_relabels_a_proposed_encounter():
    app = MockBase44()
    brains = brains_for(app)
    enc = app.meet("mina", "jo")
    app.encounters[enc].update(status="proposed", negotiatedBy="local", agentLog=[{"type": "TradeAck", "by": "fallback"}])
    run(brains["jo"]._no_match(enc))
    assert app.encounters[enc]["negotiatedBy"] == "local" and app.encounters[enc]["agentLog"][0]["by"] == "fallback"


def test_a_retried_relay_handler_logs_each_message_once():
    app = MockBase44()
    brains = brains_for(app)
    list_romper(app, brains)
    enc = app.meet("mina", "jo")
    jo, mina = brains["jo"], brains["mina"]
    real, hits = app.get_state, []

    async def flaky(*a, **k):
        hits.append(1)
        if len(hits) == 1:
            raise RateLimited("agentApi:getState 429")
        return await real(*a, **k)

    app.get_state = flaky
    msg = LookingFor(encounter_id=enc, needs=[Need(sizes=["6-9M"], categories=["onesie"])], line="Pip: Looking for 6-9M onesie!")
    try:
        run(mina.on_relay(msg, jo.address))
    except RateLimited:
        pass
    out = run(mina.on_relay(msg, jo.address))  # what closet_agent._reply does after the pause
    assert isinstance(out, HaveListings)
    assert [(x["type"], x["from"]) for x in mina.protocol_log(enc)] == [("LookingFor", jo.address), ("HaveListings", mina.address)]


def test_wire_messages_still_carry_no_private_data():
    app = MockBase44()
    brains = brains_for(app)
    list_romper(app, brains)
    enc = converse(app, brains, "mina", "jo")
    blob = json.dumps(app.encounters[enc]["agentLog"]) + json.dumps(app.proposals[next(iter(app.proposals))]["transcript"])
    assert "phone" not in blob and "lat" not in blob and app.id("mina") not in json.dumps(app.encounters[enc]["agentLog"])


def test_decline_summaries_never_name_anyone_or_an_amount():
    from relay_protocol import Decline

    rules = Decline(encounter_id="e", listing_id="l1", rule="over_price", reason="It costs more than the price limit Jo set for Pip.",
                    line="Pip: Not this one — it's over the price limit Jo set for me.")
    assert summarize(rules) == "Declines: over the price limit the buyer set for their pet. Nothing was proposed."
    assert summarize(Decline(encounter_id="e", rule="over_budget")) == "Declines: over the budget the buyer set for their pet. Nothing was proposed."
    assert summarize(Decline(encounter_id="e", reason="already_open")) == \
        "Declines: the app refused the proposal (the listing already has an open trade)."
    for msg in (rules, Decline(encounter_id="e", rule="category"), Decline(encounter_id="e", rule="agent_may_not_propose")):
        assert not any(p in summarize(msg) for p in PRIVATE) and "$" not in summarize(msg)


def test_rules_block_log_rides_on_no_match_with_the_reason():
    app = MockBase44()
    brains = brains_for(app)
    list_romper(app, brains)
    app.parents[app.id("jo")]["mandate"] = {"maxPriceCents": 1000}
    calls = len(app.calls)
    enc = converse(app, brains, "mina", "jo")
    e = app.encounters[enc]
    m, j = ADDR["mina"], ADDR["jo"]
    assert [(x["type"], x["from"], x["to"]) for x in e["agentLog"]] == [
        ("LookingFor", m, j), ("LookingFor", j, m), ("HaveListings", m, j), ("Decline", j, m)]
    assert e["noMatchReason"] == "It costs more than the price limit Jo set for Pip."
    assert app.calls[calls:].count("agentApi:noMatch") == 1 and "agentApi:createProposal" not in app.calls[calls:]
