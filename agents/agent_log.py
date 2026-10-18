"""agent_log — the protocol log: every RelayProtocol message two closet agents exchange in one encounter.

Each entry is the app's AgentLogEntry (base44/shared/types.ts):

    {at, from: "agent1q…", to: "agent1q…", type: "LookingFor", summary: "Asks for size 6-9M (onesie).", ms, by: "fetch"}

Both agents keep the log of an encounter (every message is either sent or received by each of them), and the agent
that ENDS the talk hands the whole log to the app in the call it makes anyway (agentApi createProposal / noMatch),
so the Agent Console can show the real Fetch.ai conversation without one extra call.

Privacy (rule 3): a summary is built from the wire message alone, which already carries only shared listings,
shared needs and prices. No names, phones, child ages, birth dates, parent ids or coordinates.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from relay_protocol import Decline, HaveListings, LookingFor, NoFit, ProposeTrade, TradeAck

MAX_ENTRIES = 40      # a normal talk is 3–6 messages; agentApi keeps at most 40 too
MAX_SUMMARY = 200

# The buyer's pet rules, without names or amounts (= base44/shared/c/location.ts RULE_SUMMARY).
RULE_SUMMARY = {
    "agent_may_not_propose": "the buyer asked their pet to point out matches only",
    "over_price": "over the price limit the buyer set for their pet",
    "category": "not a kind of clothes the buyer asked their pet to look for",
    "over_budget": "over the budget the buyer set for their pet",
}
# Why the app refused a proposal after the TradeAck (no names: B's own reason can name the buyer).
REFUSAL_SUMMARY = {
    "already_open": "the listing already has an open trade",
    "not_resellable": "the item has had its 3 owners",
    "not_eligible": "the listing no longer fits",
}


def _money(cents: Any) -> str:
    try:
        return f"${int(cents or 0) / 100:.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _sentence(text: str) -> str:
    """One plain sentence: trimmed, single-spaced, capitalised, ends with a full stop, at most MAX_SUMMARY chars."""
    s = " ".join(str(text or "").split())
    if not s:
        return ""
    s = s[:1].upper() + s[1:]
    if s[-1] not in ".!?":
        s += "."
    return s if len(s) <= MAX_SUMMARY else s[: MAX_SUMMARY - 1].rstrip() + "…"


def _lower_first(text: str) -> str:
    s = " ".join(str(text or "").split()).rstrip(".")
    return s[:1].lower() + s[1:] if s else ""


def message_type(msg: Any) -> str:
    """The wire model's name (LookingFor, HaveListings, NoFit, ProposeTrade, TradeAck, Decline)."""
    return type(msg).__name__


def summarize(msg: Any) -> str:
    """What the message said, as one plain sentence built from shared data only."""
    if isinstance(msg, LookingFor):
        if not msg.needs:
            return _sentence("Says hello; has no shared need to ask about")
        sizes = list(dict.fromkeys(sz for n in msg.needs for sz in n.sizes))
        cats = list(dict.fromkeys(c for n in msg.needs for c in n.categories))
        caps = [n.max_price_cents for n in msg.needs if n.max_price_cents is not None]
        out = f"Asks for size {', '.join(sizes) or 'any'}"
        if cats:
            out += f" ({', '.join(cats)})"
        if caps and len(caps) == len(msg.needs):
            out += f", up to {_money(max(caps))}"
        return _sentence(out)
    if isinstance(msg, HaveListings):
        if not msg.listings:
            return _sentence("Has no shared listing to offer")
        first = msg.listings[0]
        n = len(msg.listings)
        what = f"{first.item_name or 'an item'}, size {first.size}, {_money(first.price_cents)}"
        more = f" and {n - 1} more" if n > 1 else ""
        return _sentence(f"Offers {n} shared listing{'s' if n > 1 else ''}: {what}{more}")
    if isinstance(msg, NoFit):
        return _sentence(f"No fit: {_lower_first(msg.reason) or 'nothing fits today'}")
    if isinstance(msg, ProposeTrade):
        return _sentence(f"Proposes the listing at {_money(msg.price_cents)}. {msg.reason}")
    if isinstance(msg, TradeAck):
        if msg.ok:
            return _sentence("Agrees to the trade; both parents still decide in the app")
        return _sentence(f"Declines: {_lower_first(msg.reason) or 'the listing changed'}")
    if isinstance(msg, Decline):
        if msg.rule:
            why = RULE_SUMMARY.get(msg.rule, "the buyer's pet rules say no")
            return _sentence(f"Declines: {why}. Nothing was proposed")
        return _sentence(f"Declines: the app refused the proposal ({REFUSAL_SUMMARY.get(msg.reason, 'the listing no longer fits')})")
    return _sentence(f"Sends {message_type(msg)}")


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class AgentLog:
    """Per-encounter protocol log, as the app stores it on Encounter.agentLog."""

    def __init__(self, by: str = "fetch", clock=None):
        self.by = by
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._logs: Dict[str, List[Dict[str, Any]]] = {}
        self._last_t: Dict[str, datetime] = {}

    def record(self, encounter_id: str, msg: Any, frm: str, to: str) -> Optional[Dict[str, Any]]:
        """Add one message. A retried handler (same type, sender, receiver and summary as the last entry) is not
        logged twice. Returns the entry, or None when it was a repeat."""
        if not encounter_id:
            return None
        log = self._logs.setdefault(encounter_id, [])
        entry = {"from": frm or "unknown", "to": to or "unknown", "type": message_type(msg), "summary": summarize(msg)}
        if log and all(log[-1].get(k) == v for k, v in entry.items()):
            return None
        now = self.clock()
        prev = self._last_t.get(encounter_id)
        full: Dict[str, Any] = {"at": _iso(now), **entry, "by": self.by}
        if prev is not None:
            full["ms"] = max(0, int(round((now - prev).total_seconds() * 1000)))
        self._last_t[encounter_id] = now
        log.append(full)
        if len(log) > MAX_ENTRIES:
            del log[: len(log) - MAX_ENTRIES]
        return full

    def entries(self, encounter_id: str) -> List[Dict[str, Any]]:
        return [dict(e) for e in self._logs.get(encounter_id, [])]

    def __contains__(self, encounter_id: str) -> bool:
        return encounter_id in self._logs


def short_address(addr: str) -> str:
    """agent1qw8…f3k2 for printing (the full address is what the app stores)."""
    a = str(addr or "")
    return a if len(a) <= 16 else f"{a[:10]}…{a[-4:]}"


def format_log(entries: List[Dict[str, Any]]) -> List[str]:
    """Printable lines for local_demo / the live runner's console."""
    out = []
    for e in entries:
        ms = f"+{e['ms']}ms" if e.get("ms") is not None else "start"
        out.append(f"{ms:>9}  {short_address(e.get('from', '')):>16} → {short_address(e.get('to', '')):<16} "
                   f"{e.get('type', ''):<13} {e.get('summary', '')}")
    return out
