"""pytest -q agents/tests/test_more_matches.py — MockBase44(more_matches=True): seed.ts's extra items, listings and needs,
so every pair of families has a match (MORE_MATCHES mirrors seed.ts DEMO_MATCHES). Driven through the same
RelayProtocol talk as test_relay.py (its helpers: make_brains, converse, wire_log, only_proposal, list_romper).

What a meeting does here is what the app's planLocalMatch fallback and the Python agents agree on: ONE proposal per
meeting, and the parent whose id sorts first is the "buyer" side, so that parent's need is served first — whoever
walked. A two-way pair (Mina ↔ Sam) trades the other way at the next meeting."""

from __future__ import annotations

import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from mock_base44 import (DEFAULT_IDS, MORE_ITEMS, MORE_LISTED_AT, MORE_LISTINGS, MORE_MATCHES, MORE_NEEDS,  # noqa: E402
                         MockBase44, price_for)
from test_relay import converse, list_romper, make_brains, only_proposal, run, wire_log  # noqa: E402

START, NUDGE, MEET = "2026-05-15T17:00:00.000Z", "2026-09-20T17:00:00.000Z", "2026-10-18T17:00:00.000Z"  # seed.ts DEMO_DATES
SAM_FIRST = {"mina": DEFAULT_IDS["sam"], "sam": DEFAULT_IDS["mina"]}  # swap ids → Sam's pet opens Mina ↔ Sam
PETS = {"mina": "Button", "jo": "Pip", "sam": "Moss"}
SEED_TS = os.path.join(os.path.dirname(__file__), "..", "..", "base44", "shared", "seed.ts")


@pytest.fixture
def app():
    return MockBase44(more_matches=True)


@pytest.fixture
def brains(app):
    return make_brains(app)


def names(log=None):
    return [type(m).__name__ for m in (wire_log if log is None else log)]


def item_named(app, name):
    return next(i for i in app.items.values() if i["name"] == name)


def two_way(match):
    return any(m["seller"] == match["buyer"] and m["buyer"] == match["seller"] for m in MORE_MATCHES)


def buyer_first_ids(match):
    """In a two-way pair the smaller parent id's need is served first; swap the pair's ids so THIS row's buyer opens."""
    buyer, seller = match["buyer"], match["seller"]
    if two_way(match) and DEFAULT_IDS[buyer] > DEFAULT_IDS[seller]:
        return {buyer: DEFAULT_IDS[seller], seller: DEFAULT_IDS[buyer]}
    return None


def ready(app, brains, match):
    """The world at Oct 18 for one DEMO_MATCHES row; the romper is listed in the demo first (nudge → sell it → yes)."""
    if match.get("afterListing"):
        list_romper(app, brains)
    else:
        app.set_clock(MEET)


def assert_private(app):
    """House rule: no agent line or wire field names a parent; no birth date, phone or parent id crosses the wire."""
    blob = json.dumps([m.dict() for m in wire_log])
    secrets = ["phone", "lat", "lng", *(c["birthDate"][:10] for c in app.children.values()),
               *(p["name"] for p in app.parents.values()), *app.parents]
    for secret in secrets:
        assert secret not in blob, secret


# ---- the seed ---------------------------------------------------------------------------------------------------

def test_default_mock_is_still_the_original_slice():
    app = MockBase44()
    assert not app.listings and list(app.needs) == ["n_jo"] and not app.more_matches
    assert not {row[0] for row in MORE_ITEMS} & set(app.items)


def test_more_rows_are_listed_at_the_fixed_price(app):
    for iid, cents, condition in MORE_LISTINGS:
        listing, it = app.listings[f"listing_{iid}"], app.items[iid]
        assert listing["priceCents"] == cents == price_for(it)  # pricing.ts priceFor: the 2nd owner pays 60%
        assert listing["condition"] == condition and listing["conditionNote"] == "" and listing["createdAt"] == MORE_LISTED_AT
        assert listing["shared"] and listing["status"] == "active" and listing["sellerId"] == it["currentOwnerId"]
        assert it["status"] == "listed" and it["ownerCount"] == 1
    assert list(app.needs) == ["n_jo", *(row[0] for row in MORE_NEEDS)]  # Jo's first need stays first
    assert app.needs["n_jo_coat"]["maxPriceCents"] == 2500 and "maxPriceCents" not in app.needs["n_mina"]
    assert all(n["shared"] and n["childId"] == app._child(n["parentId"])["id"] for n in app.needs.values())


def test_still_exactly_one_nudge(app):
    assert app.set_clock(NUDGE) == 1  # the romper; listed items are not in the closet, so the scan skips them
    assert app.set_clock(MEET) == 0
    assert [n["itemId"] for n in app.nudges.values()] == ["romper"]


@pytest.mark.parametrize("clock", [NUDGE, MEET])
def test_fit_finds_exactly_the_demo_matches(app, brains, clock):
    """B's fit (the mock's matcher, + the buyer's default pet rules) over every ordered pair == MORE_MATCHES."""
    list_romper(app, brains)
    app.set_clock(clock)
    found = set()
    for buyer in PETS:
        for seller in PETS:
            if buyer != seller:
                for m in run(app._api("fit", {"buyerId": app.id(buyer), "sellerId": app.id(seller)}))["matches"]:
                    assert not m.get("blocked"), m  # $50 a trade, $100 a month, any kind: nothing is over
                    found.add((seller, buyer, m["itemName"]))
    assert found == {(m["seller"], m["buyer"], m["itemName"]) for m in MORE_MATCHES}
    assert {frozenset((s, b)) for s, b, _ in found} == {frozenset(p) for p in (("mina", "jo"), ("mina", "sam"), ("jo", "sam"))}


def test_without_the_romper_mina_and_jo_have_nothing(app):
    app.set_clock(MEET)
    for buyer, seller in (("mina", "jo"), ("jo", "mina")):
        assert run(app._api("fit", {"buyerId": app.id(buyer), "sellerId": app.id(seller)}))["matches"] == []


# ---- each match proposes when the pair meets ------------------------------------------------------------------------

@pytest.mark.parametrize("walker", ["seller", "buyer"])
@pytest.mark.parametrize("match", MORE_MATCHES, ids=lambda m: f"{m['seller']}->{m['buyer']}")
def test_each_seeded_match_proposes_when_the_pair_meets(match, walker):
    app = MockBase44(ids=buyer_first_ids(match), more_matches=True)
    brains = make_brains(app)
    ready(app, brains, match)
    seller, buyer = match["seller"], match["buyer"]
    wire_log.clear()
    enc = converse(app, brains, *((seller, buyer) if walker == "seller" else (buyer, seller)))  # who walked doesn't matter
    prop = only_proposal(app)
    it = item_named(app, match["itemName"])
    assert prop["buyerId"] == app.id(buyer) and prop["sellerId"] == app.id(seller) and prop["itemId"] == it["id"]
    assert prop["status"] == "open" and prop["source"] == "fetch" and prop["encounterId"] == enc
    assert prop["snapshot"]["priceCents"] == price_for(it) and it["status"] == "pending_trade"
    e = app.encounters[enc]
    assert e["status"] == "proposed" and e["negotiatedBy"] == "fetch"
    assert names()[0] == "LookingFor" and names()[-3:] == ["HaveListings", "ProposeTrade", "TradeAck"] and "NoFit" not in names()
    assert [x["type"] for x in e["agentLog"]][-2:] == ["ProposeTrade", "TradeAck"]
    assert {t["text"].split(":")[0] for t in e["transcript"]} == {PETS[seller], PETS[buyer]}  # both pets, in their own voice
    assert {t["parentId"] for t in e["transcript"] if t["text"].startswith(PETS[buyer])} == {app.id(buyer)}
    assert_private(app)


def test_the_headline_romper_talk_keeps_pips_line(app, brains):
    """Mina has a need now, so Button opens by asking; Jo's first need still leads Pip's line, the romper still trades."""
    list_romper(app, brains)
    wire_log.clear()
    enc = converse(app, brains, "jo", "mina")
    prop = only_proposal(app)
    assert prop["itemId"] == "romper" and prop["buyerId"] == app.id("jo") and prop["snapshot"]["priceCents"] == 1800
    assert names() == ["LookingFor", "LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
    t = app.encounters[enc]["transcript"]
    assert [x["kind"] for x in t] == ["looking_for", "looking_for", "have", "fit_check", "propose", "ack"]
    assert t[1]["text"] == "Pip: Looking for 6-9M top or onesie! Got any?"


# ---- Mina ↔ Sam: both ways, one proposal per meeting ---------------------------------------------------------------

def _settle(app, prop, then):
    if then == "paid":  # both accept, the buyer pays (demo payment): the item moves to the buyer's closet
        for who in (prop["sellerId"], prop["buyerId"]):
            run(app._api("decideProposal", {"proposalId": prop["id"], "parentId": who, "decision": "accepted"}))
        run(app._api("payProposal", {"proposalId": prop["id"], "parentId": prop["buyerId"]}))


@pytest.mark.parametrize("then", ["pending", "paid"])
@pytest.mark.parametrize("ids", [None, SAM_FIRST], ids=["mina_first", "sam_first"])
def test_two_way_pair_trades_one_way_per_meeting(ids, then):
    app = MockBase44(ids=ids, more_matches=True)
    brains = make_brains(app)
    app.set_clock(MEET)
    first, second = ("mina", "sam") if app.id("mina") < app.id("sam") else ("sam", "mina")  # the smaller id buys first
    wants = {"mina": "Star puffer snowsuit", "sam": "Spare star sleep sack"}

    enc1 = converse(app, brains, "sam", "mina")  # Sam walks to Mina either way: the walker never picks the direction
    p1 = only_proposal(app)  # one proposal per meeting: the other way waits for the next one
    assert p1["buyerId"] == app.id(first) and p1["snapshot"]["itemName"] == wants[first]
    assert app.encounters[enc1]["status"] == "proposed"
    assert item_named(app, wants[second])["status"] == "listed"
    _settle(app, p1, then)

    wire_log.clear()
    enc2 = converse(app, brains, "mina", "sam")  # the next meeting (Mina walks this time)
    assert len(app.proposals) == 2
    p2 = next(p for p in app.proposals.values() if p.get("encounterId") == enc2)
    assert p2["buyerId"] == app.id(second) and p2["sellerId"] == app.id(first) and p2["snapshot"]["itemName"] == wants[second]
    assert app.proposals[p1["id"]]["status"] == ("paid" if then == "paid" else "open")
    assert app.encounters[enc2]["status"] == "proposed"
    if then == "pending":
        # The pending item's listing is still "active" (B only marks it sold when paid), so the seller's pet offers it
        # again; B's fit drops it (the item is pending_trade, not listed), the buyer says NoFit, and the roles swap.
        assert names() == ["LookingFor", "HaveListings", "NoFit", "LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
    else:
        assert names() == ["LookingFor", "LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
        assert item_named(app, wants[first])["currentOwnerId"] == app.id(first)
    assert_private(app)

    wire_log.clear()
    enc3 = converse(app, brains, "sam", "mina")  # a third meeting: both ways are taken, nothing new to propose
    assert len(app.proposals) == 2 and app.encounters[enc3]["status"] == "no_match"


# ---- no fit, and a fit the pet rules stop ------------------------------------------------------------------------------

@pytest.mark.parametrize("clock,a,b,wire", [
    # romper not listed yet: Mina ↔ Jo have nothing for each other either way (the no-match meeting the app hides)
    (MEET, "jo", "mina", ["LookingFor", "LookingFor", "NoFit"]),
    # May 15: the sizes match on paper, but neither child fits them yet → B's fit says no both ways
    (START, "sam", "mina", ["LookingFor", "HaveListings", "NoFit", "LookingFor", "HaveListings", "NoFit"]),
], ids=["nothing_listed", "too_young"])
def test_no_fit_pair_still_ends_in_no_fit(app, brains, clock, a, b, wire):
    app.set_clock(clock)
    wire_log.clear()
    enc = converse(app, brains, a, b)
    e = app.encounters[enc]
    assert not app.proposals and e["status"] == "no_match" and e["negotiatedBy"] == "fetch" and "noMatchReason" not in e
    assert names() == wire
    assert_private(app)


def test_pet_rules_still_stop_a_seeded_match(app, brains):
    """A match before the buyer's rules (the app's hasMatch) can still end without a trade: Pip may only look for tops."""
    app.set_clock(MEET)
    app.parents[app.id("jo")]["mandate"] = {"categories": ["top", "onesie"]}  # the fleece jacket is outerwear
    wire_log.clear()
    enc = converse(app, brains, "sam", "jo")
    e = app.encounters[enc]
    assert not app.proposals and e["status"] == "no_match"
    assert e["noMatchReason"] == "It isn't one of the kinds of clothes Jo asked Pip to look for."
    # Sam has a need of his own now: after Pip's Decline, Moss asks the other way round (Jo lists nothing) → NoFit, and
    # Moss's noMatch still carries the rule's reason.
    assert names() == ["LookingFor", "HaveListings", "Decline", "LookingFor", "NoFit"]
    assert [t["kind"] for t in e["transcript"]][:3] == ["looking_for", "have", "decline"]


# ---- parity with base44/shared/seed.ts (once its extra rows land) ----------------------------------------------------

def _ts_block(src, field, value):
    m = re.search(r"\{[^{}]*\b" + field + r':\s*"' + re.escape(value) + r'"[^{}]*\}', src)
    return m.group(0) if m else None


def test_rows_match_seed_ts():
    src = open(SEED_TS, encoding="utf-8").read() if os.path.exists(SEED_TS) else ""
    if "DEMO_MATCHES" not in src:
        pytest.skip("seed.ts has no DEMO_MATCHES yet")
    for iid, key, name, cat, icon, size, cents, bought, owners in MORE_ITEMS:
        block = _ts_block(src, "name", name)
        assert block, name
        for frag in (f'ownerKey: "{key}"', f'category: "{cat}"', f'icon: "{icon}"', f'size: "{size}"',
                     f"originalPriceCents: {cents}", f'originalPurchaseDate: "{bought}"', f"ownerCount: {owners}"):
            assert frag in block, (name, frag)
    listings = src[src.index("listings: ["):]  # seedPlan's listings, not the DEMO_MATCHES rows (also itemName)
    for iid, cents, condition in MORE_LISTINGS:
        name = next(row[2] for row in MORE_ITEMS if row[0] == iid)
        block = _ts_block(listings, "itemName", name)
        assert block and f"priceCents: {cents}" in block and f'"{condition}"' in block and MORE_LISTED_AT in block, name
    for _, key, sizes, cats, cap, at in MORE_NEEDS:
        assert re.search(r'\{[^{}]*parentKey:\s*"' + key + r'"[^{}]*' + re.escape(at) + r"[^{}]*\}", src), (key, at)
    matches = src[src.index("DEMO_MATCHES"):]
    for m in MORE_MATCHES:
        assert re.search(r'seller:\s*"' + m["seller"] + r'",\s*buyer:\s*"' + m["buyer"] + r'",\s*itemName:\s*"'
                         + re.escape(m["itemName"]) + '"', matches), m
