"""pytest -q agents/tests  — no network, no uAgents runtime: drives ClosetBrain against MockBase44 (B's real shapes)."""

from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cards  # noqa: E402
import wording as w  # noqa: E402
from base44_client import Base44Error  # noqa: E402
from closet_agent import ClosetBrain  # noqa: E402
from intents import intent_from_card, parse_card_reply, parse_claim, parse_condition, parse_intent  # noqa: E402
from mock_base44 import DEFAULT_IDS, MockBase44  # noqa: E402
from relay_protocol import HaveListings, LookingFor, NoFit, ProposeTrade, TradeAck  # noqa: E402

JO_FIRST = {"mina": DEFAULT_IDS["jo"], "jo": DEFAULT_IDS["mina"]}  # swap ids → Jo's pet opens the encounter


def run(coro):
    return asyncio.run(coro)


def make_brains(app, **kw):
    directory = {app.id(k): {"key": k, "name": app.parents[app.id(k)]["name"], "pet": app.parents[app.id(k)]["pet"]["name"]}
                 for k in ("mina", "jo", "sam")}
    return {k: ClosetBrain(app, k, app.id(k), "http://app", directory=directory, **kw) for k in ("mina", "jo", "sam")}


@pytest.fixture
def app():
    return MockBase44()


@pytest.fixture
def brains(app):
    return make_brains(app)


def events(app, who, type_=None, since=0):
    """Event payloads for one parent (oldest first), marking them done like the agent's poll would."""
    out = []
    for r in app.inbox[since:]:
        if r["parentId"] == app.id(who) and r["type"] == "event" and r["status"] == "pending" and (not type_ or r["payload"]["type"] == type_):
            r["status"] = "done"
            out.append(r["payload"])
    return out


def texts(replies):
    return [r.text for r in replies]


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


def test_short_date_works_on_every_os():
    # strftime("%-d") raises on Windows; B sends full ISO timestamps
    assert w.short_date("2026-11-17T00:00:00.000Z") == "Nov 17"
    assert w.short_date("2026-08-07") == "Aug 7"
    assert w.short_date(None) == "soon" and w.short_date("someday") == "someday"


def test_lines_are_short_and_plain():
    for fn, args in [(w.nudge, ("romper", "6-9M")), (w.listed, (1800, 3000, 1)), (w.proposal, ("romper", 1800, 3000, 1, "Pip")),
                     (w.completed, ("romper", "Nov 17")), (w.declined, ()), (w.hello, ("Button",)), (w.expired, ()),
                     (w.payment_failed, ()), (w.not_yet, ()), (w.already_listed, ("romper", 1800)), (w.t_hello, ("Button",))]:
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
    assert app.set_clock("2026-09-20T17:00:00.000Z") == 1  # only the romper is due (B's seed rule)
    ev = events(app, "mina", "nudge:new")[0]
    assert set(ev) == {"type", "nudgeId", "itemId", "kind", "message"}  # types.ts InboxEvent
    out = run(mina.event(ev))
    assert "getting snug" in out[0].text and out[0].card[0] == "detail"
    assert "photo" in run(mina.owner_message("sell it"))[0].text
    assert "gently used" in run(mina.owner_message("", ["https://x/photo.jpg"]))[0].text
    assert run(mina.owner_message("yes"))[0].text == "Listed at $18.00 — 2nd owner pays 60% of $30.00."
    listing = next(iter(app.listings.values()))
    assert listing["priceCents"] == 1800 and listing["shared"] and app.items["romper"]["status"] == "listed"
    assert app.items["romper"]["photos"][0] == "https://x/photo.jpg"
    assert all(n["resolved"] for n in app.nudges.values())  # B's listItem resolves the outgrow nudge…
    assert "agentApi:resolveNudge" not in app.calls          # …so the agent doesn't spend a call on it


def test_keep_and_later_resolve_nudge(app, brains):
    app.set_clock("2026-09-20T17:00:00.000Z")
    assert run(brains["mina"].owner_message("keep"))[0].text == w.keep()
    assert all(n["resolved"] for n in app.nudges.values())
    assert app.set_clock("2026-09-21T17:00:00.000Z") == 0  # B never re-nudges an item after keep/later/sell
    app.nudges["n2"] = {"id": "n2", "parentId": app.id("mina"), "itemId": "romper", "kind": "outgrow_check", "message": "", "createdAt": "", "resolved": False}
    assert run(brains["mina"].owner_message("later please"))[0].text == w.later()  # "later" → B's "snooze"
    assert app.nudges["n2"]["resolved"]


def test_third_owner_cannot_sell(app, brains):
    out = run(brains["sam"].owner_message("sell the cardigan"))
    assert "final home" in out[0].text and not app.listings


def test_named_item_beats_the_nudge(app, brains):
    app.set_clock("2026-09-20T17:00:00.000Z")  # romper nudge open
    out = run(brains["mina"].owner_message("sell the striped tee"))
    assert "Striped long-sleeve tee" in out[0].text
    assert brains["mina"].convo["itemId"] == "tee" and brains["mina"].convo["nudgeId"] is None


def test_sell_twice_says_already_listed(app, brains):
    list_romper(app, brains)
    out = run(brains["mina"].owner_message("sell the romper"))
    assert out[0].text == w.already_listed("Yellow duck romper", 1800)


def test_refused_listing_is_a_friendly_line(app, brains):
    mina = brains["mina"]
    mina.convo = {"step": "await_condition", "itemId": "romper", "itemName": "Yellow duck romper", "photoUrl": "https://x/p.jpg", "condition": "brand_new"}
    out = run(mina.owner_message("yes"))  # B: 400 unknown condition
    assert out[0].text == w.list_failed("Yellow duck romper") and not app.listings and mina.convo == {"step": "idle"}


def test_bag(app, brains):
    out = run(brains["mina"].owner_message("bag"))
    assert "Yellow duck romper 6-9M ♥♡♡" in out[0].text and "Knit bear sweater 9-12M ♥♥♡" in out[0].text


def test_pay_link_uses_the_seed_key_not_the_id(app, brains):
    link = brains["jo"].pay_link("prop_1")
    assert link == "http://app/trade/prop_1?as=jo" and app.id("jo") not in link


# ---- relay (agent ↔ agent) --------------------------------------------------

def list_romper(app, brains):
    app.set_clock("2026-09-20T17:00:00.000Z")
    events(app, "mina", "nudge:new")  # the agent's poll would have taken it
    run(brains["mina"].owner_message("sell it"))
    run(brains["mina"].owner_message("", ["https://x/p.jpg"]))
    run(brains["mina"].owner_message("yes"))
    app.set_clock("2026-10-18T17:00:00.000Z")


def converse(app, brains, a, b, late_row=None):
    """meet(a, b), feed both encounter rows, then pass RelayProtocol messages until the pets stop.
    late_row=key: that parent's encounter row is handled only after the first message reached it."""
    enc = app.meet(a, b)
    by_id = {br.parent_id: br for br in brains.values()}
    rows = [r for r in app.inbox if r["type"] == "encounter" and r["payload"]["encounterId"] == enc]
    for r in rows:
        r["status"] = "done"
    wire, late = [], None
    for r in rows:
        brain = by_id[r["parentId"]]
        if late_row and brain.parent_name == late_row:
            late = (brain, r["payload"])
            continue
        out = run(brain.open_encounter(r["payload"]))
        if out is not None:
            wire.append((brain, by_id[r["payload"]["peer"]["parentId"]], out))
    while wire:
        sender, receiver, msg = wire.pop(0)
        reply = run(receiver.on_relay(msg))
        if late and receiver is late[0]:
            assert run(late[0].open_encounter(late[1])) is None  # the seller side never opens late
            late = None
        if reply is not None:
            wire.append((receiver, sender, reply))
        wire_log.append(msg)
    return enc


wire_log = []


def only_proposal(app):
    assert len(app.proposals) == 1
    return next(iter(app.proposals.values()))


def test_relay_mina_opens_and_the_roles_swap(app, brains):
    # On live, Mina's parent id sorts first, so C makes Mina's pet the "buyer" side — but only Jo has a need.
    list_romper(app, brains)
    wire_log.clear()
    enc = converse(app, brains, "mina", "jo")
    prop = only_proposal(app)
    assert prop["buyerId"] == app.id("jo") and prop["sellerId"] == app.id("mina")
    assert prop["status"] == "open" and prop["source"] == "fetch" and prop["snapshot"]["priceCents"] == 1800
    assert app.encounters[enc]["status"] == "proposed"
    assert [type(m).__name__ for m in wire_log] == ["LookingFor", "LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
    t = app.encounters[enc]["transcript"]  # what createProposal wrote: both pets, in order
    assert [x["kind"] for x in t] == ["looking_for", "looking_for", "have", "fit_check", "propose", "ack"]
    assert [x["text"].split(":")[0] for x in t] == ["Button", "Pip", "Button", "Pip", "Pip", "Button"]
    assert {x["parentId"] for x in t if x["text"].startswith("Button")} == {app.id("mina")}
    assert {x["parentId"] for x in t if x["text"].startswith("Pip")} == {app.id("jo")}
    assert prop["transcript"] == t
    # privacy (rule 3): nothing but shared data and bubbles crossed the wire
    blob = json.dumps([m.dict() for m in wire_log])
    for secret in ("2025-12-10", "2026-03-01", "Mina", "Jo", "phone", "lat", "lng", app.id("mina"), app.id("jo")):
        assert secret not in blob


def test_relay_jo_opens():
    app = MockBase44(ids=JO_FIRST)
    brains = make_brains(app)
    list_romper(app, brains)
    wire_log.clear()
    enc = converse(app, brains, "mina", "jo")
    prop = only_proposal(app)
    assert prop["buyerId"] == app.id("jo") and app.encounters[enc]["status"] == "proposed"
    assert [type(m).__name__ for m in wire_log] == ["LookingFor", "HaveListings", "ProposeTrade", "TradeAck"]
    assert [x["kind"] for x in app.encounters[enc]["transcript"]] == ["looking_for", "have", "fit_check", "propose", "ack"]


def test_relay_late_encounter_row_still_trades(app, brains):
    # Jo's own encounter row lands after Mina's opener reached Jo: Jo learns Mina's id late, the trade still happens.
    list_romper(app, brains)
    brains["jo"].peer_wait_s = 0
    enc = converse(app, brains, "mina", "jo", late_row="jo")
    prop = only_proposal(app)
    assert prop["buyerId"] == app.id("jo") and prop["sellerId"] == app.id("mina")
    assert all(x["parentId"] for x in app.encounters[enc]["transcript"])


def test_relay_nothing_listed_ends_in_no_match(app, brains):
    wire_log.clear()
    enc = converse(app, brains, "mina", "jo")  # romper not listed → nothing either way
    assert not app.proposals and app.encounters[enc]["status"] == "no_match"
    assert [type(m).__name__ for m in wire_log] == ["LookingFor", "LookingFor", "NoFit"]


def test_relay_nobody_needs_anything(app, brains):
    list_romper(app, brains)
    wire_log.clear()
    enc = converse(app, brains, "mina", "sam")  # Sam has no need; Mina has nothing Sam wants
    assert not app.proposals and app.encounters[enc]["status"] == "no_match"
    assert [type(m).__name__ for m in wire_log] == ["LookingFor", "NoFit"]


def test_seller_rejects_changed_price(app, brains):
    list_romper(app, brains)
    enc = app.meet("mina", "jo")
    lid = next(iter(app.listings))
    ack = run(brains["mina"].on_propose(ProposeTrade(encounter_id=enc, listing_id=lid, price_cents=100, reason="x")))
    assert not ack.ok and ack.line.startswith("Button:")


def test_second_ack_is_idempotent(app, brains):
    list_romper(app, brains)
    enc = converse(app, brains, "mina", "jo")
    prop = only_proposal(app)
    again = run(brains["jo"].on_ack(TradeAck(encounter_id=enc, listing_id=prop["listingId"], ok=True)))
    assert again["id"] == prop["id"] and len(app.proposals) == 1  # B returns the live proposal to the same buyer


def test_refused_proposal_ends_the_encounter(app, brains):
    list_romper(app, brains)
    enc = app.meet("mina", "jo")
    brains["jo"]._peer(enc)["parentId"] = app.id("mina")
    app.needs.clear()  # Jo's need disappears mid-talk → B: not_eligible
    lid = next(iter(app.listings))
    assert run(brains["jo"].on_ack(TradeAck(encounter_id=enc, listing_id=lid, ok=True))) is None
    assert app.encounters[enc]["status"] == "no_match" and not app.proposals


def test_append_turns_off_still_sends_the_whole_transcript(app):
    brains = make_brains(app, append_turns=False)
    list_romper(app, brains)
    enc = converse(app, brains, "mina", "jo")
    assert "agentApi:appendTurn" not in app.calls
    assert [x["kind"] for x in app.encounters[enc]["transcript"]] == ["looking_for", "looking_for", "have", "fit_check", "propose", "ack"]


# ---- two-sided accept + pay ---------------------------------------------------

def trade(app, brains):
    list_romper(app, brains)
    converse(app, brains, "mina", "jo")
    return only_proposal(app)


def test_accept_pay_and_welcome(app, brains):
    jo, mina = brains["jo"], brains["mina"]
    prop = trade(app, brains)
    assert "Button and I found a match: the Yellow duck romper for $18.00" in run(jo.event(events(app, "jo", "proposal:new")[0]))[0].text
    assert "Pip and I found a match" in run(mina.event(events(app, "mina", "proposal:new")[0]))[0].text

    assert run(jo.owner_message("accept")) == []
    assert app.proposals[prop["id"]]["status"] == "open"  # one side is not enough (rule 1)
    assert texts(run(jo.event(events(app, "jo", "proposal:updated")[0]))) == ["You accepted! Waiting on Mina now."]
    nudge_mina = run(mina.event(events(app, "mina", "proposal:updated")[0]))[0]
    assert nudge_mina.text == 'Jo accepted — your turn! Reply "accept" or "decline".' and nudge_mina.card[0] == "review"
    assert texts(run(jo.owner_message("I accept"))) == ["You accepted! Waiting on Mina now."]  # no second decide call

    assert run(mina.owner_message("accept")) == []
    assert app.proposals[prop["id"]]["status"] == "both_accepted"
    jo_pay = run(jo.event(events(app, "jo", "proposal:updated")[0]))[0]
    assert jo_pay.text == f"Both of you said yes! Tap to pay (demo payment · no real charge): http://app/trade/{prop['id']}?as=jo"
    assert jo_pay.card[1]["title"] == "Demo payment · no real charge"
    assert texts(run(mina.event(events(app, "mina", "proposal:updated")[0]))) == ["You accepted! Waiting on the buyer to pay now."]
    pay = run(jo.owner_message("pay"))
    assert "demo payment" in pay[0].text and prop["id"] in pay[0].text and "?as=jo" in pay[0].text

    # ASI:One pay card → payProposal (→ {proposal, item})
    assert run(jo.owner_message("", selection={"action": "pay", "proposal_id": prop["id"]})) == []
    assert app.proposals[prop["id"]]["status"] == "paid"
    romper = app.items["romper"]
    assert romper["currentOwnerId"] == app.id("jo") and romper["ownerCount"] == 2 and romper["status"] == "in_closet"
    jo_ev, mina_ev = events(app, "jo"), events(app, "mina")
    assert [e["type"] for e in jo_ev] == ["trade:completed", "nudge:new"] and [e["type"] for e in mina_ev] == ["trade:completed"]
    assert set(jo_ev[0]) == {"type", "proposalId", "role", "itemId", "priceCents"}  # B today: no snapshot
    jo_line = run(jo.event(jo_ev[0]))[0]
    mina_line = run(mina.event(mina_ev[0]))[0]
    assert jo_line.text == "Say hi to the Yellow duck romper! It should fit until ~Nov 17. I'll check in then."
    assert mina_line.text == "The Yellow duck romper found its next home for $18.00. Flowers all round!"
    assert jo_line.image_url == "http://app/fx/flowers.gif" and mina_line.image_url == "http://app/fx/flowers.gif"
    calls = len(app.calls)
    assert run(jo.event(jo_ev[1])) == []  # the welcome nudge repeats trade:completed → said once, no state read
    assert len(app.calls) == calls


@pytest.mark.parametrize("rich", [False, True])
def test_trade_completed_from_a_fresh_agent(rich):
    """A just-restarted agent (no cached proposal) never KeyErrors, with B's lean payload or W3's rich one."""
    app = MockBase44(rich_trade_events=rich)
    brains = make_brains(app)
    prop = trade(app, brains)
    run(app._api("decideProposal", {"proposalId": prop["id"], "parentId": app.id("mina"), "decision": "accepted"}))
    run(app._api("decideProposal", {"proposalId": prop["id"], "parentId": app.id("jo"), "decision": "accepted"}))
    run(app._api("payProposal", {"proposalId": prop["id"], "parentId": app.id("jo")}))
    fresh = make_brains(app)
    jo_done = next(e for e in events(app, "jo") if e["type"] == "trade:completed")
    mina_done = next(e for e in events(app, "mina") if e["type"] == "trade:completed")
    assert ("snapshot" in jo_done) is rich
    calls = len(app.calls)
    assert run(fresh["jo"].event(jo_done))[0].text == "Say hi to the Yellow duck romper! It should fit until ~Nov 17. I'll check in then."
    assert run(fresh["mina"].event(mina_done))[0].text == "The Yellow duck romper found its next home for $18.00. Flowers all round!"
    assert (len(app.calls) == calls) is rich  # the rich payload needs no getState at all


def test_trade_completed_with_almost_nothing():
    app = MockBase44()
    mina = make_brains(app)["mina"]
    out = run(mina.event({"type": "trade:completed", "proposalId": "gone", "role": "seller", "priceCents": 1800}))
    assert out[0].text == "The new item found its next home for $18.00. Flowers all round!"


def test_decline_charges_nothing(app, brains):
    jo, mina = brains["jo"], brains["mina"]
    prop = trade(app, brains)
    events(app, "jo"), events(app, "mina")
    assert run(mina.owner_message("decline")) == []
    assert app.proposals[prop["id"]]["status"] == "declined" and app.items["romper"]["status"] == "listed"
    assert texts(run(jo.event(events(app, "jo", "proposal:updated")[0]))) == [w.declined()]
    with pytest.raises(Base44Error) as e:
        run(app._api("payProposal", {"proposalId": prop["id"], "parentId": app.id("jo")}))
    assert e.value.code == "invalid_transition"
    assert texts(run(jo.owner_message("pay"))) == [w.no_open_proposal()]


def test_pay_before_both_accept(app, brains):
    trade(app, brains)
    assert texts(run(brains["jo"].owner_message("pay"))) == [w.not_yet()]


@pytest.mark.parametrize("status,line", [("expired", w.expired()), ("payment_failed", w.payment_failed()), ("paid", None)])
def test_terminal_statuses_have_their_own_line(app, brains, status, line):
    prop = trade(app, brains)
    payload = {"type": "proposal:updated", "proposalId": prop["id"], "role": "buyer", "status": status,
               "sellerDecision": "accepted", "buyerDecision": "accepted"}
    assert texts(run(brains["jo"].event(payload))) == ([line] if line else [])


def test_row_age_reads_createdAt_and_base44_created_date():
    from datetime import datetime, timezone

    from closet_agent import row_age_s
    now = datetime(2026, 10, 18, 17, 10, tzinfo=timezone.utc)
    assert row_age_s({"createdAt": "2026-10-18T17:00:00.000Z"}, now) == 600
    assert row_age_s({"createdAt": "2026-10-18T17:09:30+00:00"}, now) == 30
    assert row_age_s({"created_date": "2026-10-18T17:05:00.000000"}, now) == 300  # Base44's naive UTC
    assert row_age_s({"createdAt": "2026-10-18T17:20:00Z"}, now) == 0  # clock skew → fresh, never negative
    assert row_age_s({}, now) is None and row_age_s({"createdAt": "soon"}, now) is None


def _both_accepted_then_paid(app, brains):
    prop = trade(app, brains)
    run(app._api("decideProposal", {"proposalId": prop["id"], "parentId": app.id("mina"), "decision": "accepted"}))
    run(app._api("decideProposal", {"proposalId": prop["id"], "parentId": app.id("jo"), "decision": "accepted"}))
    both = next(e for e in events(app, "jo", "proposal:updated") if e["status"] == "both_accepted")
    run(app._api("payProposal", {"proposalId": prop["id"], "parentId": app.id("jo")}))
    return prop, both


def test_backlogged_both_accepted_is_quiet_once_paid(app, brains):
    """Agent started after a rehearsal: no "tap to pay" for a trade that is already paid; trade:completed speaks."""
    prop, both = _both_accepted_then_paid(app, brains)
    assert run(make_brains(app)["jo"].event(both)) == []  # fresh agent: one getState shows it paid
    jo = brains["jo"]  # cached the proposal while it was still open
    assert "Tap to pay" in run(jo.event(both))[0].text  # a fresh row trusts its payload (no extra call)
    calls = len(app.calls)
    assert run(jo.event(both, age_s=300)) == []  # an old row is checked first
    assert app.calls[calls:] == ["agentApi:getState"]
    done = next(e for e in events(app, "jo") if e["type"] == "trade:completed")
    assert run(jo.event(done))[0].text.startswith("Say hi to the Yellow duck romper!")


def test_update_older_than_the_known_status_is_quiet_without_a_read(app, brains):
    jo = brains["jo"]
    prop = trade(app, brains)
    run(app._api("decideProposal", {"proposalId": prop["id"], "parentId": app.id("mina"), "decision": "accepted"}))
    mina_said_yes = events(app, "jo", "proposal:updated")[0]
    assert mina_said_yes["status"] == "open"
    jo.props[prop["id"]] = {**app.proposals[prop["id"]], "status": "both_accepted"}  # a later read already saw more
    calls = len(app.calls)
    assert run(jo.event(mina_said_yes)) == []
    assert len(app.calls) == calls
    jo.props[prop["id"]]["status"] = "open"
    assert texts(run(jo.event(mina_said_yes))) == ['Mina accepted — your turn! Reply "accept" or "decline".']


def test_nudge_answered_in_the_app_meanwhile_is_silent(app, brains):
    app.set_clock("2026-09-20T17:00:00.000Z")
    ev = events(app, "mina", "nudge:new")[0]
    run(app._api("resolveNudge", {"nudgeId": ev["nudgeId"], "decision": "keep"}))
    assert run(brains["mina"].event(ev)) == []


# ---- housekeeping -------------------------------------------------------------

def test_recheck_parent_follows_a_reseed(app, brains):
    mina = brains["mina"]
    assert run(mina.recheck_parent("agent1qmina")) is False
    assert app.calls[-1] == "agentApi:lookupParent"  # same id → no registerAgent
    old, new = app.id("mina"), "6ad4679ef87aed77173808ff"
    app.parents[new] = {**app.parents.pop(old), "id": new}  # re-seed with a new id
    assert run(mina.recheck_parent("agent1qmina")) is True
    assert mina.parent_id == new and app.parents[new]["agentAddress"] == "agent1qmina"
    assert mina.directory[new]["pet"] == "Button"
