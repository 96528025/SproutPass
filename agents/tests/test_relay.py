"""pytest -q agents/tests  — no network, no uAgents runtime: drives ClosetBrain directly."""

from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cards  # noqa: E402
import wording as w  # noqa: E402
from closet_agent import ClosetBrain  # noqa: E402
from intents import intent_from_card, parse_card_reply, parse_claim, parse_condition, parse_intent  # noqa: E402
from mock_base44 import MockBase44  # noqa: E402
from relay_protocol import LookingFor, Need  # noqa: E402


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def app():
    return MockBase44()


@pytest.fixture
def brains(app):
    return {p: ClosetBrain(app, p, p, "http://app") for p in ("mina", "jo", "sam")}


# ---- intents ---------------------------------------------------------------

@pytest.mark.parametrize("text,intent", [
    ("sell it", "sell"), ("Sell", "sell"), ("keep", "keep"), ("later please", "later"),
    ("yes", "yes"), ("Yep!", "yes"), ("no", "no"), ("accept", "accept"), ("I'll take it", "accept"),
    ("decline", "decline"), ("no thanks", "decline"), ("pay", "pay"), ("bag", "bag"), ("help", "help"),
    ("hi", "hi"), ("claim mina-0000", "claim"), ("what's the weather", "unknown"), ("", "unknown"),
])
def test_parse_intent(text, intent):
    assert parse_intent(text) == intent


def test_parse_condition_and_claim():
    assert parse_condition("it's like-new") == "like_new"
    assert parse_condition("gently used I'd say") == "gently_used"
    assert parse_condition("well loved") == "well_loved"
    assert parse_claim("claim jo-1234") == ("jo", "1234")
    assert parse_claim("claim jo") is None


def test_card_reply_json_first():
    assert parse_card_reply('{"action":"accept","proposal_id":"p1"}') == {"action": "accept", "proposal_id": "p1"}
    assert parse_card_reply("accept") is None
    assert intent_from_card({"action": "confirm"}) == "accept"
    assert intent_from_card({"action": "cancel"}) == "decline"


# ---- wording / pricing text -----------------------------------------------

def test_price_rule_text():
    assert w.price_rule(3000, 1) == "2nd owner pays 60% of $30.00"
    assert w.price_rule(3000, 2) == "3rd owner pays 40% of $30.00"
    assert "final home" in w.price_rule(3000, 3)
    assert w.hearts(2) == "♥♥♡"


def test_lines_are_short_and_plain():
    for fn, args in [(w.nudge, ("romper", "6-9M")), (w.listed, (1800, 3000, 1)), (w.proposal, ("romper", 1800, 3000, 1, "Pip")),
                     (w.completed, ("romper", "Nov 17")), (w.declined, ()), (w.hello, ("Button",))]:
        line = fn(*args)
        assert "*" not in line and "#" not in line, line  # no markdown in iMessage
        assert line.count(". ") <= 2, line  # ≤ 2 sentences-ish


# ---- cards -----------------------------------------------------------------

def test_cards_have_required_shape():
    item = {"id": "romper", "name": "Yellow duck romper", "size": "6-9M", "ownerCount": 1, "originalPurchaseDate": "2026-05-15", "originalPriceCents": 3000}
    d = cards.nudge_card(item, "n1")
    assert d["title"] and d["summary_rows"] and all({"label", "value"} <= set(r) for r in d["summary_rows"])
    assert {c["selection"]["action"] for c in d["ctas"]} == {"sell", "keep", "later"}
    prop = {"id": "p1", "buyerId": "jo", "snapshot": {"itemName": "romper", "size": "6-9M", "previousOwners": 1, "priceCents": 1800, "originalPriceCents": 3000}}
    r = cards.proposal_card(prop, "jo")
    assert r["approve_cta"]["selection"] == {"action": "accept", "proposal_id": "p1"}
    assert r["reject_cta"]["selection"]["action"] == "decline"
    msg = cards.card_message("hi", "review", r)
    meta = msg.content[1].metadata
    assert meta["card_protocol_version"] == "1" and meta["requires_card_interaction"] == "true"
    assert json.loads(meta["card_payload"])["title"].startswith("Trade proposal")
    assert len(meta["card_payload"].encode()) < 64 * 1024


# ---- owner conversation -----------------------------------------------------

def test_nudge_to_listing(app, brains):
    mina = brains["mina"]
    app.set_clock("2026-09-20T12:00:00Z")
    ev = [r for r in app.inbox if r["type"] == "event"][0]
    out = run(mina.event(ev["payload"]))
    assert "getting snug" in out[0].text and out[0].card[0] == "detail"
    assert "photo" in run(mina.owner_message("sell it"))[0].text
    assert "gently used" in run(mina.owner_message("", ["https://x/photo.jpg"]))[0].text
    assert run(mina.owner_message("yes"))[0].text == "Listed at $18.00 — 2nd owner pays 60% of $30.00."
    listing = next(iter(app.listings.values()))
    assert listing["priceCents"] == 1800 and listing["shared"] and app.items["romper"]["status"] == "listed"
    assert all(n["resolved"] for n in app.nudges.values())


def test_keep_resolves_nudge(app, brains):
    app.set_clock("2026-09-20T12:00:00Z")
    assert run(brains["mina"].owner_message("keep"))[0].text == w.keep()
    assert all(n["resolved"] for n in app.nudges.values())


def test_third_owner_cannot_sell(app, brains):
    out = run(brains["sam"].owner_message("sell the sun hat"))
    assert "final home" in out[0].text and not app.listings


def test_bag(app, brains):
    out = run(brains["mina"].owner_message("bag"))
    assert "Yellow duck romper 6-9M ♥♡♡" in out[0].text


# ---- relay (agent ↔ agent) --------------------------------------------------

def list_romper(app, brains):
    app.set_clock("2026-09-20T12:00:00Z")
    run(brains["mina"].owner_message("sell it"))
    run(brains["mina"].owner_message("", ["https://x/p.jpg"]))
    run(brains["mina"].owner_message("yes"))


def test_relay_flow_creates_proposal_once(app, brains):
    list_romper(app, brains)
    enc = app.meet("mina", "jo")
    jo, mina = brains["jo"], brains["mina"]
    jo_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "jo")
    mina_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "mina")
    assert jo_row["payload"]["role"] == "buyer" and mina_row["payload"]["role"] == "seller"  # "jo" < "mina"
    looking = run(jo.open_encounter(jo_row["payload"]))
    assert run(mina.open_encounter(mina_row["payload"])) is None
    assert isinstance(looking, LookingFor) and looking.needs[0].sizes == ["6-9M"] and looking.child_age_months == 6
    have = run(mina.on_looking_for(looking))
    assert have.listings[0].item_name == "Yellow duck romper" and have.listings[0].price_cents == 1800
    propose = run(jo.on_have_listings(have))
    assert propose.listing_id == have.listings[0].listing_id and propose.wear_weeks_left == 4
    ack = run(mina.on_propose(propose))
    assert ack.ok
    prop = run(jo.on_ack(ack))
    assert prop["status"] == "open" and prop["source"] == "fetch" and prop["snapshot"]["priceCents"] == 1800
    assert app.encounters[enc]["status"] == "proposed"
    kinds = [t["kind"] for t in app.encounters[enc]["transcript"]]
    assert kinds == ["looking_for", "have", "fit_check", "propose", "ack"]
    assert all(t["text"].startswith(("Pip:", "Button:")) for t in app.encounters[enc]["transcript"])
    # privacy: nothing but shared data crossed the wire
    blob = json.dumps(looking.dict()) + json.dumps(have.dict()) + json.dumps(propose.dict())
    for secret in ("2025-12-10", "2026-03-01", "Mina", "Jo", "phone", "lat", "lng"):
        assert secret not in blob
    # second ack must not create a second open proposal
    with pytest.raises(Exception):
        run(jo.on_ack(ack))


def test_relay_no_fit(app, brains):
    enc = app.meet("mina", "jo")  # romper not listed → nothing shared
    jo_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "jo")
    mina_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "mina")
    looking = run(brains["jo"].open_encounter(jo_row["payload"]))
    run(brains["mina"].open_encounter(mina_row["payload"]))
    out = run(brains["mina"].on_looking_for(looking))
    assert out.__class__.__name__ == "NoFit"


def test_seller_rejects_changed_price(app, brains):
    list_romper(app, brains)
    app.meet("mina", "jo")
    from relay_protocol import ProposeTrade
    lid = next(iter(app.listings))
    ack = run(brains["mina"].on_propose(ProposeTrade(encounter_id=next(iter(app.encounters)), listing_id=lid, price_cents=100, reason="x")))
    assert not ack.ok


# ---- two-sided accept + pay ---------------------------------------------------

def test_accept_pay_and_welcome(app, brains):
    list_romper(app, brains)
    enc = app.meet("mina", "jo")
    jo, mina = brains["jo"], brains["mina"]
    jo_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "jo")
    mina_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "mina")
    looking = run(jo.open_encounter(jo_row["payload"])); run(mina.open_encounter(mina_row["payload"]))
    prop = run(jo.on_ack(run(mina.on_propose(run(jo.on_have_listings(run(mina.on_looking_for(looking))))))))
    assert run(jo.owner_message("accept")) == []
    assert app.proposals[prop["id"]]["status"] == "open"  # one side is not enough (rule 1)
    assert run(mina.owner_message("accept")) == []
    assert app.proposals[prop["id"]]["status"] == "both_accepted"
    pay = run(jo.owner_message("pay"))
    assert "demo payment" in pay[0].text and prop["id"] in pay[0].text
    # ASI:One pay card → payProposal
    assert run(jo.owner_message("", selection={"action": "pay", "proposal_id": prop["id"]})) == []
    assert app.proposals[prop["id"]]["status"] == "paid"
    romper = app.items["romper"]
    assert romper["currentOwnerId"] == "jo" and romper["ownerCount"] == 2 and romper["status"] == "in_closet"
    done = [r for r in app.inbox if r["payload"].get("type") == "trade:completed"]
    jo_line = run(jo.event(next(r for r in done if r["parentId"] == "jo")["payload"]))[0]
    mina_line = run(mina.event(next(r for r in done if r["parentId"] == "mina")["payload"]))[0]
    assert jo_line.text == "Say hi to the Yellow duck romper! It should fit until ~Nov 17. I'll check in then."
    assert mina_line.text == "The Yellow duck romper found its next home for $18.00. Flowers all round!"
    assert jo_line.image_url and jo_line.image_url.endswith("flowers.gif")


def test_decline_charges_nothing(app, brains):
    list_romper(app, brains)
    app.meet("mina", "jo")
    jo, mina = brains["jo"], brains["mina"]
    jo_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "jo")
    mina_row = next(r for r in app.inbox if r["type"] == "encounter" and r["parentId"] == "mina")
    looking = run(jo.open_encounter(jo_row["payload"])); run(mina.open_encounter(mina_row["payload"]))
    prop = run(jo.on_ack(run(mina.on_propose(run(jo.on_have_listings(run(mina.on_looking_for(looking))))))))
    run(mina.owner_message("decline"))
    assert app.proposals[prop["id"]]["status"] == "declined" and app.items["romper"]["status"] == "listed"
    upd = [r for r in app.inbox if r["payload"].get("type") == "proposal:updated"][-1]
    assert run(jo.event(upd["payload"]))[0].text == w.declined()
    with pytest.raises(Exception):
        run(app._api("payProposal", {"proposalId": prop["id"], "parentId": "jo"}))
