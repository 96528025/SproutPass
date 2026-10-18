"""closet_agent — one Fetch.ai uAgent per parent (Mina / Jo / Sam).

    python closet_agent.py --parent mina            # port 8101, Agentverse mailbox
    python closet_agent.py --parent jo --port 8102
    python live_bureau.py                           # all three in one Bureau, no mailbox (see agent_readme.md)

What it does (Part C §4–8):
  * polls the app's AgentInbox (claimInbox → handle → complete), politely: the Base44 Free plan
    allows the whole team about 10 function calls a minute (POLL_S, CALLS_PER_MIN)
  * talks to the owner over iMessage (via sendImessage, mirrored to the in-app pet) and ASI:One (chat + cards)
  * talks to the other parent's agent with RelayProtocol when the two phones meet
  * never decides for a person: it only creates *proposals* (rule 1)

Env: BASE44_URL, AGENT_KEY, TEAM_SECRET, APP_URL (for pay links), PARENT_ID_<NAME> (optional),
     POLL_S (default 10), CALLS_PER_MIN (default 8),
     ASI_OPEN (default 0: an ASI:One sender must "claim" first; 1 = unclaimed senders may also say hi / help / bag),
     INBOX_MAX_AGE_S (default 600: older inbox rows are a backlog from while the agent was off → completed silently)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import re
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

import cards
import wording as w
from base44_client import Base44Client, Base44Error, CallBudget, RateLimited
from intents import intent_from_card, parse_card_reply, parse_claim, parse_condition, parse_intent
from relay_protocol import (
    HaveListings,
    ListingCard,
    LookingFor,
    Need,
    NoFit,
    ProposeTrade,
    TradeAck,
    make_relay_protocol,
)

log = logging.getLogger("closet")

PARENT_PORTS = {"mina": 8101, "jo": 8102, "sam": 8103}
PET_NAMES = {"mina": "Button", "jo": "Pip", "sam": "Moss"}  # overwritten by getState when available

Directory = Dict[str, Dict[str, Any]]  # parent id → {"key", "name", "pet"} (public names only; shared by a Bureau)
InboxSource = Callable[[], Awaitable[List[Dict[str, Any]]]]


def _owners(item: Dict[str, Any]) -> int:
    try:
        return max(1, min(3, int(item.get("ownerCount") or 1)))
    except (TypeError, ValueError):
        return 1


def _cents(v: Any) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"the", "a", "an", "my", "it", "sell", "list", "pass", "on", "please", "this", "that", "of", "and", "for"}

INBOX_MAX_AGE_S = 600.0   # an inbox row older than this is a backlog (agent was off, no RESET): completed, never spoken
RECHECK_AFTER_S = 60.0    # a proposal:updated row older than this is checked against getState before it speaks
_STATUS_RANK = {"open": 0, "both_accepted": 1, "paid": 2, "declined": 2, "expired": 2, "payment_failed": 2}

# What an ASI:One sender who has NOT claimed this parent may ask when ASI_OPEN=1. Read-only: nothing that lists,
# resolves a nudge, accepts, declines or pays (and nothing that moves the owner's half-finished conversation).
ASI_OPEN_INTENTS = frozenset({"hi", "help", "bag", "unknown"})


def row_age_s(row: Dict[str, Any], now: Optional[datetime] = None) -> Optional[float]:
    """Seconds since an AgentInbox row was written (createdAt is real time; Base44's created_date as a fallback).
    None when the row carries no readable timestamp (then it is treated as fresh)."""
    raw = row.get("createdAt") or row.get("created_date")
    if not raw:
        return None
    try:
        t = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)  # Base44 writes naive UTC
    return max(0.0, ((now or datetime.now(timezone.utc)) - t).total_seconds())


def asi_refusal(parent_name: str, claimed: bool, intent: str, open_mode: bool) -> Optional[str]:
    """None = go ahead. Only the claimed owner acts for the parent over ASI:One; ASI_OPEN=1 lets anyone else look
    (hi / help / bag), never sell, keep, accept, decline or pay."""
    if claimed:
        return None
    ask = f"Say: claim {parent_name}-<code> first so I know it's you."
    if not open_mode:
        return ask
    if intent in ASI_OPEN_INTENTS:
        return None
    return f"Only {parent_name.title()} can do that. {ask}"


# ---------------------------------------------------------------------------
# Reply plumbing: one owner-conversation engine, two channels (iMessage, ASI:One)
# ---------------------------------------------------------------------------

class Reply:
    """A line for the owner. `card` is an optional (kind, payload) for ASI:One."""

    def __init__(self, text: str, card: Optional[tuple] = None, image_url: Optional[str] = None):
        self.text, self.card, self.image_url = text, card, image_url

    def __repr__(self) -> str:  # pytest diffs
        return f"Reply({self.text!r})"


class ClosetBrain:
    """Everything that doesn't need a uAgents Context. Unit-tested with MockBase44 (tests/)."""

    def __init__(self, client: Base44Client, parent_name: str, parent_id: str, app_url: str = "",
                 directory: Optional[Directory] = None, append_turns: bool = True, peer_wait_s: float = 0.0):
        self.client = client
        self.parent_name = parent_name          # seed key: "mina" | "jo" | "sam" (the app's ?as=)
        self.parent_id = parent_id              # the real Base44 Parent id
        self.app_url = app_url.rstrip("/")
        self.pet = PET_NAMES.get(parent_name, "Pet")
        self.directory: Directory = directory if directory is not None else {}
        self.append_turns = append_turns        # live bubbles via appendTurn (1 call per line)
        self.peer_wait_s = peer_wait_s          # how long a relay handler waits for its own encounter row
        self.convo: Dict[str, Any] = {"step": "idle"}
        self.transcripts: Dict[str, List[Dict[str, Any]]] = {}  # encounter_id → turns (both pets)
        self.peers: Dict[str, Dict[str, Any]] = {}  # encounter_id → {parentId, agentAddress, role, asked, answered, offered}
        self.props: Dict[str, Dict[str, Any]] = {}  # proposal id → proposal (snapshot/buyer/seller never change)
        self.announced: set = set()  # item ids whose arrival we already announced (skip the welcome nudge)

    # ----- helpers ---------------------------------------------------------
    async def state(self) -> Dict[str, Any]:
        """B's getCloset (+ child.ageMonths): parent, child, items, passedOn, listings (any status), needs,
        open nudges, proposals (live + last 5 terminal)."""
        s = await self.client.get_state(self.parent_id) or {}
        pet = ((s.get("parent") or {}).get("pet") or {}).get("name")
        if pet:
            self.pet = pet
        for p in s.get("proposals") or []:
            if p.get("id"):
                self.props[p["id"]] = p
        return s

    def pay_link(self, proposal_id: str) -> str:
        # The app picks the family by its seed key (?as=mina), not by the Parent id.
        return f"{self.app_url or 'https://app'}/trade/{proposal_id}?as={self.parent_name}"

    def _who(self, parent_id: Optional[str], field: str) -> Optional[str]:
        return (self.directory.get(parent_id or "") or {}).get(field)

    def _other_id(self, prop: Dict[str, Any]) -> Optional[str]:
        return prop.get("sellerId") if prop.get("buyerId") == self.parent_id else prop.get("buyerId")

    @staticmethod
    def _open_nudge(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for n in state.get("nudges") or []:
            if not n.get("resolved") and n.get("kind") == "outgrow_check":
                return n
        return None

    @staticmethod
    def _item(state: Dict[str, Any], item_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not item_id:
            return None
        return next((i for i in state.get("items") or [] if i.get("id") == item_id), None)

    @staticmethod
    def _named_item(state: Dict[str, Any], text: str) -> Optional[Dict[str, Any]]:
        """"sell the sun hat" → the bag item whose name shares the most words with the text (ties → none)."""
        said = set(_WORD.findall((text or "").lower())) - _STOP
        if not said:
            return None
        scored = []
        for i in state.get("items") or []:
            if i.get("status") == "transferred_out":
                continue
            words = set(_WORD.findall(str(i.get("name", "")).lower())) - _STOP
            hit = len(words & said)
            if hit:
                scored.append((hit, i))
        scored.sort(key=lambda x: -x[0])
        if not scored or (len(scored) > 1 and scored[0][0] == scored[1][0]):
            return None
        return scored[0][1]

    # ----- owner conversation (Part C §5) ----------------------------------
    async def owner_message(self, text: str, photo_urls: Optional[List[str]] = None, selection: Optional[dict] = None) -> List[Reply]:
        """One inbound line from the owner → zero or more replies.

        RateLimited from a read propagates (the inbox row is retried later); a refused write becomes a friendly line.
        """
        photo_urls = photo_urls or []
        if selection is not None:
            intent = intent_from_card(selection)
            if selection.get("condition"):
                self.convo["condition"] = selection["condition"]
        else:
            intent = parse_intent(text)

        if photo_urls:
            return await self._on_photo(photo_urls[0])

        if intent == "hi":
            return [Reply(w.hello(self.pet))]
        if intent == "help":
            return [Reply(w.help_text())]
        if intent == "bag":
            s = await self.state()
            items = [i for i in s.get("items") or [] if i.get("status") != "transferred_out"]
            lines = [f"{i.get('name', 'item')} {i.get('size', '')} {w.hearts(_owners(i))}" for i in items]
            return [Reply(w.bag(lines), card=("detail", cards.bag_card(items)))]
        if intent == "sell":
            return await self._on_sell(text, selection)
        if intent in ("keep", "later"):
            s = await self.state()
            nid = (selection or {}).get("nudge_id")
            nudge = next((n for n in s.get("nudges") or [] if n.get("id") == nid), None) if nid else self._open_nudge(s)
            if nudge:
                try:
                    await self.client.resolve_nudge(nudge["id"], intent)  # cbridge: later → B's "snooze"
                except RateLimited:
                    raise
                except Base44Error as e:
                    log.warning("resolveNudge: %s", e)
            self.convo = {"step": "idle"}
            return [Reply(w.keep() if intent == "keep" else w.later())]
        if intent == "condition":
            cond = parse_condition(text)
            if self.convo.get("step") == "await_condition" and cond:
                self.convo["condition"] = cond
                return [Reply(w.ask_condition(cond))]
            return [Reply(w.unknown())]
        if intent == "yes":
            if self.convo.get("step") != "await_condition":
                return [Reply(w.unknown())]
            return await self._list_now()
        if intent == "no":
            if self.convo.get("step") == "await_condition":
                return [Reply('Okay — tell me "like new", "gently used" or "well loved".')]
            return [Reply(w.unknown())]
        if intent in ("accept", "decline"):
            return await self._on_decide(intent, selection)
        if intent == "pay":
            return await self._on_pay(selection)
        return [Reply(w.unknown())]

    async def _on_sell(self, text: str, selection: Optional[dict]) -> List[Reply]:
        s = await self.state()
        nudge = self._open_nudge(s)
        item = self._item(s, (selection or {}).get("item_id")) or self._named_item(s, text) \
            or self._item(s, (nudge or {}).get("itemId"))
        if not item:
            return [Reply(w.nothing_due())]
        name = item.get("name", "item")
        if _owners(item) >= 3:
            return [Reply(w.final_home(name))]
        if item.get("status") == "pending_trade":
            return [Reply(w.in_trade(name))]
        if item.get("status") == "listed":
            listing = next((l for l in s.get("listings") or [] if l.get("itemId") == item.get("id") and l.get("status") == "active"), None)
            if listing:
                return [Reply(w.already_listed(name, _cents(listing.get("priceCents"))))]
        nudge_id = nudge["id"] if nudge and nudge.get("itemId") == item.get("id") else None
        self.convo = {"step": "await_photo", "itemId": item["id"], "nudgeId": nudge_id, "itemName": name}
        return [Reply(w.ask_photo(name))]

    async def _on_photo(self, url: str) -> List[Reply]:
        if self.convo.get("step") not in ("await_photo", "await_condition"):
            s = await self.state()
            nudge = self._open_nudge(s)
            if not nudge:
                return [Reply(w.unknown())]
            item = self._item(s, nudge.get("itemId")) or {}
            self.convo = {"step": "await_photo", "itemId": nudge.get("itemId"), "nudgeId": nudge["id"], "itemName": item.get("name", "item")}
        try:
            sug = await self.client.suggest_condition(url, self.convo.get("itemName", ""))
        except Base44Error:  # incl. RateLimited: the pet's guess is optional
            sug = {"condition": "gently_used", "note": ""}
        self.convo.update({"step": "await_condition", "photoUrl": url, "condition": sug.get("condition") or "gently_used", "note": sug.get("note") or ""})
        return [Reply(w.ask_condition(self.convo["condition"]),
                      card=("detail", cards.condition_card(self.convo.get("itemName", "item"), self.convo["condition"], self.convo["note"])))]

    async def _list_now(self) -> List[Reply]:
        c = self.convo
        try:
            r = await self.client.list_item(
                itemId=c["itemId"], sellerId=self.parent_id,
                condition=c.get("condition", "gently_used"), conditionNote=c.get("note", ""),
                photos=[c["photoUrl"]] if c.get("photoUrl") else [], shared=True,
            )
        except RateLimited:
            raise
        except Base44Error as e:
            log.warning("listItem: %s", e)
            self.convo = {"step": "idle"}
            if e.code == "not_resellable":
                return [Reply(w.final_home(c.get("itemName", "item")))]
            return [Reply(w.list_failed(c.get("itemName", "item")))]
        # B's listItem also resolves the item's open outgrow nudges, so no resolveNudge call here (saves a call).
        listing = r.get("listing") or r
        item = r.get("item") or {}
        self.convo = {"step": "idle"}
        return [Reply(w.listed(_cents(listing.get("priceCents")), _cents(item.get("originalPriceCents")), _owners(item)))]

    async def _on_decide(self, intent: str, selection: Optional[dict]) -> List[Reply]:
        s = await self.state()
        pid = (selection or {}).get("proposal_id")
        mine = lambda p: p.get("buyerDecision" if p.get("buyerId") == self.parent_id else "sellerDecision")  # noqa: E731
        live = [p for p in s.get("proposals") or [] if p.get("status") == "open" and (not pid or p.get("id") == pid)]
        todo = next((p for p in live if mine(p) in (None, "pending")), None)
        if not todo:
            if intent == "accept" and live:  # already said yes; still waiting on the other side
                return [Reply(w.accepted(self._who(self._other_id(live[0]), "name") or "the other side"))]
            ready = next((p for p in s.get("proposals") or [] if p.get("status") == "both_accepted"
                          and (not pid or p.get("id") == pid)), None)
            if intent == "accept" and ready:
                if ready.get("buyerId") == self.parent_id:
                    return [Reply(w.both_accepted(self.pay_link(ready["id"])), card=("review", cards.pay_card(ready)))]
                return [Reply(w.accepted("the buyer to pay"))]
            return [Reply(w.no_open_proposal())]
        try:
            await self.client.decide_proposal(todo["id"], self.parent_id, "accepted" if intent == "accept" else "declined")
        except RateLimited:
            raise
        except Base44Error as e:
            log.warning("decideProposal: %s", e)
            return [Reply(w.expired() if e.code == "expired" else w.no_open_proposal())]
        return []  # the proposal:updated event carries the next line

    async def _on_pay(self, selection: Optional[dict]) -> List[Reply]:
        s = await self.state()
        pid = (selection or {}).get("proposal_id")
        ready = next((p for p in s.get("proposals") or [] if p.get("status") == "both_accepted"
                      and p.get("buyerId") == self.parent_id and (not pid or p.get("id") == pid)), None)
        if not ready:
            waiting = any(p.get("status") == "open" and p.get("buyerId") == self.parent_id for p in s.get("proposals") or [])
            return [Reply(w.not_yet() if waiting else w.no_open_proposal())]
        if selection is not None:  # ASI:One: the card IS the pay button (demo payment)
            try:
                await self.client.pay_proposal(ready["id"], self.parent_id)
            except RateLimited:
                raise
            except Base44Error as e:
                log.warning("payProposal: %s", e)
                return [Reply(w.payment_failed())]
            return []  # trade:completed event follows
        return [Reply(w.both_accepted(self.pay_link(ready["id"])), card=("review", cards.pay_card(ready)))]

    # ----- app events (Part C §6; payload shapes = types.ts InboxEvent) -----
    async def event(self, payload: Dict[str, Any], age_s: Optional[float] = None) -> List[Reply]:
        """age_s: how old the inbox row is (None = unknown/fresh). Rows past INBOX_MAX_AGE_S never get here."""
        kind = payload.get("type")
        if kind == "nudge:new":
            return await self._on_nudge(payload)
        if kind == "proposal:new":
            return await self._on_proposal_new(payload)
        if kind == "proposal:updated":
            return await self._on_proposal_updated(payload, age_s)
        if kind == "trade:completed":
            return await self._on_trade_completed(payload)
        return []

    async def _on_nudge(self, payload: Dict[str, Any]) -> List[Reply]:
        # {type, nudgeId, itemId, kind, message}
        if payload.get("kind") == "new_owner_welcome" and payload.get("itemId") in self.announced:
            return []  # trade:completed already said hi to it (no state read)
        s = await self.state()
        nid = payload.get("nudgeId")
        nudge = next((n for n in s.get("nudges") or [] if n.get("id") == nid), None) if nid else self._open_nudge(s)
        if not nudge:
            return []  # resolved meanwhile (e.g. answered in the app): don't nag
        item = self._item(s, nudge.get("itemId") or payload.get("itemId")) or {}
        kind = nudge.get("kind") or payload.get("kind")
        if kind == "new_owner_welcome":
            if item.get("id") in self.announced:
                return []
            self.announced.add(item.get("id"))
            return [Reply(w.completed(item.get("name", "new item"), w.short_date(item.get("predictedOutgrowDate"))))]
        if kind != "outgrow_check" and (nudge.get("message") or payload.get("message")):
            return [Reply(str(nudge.get("message") or payload.get("message")))]
        return [Reply(w.nudge(item.get("name", "item"), item.get("size", "")), card=("detail", cards.nudge_card(item, nudge["id"])))]

    async def _on_proposal_new(self, payload: Dict[str, Any]) -> List[Reply]:
        # {type, proposalId, role}
        pid = payload.get("proposalId")
        if pid not in self.props:
            await self.state()
        prop = self.props.get(pid)
        if not prop or prop.get("status") not in (None, "open"):
            return []  # gone, or already moved on: the proposal:updated events speak
        snap = prop.get("snapshot") or {}
        peer_pet = payload.get("peerPet") or self._who(self._other_id(prop), "pet") or "a friend's pet"
        return [Reply(w.proposal(snap.get("itemName", "item"), _cents(snap.get("priceCents")), _cents(snap.get("originalPriceCents")),
                                 int(snap.get("previousOwners") or 1), peer_pet),
                      card=("review", cards.proposal_card(prop, self.parent_id)))]

    async def _on_proposal_updated(self, payload: Dict[str, Any], age_s: Optional[float] = None) -> List[Reply]:
        # {type, proposalId, role, status, sellerDecision, buyerDecision} — read the decisions from the payload, not
        # from a later getState, so a slow agent still says what happened at that moment… unless the proposal has
        # moved on since (an inbox backlog): then the later event speaks and this one stays quiet.
        pid = payload.get("proposalId")
        prop = self.props.get(pid)
        if prop is None or (age_s is not None and age_s > RECHECK_AFTER_S):
            try:
                await self.state()
            except RateLimited:
                raise
            except Base44Error as e:
                log.warning("getState: %s", e)
            prop = self.props.get(pid) or prop or payload.get("proposal") or {"id": pid}
        role = payload.get("role") or ("buyer" if prop.get("buyerId") == self.parent_id
                                       else "seller" if prop.get("sellerId") == self.parent_id else None)
        st = payload.get("status") or prop.get("status") or "declined"
        known = prop.get("status")
        if known and _STATUS_RANK.get(known, 0) > _STATUS_RANK.get(st, 0):
            return []  # e.g. "both said yes, tap to pay" for a trade that is already paid
        other_id = prop.get("sellerId") if role == "buyer" else prop.get("buyerId")
        other = self._who(other_id, "name") or payload.get("otherName") or "the other side"
        if st == "both_accepted":
            if role == "buyer":
                return [Reply(w.both_accepted(self.pay_link(pid)), card=("review", cards.pay_card(prop)) if prop.get("snapshot") else None)]
            return [Reply(w.accepted("the buyer to pay"))]
        if st == "declined":
            return [Reply(w.declined())]
        if st == "expired":
            return [Reply(w.expired())]
        if st == "payment_failed":
            return [Reply(w.payment_failed())]
        if st != "open":
            return []  # paid → trade:completed says it
        decided = {"buyer": payload.get("buyerDecision", prop.get("buyerDecision")),
                   "seller": payload.get("sellerDecision", prop.get("sellerDecision"))}
        mine, theirs = decided.get(role or ""), decided.get("seller" if role == "buyer" else "buyer")
        if mine == "accepted":
            return [Reply(w.accepted(other))]
        if theirs == "accepted":
            card = ("review", cards.proposal_card(prop, self.parent_id)) if prop.get("snapshot") else None
            return [Reply(w.other_accepted(other[:1].upper() + other[1:]), card=card)]
        return []

    async def _on_trade_completed(self, payload: Dict[str, Any]) -> List[Reply]:
        # B today: {type, proposalId, role, itemId, priceCents}; W3 adds {buyerId, sellerId, snapshot, predictedOutgrowDate}.
        pid, item_id = payload.get("proposalId"), payload.get("itemId")
        prop = self.props.get(pid) or {}
        snap = {**(prop.get("snapshot") or {}), **{k: v for k, v in (payload.get("snapshot") or {}).items() if v is not None}}
        buyer_id = payload.get("buyerId") or prop.get("buyerId")
        role = payload.get("role") or ("buyer" if buyer_id == self.parent_id else "seller")
        until = payload.get("predictedOutgrowDate")
        item: Dict[str, Any] = {}
        if not snap.get("itemName") or (role == "buyer" and not until):
            try:
                s = await self.state()
            except RateLimited:
                raise
            except Base44Error as e:
                log.warning("getState: %s", e)
                s = {}
            prop = self.props.get(pid) or prop
            snap = {**(prop.get("snapshot") or {}), **snap}
            item = self._item(s, item_id) or next((i for i in s.get("passedOn") or [] if i.get("id") == item_id), None) or {}
        name = snap.get("itemName") or item.get("name") or "new item"
        price = _cents(payload.get("priceCents") or snap.get("priceCents"))
        gif = payload.get("flowersUrl") or (f"{self.app_url}/fx/flowers.gif" if self.app_url else None)
        if role == "buyer":
            if item_id:
                self.announced.add(item_id)
            return [Reply(w.completed(name, w.short_date(until or item.get("predictedOutgrowDate"))), image_url=gif)]
        return [Reply(w.sold(name, price), image_url=gif)]

    # ----- relay (agent ↔ agent, Part C §7) --------------------------------
    def _peer(self, enc: str) -> Dict[str, Any]:
        return self.peers.setdefault(enc, {"asked": False, "answered": False, "offered": False})

    def _turn(self, enc: str, role: str, kind: str, text: str, parent_id: Optional[str] = None) -> Dict[str, Any]:
        t = {"from": f"{role}_agent", "parentId": self.parent_id if parent_id is None else parent_id, "kind": kind,
             "text": text[:200], "at": _now_iso()}
        self.transcripts.setdefault(enc, []).append(t)
        return t

    async def say(self, enc: str, role: str, kind: str, text: str) -> str:
        turn = self._turn(enc, role, kind, text)
        if self.append_turns:
            try:
                await self.client.append_turn(enc, turn)
            except Base44Error as e:  # bubbles are best-effort; the transcript also rides on createProposal
                log.warning("appendTurn: %s", e)
        return text

    def heard(self, enc: str, role: str, kind: str, line: str) -> None:
        """Record the other pet's bubble, so the proposal carries both sides of the conversation."""
        last = (self.transcripts.get(enc) or [{}])[-1]
        if line and last.get("text") != line[:200]:  # a retried message must not repeat the bubble
            self._turn(enc, role, kind, line, parent_id=self._peer(enc).get("parentId", ""))

    async def _no_match(self, enc: str) -> None:
        self._peer(enc)["done"] = True
        try:
            await self.client.no_match(enc)
        except Base44Error as e:
            log.warning("noMatch: %s", e)

    async def _peer_id(self, enc: str) -> Optional[str]:
        """The other parent's id comes with my own encounter row, which can land after their first message."""
        p = self._peer(enc)
        deadline = time.monotonic() + self.peer_wait_s
        while not p.get("parentId") and time.monotonic() < deadline:
            await asyncio.sleep(0.25)
        return p.get("parentId")

    @staticmethod
    def _shared_needs(s: Dict[str, Any]) -> List[Need]:
        return [Need(sizes=list(n.get("sizes") or []), categories=list(n.get("categories") or []), max_price_cents=n.get("maxPriceCents"))
                for n in s.get("needs") or [] if n.get("shared")]

    async def _ask(self, enc: str, s: Optional[Dict[str, Any]] = None) -> LookingFor:
        """Open as the buyer: my shared needs (or a hello that invites the other pet to ask instead)."""
        p = self._peer(enc)
        p["asked"] = True
        try:
            s = s if s is not None else await self.state()
        except Exception:
            p["asked"] = False  # retried with the inbox row
            raise
        needs = self._shared_needs(s)
        age = (s.get("child") or {}).get("ageMonths", s.get("childAgeMonths"))
        if needs:
            sizes = list(dict.fromkeys(sz for n in needs for sz in n.sizes))
            line = w.t_looking_for(self.pet, sizes, needs[0].categories)
        else:
            line = w.t_hello(self.pet)
        await self.say(enc, "buyer", "looking_for", line)
        return LookingFor(encounter_id=enc, needs=needs, child_age_months=age, line=line)

    async def open_encounter(self, payload: Dict[str, Any]) -> Optional[LookingFor]:
        """Encounter row {encounterId, role, peer:{parentId, agentAddress}}. The "buyer" side opens; the other waits."""
        enc = payload.get("encounterId")
        if not enc:
            return None
        p = self._peer(enc)
        p.update({k: v for k, v in (payload.get("peer") or {}).items() if v})
        p["role"] = payload.get("role", "buyer")
        if p["role"] != "buyer" or p["asked"] or p["answered"] or p.get("done"):
            return None
        return await self._ask(enc)

    async def on_looking_for(self, msg: LookingFor) -> Any:
        """Answer with my shared listings that match → HaveListings. Nothing for them but I have needs of my own →
        my own LookingFor (roles swap once). Otherwise NoFit."""
        enc = msg.encounter_id
        p = self._peer(enc)
        p["answered"] = True
        self.heard(enc, "buyer" if msg.needs else "seller", "looking_for", msg.line)
        s = await self.state()
        if msg.needs:
            out = self._offer(s, msg)
            if out:
                p["offered"] = True
                line = await self.say(enc, "seller", "have", w.t_have(self.pet, out[0].item_name, out[0].size))
                return HaveListings(encounter_id=enc, listings=out[:5], line=line)
        if not p["asked"] and self._shared_needs(s):
            return await self._ask(enc, s)
        line = await self.say(enc, "seller", "no_fit", w.t_no_fit(self.pet))
        return NoFit(encounter_id=enc, line=line)

    @staticmethod
    def _offer(s: Dict[str, Any], msg: LookingFor) -> List[ListingCard]:
        """My shared, active listings that fit their needs. Same fields as agentApi's peer view (rule 3)."""
        items = {i.get("id"): i for i in s.get("items") or []}
        wanted = {sz for n in msg.needs for sz in n.sizes}
        cats = {c for n in msg.needs for c in n.categories}
        caps = [n.max_price_cents for n in msg.needs if n.max_price_cents is not None]
        maxp = max(caps) if caps and len(caps) == len(msg.needs) else None  # a need without a cap takes any price
        out = []
        for l in s.get("listings") or []:
            if not l.get("shared") or l.get("status") != "active":
                continue
            it = items.get(l.get("itemId")) or {}
            if wanted and it.get("size") not in wanted:
                continue
            if cats and it.get("category") not in cats:
                continue
            if maxp is not None and _cents(l.get("priceCents")) > maxp:
                continue
            if _owners(it) >= 3:
                continue
            out.append(ListingCard(listing_id=l["id"], item_name=it.get("name", ""), icon=it.get("icon", ""),
                                   category=it.get("category", ""), size=it.get("size", ""), owner_count=_owners(it),
                                   condition=l.get("condition", "gently_used"), price_cents=_cents(l.get("priceCents")),
                                   original_price_cents=_cents(it.get("originalPriceCents"))))
        return out

    async def on_have_listings(self, msg: HaveListings) -> Any:
        """Buyer side: B's fit ranks the offer → ProposeTrade, or NoFit when nothing is eligible."""
        enc = msg.encounter_id
        self.heard(enc, "seller", "have", msg.line)
        seller = await self._peer_id(enc)
        best, weeks, reason, ranked_ok = None, None, "", False
        if seller:
            try:
                ranked = (await self.client.fit(buyerId=self.parent_id, sellerId=seller)).get("matches") or []
                ranked_ok = True
                offered = {l.listing_id: l for l in msg.listings}
                for m in ranked:
                    if m.get("listingId") in offered:
                        best, weeks, reason = offered[m["listingId"]], m.get("wearWeeksLeft"), m.get("reason", "")
                        break
            except Base44Error as e:  # incl. RateLimited: B re-checks everything in createProposal anyway
                log.warning("fit: %s", e)
        if best is None and not ranked_ok and msg.listings:
            best = msg.listings[0]
            reason = f"Size {best.size} matches a shared need."
        if best is None:
            line = await self.say(enc, "buyer", "no_fit", w.t_not_needed(self.pet))
            return NoFit(encounter_id=enc, reason="Nothing on offer fits my little one.", line=line)
        # B's reason names the buyer ("Jo's little one fits…"): keep it for createProposal, never put it on the wire.
        self._peer(enc)["reason"] = reason
        fit_line = await self.say(enc, "buyer", "fit_check", w.t_fit_check(self.pet, weeks))
        line = await self.say(enc, "buyer", "propose", w.t_propose(self.pet, best.price_cents))
        wire_reason = f"Size {best.size} fits for about {weeks} more weeks." if weeks is not None else f"Size {best.size} fits."
        return ProposeTrade(encounter_id=enc, listing_id=best.listing_id, price_cents=best.price_cents, reason=wire_reason,
                            wear_weeks_left=weeks, line=f"{fit_line}\n{line}")

    async def on_no_fit(self, msg: NoFit) -> Optional[LookingFor]:
        """Nothing for me that way round. If I haven't asked yet and have needs, I ask now; else the encounter is over."""
        enc = msg.encounter_id
        p = self._peer(enc)
        self.heard(enc, "buyer" if p.get("offered") else "seller", "no_fit", msg.line)
        if not p["asked"] and not p.get("done"):
            s = await self.state()
            if self._shared_needs(s):
                return await self._ask(enc, s)
        await self._no_match(enc)
        return None

    async def on_propose(self, msg: ProposeTrade) -> TradeAck:
        """Seller side re-checks that the listing is still live and at that price (B re-validates again)."""
        enc = msg.encounter_id
        for i, part in enumerate((msg.line or "").split("\n")):
            self.heard(enc, "buyer", "fit_check" if i == 0 and "\n" in msg.line else "propose", part)
        try:
            s = await self.state()
            live = next((l for l in s.get("listings") or [] if l.get("id") == msg.listing_id and l.get("status") == "active" and l.get("shared")), None)
            changed = not live or _cents(live.get("priceCents")) != msg.price_cents
        except Base44Error as e:  # can't look right now: let B's createProposal be the judge
            log.warning("getState: %s", e)
            changed = False
        if changed:
            line = await self.say(enc, "seller", "decline", w.t_decline(self.pet, "that listing changed."))
            return TradeAck(encounter_id=enc, listing_id=msg.listing_id, ok=False, reason="listing changed", line=line)
        line = await self.say(enc, "seller", "ack", w.t_ack(self.pet))
        return TradeAck(encounter_id=enc, listing_id=msg.listing_id, ok=True, line=line)

    async def on_ack(self, msg: TradeAck) -> Optional[Dict[str, Any]]:
        """Buyer side creates the proposal (B re-validates every rule and derives the seller from the listing)."""
        enc = msg.encounter_id
        self.heard(enc, "seller", "ack" if msg.ok else "decline", msg.line)
        if not msg.ok:
            await self._no_match(enc)
            return None
        seller = await self._peer_id(enc)
        transcript = [dict(t) for t in self.transcripts.get(enc, [])]
        for t in transcript:
            if not t["parentId"]:
                t["parentId"] = seller or ""
        # B's fit reason ("Jo's little one fits it for about 4 more weeks."); empty → B writes its own reasonLine.
        reason = self._peer(enc).get("reason") or ""
        args: Dict[str, Any] = dict(listingId=msg.listing_id, buyerId=self.parent_id, encounterId=enc, reason=reason,
                                    transcript=transcript, source="fetch")
        if seller:
            args["sellerId"] = seller
        try:
            prop = await self.client.create_proposal(**args)
        except Base44Error as e:
            log.warning("createProposal: %s", e)
            if e.code in ("not_eligible", "already_open", "not_resellable"):
                await self._no_match(enc)
            return None  # anything else (rate limit, encounter already proposed): C's 8 s fallback takes over
        self._peer(enc)["done"] = True
        if isinstance(prop, dict) and prop.get("id"):
            self.props[prop["id"]] = prop
        return prop

    async def on_relay(self, msg: Any) -> Any:
        """One RelayProtocol message in → the reply to send back (or None)."""
        if isinstance(msg, LookingFor):
            return await self.on_looking_for(msg)
        if isinstance(msg, HaveListings):
            return await self.on_have_listings(msg)
        if isinstance(msg, NoFit):
            return await self.on_no_fit(msg)
        if isinstance(msg, ProposeTrade):
            return await self.on_propose(msg)
        if isinstance(msg, TradeAck):
            await self.on_ack(msg)
            return None
        return None

    # ----- housekeeping ------------------------------------------------------
    async def recheck_parent(self, agent_address: str) -> bool:
        """Look my Parent up by name again; if the id changed (re-seed), switch to it and re-register. True if changed."""
        r = await self.client.lookup_parent(self.parent_name) or {}
        fresh = r.get("id")
        if fresh:
            self.directory[fresh] = {"key": self.parent_name, "name": r.get("name"), "pet": (r.get("pet") or {}).get("name")}
        if not fresh or fresh == self.parent_id:
            return False
        log.info("%s: parent id changed %s → %s (demo reset); re-registering", self.parent_name, self.parent_id, fresh)
        self.parent_id = fresh
        self.convo = {"step": "idle"}
        self.props.clear()
        self.announced.clear()
        try:
            await self.client.register_agent(fresh, agent_address)
        except Base44Error as e:
            log.warning("registerAgent: %s", e)
        return True


# ---------------------------------------------------------------------------
# uAgents wiring
# ---------------------------------------------------------------------------

def build_agent(parent: str, port: int, client: Base44Client, parent_id: str, app_url: str, seed: Optional[str] = None,
                poll_s: Optional[float] = None, asi_open: Optional[bool] = None, max_age_s: Optional[float] = None) -> Agent:
    team_secret = os.environ.get("TEAM_SECRET", "dev")
    agent = Agent(
        name=f"{parent}-closet",
        seed=seed or f"relay-{parent}-{team_secret}",
        port=port,
        mailbox=True,
        readme_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_readme.md"),
        description=f"Closet pet for {parent.title()} in Hand-Me-Down Relay: tracks kids' clothes, "
                    f"nudges when they're outgrown, and trades with nearby parents' agents. Never decides for a person.",
        publish_agent_details=True,
    )
    brain = ClosetBrain(client, parent, parent_id, app_url, peer_wait_s=20.0)
    attach(agent, brain, poll_s=poll_s if poll_s is not None else float(os.environ.get("POLL_S", "10")),
           asi_open=asi_open, max_age_s=max_age_s)
    return agent


def attach(agent: Agent, brain: ClosetBrain, *, inbox: Optional[InboxSource] = None, poll_s: float = 1.0,
           recheck_s: float = 60.0, register: bool = True, publish_manifest: bool = True,
           address_book: Optional[Dict[str, str]] = None, send_lines: bool = True,
           asi_open: Optional[bool] = None, max_age_s: Optional[float] = None) -> None:
    """Wire a brain into an Agent.

    inbox:        where rows come from (default: this agent's own claimInbox; live_bureau passes a shared InboxHub)
    recheck_s:    lookupParent re-check period (0 = off; also off when PARENT_ID_<NAME> pins the id)
    address_book: parent id → agent address of agents in the same process (beats a stale Parent.agentAddress)
    send_lines:   False = don't call sendImessage (lines only go to ASI:One / the log)
    asi_open:     True = unclaimed ASI:One senders may say hi / help / bag (default: env ASI_OPEN == "1", else off)
    max_age_s:    inbox rows older than this are completed without a word (default: env INBOX_MAX_AGE_S or 600; 0 = off)
    """
    relay = make_relay_protocol()
    chat = Protocol(spec=chat_protocol_spec)
    open_mode = asi_open if asi_open is not None else os.environ.get("ASI_OPEN", "0") == "1"
    if max_age_s is None:
        try:
            max_age_s = float(os.environ.get("INBOX_MAX_AGE_S", INBOX_MAX_AGE_S))
        except ValueError:
            max_age_s = INBOX_MAX_AGE_S
    asi_users: Dict[str, str] = {}  # ASI:One sender address → parent id (only our own parent binds here)
    last_sender: Dict[str, str] = {}  # "asi": the CLAIMED owner's ASI:One address (gets every line); "text": dedupe
    backlog: Deque[Dict[str, Any]] = deque()
    source: InboxSource = inbox or (lambda: brain.client.claim_inbox(brain.parent_id, agent.address))

    async def deliver(ctx: Context, replies: List[Reply]) -> None:
        """iMessage (+ the in-app pet's PetLine) always; ASI:One too if someone claimed this parent."""
        for r in replies:
            if r.text == last_sender.get("text"):  # two events in one tick → say it once
                continue
            last_sender["text"] = r.text
            ctx.logger.info(f"→ {brain.parent_name}: {r.text}")
            if send_lines:
                try:
                    await brain.client.send_imessage(brain.parent_id, r.text, r.image_url)
                except Base44Error as e:
                    ctx.logger.warning(f"sendImessage: {e}")
            if last_sender.get("asi"):
                msg = cards.card_message(r.text, r.card[0], r.card[1]) if r.card else cards.text_message(r.text)
                await ctx.send(last_sender["asi"], msg)

    @agent.on_event("startup")
    async def _startup(ctx: Context):
        ctx.logger.info(f"{agent.name} address={agent.address} parent={brain.parent_id}")
        if not register:
            return
        try:
            await brain.client.register_agent(brain.parent_id, agent.address)
        except Base44Error as e:
            ctx.logger.warning(f"registerAgent: {e} (B's seed can copy the address instead)")

    # ---- parent id check -----------------------------------------------------
    # B's RESET keeps Parent ids stable now, but if the row is ever re-created (or the agent started against an
    # older seed) the cached id goes stale and claimInbox silently returns nothing. Re-check by name once a minute.
    if recheck_s and recheck_s > 0:
        @agent.on_interval(period=recheck_s)
        async def _recheck_parent(ctx: Context):
            if os.environ.get(f"PARENT_ID_{brain.parent_name.upper()}"):
                return  # pinned by env: trust it
            try:
                await brain.recheck_parent(agent.address)
            except Base44Error as e:
                ctx.logger.warning(f"lookupParent: {e}")

    # ---- inbox loop (Part C §4) --------------------------------------------
    @agent.on_interval(period=poll_s)
    async def _poll(ctx: Context):
        if not backlog:
            try:
                backlog.extend(await source())
            except Base44Error as e:
                ctx.logger.warning(f"claimInbox: {e}")
                return
        while backlog:
            row = backlog[0]
            age = row_age_s(row)
            try:
                if max_age_s and age is not None and age > max_age_s:
                    # Left over from while the agent was off (no RESET): "tap to pay" for a trade paid an hour ago,
                    # or an old "accept" landing on a newer proposal, would be wrong. Complete it without a word.
                    ctx.logger.info(f"inbox {row.get('id')}: {row.get('type')} row from {age / 60:.0f} min ago — skipped (stale)")
                else:
                    await handle_row(ctx, row, age)
            except RateLimited as e:  # nothing happened; keep the (claimed) row and try again next tick
                ctx.logger.warning(f"inbox {row.get('id')}: {e} — will retry")
                return
            except Exception as e:  # noqa: BLE001 — never let one row kill the loop
                ctx.logger.error(f"inbox {row.get('id')}: {type(e).__name__}: {e}")
            backlog.popleft()
            try:
                await brain.client.complete(row["id"])
            except Base44Error as e:
                ctx.logger.warning(f"complete: {e}")

    async def handle_row(ctx: Context, row: Dict[str, Any], age: Optional[float] = None) -> None:
        kind, p = row.get("type"), row.get("payload") or {}
        if kind == "imessage":
            await deliver(ctx, await brain.owner_message(p.get("text", ""), p.get("photoUrls") or []))
        elif kind == "event":
            await deliver(ctx, await brain.event(p, age_s=age))
        elif kind == "encounter":
            opening = await brain.open_encounter(p)
            peer = p.get("peer") or {}
            addr = (address_book or {}).get(peer.get("parentId", "")) or peer.get("agentAddress")
            if opening is not None and addr:
                await ctx.send(addr, opening)
            elif opening is not None:
                ctx.logger.info("peer has no agentAddress — C's local fallback will match after 8 s")

    # ---- RelayProtocol (Part C §7) -----------------------------------------
    async def _reply(ctx: Context, sender: str, msg: Any) -> None:
        for attempt in range(2):
            try:
                out = await brain.on_relay(msg)
                break
            except RateLimited as e:  # wait the pause out once; after that C's 8 s fallback owns the encounter
                if attempt:
                    ctx.logger.warning(f"relay {type(msg).__name__}: {e} — leaving it to C's fallback")
                    return
                await asyncio.sleep(e.retry_after or 15.0)
        if out is not None:
            await ctx.send(sender, out)

    @relay.on_message(model=LookingFor, replies={HaveListings, NoFit, LookingFor})
    async def _looking(ctx: Context, sender: str, msg: LookingFor):
        brain._peer(msg.encounter_id).setdefault("agentAddress", sender)
        await _reply(ctx, sender, msg)

    @relay.on_message(model=HaveListings, replies={ProposeTrade, NoFit})
    async def _have(ctx: Context, sender: str, msg: HaveListings):
        await _reply(ctx, sender, msg)

    @relay.on_message(model=NoFit)
    async def _nofit(ctx: Context, sender: str, msg: NoFit):
        await _reply(ctx, sender, msg)

    @relay.on_message(model=ProposeTrade, replies={TradeAck})
    async def _propose(ctx: Context, sender: str, msg: ProposeTrade):
        await _reply(ctx, sender, msg)

    @relay.on_message(model=TradeAck)
    async def _ack(ctx: Context, sender: str, msg: TradeAck):
        prop = await brain.on_ack(msg)
        if prop:
            ctx.logger.info(f"proposal {prop.get('id')} created for encounter {msg.encounter_id}")

    # ---- Chat protocol / ASI:One (Part C §8) -------------------------------
    @chat.on_message(ChatMessage)
    async def _chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        for part in msg.content:
            if isinstance(part, StartSessionContent):
                await ctx.send(sender, cards.text_message(
                    f"{w.hello(brain.pet)} If you're {brain.parent_name.title()}, text: claim {brain.parent_name}-<last 4 of your phone>"))
            elif isinstance(part, TextContent):
                text = part.text or ""
                claim = parse_claim(text)
                if claim:
                    name, code = claim
                    if name != brain.parent_name:
                        await ctx.send(sender, cards.text_message(f"I'm {brain.parent_name.title()}'s pet — find {name.title()}'s agent to claim that one."))
                        continue
                    try:
                        await brain.client.bind_asi_user(brain.parent_id, code, sender)
                        asi_users[sender] = brain.parent_id
                        last_sender["asi"] = sender
                        await ctx.send(sender, cards.text_message(f"Linked! I'm {brain.pet}. Try \"bag\"."))
                    except Base44Error:
                        await ctx.send(sender, cards.text_message("That code didn't match. It's the last 4 digits of your phone (0000 in the demo)."))
                    continue
                sel = parse_card_reply(text)
                intent = intent_from_card(sel) if sel is not None else parse_intent(text)
                refusal = asi_refusal(brain.parent_name, sender in asi_users, intent, open_mode)
                if refusal:
                    await ctx.send(sender, cards.text_message(refusal))
                    continue
                if sender in asi_users:
                    last_sender["asi"] = sender  # only the claimed owner gets this parent's later lines (pay links…)
                try:
                    replies = await brain.owner_message(text, selection=sel)
                except RateLimited:
                    replies = [Reply(w.busy())]
                for r in replies:
                    out = cards.card_message(r.text, r.card[0], r.card[1]) if r.card else cards.text_message(r.text)
                    await ctx.send(sender, out)
            elif isinstance(part, EndSessionContent):
                ctx.logger.info("ASI:One session ended")

    @chat.on_message(ChatAcknowledgement)
    async def _chat_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(relay, publish_manifest=publish_manifest)
    agent.include(chat, publish_manifest=publish_manifest)


# ---------------------------------------------------------------------------

async def resolve_parent_id(client: Base44Client, parent: str) -> str:
    env = os.environ.get(f"PARENT_ID_{parent.upper()}")
    if env:
        return env
    try:
        r = await client.lookup_parent(parent)
        return r["id"]
    except Exception as e:  # noqa: BLE001
        log.warning("lookupParent failed (%s); using name as id — set PARENT_ID_%s", e, parent.upper())
        return parent


def main() -> None:
    from live_bureau import load_config, seed_for  # env, then agents/.env, then ../.env.local (same as `make live`)

    ap = argparse.ArgumentParser()
    ap.add_argument("--parent", required=True, choices=sorted(PARENT_PORTS))
    ap.add_argument("--port", type=int)
    ap.add_argument("--log", default="INFO")
    a = ap.parse_args()
    logging.basicConfig(level=a.log)
    cfg = load_config()
    os.environ.update({k: v for k, v in cfg.items() if k.startswith("PARENT_ID_")})  # attach() checks the pin
    budget = CallBudget(int(cfg["CALLS_PER_MIN"]))

    async def _resolve() -> str:
        client = Base44Client(cfg["BASE44_URL"], cfg.get("AGENT_KEY", ""), budget=budget)
        try:
            return await resolve_parent_id(client, a.parent)
        finally:
            await client.close()

    parent_id = asyncio.run(_resolve())
    asyncio.set_event_loop(asyncio.new_event_loop())  # uAgents needs a current loop after asyncio.run()
    agent = build_agent(a.parent, a.port or PARENT_PORTS[a.parent], Base44Client(cfg["BASE44_URL"], cfg.get("AGENT_KEY", ""), budget=budget),
                        parent_id, cfg["APP_URL"], seed=seed_for(a.parent, cfg["TEAM_SECRET"]), poll_s=float(cfg["POLL_S"]),
                        asi_open=cfg.get("ASI_OPEN") == "1", max_age_s=float(cfg.get("INBOX_MAX_AGE_S") or INBOX_MAX_AGE_S))
    print(f"\n=== {agent.name} ===\naddress: {agent.address}\nparentId: {parent_id}\n")
    agent.run()


if __name__ == "__main__":
    main()
