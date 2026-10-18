"""live_bureau — Mina's, Jo's and Sam's closet agents in ONE uAgents Bureau on this laptop, against the LIVE app.

No Agentverse / mailbox login: the three agents talk to each other inside the Bureau, and to the app over HTTPS
(agentApi + sendImessage with the x-agent-key header).

    python live_bureau.py --addresses   # the three agent addresses (no network)
    python live_bureau.py --check       # 3 read-only calls (lookupParent ×3): ids, pets, who opens an encounter
    python live_bureau.py               # run until Ctrl+C

Config (environment first, then agents/.env, then ../.env.local — values are never printed):
    BASE44_URL     default https://sproutpass-5c025059.base44.app
    AGENT_KEY      required (same value as the Base44 secret AGENT_KEY)
    APP_URL        default = BASE44_URL (pay links /trade/<id>?as=<name>, flowers GIF)
    TEAM_SECRET    default "dev" — fixes the agent addresses (seed "relay-<name>-<TEAM_SECRET>")
    CALLS_PER_MIN  default 8 — budget for ALL three agents together (Base44 Free plan ≈ 10/min for the whole team)
    POLL_S         default 12 — one claimInbox for all three parents every POLL_S seconds…
    FAST_POLL_S    default 4  — …and every FAST_POLL_S for 90 s after something arrived
    APPEND_TURNS   default 0  — 1 = write each pet bubble with appendTurn as it is said (+1 call per bubble);
                                0 = the whole two-sided transcript goes in with createProposal
    SEND_LINES     default 1  — 0 = don't call sendImessage (no PetLine / iMessage; lines only in the log)
    BUREAU_PORT    default 8100
    INBOX_MAX_AGE_S default 600 — older inbox rows (a backlog from a rehearsal without RESET) are completed silently
    ASI_OPEN       default 0  — 1 = an unclaimed ASI:One sender may say hi / help / bag (never sell, accept or pay)
    INBOX_TYPES    default "encounter" — the agents claim only encounter rows (agent-to-agent negotiation); the app's
                                TypeScript side answers "imessage" / "event" rows. "all" = the old claim-everything mode.
    STARTUP_ATTEMPTS default 10 — lookupParent / registerAgent tries at startup (a 429 waits 15 → 30 → 60 → 120 s)

Rate limit: every call goes through one CallBudget (the startup lookups included); a 429 / "Rate limit exceeded"
stops all calls for 15 → 30 → 60 → 120 s (or Retry-After) and the row is retried, never re-sent at once. A 429 at
startup waits and tries again instead of exiting. Ctrl+C shuts the Bureau down and closes the HTTP session.

Every encounter's protocol messages (LookingFor, HaveListings, NoFit, ProposeTrade, TradeAck, Decline) are logged here
and sent with the createProposal / noMatch call that ends the talk (Encounter.agentLog → the app's Agent Console). The
buyer's pet checks its parent's pet rules (agentApi fit) before proposing: a trade the rules stop ends in a Decline,
and the noMatch call carries the rule's reason (Encounter.noMatchReason).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from collections import deque
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional, Tuple

from uagents import Agent, Bureau
from uagents.crypto import Identity
from uagents.registration import AgentRegistrationPolicy, BatchRegistrationPolicy

from base44_client import Base44Client, Base44Error, CallBudget, RateLimited, with_backoff
from closet_agent import AGENT_INBOX_TYPES, ClosetBrain, Directory, attach, inbox_types_from

log = logging.getLogger("live")

HERE = os.path.dirname(os.path.abspath(__file__))
PARENTS = ("mina", "jo", "sam")
LIVE_URL = "https://sproutpass-5c025059.base44.app"
DEFAULTS = {"BASE44_URL": LIVE_URL, "TEAM_SECRET": "dev", "CALLS_PER_MIN": "8", "POLL_S": "12", "FAST_POLL_S": "4",
            "APPEND_TURNS": "0", "SEND_LINES": "1", "BUREAU_PORT": "8100", "ASI_OPEN": "0", "INBOX_MAX_AGE_S": "600",
            "INBOX_TYPES": "encounter", "STARTUP_ATTEMPTS": "10"}
KEYS = ("BASE44_URL", "AGENT_KEY", "APP_URL", "TEAM_SECRET", "CALLS_PER_MIN", "POLL_S", "FAST_POLL_S", "APPEND_TURNS",
        "SEND_LINES", "BUREAU_PORT", "ASI_OPEN", "INBOX_MAX_AGE_S", "INBOX_TYPES", "STARTUP_ATTEMPTS",
        *(f"PARENT_ID_{p.upper()}" for p in PARENTS))


# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------

def _read_env_file(path: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        with open(path, encoding="utf-8-sig") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip().removeprefix("export ").strip()
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                out[k] = v
    except OSError:
        pass
    return out


def load_config(env: Optional[Dict[str, str]] = None, files: Optional[List[str]] = None) -> Dict[str, str]:
    """Environment wins, then agents/.env, then the repo's .env.local (where AGENT_KEY lives on Caesar's laptop)."""
    env = dict(os.environ if env is None else env)
    files = files if files is not None else [os.path.join(HERE, ".env"), os.path.join(HERE, "..", ".env.local")]
    cfg: Dict[str, str] = {}
    for path in reversed(files):
        cfg.update({k: v for k, v in _read_env_file(path).items() if k in KEYS and v})
    cfg.update({k: v for k, v in env.items() if k in KEYS and v})
    for k, v in DEFAULTS.items():
        cfg.setdefault(k, v)
    cfg["BASE44_URL"] = cfg["BASE44_URL"].rstrip("/")
    cfg.setdefault("APP_URL", cfg["BASE44_URL"])
    return cfg


def seed_for(parent: str, team_secret: str) -> str:
    return f"relay-{parent}-{team_secret}"  # same as closet_agent.build_agent → same address in both modes


# ---------------------------------------------------------------------------
# offline registration: the Bureau delivers locally, nothing goes to the Almanac
# ---------------------------------------------------------------------------

class OfflinePolicy(AgentRegistrationPolicy):
    async def register(self, *a, **k):  # noqa: D401
        return None


class OfflineBatchPolicy(BatchRegistrationPolicy):
    async def register(self, *a, **k):
        return None

    def add_agent(self, *a, **k):
        return None


# ---------------------------------------------------------------------------
# one claimInbox for the whole Bureau
# ---------------------------------------------------------------------------

class InboxHub:
    """claimInbox WITHOUT parentId (= every parent's oldest pending rows) once per period, shared out by parent id.

    Three agents cost one poll instead of three. Polls every `poll_s`, every `fast_s` for `fast_window_s` after a row
    arrived, skips a poll while the budget is nearly spent, and waits out a 429. Rows for a parent id nobody here
    owns trigger `on_unknown` (re-resolve the ids: the demo was re-seeded) before they are shared out.
    `types` (default: encounter only) is the claimInbox filter; None claims every row type.
    """

    def __init__(self, client: Base44Client, brains: List[ClosetBrain], label: str = "live-bureau", *,
                 poll_s: float = 12.0, fast_s: float = 4.0, fast_window_s: float = 90.0, limit: int = 10, reserve: int = 2,
                 on_unknown: Optional[Callable[[], Awaitable[None]]] = None, clock: Callable[[], float] = time.monotonic,
                 types: Optional[Tuple[str, ...]] = AGENT_INBOX_TYPES):
        self.types = tuple(types) if types is not None else None
        self.client, self.brains, self.label = client, brains, label
        self.poll_s, self.fast_s, self.fast_window_s = poll_s, fast_s, fast_window_s
        self.limit, self.reserve, self.on_unknown, self.clock = limit, reserve, on_unknown, clock
        self.buckets: Dict[str, Deque[Dict[str, Any]]] = {}
        self.orphans: List[Dict[str, Any]] = []
        self.next_at = 0.0
        self.hot_until = 0.0
        self.polls = 0
        self._lock = asyncio.Lock()

    def known(self) -> set:
        return {b.parent_id for b in self.brains}

    def source_for(self, brain: ClosetBrain) -> Callable[[], Awaitable[List[Dict[str, Any]]]]:
        async def take() -> List[Dict[str, Any]]:
            await self.maybe_fetch()
            q = self.buckets.pop(brain.parent_id, None)
            return list(q or [])
        return take

    async def maybe_fetch(self) -> int:
        async with self._lock:
            now = self.clock()
            if now < self.next_at:
                return 0
            budget = getattr(self.client, "budget", None)
            if budget is not None and budget.available() <= self.reserve:
                self.next_at = now + max(1.0, min(self.poll_s, budget.wait_s() or 1.0))  # leave room for the agents' own calls
                return 0
            try:
                rows = await self.client.claim_inbox(None, self.label, self.limit, types=self.types)
            except RateLimited as e:
                self.next_at = self.clock() + (e.retry_after or 30.0)
                log.warning("claimInbox rate limited — next poll in %.0fs", self.next_at - self.clock())
                return 0
            except Base44Error as e:
                self.next_at = self.clock() + self.poll_s
                log.warning("claimInbox: %s", e)
                return 0
            self.polls += 1
            now = self.clock()
            if rows:
                self.hot_until = now + self.fast_window_s
            self.next_at = now + (self.fast_s if now < self.hot_until else self.poll_s)
            if rows and self.on_unknown and any(r.get("parentId") not in self.known() for r in rows):
                await self.on_unknown()
            known = self.known()
            for r in rows:
                if r.get("parentId") in known:
                    self.buckets.setdefault(r["parentId"], deque()).append(r)
                else:  # claimed but nobody here can answer it; leave it claimed (C's fallback only sweeps pending rows)
                    self.orphans.append(r)
                    log.warning("inbox row %s is for unknown parent %s — left claimed", r.get("id"), r.get("parentId"))
            return len(rows)


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def build_bureau(client: Base44Client, parents: Dict[str, Dict[str, Any]], *, app_url: str, seeds: Dict[str, str],
                 port: int = 8100, poll_s: float = 12.0, fast_s: float = 4.0, tick_s: float = 1.0, append_turns: bool = False,
                 send_lines: bool = True, peer_wait_s: float = 30.0, recheck_every_s: float = 300.0,
                 asi_open: bool = False, max_age_s: Optional[float] = None,
                 inbox_types: Optional[Tuple[str, ...]] = AGENT_INBOX_TYPES,
                 ) -> Tuple[Bureau, Dict[str, Agent], Dict[str, ClosetBrain], InboxHub]:
    """parents: key → {"id", "name", "pet"} (from lookupParent). Returns (bureau, agents, brains, hub).
    inbox_types: what the one shared claimInbox takes (default encounter rows only; None = every type)."""
    directory: Directory = {v["id"]: {"key": k, "name": v.get("name"), "pet": v.get("pet")} for k, v in parents.items()}
    brains: Dict[str, ClosetBrain] = {}
    agents: Dict[str, Agent] = {}
    address_book: Dict[str, str] = {}
    for key, info in parents.items():
        # Offline Bureau: no Almanac call on Ctrl+C either (mark_inactive_on_shutdown), and a short shutdown wait.
        agent = Agent(name=f"{key}-closet", seed=seeds[key], mailbox=False, registration_policy=OfflinePolicy(),
                      publish_agent_details=False, mark_inactive_on_shutdown=False, shutdown_timeout=10.0)
        brain = ClosetBrain(client, key, info["id"], app_url, directory=directory, append_turns=append_turns, peer_wait_s=peer_wait_s)
        if info.get("pet"):
            brain.pet = info["pet"]
        agents[key], brains[key] = agent, brain
        address_book[info["id"]] = agent.address

    last = {"at": -1e9}

    async def on_unknown() -> None:
        if time.monotonic() - last["at"] < recheck_every_s:
            return
        last["at"] = time.monotonic()
        for key, brain in brains.items():
            try:
                if await brain.recheck_parent(agents[key].address):
                    address_book[brain.parent_id] = agents[key].address
            except Base44Error as e:
                log.warning("lookupParent %s: %s", key, e)

    hub = InboxHub(client, list(brains.values()), poll_s=poll_s, fast_s=fast_s, on_unknown=on_unknown, types=inbox_types)
    for key, agent in agents.items():
        attach(agent, brains[key], inbox=hub.source_for(brains[key]), poll_s=tick_s, recheck_s=0, register=False,
               publish_manifest=False, address_book=address_book, send_lines=send_lines, asi_open=asi_open,
               max_age_s=max_age_s)
    bureau = Bureau(agents=list(agents.values()), port=port, endpoint=[f"http://127.0.0.1:{port}/submit"],
                    registration_policy=OfflineBatchPolicy(), shutdown_timeout=15)
    return bureau, agents, brains, hub


# ---------------------------------------------------------------------------
# live setup
# ---------------------------------------------------------------------------

async def resolve_parents(client: Base44Client, cfg: Dict[str, str], *, attempts: int = 1,
                          sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
                          say: Optional[Callable[[str], None]] = None) -> Dict[str, Dict[str, Any]]:
    """key → {"id", "name", "pet", "agentAddress"}; PARENT_ID_<NAME> skips the lookup (then name/pet are defaults).
    attempts > 1: a 429 / network error waits (with_backoff) and asks again instead of failing."""
    out: Dict[str, Dict[str, Any]] = {}
    for key in PARENTS:
        pinned = cfg.get(f"PARENT_ID_{key.upper()}")
        if pinned:
            out[key] = {"id": pinned, "name": key.title(), "pet": None, "agentAddress": None, "pinned": True}
            continue
        r = await with_backoff(lambda k=key: client.lookup_parent(k), f"lookupParent {key}", attempts=attempts,
                               sleep=sleep, say=say)
        out[key] = {"id": r["id"], "name": r.get("name") or key.title(), "pet": (r.get("pet") or {}).get("name"),
                    "agentAddress": r.get("agentAddress")}
    return out


def agent_addresses(team_secret: str) -> Dict[str, str]:
    """The three agent addresses, without building Agents (uAgents derives them as Identity.from_seed(seed, 0))."""
    return {p: Identity.from_seed(seed_for(p, team_secret), 0).address for p in PARENTS}


def _print_table(parents: Dict[str, Dict[str, Any]], ours: Dict[str, str]) -> None:
    print(f"\n{'parent':7} {'id':26} {'pet':8} agentAddress on the Parent row")
    for key, p in parents.items():
        reg = p.get("agentAddress")
        mark = "= this Bureau's" if reg == ours[key] else ("(none)" if not reg else "≠ this Bureau's (will re-register)")
        print(f"{key:7} {p['id']:26} {str(p.get('pet') or '?'):8} {mark}")
    ids = {k: p["id"] for k, p in parents.items()}
    opener = "mina" if ids["mina"] < ids["jo"] else "jo"
    print(f"\nWhen Mina meets Jo, C's encounter makes {opener.title()}'s pet the opening 'buyer' "
          f"(smaller parent id){' — the pets swap roles, since Jo has the need' if opener == 'mina' else ''}.")


def _say(line: str) -> None:
    print(line, flush=True)


async def setup_parents(client: Base44Client, cfg: Dict[str, str], ours: Dict[str, str], check_only: bool, *,
                        attempts: int = 10, sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
                        say: Callable[[str], None] = _say) -> Dict[str, Dict[str, Any]]:
    """lookupParent ×3, then registerAgent where the Parent row has another address. A 429 (or a network blip / 5xx)
    waits 15 → 30 → 60 → 120 s (or Retry-After) and tries that call again, up to `attempts` times: a busy rate limit
    delays the start, it doesn't end it. A 4xx (bad AGENT_KEY, unknown parent) still fails at once."""
    parents = await resolve_parents(client, cfg, attempts=attempts, sleep=sleep, say=say)
    _print_table(parents, ours)
    if check_only:
        return parents
    for key, p in parents.items():
        if p.get("agentAddress") != ours[key]:
            await with_backoff(lambda pid=p["id"], addr=ours[key]: client.register_agent(pid, addr),
                               f"registerAgent {key}", attempts=attempts, sleep=sleep, say=say)
            p["agentAddress"] = ours[key]
            say(f"registered {key}-closet → {p['id']}")
    return parents


async def _setup(cfg: Dict[str, str], ours: Dict[str, str], check_only: bool,
                 budget: CallBudget) -> Optional[Dict[str, Dict[str, Any]]]:
    client = Base44Client(cfg["BASE44_URL"], cfg["AGENT_KEY"], budget=budget)
    try:
        return await setup_parents(client, cfg, ours, check_only, attempts=max(1, int(cfg.get("STARTUP_ATTEMPTS") or 10)))
    finally:
        await client.close()  # also on Ctrl+C (asyncio.run cancels this task, so the finally runs)


def run_bureau(bureau: Any, loop: asyncio.AbstractEventLoop, on_exit: Callable[[], Awaitable[None]]) -> None:
    """bureau.run(), except that Ctrl+C runs the Bureau's own graceful shutdown and then `on_exit` (close the HTTP
    session) on the same loop before it is closed. Bureau.run() would close the loop without either, leaving an
    "Unclosed client session" behind."""
    main_task = loop.create_task(bureau.run_async())
    try:
        loop.run_until_complete(main_task)
    except KeyboardInterrupt:
        main_task.cancel()
        try:
            loop.run_until_complete(main_task)  # run_async's finally: stop the server, cancel handlers, shutdown hooks
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
    finally:
        try:
            loop.run_until_complete(on_exit())
        except KeyboardInterrupt:
            pass
        finally:
            loop.close()


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="3 read-only lookups, print the wiring, exit")
    ap.add_argument("--addresses", action="store_true", help="print the three agent addresses (no network), exit")
    ap.add_argument("--log", default=os.environ.get("LOG", "INFO"))
    a = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):  # the protocol log has → and …; a Windows console would mangle them
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=a.log, format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    for noisy in ("aiohttp.access", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    cfg = load_config()
    ours = agent_addresses(cfg["TEAM_SECRET"])
    if a.addresses:
        for p, addr in ours.items():
            print(f"{p.upper()}_AGENT={addr}")
        return 0
    if not cfg.get("AGENT_KEY"):
        print("AGENT_KEY is not set (env, agents/.env or ../.env.local).", file=sys.stderr)
        return 2
    types = inbox_types_from(cfg.get("INBOX_TYPES"))
    print(f"app: {cfg['BASE44_URL']}  · budget {cfg['CALLS_PER_MIN']} calls/min · poll {cfg['POLL_S']}s "
          f"(fast {cfg['FAST_POLL_S']}s) · claims {'/'.join(types) if types else 'every'} inbox rows · "
          f"AGENT_KEY loaded ({len(cfg['AGENT_KEY'])} chars)")
    # ONE budget for the startup lookups and the running Bureau: the calls spent at startup count against the first
    # minute of polling too (the Base44 Free plan's ~10 calls/min is shared by the whole team).
    budget = CallBudget(int(cfg["CALLS_PER_MIN"]))
    try:
        parents = asyncio.run(_setup(cfg, ours, a.check, budget))
    except KeyboardInterrupt:
        print("\nstopped during setup.")
        return 130
    except Base44Error as e:
        print(f"setup failed: {e}", file=sys.stderr)
        return 1
    if a.check or not parents:
        return 0

    loop = asyncio.new_event_loop()  # asyncio.run() above closed its loop; uAgents needs a current one
    asyncio.set_event_loop(loop)
    client = Base44Client(cfg["BASE44_URL"], cfg["AGENT_KEY"], budget=budget)
    bureau, agents, brains, hub = build_bureau(
        client, parents, app_url=cfg["APP_URL"], seeds={p: seed_for(p, cfg["TEAM_SECRET"]) for p in PARENTS},
        port=int(cfg["BUREAU_PORT"]), poll_s=float(cfg["POLL_S"]), fast_s=float(cfg["FAST_POLL_S"]),
        append_turns=cfg["APPEND_TURNS"] == "1", send_lines=cfg["SEND_LINES"] != "0",
        asi_open=cfg["ASI_OPEN"] == "1", max_age_s=float(cfg["INBOX_MAX_AGE_S"]), inbox_types=types,
    )
    print("\nRunning mina-closet, jo-closet, sam-closet. Ctrl+C to stop.\n")
    try:
        run_bureau(bureau, getattr(bureau, "_loop", None) or loop, client.close)
    finally:
        print(f"\nstopped · {budget.used} calls spent · {hub.polls} inbox polls")
    return 0


if __name__ == "__main__":
    sys.exit(main())
