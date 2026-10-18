"""closet_agent — one Fetch.ai uAgent per parent (Mina / Jo / Sam).

    python closet_agent.py --parent mina            # port 8101, mailbox
    python closet_agent.py --parent jo --port 8102

What it does (Part C §4–8):
  * polls the app's AgentInbox every second (claimInbox → handle → complete)
  * talks to the owner over iMessage (via sendImessage) and over ASI:One (chat protocol + cards)
  * talks to the other parent's agent with RelayProtocol when the two phones meet
  * never decides for a person: it only creates *proposals* (rule 1)

Env: BASE44_URL, AGENT_KEY, TEAM_SECRET, APP_URL (for pay links), PARENT_ID_<NAME> (optional)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

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
from base44_client import Base44Client, Base44Error
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


# ---------------------------------------------------------------------------
# Reply plumbing: one owner-conversation engine, two channels (iMessage, ASI:One)
# ---------------------------------------------------------------------------

class Reply:
    """A line for the owner. `card` is an optional (kind, payload) for ASI:One."""

    def __init__(self, text: str, card: Optional[tuple] = None, image_url: Optional[str] = None):
        self.text, self.card, self.image_url = text, card, image_url


class ClosetBrain:
    """Everything that doesn't need a uAgents Context. Unit-tested with a mocked client."""

    def __init__(self, client: Base44Client, parent_name: str, parent_id: str, app_url: str = ""):
        self.client = client
        self.parent_name = parent_name
        self.parent_id = parent_id
        self.app_url = app_url.rstrip("/")
        self.pet = PET_NAMES.get(parent_name, "Pet")
        self.convo: Dict[str, Any] = {"step": "idle"}
        self.transcripts: Dict[str, List[Dict[str, Any]]] = {}  # encounter_id → turns
        self.peers: Dict[str, Dict[str, Any]] = {}  # encounter_id → {parentId, agentAddress, role}

    # ----- helpers ---------------------------------------------------------
    async def state(self) -> Dict[str, Any]:
        s = await self.client.get_state(self.parent_id)
        pet = (s.get("parent") or {}).get("pet", {}).get("name")
        if pet:
            self.pet = pet
        return s

    def pay_link(self, proposal_id: str) -> str:
        # The app picks the family by its seed key (?as=mina), not by the Parent id.
        return f"{self.app_url or 'https://app'}/trade/{proposal_id}?as={self.parent_name}"

    @staticmethod
    def _open_nudge(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for n in state.get("nudges", []):
            if not n.get("resolved") and n.get("kind") == "outgrow_check":
                return n
        return None

    @staticmethod
    def _item(state: Dict[str, Any], item_id: str) -> Optional[Dict[str, Any]]:
        return next((i for i in state.get("items", []) if i.get("id") == item_id), None)

    # ----- owner conversation (Part C §5) ----------------------------------
    async def owner_message(self, text: str, photo_urls: Optional[List[str]] = None, selection: Optional[dict] = None) -> List[Reply]:
        """One inbound line from the owner → zero or more replies."""
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
            items = [i for i in s.get("items", []) if i.get("status") != "transferred_out"]
            lines = [f"{i['name']} {i['size']} {w.hearts(int(i.get('ownerCount', 1)))}" for i in items]
            return [Reply(w.bag(lines), card=("detail", cards.bag_card(items)))]
        if intent == "sell":
            s = await self.state()
            nudge = self._open_nudge(s)
            item = self._item(s, (selection or {}).get("item_id") or (nudge or {}).get("itemId", ""))
            if not item:  # "sell the sun hat" → match an item name from the bag
                low = (text or "").lower()
                item = next((i for i in s.get("items", []) if i.get("status") == "in_closet" and i.get("name", "").lower() in low), None)
            if not item:
                return [Reply(w.nothing_due())]
            if int(item.get("ownerCount", 1)) >= 3:
                return [Reply(w.final_home(item["name"]))]
            self.convo = {"step": "await_photo", "itemId": item["id"], "nudgeId": (nudge or {}).get("id"), "itemName": item["name"]}
            return [Reply(w.ask_photo(item["name"]))]
        if intent in ("keep", "later"):
            s = await self.state()
            nudge = self._open_nudge(s)
            if nudge:
                try:
                    await self.client.resolve_nudge(nudge["id"], intent)
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
            s = await self.state()
            pid = (selection or {}).get("proposal_id")
            open_ = next((p for p in s.get("proposals", []) if p.get("status") == "open" and (not pid or p.get("id") == pid)), None)
            if not open_:
                return [Reply(w.no_open_proposal())]
            await self.client.decide_proposal(open_["id"], self.parent_id, "accepted" if intent == "accept" else "declined")
            return []  # proposal:updated event will carry the next line
        if intent == "pay":
            s = await self.state()
            pid = (selection or {}).get("proposal_id")
            ready = next((p for p in s.get("proposals", []) if p.get("status") == "both_accepted" and p.get("buyerId") == self.parent_id and (not pid or p.get("id") == pid)), None)
            if not ready:
                return [Reply(w.no_open_proposal())]
            if selection is not None:  # ASI:One: the card IS the pay button (demo payment)
                await self.client.pay_proposal(ready["id"], self.parent_id)
                return []  # trade:completed event follows
            return [Reply(w.both_accepted(self.pay_link(ready["id"])))]
        return [Reply(w.unknown())]

    async def _on_photo(self, url: str) -> List[Reply]:
        if self.convo.get("step") not in ("await_photo", "await_condition"):
            s = await self.state()
            nudge = self._open_nudge(s)
            if not nudge:
                return [Reply(w.unknown())]
            item = self._item(s, nudge["itemId"]) or {}
            self.convo = {"step": "await_photo", "itemId": nudge["itemId"], "nudgeId": nudge["id"], "itemName": item.get("name", "item")}
        try:
            sug = await self.client.suggest_condition(url, self.convo.get("itemName", ""))
        except Base44Error:
            sug = {"condition": "gently_used", "note": ""}
        self.convo.update({"step": "await_condition", "photoUrl": url, "condition": sug.get("condition", "gently_used"), "note": sug.get("note", "")})
        return [Reply(w.ask_condition(self.convo["condition"]),
                      card=("detail", cards.condition_card(self.convo.get("itemName", "item"), self.convo["condition"], self.convo["note"])))]

    async def _list_now(self) -> List[Reply]:
        c = self.convo
        r = await self.client.list_item(
            itemId=c["itemId"], sellerId=self.parent_id,
            condition=c.get("condition", "gently_used"), conditionNote=c.get("note", ""),
            photos=[c["photoUrl"]] if c.get("photoUrl") else [], shared=True,
        )
        listing = r.get("listing", r)
        item = r.get("item") or {}
        if c.get("nudgeId"):
            try:
                await self.client.resolve_nudge(c["nudgeId"], "sell")
            except Base44Error:
                pass
        self.convo = {"step": "idle"}
        return [Reply(w.listed(int(listing.get("priceCents", 0)), int(item.get("originalPriceCents", 0)), int(item.get("ownerCount", 1))))]

    # ----- app events (Part C §6) ------------------------------------------
    async def event(self, payload: Dict[str, Any]) -> List[Reply]:
        kind = payload.get("type")
        if kind == "nudge:new":
            s = await self.state()
            nudge = next((n for n in s.get("nudges", []) if n.get("id") == payload.get("nudgeId")), None) or self._open_nudge(s)
            if not nudge:
                return []
            item = self._item(s, nudge.get("itemId", "")) or {}
            if nudge.get("kind") == "new_owner_welcome":
                return [Reply(w.completed(item.get("name", "new item"), w.short_date(item.get("predictedOutgrowDate"))))]
            return [Reply(w.nudge(item.get("name", "item"), item.get("size", "")), card=("detail", cards.nudge_card(item, nudge["id"])))]
        if kind == "proposal:new":
            s = await self.state()
            prop = next((p for p in s.get("proposals", []) if p.get("id") == payload.get("proposalId")), None)
            if not prop:
                return []
            snap = prop.get("snapshot", {})
            return [Reply(w.proposal(snap.get("itemName", "item"), int(snap.get("priceCents", 0)), int(snap.get("originalPriceCents", 0)),
                                     int(snap.get("previousOwners", 1)), payload.get("peerPet", "a friend's pet")),
                          card=("review", cards.proposal_card(prop, self.parent_id)))]
        if kind == "proposal:updated":
            s = await self.state()
            prop = next((p for p in s.get("proposals", []) if p.get("id") == payload.get("proposalId")), None) or payload.get("proposal") or {}
            # getCloset only returns open/both_accepted proposals, so "not found" + no status in the payload == no longer open.
            st = payload.get("status") or prop.get("status") or "declined"
            if st == "both_accepted":
                if prop.get("buyerId") == self.parent_id:
                    return [Reply(w.both_accepted(self.pay_link(prop["id"])), card=("review", cards.pay_card(prop)))]
                return [Reply(w.accepted("the buyer to pay"))]
            if st == "declined":
                return [Reply(w.declined())]
            mine = prop.get("buyerDecision" if prop.get("buyerId") == self.parent_id else "sellerDecision")
            other = payload.get("otherName", "the other side")
            if mine == "accepted":
                return [Reply(w.accepted(other))]
            return [Reply(w.other_accepted(other), card=("review", cards.proposal_card(prop, self.parent_id)))]
        if kind == "trade:completed":
            s = await self.state()
            snap = dict(payload.get("snapshot") or {})
            item = self._item(s, payload.get("itemId", "")) or {}
            snap.setdefault("itemName", item.get("name", "new item"))
            snap.setdefault("priceCents", payload.get("priceCents", 0))
            gif = payload.get("flowersUrl") or (f"{self.app_url}/fx/flowers.gif" if self.app_url else None)
            if payload.get("role") == "buyer" or payload.get("buyerId") == self.parent_id:
                return [Reply(w.completed(snap["itemName"], w.short_date(item.get("predictedOutgrowDate") or payload.get("predictedOutgrowDate"))), image_url=gif)]
            return [Reply(w.sold(snap["itemName"], int(snap.get("priceCents") or 0)), image_url=gif)]
        return []

    # ----- relay (agent ↔ agent, Part C §7) --------------------------------
    def _turn(self, enc: str, role: str, kind: str, text: str) -> Dict[str, Any]:
        t = {"from": f"{role}_agent", "parentId": self.parent_id, "kind": kind, "text": text,
             "at": datetime.now(timezone.utc).isoformat()}
        self.transcripts.setdefault(enc, []).append(t)
        return t

    async def say(self, enc: str, role: str, kind: str, text: str) -> None:
        turn = self._turn(enc, role, kind, text)
        try:
            await self.client.append_turn(enc, turn)
        except Base44Error as e:
            log.warning("appendTurn: %s", e)

    async def open_encounter(self, payload: Dict[str, Any]) -> Optional[LookingFor]:
        """Buyer side opens with LookingFor; seller side waits. Returns the message to send (or None)."""
        enc = payload["encounterId"]
        self.peers[enc] = {**payload.get("peer", {}), "role": payload.get("role", "buyer")}
        if payload.get("role") != "buyer":
            return None
        s = await self.state()
        needs = [Need(sizes=n.get("sizes", []), categories=n.get("categories") or [], max_price_cents=n.get("maxPriceCents"))
                 for n in s.get("needs", []) if n.get("shared")]
        age = (s.get("child") or {}).get("ageMonths")
        if needs:
            await self.say(enc, "buyer", "looking_for", w.t_looking_for(self.pet, sorted({sz for n in needs for sz in n.sizes}), needs[0].categories))
        else:
            await self.say(enc, "buyer", "looking_for", f"{self.pet}: Just browsing today — anything for a little one?")
        return LookingFor(encounter_id=enc, needs=needs, child_age_months=age)

    async def on_looking_for(self, msg: LookingFor) -> Any:
        """Seller side: answer with my shared listings that match (or NoFit)."""
        enc = msg.encounter_id
        peer = self.peers.get(enc, {})
        s = await self.client.get_state(self.parent_id, peer_of=peer.get("parentId", "peer"))
        wanted = {sz for n in msg.needs for sz in n.sizes}
        cats = {c for n in msg.needs for c in n.categories}
        maxp = min([n.max_price_cents for n in msg.needs if n.max_price_cents is not None] or [None]) if msg.needs else None
        out = []
        for l in s.get("listings", []):
            if wanted and l.get("size") not in wanted:
                continue
            if cats and l.get("category") not in cats:
                continue
            if maxp is not None and int(l.get("priceCents", 0)) > maxp:
                continue
            if int(l.get("ownerCount", 1)) >= 3:
                continue
            out.append(ListingCard(listing_id=l["listingId"], item_name=l.get("itemName", ""), icon=l.get("icon", ""),
                                   category=l.get("category", ""), size=l.get("size", ""), owner_count=int(l.get("ownerCount", 1)),
                                   condition=l.get("condition", "gently_used"), price_cents=int(l.get("priceCents", 0)),
                                   original_price_cents=int(l.get("originalPriceCents", 0))))
        if not out:
            await self.say(enc, "seller", "no_fit", w.t_no_fit(self.pet))
            return NoFit(encounter_id=enc)
        await self.say(enc, "seller", "have", w.t_have(self.pet, out[0].item_name, out[0].size))
        return HaveListings(encounter_id=enc, listings=out[:5])

    async def on_have_listings(self, msg: HaveListings) -> Optional[ProposeTrade]:
        """Buyer side: run fit, pick the best, propose."""
        enc = msg.encounter_id
        peer = self.peers.get(enc, {})
        best, weeks, reason = None, None, ""
        try:
            fit = await self.client.fit(buyerId=self.parent_id, sellerId=peer.get("parentId", ""))
            ranked = fit.get("matches", [])
            offered = {l.listing_id: l for l in msg.listings}
            for m in ranked:
                if m.get("listingId") in offered:
                    best, weeks, reason = offered[m["listingId"]], m.get("wearWeeksLeft"), m.get("reason", "")
                    break
        except Base44Error as e:
            log.warning("fit: %s", e)
        if best is None and msg.listings:  # B's fit unavailable → first offered listing
            best = msg.listings[0]
            reason = f"Size {best.size} matches a shared need."
        if best is None:
            await self.say(enc, "buyer", "no_fit", w.t_no_fit(self.pet))
            return None
        await self.say(enc, "buyer", "fit_check", w.t_fit_check(self.pet, weeks))
        await self.say(enc, "buyer", "propose", w.t_propose(self.pet, best.price_cents))
        return ProposeTrade(encounter_id=enc, listing_id=best.listing_id, price_cents=best.price_cents, reason=reason, wear_weeks_left=weeks)

    async def on_propose(self, msg: ProposeTrade) -> TradeAck:
        """Seller side re-checks that the listing is still live and at that price."""
        s = await self.state()
        live = next((l for l in s.get("listings", []) if l.get("id") == msg.listing_id and l.get("status") == "active" and l.get("shared")), None)
        if not live or int(live.get("priceCents", -1)) != msg.price_cents:
            await self.say(msg.encounter_id, "seller", "decline", w.t_decline(self.pet, "that listing changed."))
            return TradeAck(encounter_id=msg.encounter_id, listing_id=msg.listing_id, ok=False, reason="listing changed")
        await self.say(msg.encounter_id, "seller", "ack", w.t_ack(self.pet))
        return TradeAck(encounter_id=msg.encounter_id, listing_id=msg.listing_id, ok=True)

    async def on_ack(self, msg: TradeAck) -> Optional[Dict[str, Any]]:
        """Buyer side creates the proposal (B re-validates every rule)."""
        enc = msg.encounter_id
        peer = self.peers.get(enc, {})
        if not msg.ok:
            await self.client.no_match(enc)
            return None
        transcript = self.transcripts.get(enc, [])
        propose = next((t for t in reversed(transcript) if t["kind"] == "propose"), None)
        reason = propose["text"].split(": ", 1)[-1] if propose else "Our pets agreed."
        prop = await self.client.create_proposal(
            listingId=msg.listing_id, sellerId=peer.get("parentId", ""), buyerId=self.parent_id,
            encounterId=enc, reason=reason, transcript=transcript, source="fetch",
        )
        return prop


# ---------------------------------------------------------------------------
# uAgents wiring
# ---------------------------------------------------------------------------

def build_agent(parent: str, port: int, client: Base44Client, parent_id: str, app_url: str, seed: Optional[str] = None) -> Agent:
    team_secret = os.environ.get("TEAM_SECRET", "dev")
    agent = Agent(
        name=f"{parent}-closet",
        seed=seed or f"relay-{parent}-{team_secret}",
        port=port,
        mailbox=True,
        readme_path=os.path.join(os.path.dirname(__file__), "agent_readme.md"),
        description=f"Closet pet for {parent.title()} in Hand-Me-Down Relay: tracks kids' clothes, "
                    f"nudges when they're outgrown, and trades with nearby parents' agents. Never decides for a person.",
        publish_agent_details=True,
    )
    brain = ClosetBrain(client, parent, parent_id, app_url)
    attach(agent, brain)
    return agent


def attach(agent: Agent, brain: ClosetBrain) -> None:
    relay = make_relay_protocol()
    chat = Protocol(spec=chat_protocol_spec)
    asi_users: Dict[str, str] = {}  # ASI:One sender address → parent id (only our own parent binds here)
    last_sender: Dict[str, str] = {}

    async def deliver(ctx: Context, replies: List[Reply]) -> None:
        """iMessage always; ASI:One too if someone claimed this parent."""
        for r in replies:
            if r.text == last_sender.get("text"):  # two events in one tick → say it once
                continue
            last_sender["text"] = r.text
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
        try:
            await brain.client.api("registerAgent", parentId=brain.parent_id, agentAddress=agent.address)
        except Base44Error as e:
            ctx.logger.warning(f"registerAgent: {e} (B's seed can copy the address instead)")

    # ---- parent id check -----------------------------------------------------
    # B's RESET keeps Parent ids stable now, but if the row is ever re-created (or the agent started against an
    # older seed) the cached id goes stale and claimInbox silently returns nothing. Re-check by name once a minute.
    @agent.on_interval(period=60.0)
    async def _recheck_parent(ctx: Context):
        if os.environ.get(f"PARENT_ID_{brain.parent_name.upper()}"):
            return  # pinned by env: trust it
        try:
            r = await brain.client.api("lookupParent", name=brain.parent_name)
        except Base44Error as e:
            ctx.logger.warning(f"lookupParent: {e}")
            return
        fresh = (r or {}).get("id")
        if not fresh or fresh == brain.parent_id:
            return
        ctx.logger.info(f"parent id changed {brain.parent_id} → {fresh} (demo reset); re-registering")
        brain.parent_id = fresh
        brain.convo = {"step": "idle"}
        try:
            await brain.client.api("registerAgent", parentId=fresh, agentAddress=agent.address)
        except Base44Error as e:
            ctx.logger.warning(f"registerAgent: {e}")

    # ---- inbox loop (Part C §4) --------------------------------------------
    @agent.on_interval(period=1.0)
    async def _poll(ctx: Context):
        try:
            rows = await brain.client.claim_inbox(brain.parent_id, agent.address)
        except Base44Error as e:
            ctx.logger.warning(f"claimInbox: {e}")
            return
        for row in rows:
            try:
                await handle_row(ctx, row)
            except Exception as e:  # noqa: BLE001 — never let one row kill the loop
                ctx.logger.error(f"inbox {row.get('id')}: {e}")
            try:
                await brain.client.complete(row["id"])
            except Base44Error as e:
                ctx.logger.warning(f"complete: {e}")

    async def handle_row(ctx: Context, row: Dict[str, Any]) -> None:
        kind, p = row.get("type"), row.get("payload") or {}
        if kind == "imessage":
            await deliver(ctx, await brain.owner_message(p.get("text", ""), p.get("photoUrls") or []))
        elif kind == "event":
            await deliver(ctx, await brain.event(p))
        elif kind == "encounter":
            opening = await brain.open_encounter(p)
            addr = (p.get("peer") or {}).get("agentAddress")
            if opening is not None and addr:
                await ctx.send(addr, opening)
            elif opening is not None:
                ctx.logger.info("peer has no agentAddress — Deno local fallback will match after 8 s")

    # ---- RelayProtocol (Part C §7) -----------------------------------------
    @relay.on_message(model=LookingFor, replies={HaveListings, NoFit})
    async def _looking(ctx: Context, sender: str, msg: LookingFor):
        brain.peers.setdefault(msg.encounter_id, {"role": "seller"})
        brain.peers[msg.encounter_id].setdefault("agentAddress", sender)
        await ctx.send(sender, await brain.on_looking_for(msg))

    @relay.on_message(model=HaveListings, replies={ProposeTrade})
    async def _have(ctx: Context, sender: str, msg: HaveListings):
        out = await brain.on_have_listings(msg)
        if out is not None:
            await ctx.send(sender, out)
        else:
            await brain.client.no_match(msg.encounter_id)

    @relay.on_message(model=NoFit)
    async def _nofit(ctx: Context, sender: str, msg: NoFit):
        await brain.say(msg.encounter_id, "buyer", "no_fit", w.no_fit())
        await brain.client.no_match(msg.encounter_id)

    @relay.on_message(model=ProposeTrade, replies={TradeAck})
    async def _propose(ctx: Context, sender: str, msg: ProposeTrade):
        await ctx.send(sender, await brain.on_propose(msg))

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
                if sender not in asi_users and os.environ.get("ASI_OPEN", "1") != "1":
                    await ctx.send(sender, cards.text_message(f"Say: claim {brain.parent_name}-<code> first so I know it's you."))
                    continue
                last_sender["asi"] = sender
                sel = parse_card_reply(text)
                replies = await brain.owner_message(text, selection=sel)
                for r in replies:
                    out = cards.card_message(r.text, r.card[0], r.card[1]) if r.card else cards.text_message(r.text)
                    await ctx.send(sender, out)
            elif isinstance(part, EndSessionContent):
                ctx.logger.info("ASI:One session ended")

    @chat.on_message(ChatAcknowledgement)
    async def _chat_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    agent.include(relay, publish_manifest=True)
    agent.include(chat, publish_manifest=True)


# ---------------------------------------------------------------------------

async def resolve_parent_id(client: Base44Client, parent: str) -> str:
    env = os.environ.get(f"PARENT_ID_{parent.upper()}")
    if env:
        return env
    try:
        r = await client.api("lookupParent", name=parent)
        return r["id"]
    except Exception as e:  # noqa: BLE001
        log.warning("lookupParent failed (%s); using name as id — set PARENT_ID_%s", e, parent.upper())
        return parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parent", required=True, choices=sorted(PARENT_PORTS))
    ap.add_argument("--port", type=int)
    ap.add_argument("--log", default="INFO")
    a = ap.parse_args()
    logging.basicConfig(level=a.log)
    client = Base44Client()
    parent_id = asyncio.run(resolve_parent_id(client, a.parent))
    asyncio.run(client.close())
    agent = build_agent(a.parent, a.port or PARENT_PORTS[a.parent], Base44Client(), parent_id, os.environ.get("APP_URL", ""))
    print(f"\n=== {agent.name} ===\naddress: {agent.address}\nparentId: {parent_id}\n")
    agent.run()


if __name__ == "__main__":
    main()
