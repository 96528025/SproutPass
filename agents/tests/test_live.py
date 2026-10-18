"""The live runner's parts, offline: config loading, the shared call budget, HTTP error mapping, the Bureau inbox hub."""

from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from base44_client import Base44Client, Base44Error, CallBudget, RateLimited, error_code, is_rate_limited  # noqa: E402
from closet_agent import ClosetBrain  # noqa: E402
from live_bureau import LIVE_URL, InboxHub, agent_addresses, load_config, seed_for  # noqa: E402
from mock_base44 import MockBase44  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class Clock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


# ---- config -------------------------------------------------------------------

def test_config_env_beats_files_and_defaults_fill_in(tmp_path):
    local = tmp_path / ".env.local"
    local.write_text("AGENT_KEY=from-env-local\nVITE_SOMETHING=x\n", encoding="utf-8")
    dot = tmp_path / ".env"
    dot.write_text("# comment\nexport POLL_S='20'\nAGENT_KEY=\"from-dot-env\"\n", encoding="utf-8")
    cfg = load_config(env={}, files=[str(dot), str(local)])
    assert cfg["AGENT_KEY"] == "from-dot-env" and cfg["POLL_S"] == "20"
    assert cfg["BASE44_URL"] == LIVE_URL and cfg["APP_URL"] == LIVE_URL and cfg["CALLS_PER_MIN"] == "8"
    assert "VITE_SOMETHING" not in cfg
    cfg = load_config(env={"AGENT_KEY": "from-env", "BASE44_URL": "https://x.base44.app/"}, files=[str(local)])
    assert cfg["AGENT_KEY"] == "from-env" and cfg["BASE44_URL"] == "https://x.base44.app" and cfg["APP_URL"] == "https://x.base44.app"
    assert load_config(env={}, files=[str(local)])["AGENT_KEY"] == "from-env-local"
    assert "AGENT_KEY" not in load_config(env={}, files=[str(tmp_path / "missing")])


def test_addresses_are_stable_per_team_secret():
    a, b = agent_addresses("dev"), agent_addresses("dev")
    assert a == b and len(set(a.values())) == 3 and all(v.startswith("agent1q") for v in a.values())
    assert agent_addresses("other")["mina"] != a["mina"]
    assert seed_for("mina", "dev") == "relay-mina-dev"  # same seed as closet_agent.build_agent


# ---- call budget --------------------------------------------------------------

def test_budget_caps_calls_per_rolling_minute():
    clock = Clock()
    b = CallBudget(3, clock=clock)
    for _ in range(3):
        run(b.acquire())
    assert b.available() == 0 and b.wait_s() == pytest.approx(60.0)
    clock.t += 30
    assert b.wait_s() == pytest.approx(30.0)
    clock.t += 30
    assert b.available() == 3 and b.used == 3


def test_budget_backs_off_harder_on_repeated_429():
    clock = Clock()
    b = CallBudget(8, clock=clock)
    assert b.penalize() == 15 and b.available() == 0
    assert b.penalize() == 30 and b.penalize() == 60 and b.penalize() == 120 and b.penalize() == 120
    assert b.wait_s() == pytest.approx(120)
    b.ok()
    assert b.penalize(retry_after=5) == 5 and b.strikes == 1


# ---- HTTP error mapping (fake aiohttp session, no sockets) ------------------------

class _Resp:
    def __init__(self, status, text, headers=None):
        self.status, self._text, self.headers = status, text, headers or {}

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    def __init__(self, responses):
        self.responses, self.posts = list(responses), []

    def post(self, url, json=None):
        self.posts.append((url, json))
        return self.responses.pop(0)

    async def close(self):
        pass


def client_with(*responses, budget=None):
    c = Base44Client("https://app.example", "k", budget=budget)
    c._session = _Session(responses)
    return c


def test_error_codes_from_both_error_shapes():
    assert error_code(409, {"error": "createProposal: not_eligible: buyer has no shared need"}) == "not_eligible"
    assert error_code(409, {"error": {"code": "already_open", "message": "x"}}) == "already_open"
    assert error_code(404, {"error": "no parent named zed"}) == "not_found"
    assert error_code(500, {"error": "boom"}) is None
    assert is_rate_limited(429, "") and is_rate_limited(500, {"error": "Rate limit exceeded"})
    assert is_rate_limited(500, {"error": {"code": "internal", "message": "rate limit"}})
    assert not is_rate_limited(409, {"error": "listItem: not_resellable: Final home"})


def test_429_is_not_retried_and_pauses_everyone():
    clock = Clock()
    budget = CallBudget(8, clock=clock)
    c = client_with(_Resp(429, '{"error":"Rate limit exceeded"}', {"Retry-After": "7"}), budget=budget)
    with pytest.raises(RateLimited) as e:
        run(c.api("getState", parentId="p"))
    assert e.value.retry_after == 7 and len(c._session.posts) == 1 and budget.wait_s() == pytest.approx(7)


def test_b_error_keeps_status_and_code_and_success_resets_strikes():
    budget = CallBudget(8, clock=Clock())
    budget.strikes = 2
    c = client_with(_Resp(409, '{"error":"listItem: not_resellable: Final home: this item has had its 3 owners."}'),
                    _Resp(200, '{"rows":[{"id":"r1"}]}'), budget=budget)
    with pytest.raises(Base44Error) as e:
        run(c.list_item(itemId="i"))
    assert e.value.status == 409 and e.value.code == "not_resellable" and not isinstance(e.value, RateLimited)
    assert run(c.claim_inbox(None, "agent1q")) == [{"id": "r1"}]
    url, body = c._session.posts[-1]
    assert url == "https://app.example/functions/agentApi" and body == {"action": "claimInbox", "agentAddress": "agent1q", "limit": 5}
    assert budget.strikes == 0


def test_non_json_error_page_is_a_base44_error():
    c = client_with(_Resp(502, "<html>Bad gateway</html>"))
    with pytest.raises(Base44Error) as e:
        run(c.now())
    assert e.value.status == 502 and "Bad gateway" in str(e.value)


# ---- inbox hub ------------------------------------------------------------------

def hub_for(app, clock, **kw):
    """types=None: these hub tests use imessage rows, so they run the claim-every-type mode (INBOX_TYPES=all)."""
    brains = [ClosetBrain(app, k, app.id(k)) for k in ("mina", "jo", "sam")]
    kw.setdefault("types", None)
    return brains, InboxHub(app, brains, clock=clock, poll_s=12, fast_s=4, fast_window_s=90, **kw)


def test_hub_claims_once_for_all_parents_and_shares_out():
    app, clock = MockBase44(), Clock()
    brains, hub = hub_for(app, clock)
    app.push("mina", "imessage", {"text": "hi"})
    app.push("jo", "imessage", {"text": "bag"})
    mina, jo, sam = (hub.source_for(b) for b in brains)
    assert [r["payload"]["text"] for r in run(mina())] == ["hi"]
    assert app.calls == ["agentApi:claimInbox"]
    assert [r["payload"]["text"] for r in run(jo())] == ["bag"] and run(sam()) == []
    assert app.calls == ["agentApi:claimInbox"]  # one poll served all three
    assert all(r["status"] == "claimed" and r["claimedBy"] == "live-bureau" for r in app.inbox)


def test_hub_polls_slow_when_idle_fast_when_busy():
    app, clock = MockBase44(), Clock()
    brains, hub = hub_for(app, clock)
    take = hub.source_for(brains[0])
    run(take())
    assert hub.next_at == clock.t + 12  # idle
    clock.t += 5
    run(take())
    assert hub.polls == 1  # not due yet
    clock.t += 7
    app.push("mina", "imessage", {"text": "hi"})
    run(take())
    assert hub.polls == 2 and hub.next_at == clock.t + 4  # something arrived → fast for 90 s
    clock.t += 91
    run(take())
    assert hub.next_at == clock.t + 12


def test_hub_waits_out_a_rate_limit_and_spares_the_last_calls():
    app, clock = MockBase44(), Clock()
    brains, hub = hub_for(app, clock)
    take = hub.source_for(brains[0])
    app.rate_limit_next = 1
    assert run(take()) == [] and hub.next_at == clock.t + 30
    app.budget = CallBudget(8, clock=clock)
    clock.t += 30
    app.budget.stamps.extend([clock.t] * 6)  # 2 left: keep them for the agents' own calls
    run(take())
    assert hub.polls == 0 and app.calls == ["agentApi:claimInbox"]


def test_hub_rows_for_a_reseeded_parent_reach_the_agent():
    app, clock = MockBase44(), Clock()
    old, new = app.id("jo"), "6ad4679ef87aed77173808ff"
    seen = []
    brains, hub = hub_for(app, clock)

    async def on_unknown():
        seen.append(True)
        for b in brains:
            await b.recheck_parent(f"agent1q{b.parent_name}")

    hub.on_unknown = on_unknown
    app.parents[new] = {**app.parents.pop(old), "id": new}  # demo re-seeded Jo with a new id
    app.push(new, "imessage", {"text": "bag"})
    app.push("6ad4679ef87aed7717380000", "imessage", {"text": "who?"})  # nobody's
    jo = brains[1]
    rows = run(hub.source_for(jo)())
    assert seen and jo.parent_id == new and [r["payload"]["text"] for r in rows] == ["bag"]
    assert app.parents[new]["agentAddress"] == "agent1qjo"
    assert [r["payload"]["text"] for r in hub.orphans] == ["who?"]


# ---- the agent's poll loop (uAgents interval handler, called directly) ---------------

def test_poll_keeps_a_rate_limited_row_and_finishes_it_next_tick():
    import logging
    from types import SimpleNamespace

    from uagents import Agent

    from closet_agent import attach
    from live_bureau import OfflinePolicy

    asyncio.set_event_loop(asyncio.new_event_loop())  # uAgents wants a current loop at construction
    app = MockBase44()
    agent = Agent(name="mina-closet", seed="test-poll-mina", mailbox=False, registration_policy=OfflinePolicy(),
                  publish_agent_details=False, enable_agent_inspector=False)
    brain = ClosetBrain(app, "mina", app.id("mina"), "http://app")
    attach(agent, brain, poll_s=1.0, recheck_s=0, register=False, publish_manifest=False, inbox_types=None)
    (poll, period), = agent._protocol.intervals
    assert period == 1.0
    ctx = SimpleNamespace(logger=logging.getLogger("test"), send=None)

    real, hits = app.get_state, []

    async def flaky(*a, **k):
        hits.append(1)
        if len(hits) == 1:
            raise RateLimited("agentApi:getState 429: rate limited")
        return await real(*a, **k)

    app.get_state = flaky
    row = app.push("mina", "imessage", {"text": "bag"})
    run(poll(ctx))
    assert row["status"] == "claimed" and not app.sent  # kept, nothing said, not completed
    run(poll(ctx))
    assert row["status"] == "done" and "Yellow duck romper" in app.sent[0]["text"]
    assert app.calls.count("agentApi:claimInbox") == 1  # the backlog was retried before claiming more


# ---- stale inbox rows (agent started after a rehearsal without RESET) ------------------

class FakeCtx:
    """Just enough of a uAgents Context for the interval and chat handlers."""

    def __init__(self):
        import logging
        self.logger = logging.getLogger("test")
        self.out = []

    async def send(self, to, msg):
        self.out.append((to, msg))

    def texts(self, to):
        from uagents_core.contrib.protocols.chat import ChatMessage
        return [m.content[0].text for a, m in self.out if a == to and isinstance(m, ChatMessage)]


def _attached(app, **kw):
    from uagents import Agent

    from closet_agent import attach
    from live_bureau import OfflinePolicy

    asyncio.set_event_loop(asyncio.new_event_loop())  # uAgents wants a current loop at construction
    agent = Agent(name="mina-closet", seed="test-attach-mina", mailbox=False, registration_policy=OfflinePolicy(),
                  publish_agent_details=False, enable_agent_inspector=False)
    brain = ClosetBrain(app, "mina", app.id("mina"), "http://app")
    kw.setdefault("inbox_types", None)  # these tests feed imessage / event rows: the claim-every-type mode
    attach(agent, brain, poll_s=1.0, recheck_s=0, register=False, publish_manifest=False, **kw)
    (poll, _), = agent._protocol.intervals
    return agent, brain, poll


def _age(row, minutes):
    from datetime import datetime, timedelta, timezone
    row["createdAt"] = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    return row


def test_poll_completes_stale_rows_without_a_word():
    import wording as w

    app = MockBase44()
    _, _, poll = _attached(app)
    rows = [_age(app.push("mina", "imessage", {"text": "accept"}), 20),
            _age(app.push("mina", "event", {"type": "trade:completed", "proposalId": "p0", "role": "seller",
                                            "itemId": "romper", "priceCents": 1800}), 45),
            _age(app.push("mina", "imessage", {"text": "help"}), 1)]
    run(poll(FakeCtx()))
    assert [r["status"] for r in rows] == ["done", "done", "done"]
    assert [s["text"] for s in app.sent] == [w.help_text()]  # only the fresh row speaks
    assert "agentApi:getState" not in app.calls and "agentApi:decideProposal" not in app.calls


def test_poll_max_age_zero_answers_everything():
    import wording as w

    app = MockBase44()
    _, _, poll = _attached(app, max_age_s=0)
    _age(app.push("mina", "imessage", {"text": "help"}), 60 * 24)
    run(poll(FakeCtx()))
    assert [s["text"] for s in app.sent] == [w.help_text()]


# ---- ASI:One: only the claimed owner acts for the parent -------------------------------

def _chat(agent, ctx, sender, text):
    from uuid import uuid4
    from datetime import datetime, timezone

    from uagents import Model
    from uagents_core.contrib.protocols.chat import ChatMessage, TextContent

    handler = agent._signed_message_handlers[Model.build_schema_digest(ChatMessage)]
    run(handler(ctx, sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(text=text)])))
    return ctx.texts(sender)[-1]


STRANGER, OWNER = "agent1qstranger", "agent1qowner"


def test_asi_closed_by_default_unclaimed_sender_gets_only_the_claim_prompt(monkeypatch):
    monkeypatch.delenv("ASI_OPEN", raising=False)
    app = MockBase44()
    agent, _, _ = _attached(app)
    ctx = FakeCtx()
    for text in ("bag", "accept", "pay", "sell", json.dumps({"action": "pay", "proposal_id": "p1"})):
        assert _chat(agent, ctx, STRANGER, text) == "Say: claim mina-<code> first so I know it's you."
    assert not [c for c in app.calls if c != "agentApi:claimInbox"]  # not one call made for a stranger


def test_asi_open_lets_a_stranger_look_but_never_act_or_hear_the_owner_lines():
    app = MockBase44()
    agent, brain, poll = _attached(app, asi_open=True)
    ctx = FakeCtx()
    assert "Yellow duck romper" in _chat(agent, ctx, STRANGER, "bag")
    for text in ("sell the romper", "accept", "decline", "pay", "keep", "yes", "gently used",
                 json.dumps({"action": "accept", "proposal_id": "p1"})):
        assert _chat(agent, ctx, STRANGER, text).startswith("Only Mina can do that.")
    assert brain.convo == {"step": "idle"}
    assert not {"agentApi:listItem", "agentApi:resolveNudge", "agentApi:decideProposal", "agentApi:payProposal"} & set(app.calls)
    seen = len(ctx.out)
    app.push("mina", "imessage", {"text": "bag"})  # the owner texts the pet: the line goes to iMessage, not to the stranger
    run(poll(ctx))
    assert app.sent and ctx.out[seen:] == []


def test_asi_claimed_owner_acts_and_gets_the_mirrored_lines(monkeypatch):
    monkeypatch.delenv("ASI_OPEN", raising=False)
    app = MockBase44()
    agent, brain, poll = _attached(app)
    ctx = FakeCtx()
    assert _chat(agent, ctx, OWNER, "claim mina-1234").startswith("That code didn't match")
    assert _chat(agent, ctx, OWNER, "claim mina-0000").startswith("Linked!")
    assert "Yellow duck romper" in _chat(agent, ctx, OWNER, "bag")
    assert _chat(agent, ctx, STRANGER, "bag").startswith("Say: claim mina-")  # someone else is still a stranger
    app.push("mina", "imessage", {"text": "help"})
    run(poll(ctx))
    assert ctx.texts(OWNER)[-1] == app.sent[-1]["text"]  # mirrored to the claimed chat only
    assert ctx.texts(STRANGER)[-1].startswith("Say: claim mina-")


# ---- division of labour: the agents claim only encounter rows ------------------------------

def test_inbox_types_from_env():
    from closet_agent import AGENT_INBOX_TYPES, inbox_types_from

    assert inbox_types_from(None) == AGENT_INBOX_TYPES == ("encounter",)
    assert inbox_types_from("") == ("encounter",)
    assert inbox_types_from("all") is None
    assert inbox_types_from("encounter, event, bogus") == ("encounter", "event")
    assert inbox_types_from("bogus") == ("encounter",)
    assert load_config(env={}, files=[])["INBOX_TYPES"] == "encounter"


def test_claim_inbox_sends_the_types_filter():
    c = client_with(_Resp(200, '{"rows":[]}'), _Resp(200, '{"rows":[]}'))
    run(c.claim_inbox(None, "live-bureau", 10, types=("encounter",)))
    run(c.claim_inbox("p1", "agent1q"))
    assert c._session.posts[0][1] == {"action": "claimInbox", "agentAddress": "live-bureau", "limit": 10, "types": ["encounter"]}
    assert "types" not in c._session.posts[1][1]  # no filter = every row (an older app ignores it the same way)


def test_hub_claims_only_encounter_rows_by_default():
    app, clock = MockBase44(), Clock()
    brains = [ClosetBrain(app, k, app.id(k)) for k in ("mina", "jo", "sam")]
    hub = InboxHub(app, brains, clock=clock)
    text = app.push("mina", "imessage", {"text": "hi"})
    event = app.push("jo", "event", {"type": "nudge:new"})
    enc = app.push("jo", "encounter", {"encounterId": "e1", "peer": {"parentId": app.id("mina")}, "role": "seller"})
    assert run(hub.source_for(brains[0])()) == []
    assert [r["id"] for r in run(hub.source_for(brains[1])())] == [enc["id"]]
    assert text["status"] == "pending" and event["status"] == "pending"  # left for the app's TypeScript side
    assert enc["status"] == "claimed"


def test_agent_poll_never_answers_an_imessage_row_by_default():
    from uagents import Agent

    from closet_agent import attach
    from live_bureau import OfflinePolicy

    asyncio.set_event_loop(asyncio.new_event_loop())
    app = MockBase44()
    agent = Agent(name="mina-closet", seed="test-types-mina", mailbox=False, registration_policy=OfflinePolicy(),
                  publish_agent_details=False, enable_agent_inspector=False)
    brain = ClosetBrain(app, "mina", app.id("mina"), "http://app")
    attach(agent, brain, poll_s=1.0, recheck_s=0, register=False, publish_manifest=False)
    assert brain.address == agent.address
    (poll, _), = agent._protocol.intervals
    row = app.push("mina", "imessage", {"text": "bag"})
    run(poll(FakeCtx()))
    assert row["status"] == "pending" and not app.sent and "agentApi:getState" not in app.calls


def test_mock_claim_inbox_refuses_unknown_types():
    app = MockBase44()
    with pytest.raises(Base44Error) as e:
        run(app.claim_inbox(None, "x", types=["bogus"]))
    assert e.value.status == 400


# ---- live runner robustness: startup backoff, one budget, clean Ctrl+C -------------------------

def test_with_backoff_waits_out_429s_and_network_blips_but_not_a_bad_key():
    from base44_client import with_backoff

    waits, said = [], []

    async def sleep(s):
        waits.append(s)

    fails = [RateLimited("429"), RateLimited("429", retry_after=7), Base44Error("net down"), Base44Error("502", status=502)]

    async def flaky():
        if fails:
            raise fails.pop(0)
        return "ok"

    assert run(with_backoff(flaky, "lookupParent mina", sleep=sleep, say=said.append)) == "ok"
    assert waits == [15.0, 7, 60.0, 120.0] and len(said) == 4 and "rate limited" in said[0]

    async def bad_key():
        raise Base44Error("agentApi 401: x-agent-key required", status=401)

    waits.clear()
    with pytest.raises(Base44Error):
        run(with_backoff(bad_key, "lookupParent", sleep=sleep))
    assert waits == []

    async def always_429():
        raise RateLimited("429")

    with pytest.raises(RateLimited):
        run(with_backoff(always_429, "lookupParent", attempts=3, sleep=sleep))
    assert waits == [15.0, 30.0]


def test_setup_survives_a_rate_limited_start_and_registers_the_addresses():
    from live_bureau import setup_parents

    app = MockBase44()
    app.rate_limit_next = 2  # the first two calls of the start hit Base44's 429
    ours = agent_addresses("dev")
    waits, said = [], []

    async def sleep(s):
        waits.append(s)

    parents = run(setup_parents(app, {}, ours, False, attempts=5, sleep=sleep, say=said.append))
    assert {k: p["id"] for k, p in parents.items()} == {k: app.id(k) for k in ("mina", "jo", "sam")}
    assert waits == [15.0, 30.0]
    assert all(app.parents[app.id(k)]["agentAddress"] == ours[k] for k in ours)
    assert app.calls.count("agentApi:lookupParent") == 5 and app.calls.count("agentApi:registerAgent") == 3
    assert any("registered mina-closet" in s for s in said)


def test_setup_check_only_registers_nothing():
    from live_bureau import setup_parents

    app = MockBase44()
    run(setup_parents(app, {}, agent_addresses("dev"), True, say=lambda s: None))
    assert "agentApi:registerAgent" not in app.calls


def test_ctrl_c_shuts_the_bureau_down_and_closes_the_http_session():
    from live_bureau import run_bureau

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    client = Base44Client("https://app.example", "k")
    loop.run_until_complete(client._sess())  # a real aiohttp session, bound to this loop
    session = client._session
    seen = []

    class FakeBureau:
        async def run_async(self):
            try:
                await asyncio.sleep(3600)
            finally:
                seen.append("graceful shutdown")  # Bureau.run_async's finally: server stop, handlers, shutdown hooks

    def ctrl_c():
        raise KeyboardInterrupt

    loop.call_later(0.05, ctrl_c)
    run_bureau(FakeBureau(), loop, client.close)
    assert seen == ["graceful shutdown"]
    assert client._session is None and session.closed
    assert loop.is_closed()


def test_one_budget_spans_startup_and_the_running_bureau():
    import live_bureau

    src = open(live_bureau.__file__, encoding="utf-8").read()
    main_src = src[src.index("def main("):]
    assert main_src.count("CallBudget(") == 1  # the startup lookups count against the Bureau's first minute


# ---- a claimed ASI:One owner still gets the trade cards (event rows stay the TypeScript side's) -----------------

def test_claimed_asi_owner_gets_events_mirrored_without_a_second_text(monkeypatch):
    monkeypatch.delenv("ASI_OPEN", raising=False)
    app = MockBase44()
    agent, brain, poll = _attached(app, inbox_types=("encounter",))
    ctx = FakeCtx()
    before = app.push("mina", "event", {"type": "trade:completed", "proposalId": "p0", "role": "seller", "itemId": "romper", "priceCents": 1800})
    run(poll(ctx))  # nobody linked on ASI:One yet: nothing is peeked, nothing mirrored
    assert not ctx.out and before["status"] == "pending"
    assert _chat(agent, ctx, OWNER, "claim mina-0000").startswith("Linked!")
    seen = len(ctx.texts(OWNER))
    row = app.push("mina", "event", {"type": "trade:completed", "proposalId": "p1", "role": "seller", "itemId": "romper", "priceCents": 1800})
    run(poll(ctx))
    mirrored = ctx.texts(OWNER)[seen:]
    assert mirrored == ["The Yellow duck romper found its next home for $18.00. Flowers all round!"]  # only the new row
    assert row["status"] == "pending" and before["status"] == "pending"  # never claimed: the app still texts it
    assert not app.sent  # no second iMessage from the agent
    run(poll(ctx))
    assert ctx.texts(OWNER)[seen:] == mirrored  # said once


def test_claim_inbox_peek_args_and_rows():
    c = client_with(_Resp(200, '{"rows":[{"id":"r1"}],"peeked":[{"id":"e1","type":"event"}]}'))
    rows = run(c.claim_inbox("p1", "agent1q", 5, types=("encounter",), peek_types=("event",), peek_since="2026-10-18T17:00:00Z"))
    assert rows == [{"id": "r1"}, {"id": "e1", "type": "event", "peek": True}]
    assert c._session.posts[0][1]["peek"] == {"types": ["event"], "since": "2026-10-18T17:00:00Z"}
