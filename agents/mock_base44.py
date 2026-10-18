"""mock_base44 — an in-memory stand-in for the app, for local_demo.py and the tests.

Same methods as Base44Client. It mirrors what the agents really get back from the live app:

  * agentApi (base44/functions/agentApi/entry.ts): claimInbox (parentId optional), complete, getState (+ peerOf
    view), fit, suggestCondition, createProposal, noMatch, appendTurn, now, sendImessage, lookupParent,
    registerAgent, bindAsiUser, and the pass-through to B via shared/cbridge.ts.
  * B's handlers (base44/shared/logic/{closet,trade}.ts): getCloset's ClosetView (+ child.ageMonths), listItem
    (idempotent, resolves the item's outgrow nudges, returns the Listing + {listing, item}), resolveNudge
    (sell|keep|later → snooze), createProposal (idempotent per buyer, eligibility, encounter must be talking),
    decideProposal, payProposal (→ {proposal, item}, welcome nudge).
  * InboxEvent payloads exactly as base44/shared/types.ts. `rich_trade_events=True` adds the trade:completed
    fields W3 is adding (buyerId, sellerId, snapshot, predictedOutgrowDate).
  * Errors as C's handle() sends them: {error: "<action>: <code>: <message>"} with B's HTTP status → Base44Error
    with .status and .code. `rate_limit_next = n` makes the next n calls fail with RateLimited.
  * Parent ids are opaque (like Base44's), not the seed key: the app's ?as= takes the key, everything else the id.
"""

from __future__ import annotations

import copy
import itertools
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from base44_client import Base44Client, Base44Error, RateLimited

_ids = itertools.count(1)

# Lexical order matters: C's encounter makes the smaller parent id the "buyer" side. On live, Mina < Jo too
# (checked with lookupParent), so Mina's pet opens and the roles swap (Jo is the one with a need).
DEFAULT_IDS = {"mina": "68f1a0c0b1d2e3f4a5b6c7d1", "jo": "68f1a0c0b1d2e3f4a5b6c7d2", "sam": "68f1a0c0b1d2e3f4a5b6c7d3"}

SIZE_RANGES = {"0-3M": (0, 3), "3-6M": (3, 6), "6-9M": (6, 9), "9-12M": (9, 12), "12-18M": (12, 18),
               "18-24M": (18, 24), "2T": (24, 36), "3T": (36, 48), "4T": (48, 60)}
PCT = {1: 60, 2: 40}
TURN_KINDS = {"looking_for", "have", "no_fit", "fit_check", "propose", "ack", "decline"}
LIVE = ("open", "both_accepted")
PROPOSAL_TTL = timedelta(minutes=30)


def nid(prefix: str) -> str:
    return f"{prefix}_{next(_ids)}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dt(iso: str) -> datetime:
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def age_in_months(birth: str, now: str) -> int:
    b, n = _dt(birth), _dt(now)
    m = (n.year - b.year) * 12 + (n.month - b.month) - (1 if n.day < b.day else 0)
    return max(0, m)


def _add_months(d: datetime, months: int) -> datetime:
    y, m = divmod(d.month - 1 + months, 12)
    return d.replace(year=d.year + y, month=m + 1)


def predict_outgrow(size: str, birth: str, not_before: str) -> str:
    """B's sizes.ts: birthDate + size.maxMonths − 14 days, never before `not_before`."""
    out = _add_months(_dt(birth), SIZE_RANGES[size][1]) - timedelta(days=14)
    return _iso(max(out, _dt(not_before)))


def fits_now(size: str, birth: str, now: str) -> bool:
    lo, hi = SIZE_RANGES[size]
    return lo <= age_in_months(birth, now) < hi


def wear_weeks_left(size: str, birth: str, now: str) -> int:
    until = _dt(predict_outgrow(size, birth, now)) - _dt(now)
    return max(0, math.floor(until.total_seconds() / (7 * 86400)))


def price_for(item: Dict[str, Any]) -> Optional[int]:
    pct = PCT.get(item["ownerCount"])
    return None if pct is None else round(item["originalPriceCents"] * pct / 100)


def err(action: str, code: str, message: str, status: int) -> Base44Error:
    return Base44Error(f"{action}: {code}: {message}", status=status, code=code)


class MockBase44(Base44Client):
    def __init__(self, ids: Optional[Dict[str, str]] = None, rich_trade_events: bool = False):
        super().__init__(base_url="mock://", agent_key="mock")
        self.pid: Dict[str, str] = {**DEFAULT_IDS, **(ids or {})}  # seed key → Parent id
        self.rich_trade_events = rich_trade_events
        self.parents: Dict[str, Dict[str, Any]] = {}
        self.children: Dict[str, Dict[str, Any]] = {}
        self.items: Dict[str, Dict[str, Any]] = {}
        self.listings: Dict[str, Dict[str, Any]] = {}
        self.needs: Dict[str, Dict[str, Any]] = {}
        self.nudges: Dict[str, Dict[str, Any]] = {}
        self.proposals: Dict[str, Dict[str, Any]] = {}
        self.encounters: Dict[str, Dict[str, Any]] = {}
        self.inbox: List[Dict[str, Any]] = []
        self.sent: List[Dict[str, Any]] = []   # every line sendImessage got (= the PetLine mirror)
        self.calls: List[str] = []             # "agentApi:getState", "sendImessage", … in order
        self.rate_limit_next = 0
        self.setting = {"key": "demo", "now": "2026-05-15T17:00:00.000Z", "matchVia": "fetch", "imessage": False}
        self.seed()

    @property
    def clock(self) -> str:
        return self.setting["now"]

    def id(self, who: str) -> str:
        """Seed key ("mina") or id → Parent id."""
        return self.pid.get(who, who)

    def key_of(self, parent_id: str) -> str:
        return self.parents[parent_id]["key"]

    # ---- seed (a slice of B's seed.ts) ----------------------------------------
    def seed(self) -> None:
        for key, name, pet, letter, palette in (("mina", "Mina", "Button", "a", "peach"), ("jo", "Jo", "Pip", "b", "mint"),
                                                ("sam", "Sam", "Moss", "c", "lav")):
            pid = self.pid[key]
            self.parents[pid] = {"id": pid, "key": key, "name": name, "avatar": {"sprite": f"parent_{letter}", "palette": palette},
                                 "pet": {"sprite": f"pet_{letter}", "name": pet}, "discoverable": True, "agentAddress": None,
                                 "phone": None}
        for cid, key, nick, born in (("c_mina", "mina", "Bean", "2025-12-10T00:00:00.000Z"), ("c_jo", "jo", "Pea", "2026-03-01T00:00:00.000Z"),
                                     ("c_sam", "sam", "Sprout", "2025-06-01T00:00:00.000Z")):
            self.children[cid] = {"id": cid, "parentId": self.pid[key], "nickname": nick, "birthDate": born}
        for iid, key, name, cat, icon, size, cents, bought, owners in (
            ("romper", "mina", "Yellow duck romper", "onesie", "item_romper", "6-9M", 3000, "2026-05-15T17:00:00.000Z", 1),
            ("tee", "mina", "Striped long-sleeve tee", "top", "item_tee", "9-12M", 1400, "2026-04-20T17:00:00.000Z", 1),
            ("sweater", "mina", "Knit bear sweater", "top", "item_sweater", "9-12M", 3600, "2025-08-15T17:00:00.000Z", 2),
            ("onesies", "jo", "Mint onesie three-pack", "onesie", "item_onesie", "6-9M", 2400, "2026-04-10T17:00:00.000Z", 1),
            ("cardigan", "sam", "Oatmeal knit cardigan", "outerwear", "item_sweater", "12-18M", 4000, "2025-09-01T17:00:00.000Z", 3),
            ("sunhat", "sam", "Sunflower sun hat", "other", "item_hat", "18-24M", 1400, "2026-05-09T17:00:00.000Z", 1),
        ):
            pid = self.pid[key]
            child = next(c for c in self.children.values() if c["parentId"] == pid)
            self.items[iid] = {"id": iid, "name": name, "category": cat, "icon": icon, "size": size, "originalPriceCents": cents,
                               "originalPurchaseDate": bought, "ownerCount": owners, "currentOwnerId": pid, "childId": child["id"],
                               "photos": [], "ownershipHistory": [{"ownerId": pid, "from": bought}],
                               "predictedOutgrowDate": predict_outgrow(size, child["birthDate"], bought), "status": "in_closet"}
        self.needs["n_jo"] = {"id": "n_jo", "parentId": self.pid["jo"], "childId": "c_jo", "sizes": ["6-9M"],
                              "categories": ["top", "onesie"], "shared": True, "createdAt": "2026-10-01T17:00:00.000Z"}

    # ---- helpers ------------------------------------------------------------
    def push(self, who: str, type_: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        row = {"id": nid("inbox"), "parentId": self.id(who), "type": type_, "payload": payload, "status": "pending", "createdAt": now_iso()}
        self.inbox.append(row)
        return row

    def event(self, parent_id: str, payload: Dict[str, Any]) -> None:
        self.push(parent_id, "event", payload)

    def _child(self, parent_id: str) -> Optional[Dict[str, Any]]:
        kids = sorted((c for c in self.children.values() if c["parentId"] == parent_id), key=lambda c: (c["birthDate"], c["id"]))
        return kids[0] if kids else None

    def _parent(self, action: str, parent_id: Optional[str]) -> Dict[str, Any]:
        p = self.parents.get(parent_id or "")
        if not p:
            raise err(action, "not_found", "parent not found", 404)
        return p

    def closet(self, parent_id: str) -> Dict[str, Any]:
        """B's getCloset → ClosetView, plus cbridge's child.ageMonths."""
        parent = self._parent("getCloset", parent_id)
        child = self._child(parent_id)
        age = age_in_months(child["birthDate"], self.clock) if child else None
        mine = [p for p in reversed(list(self.proposals.values())) if parent_id in (p["buyerId"], p["sellerId"])]
        terminal = [p for p in mine if p["status"] not in LIVE][:5]
        public = {k: v for k, v in parent.items() if k not in ("phone", "photonUserId", "photonSpaceId", "photonLineUserId", "convo", "asiAddress")}
        return copy.deepcopy({
            "now": self.clock,
            "parent": public,
            "child": {**child, "ageMonths": age} if child else None,
            "childAgeMonths": age,
            "items": [i for i in self.items.values() if i["currentOwnerId"] == parent_id and i["status"] != "transferred_out"],
            "passedOn": [i for i in self.items.values() if i["currentOwnerId"] != parent_id
                         and any(h["ownerId"] == parent_id and h.get("to") for h in i["ownershipHistory"])],
            "listings": [l for l in reversed(list(self.listings.values())) if l["sellerId"] == parent_id],
            "needs": [n for n in self.needs.values() if n["parentId"] == parent_id],
            "nudges": [n for n in self.nudges.values() if n["parentId"] == parent_id and not n["resolved"]],
            "proposals": [p for p in mine if p["status"] in LIVE or p in terminal],
        })

    # ---- demo clock (B's demoClock: set the clock, scan for nudges) ---------------
    def set_clock(self, iso: str) -> int:
        self.setting["now"] = iso
        made = 0
        for it in self.items.values():
            if it["status"] != "in_closet" or it["ownerCount"] >= 3 or not it.get("predictedOutgrowDate"):
                continue
            if _dt(iso) < _dt(it["predictedOutgrowDate"]) - timedelta(days=14):
                continue
            if any(n["itemId"] == it["id"] and n["parentId"] == it["currentOwnerId"] and n["kind"] == "outgrow_check" for n in self.nudges.values()):
                continue
            msg = f"The {it['name']} ({it['size']}) is probably getting snug. Still fit?"
            n = {"id": nid("nudge"), "parentId": it["currentOwnerId"], "itemId": it["id"], "kind": "outgrow_check",
                 "message": msg, "createdAt": iso, "resolved": False}
            self.nudges[n["id"]] = n
            self.event(it["currentOwnerId"], {"type": "nudge:new", "nudgeId": n["id"], "itemId": it["id"], "kind": n["kind"], "message": msg})
            made += 1
        return made

    # ---- C's updatePresence/demoWalk, condensed: an encounter at < 25 m -------------
    def meet(self, a: str, b: str) -> str:
        a, b = self.id(a), self.id(b)
        enc = {"id": nid("enc"), "aId": a, "bId": b, "band": "<25m", "simulated": True, "status": "talking",
               "startedAt": now_iso(), "transcript": []}
        self.encounters[enc["id"]] = enc
        for me, peer in ((a, b), (b, a)):
            self.push(me, "encounter", {"encounterId": enc["id"],
                                        "peer": {"parentId": peer, "agentAddress": self.parents[peer].get("agentAddress")},
                                        "role": "buyer" if me < peer else "seller"})
        return enc["id"]

    # ---- Base44Client surface -------------------------------------------------
    async def call(self, fn: str, payload: Dict[str, Any]) -> Any:
        body = copy.deepcopy(payload)
        self.calls.append(f"{fn}:{body.get('action')}" if fn == "agentApi" else fn)
        if self.rate_limit_next > 0:
            self.rate_limit_next -= 1
            raise RateLimited(f"{fn} 429: Rate limit exceeded")
        if fn == "sendImessage":
            return self._send(body)
        if fn == "agentApi":
            return copy.deepcopy(await self._api(str(body.pop("action", "")), body))
        raise Base44Error(f"mock: unknown function {fn}", status=404)

    def _send(self, a: Dict[str, Any]) -> Dict[str, Any]:
        if not a.get("parentId"):
            raise Base44Error("sendImessage 400: parentId required", status=400, code="bad_request")
        if not a.get("text") and not a.get("imageUrl"):
            raise Base44Error("sendImessage 400: text or imageUrl required", status=400, code="bad_request")
        self.sent.append({"parentId": a["parentId"], "text": str(a.get("text") or "")[:600], "imageUrl": a.get("imageUrl")})
        return {"sent": False, "skipped": "Setting.imessage=false"}

    async def _api(self, action: str, a: Dict[str, Any]) -> Any:  # noqa: C901 — one switch, like agentApi
        if action == "claimInbox":
            limit = min(20, int(a.get("limit") or 5))
            rows = [r for r in self.inbox if r["status"] == "pending" and (not a.get("parentId") or r["parentId"] == a["parentId"])][:limit]
            for r in rows:
                r.update(status="claimed", claimedBy=a.get("agentAddress") or "agent", claimedAt=now_iso())
            return {"rows": rows}
        if action == "complete":
            if not a.get("inboxId"):
                raise Base44Error("inboxId required", status=400, code="bad_request")
            for r in self.inbox:
                if r["id"] == a["inboxId"]:
                    r.update(status="done", doneAt=now_iso())
            return {"ok": True}
        if action == "lookupParent":
            p = next((p for p in self.parents.values() if p["name"].lower() == str(a.get("name", "")).lower()), None)
            if not p:
                raise Base44Error(f"no parent named {a.get('name')}", status=404, code="not_found")
            return {"id": p["id"], "name": p["name"], "pet": p["pet"], "agentAddress": p.get("agentAddress")}
        if action == "registerAgent":
            if not a.get("parentId") or not a.get("agentAddress"):
                raise Base44Error("parentId, agentAddress required", status=400, code="bad_request")
            self._parent("registerAgent", a["parentId"])["agentAddress"] = a["agentAddress"]
            return {"ok": True}
        if action == "now":
            return {"now": self.clock, "matchVia": self.setting["matchVia"], "imessage": self.setting["imessage"]}
        if action == "getState":
            if not a.get("parentId"):
                raise Base44Error("parentId required", status=400, code="bad_request")
            s = self.closet(a["parentId"])
            if not a.get("peerOf"):
                return s
            items = {i["id"]: i for i in s["items"]}
            return {
                "parentId": a["parentId"], "petName": s["parent"]["pet"]["name"], "childAgeMonths": s["childAgeMonths"],
                "listings": [{"listingId": l["id"], "itemName": items.get(l["itemId"], {}).get("name"), "icon": items.get(l["itemId"], {}).get("icon"),
                              "category": items.get(l["itemId"], {}).get("category"), "size": items.get(l["itemId"], {}).get("size"),
                              "ownerCount": items.get(l["itemId"], {}).get("ownerCount"), "condition": l["condition"],
                              "priceCents": l["priceCents"], "originalPriceCents": items.get(l["itemId"], {}).get("originalPriceCents")}
                             for l in s["listings"] if l["shared"] and l["status"] == "active"],
                "needs": [{"sizes": n["sizes"], "categories": n.get("categories") or [], "maxPriceCents": n.get("maxPriceCents")}
                          for n in s["needs"] if n["shared"]],
            }
        if action == "fit":
            if a.get("buyerId") and a.get("sellerId"):
                return {"matches": self._find_matches(a["buyerId"], a["sellerId"])}
            raise Base44Error("fit needs {buyerId, sellerId} or {itemId, childId}", status=400, code="bad_request")
        if action == "suggestCondition":
            return {"condition": "gently_used", "note": "A little fading on the collar.", "via": "template"}
        if action == "appendTurn":
            turn = a.get("turn") or {}
            if not a.get("encounterId") or not turn.get("text"):
                raise Base44Error("encounterId, turn required", status=400, code="bad_request")
            if turn.get("kind") not in TURN_KINDS or turn.get("from") not in ("buyer_agent", "seller_agent"):
                raise Base44Error(f"mock: turn breaks the AgentTurn contract: {turn}", status=400, code="bad_request")
            enc = self.encounters[a["encounterId"]]
            enc["transcript"].append({**turn, "text": str(turn["text"])[:200]})
            return {"transcript": enc["transcript"]}
        if action == "noMatch":
            if not a.get("encounterId"):
                raise Base44Error("encounterId required", status=400, code="bad_request")
            self.encounters[a["encounterId"]]["status"] = "no_match"
            return {"ok": True}
        if action == "sendImessage":
            return self._send(a)
        if action == "bindAsiUser":
            p = self.parents.get(a.get("parentId", ""))
            if not p:
                raise Base44Error("unknown parent", status=404, code="not_found")
            last4 = "".join(ch for ch in (p.get("phone") or "") if ch.isdigit())[-4:] or "0000"
            if str(a.get("code")) != last4:
                raise Base44Error("bad claim code", status=403, code="forbidden")
            p["asiAddress"] = a.get("asiAddress")
            return {"ok": True, "parentId": p["id"], "name": p["name"]}
        if action == "createProposal":
            args = {k: v for k, v in a.items() if k != "sellerId"}  # cbridge: B derives the seller from the listing
            args.setdefault("source", "fetch")
            prop = self._create_proposal(args)
            if args.get("encounterId") in self.encounters:  # agentApi: Encounter → proposed (+ the agents' transcript)
                enc = self.encounters[args["encounterId"]]
                enc["status"] = "proposed"
                if isinstance(args.get("transcript"), list):
                    enc["transcript"] = copy.deepcopy(args["transcript"])
            return prop
        # ---- pass-through to B (cbridge.callB) ----
        if action == "getCloset":
            return self.closet((a.get("parentId") or a.get("sellerId")) or "")
        if action == "listItem":
            listing, item = self._list_item({**a, "parentId": a.get("parentId") or a.get("sellerId")})
            return {**listing, "listing": listing, "item": item}
        if action == "resolveNudge":
            return self._resolve_nudge(a)
        if action == "decideProposal":
            return self._decide(a)
        if action == "payProposal":
            return self._pay(a)
        raise Base44Error(f"unknown action {action}", status=400, code="bad_request")

    # ---- B, condensed -----------------------------------------------------------
    def _eligible(self, listing: Dict[str, Any], item: Dict[str, Any], need: Dict[str, Any], child: Dict[str, Any], buyer_id: str):
        if listing["status"] != "active" or not listing["shared"] or not need["shared"]:
            return None, "not active / not shared"
        if listing["sellerId"] == buyer_id or need["parentId"] != buyer_id:
            return None, "own listing"
        if item["ownerCount"] >= 3:
            return None, "item already has 3 owners"
        if item["status"] != "listed":
            return None, "item not listed"
        if item["size"] not in need["sizes"]:
            return None, "size not in need"
        if need.get("categories") and item["category"] not in need["categories"]:
            return None, "category not wanted"
        if need.get("maxPriceCents") is not None and listing["priceCents"] > need["maxPriceCents"]:
            return None, "over max price"
        if not fits_now(item["size"], child["birthDate"], self.clock):
            return None, "child doesn't fit this size now"
        return wear_weeks_left(item["size"], child["birthDate"], self.clock), ""

    def _find_matches(self, buyer_id: str, seller_id: str) -> List[Dict[str, Any]]:
        child = self._child(buyer_id)
        if not child:
            return []
        buyer = self.parents.get(buyer_id, {})
        out = []
        for l in self.listings.values():
            if l["sellerId"] != seller_id or l["status"] != "active":
                continue
            it = self.items[l["itemId"]]
            for n in (n for n in self.needs.values() if n["parentId"] == buyer_id):
                weeks, _ = self._eligible(l, it, n, child, buyer_id)
                if weeks is not None:
                    out.append({"listingId": l["id"], "itemId": it["id"], "itemName": it["name"], "size": it["size"],
                                "category": it["category"], "priceCents": l["priceCents"], "condition": l["condition"],
                                "wearWeeksLeft": weeks, "reason": f"{buyer.get('name', 'A friend')}'s little one fits it for about {weeks} more weeks."})
                    break
        out.sort(key=lambda m: -m["wearWeeksLeft"])
        return out

    def _list_item(self, a: Dict[str, Any]):
        parent = self._parent("listItem", a.get("parentId"))
        it = self.items.get(a.get("itemId", ""))
        if not it:
            raise err("listItem", "not_found", "item not found", 404)
        if it["currentOwnerId"] != parent["id"] or it["status"] == "transferred_out":
            raise err("listItem", "forbidden", "you don't own this item", 403)
        price = price_for(it)
        if price is None:
            raise err("listItem", "not_resellable", "Final home: this item has had its 3 owners.", 409)
        if a.get("condition") not in ("like_new", "gently_used", "well_loved"):
            raise err("listItem", "bad_request", f"unknown condition '{a.get('condition')}'", 400)
        photo = a.get("photo") or (a.get("photos") or [None])[0] or (it["photos"] or [None])[0]
        if not photo:
            raise err("listItem", "bad_request", "photo required", 400)
        active = next((l for l in self.listings.values() if l["itemId"] == it["id"] and l["status"] == "active"), None)
        if active is None:
            if it["status"] != "in_closet":
                raise err("listItem", "invalid_transition", f"item is {it['status']}, not in the closet", 409)
            active = {"id": nid("listing"), "itemId": it["id"], "sellerId": parent["id"], "condition": a["condition"],
                      "conditionNote": str(a.get("conditionNote") or "").strip(), "priceCents": price,
                      "shared": a.get("shared") is not False, "status": "active", "createdAt": self.clock}
            self.listings[active["id"]] = active
            if not it["photos"] or it["photos"][0] != photo:
                it["photos"] = [photo, *it["photos"]]
        if it["status"] == "in_closet":
            it["status"] = "listed"
        for n in self.nudges.values():  # B: listing resolves this owner's outgrow nudges for the item
            if n["itemId"] == it["id"] and n["kind"] == "outgrow_check" and n["parentId"] == parent["id"]:
                n["resolved"] = True
        return active, it

    def _resolve_nudge(self, a: Dict[str, Any]) -> Dict[str, Any]:
        action = {"sell": "sell", "keep": "keep", "later": "snooze", "snooze": "snooze"}.get(str(a.get("action") or a.get("decision")))
        if not action:
            raise err("resolveNudge", "bad_request", f"unknown nudge answer '{a.get('action') or a.get('decision')}'", 400)
        n = self.nudges.get(a.get("nudgeId", ""))
        if not n:
            raise err("resolveNudge", "not_found", "nudge not found", 404)
        parent_id = a.get("parentId") or n["parentId"]
        if parent_id != n["parentId"]:
            raise err("resolveNudge", "forbidden", "that nudge belongs to another parent", 403)
        n["resolved"] = True
        it = self.items.get(n["itemId"]) or {}
        sellable = action == "sell" and it.get("ownerCount", 3) < 3 and it.get("currentOwnerId") == parent_id
        return {"nudge": n, "next": "open_listing" if sellable else "none", "itemId": n["itemId"]}

    def _create_proposal(self, a: Dict[str, Any]) -> Dict[str, Any]:
        A = "createProposal"
        listing = self.listings.get(a.get("listingId", ""))
        if not listing:
            raise err(A, "not_found", "listing not found", 404)
        buyer = self._parent(A, a.get("buyerId"))
        for p in self.proposals.values():  # idempotent: one live proposal per listing
            if p["listingId"] == listing["id"] and p["status"] in LIVE:
                if p["buyerId"] != buyer["id"]:
                    raise err(A, "already_open", "This item already has an open trade.", 409)
                return p
        it = self.items[listing["itemId"]]
        child = self._child(buyer["id"])
        needs = [n for n in self.needs.values() if n["parentId"] == buyer["id"] and n["shared"]]
        if not child:
            raise err(A, "not_eligible", "buyer has no child on file", 409)
        if not needs:
            raise err(A, "not_eligible", "buyer has no shared need", 409)
        weeks, why = None, ""
        for n in needs:
            weeks, why = self._eligible(listing, it, n, child, buyer["id"])
            if weeks is not None:
                break
        if weeks is None:
            raise err(A, "not_eligible", why, 409)
        transcript = a.get("transcript") if isinstance(a.get("transcript"), list) else []
        if a.get("encounterId"):
            enc = self.encounters.get(a["encounterId"])
            if not enc:
                raise err(A, "not_found", "encounter not found", 404)
            if listing["sellerId"] not in (enc["aId"], enc["bId"]) or buyer["id"] not in (enc["aId"], enc["bId"]):
                raise err(A, "forbidden", "encounter is between other parents", 403)
            if enc["status"] != "talking":
                raise err(A, "invalid_transition", f"encounter is {enc['status']}", 409)
            transcript = transcript or list(enc["transcript"])
        created = _dt(self.clock)
        p = {"id": nid("prop"), "listingId": listing["id"], "itemId": it["id"], "sellerId": listing["sellerId"], "buyerId": buyer["id"],
             **({"encounterId": a["encounterId"]} if a.get("encounterId") else {}),
             "snapshot": {"itemName": it["name"], "icon": it["icon"], "photo": (it["photos"] or [""])[0], "size": it["size"],
                          "originalPurchaseDate": it["originalPurchaseDate"], "originalPriceCents": it["originalPriceCents"],
                          "condition": listing["condition"], "conditionNote": listing["conditionNote"], "previousOwners": it["ownerCount"],
                          "priceCents": listing["priceCents"], "wearWeeksLeft": weeks},
             "reason": str(a.get("reason") or "").strip() or f"{buyer['name']}'s little one fits it for about {weeks} more weeks.",
             "transcript": transcript, "source": "fetch" if a.get("source") == "fetch" else "local",
             "sellerDecision": "pending", "buyerDecision": "pending", "status": "open", "handover": "now",
             "createdAt": self.clock, "expiresAt": _iso(created + PROPOSAL_TTL)}
        self.proposals[p["id"]] = p
        it["status"] = "pending_trade"
        if a.get("encounterId"):
            self.encounters[a["encounterId"]]["status"] = "proposed"
        self.event(p["sellerId"], {"type": "proposal:new", "proposalId": p["id"], "role": "seller"})
        self.event(p["buyerId"], {"type": "proposal:new", "proposalId": p["id"], "role": "buyer"})
        return p

    def _notify_updated(self, p: Dict[str, Any]) -> None:
        base = {"proposalId": p["id"], "status": p["status"], "sellerDecision": p["sellerDecision"], "buyerDecision": p["buyerDecision"]}
        self.event(p["sellerId"], {"type": "proposal:updated", "role": "seller", **base})
        self.event(p["buyerId"], {"type": "proposal:updated", "role": "buyer", **base})

    def _relist(self, p: Dict[str, Any]) -> None:
        it = self.items[p["itemId"]]
        if it["currentOwnerId"] == p["sellerId"] and it["status"] == "pending_trade":
            it["status"] = "listed"

    def _decide(self, a: Dict[str, Any]) -> Dict[str, Any]:
        A = "decideProposal"
        parent = self._parent(A, a.get("parentId"))
        if a.get("decision") not in ("accepted", "declined"):
            raise err(A, "bad_request", "decision must be accepted or declined", 400)
        p = self.proposals.get(a.get("proposalId", ""))
        if not p:
            raise err(A, "not_found", "proposal not found", 404)
        role = "seller" if parent["id"] == p["sellerId"] else "buyer" if parent["id"] == p["buyerId"] else None
        if not role:
            raise err(A, "forbidden", "only the buyer or the seller can decide", 403)
        if p["status"] == "expired":
            raise err(A, "expired", "This offer timed out.", 409)
        if p["status"] == "open" and _dt(self.clock) > _dt(p["expiresAt"]):
            p["status"] = "expired"
            self._relist(p)
            self._notify_updated(p)
            raise err(A, "expired", "This offer timed out.", 409)
        key = f"{role}Decision"
        if p[key] == a["decision"]:
            return p
        if p["status"] != "open":
            raise err(A, "invalid_transition", f"this trade is already {p['status'].replace('_', ' ')}", 409)
        if p[key] != "pending":
            raise err(A, "invalid_transition", "you already decided on this trade", 409)
        p[key] = a["decision"]
        if a["decision"] == "declined":
            p["status"] = "declined"
            self._relist(p)
        else:
            other = p["buyerDecision"] if role == "seller" else p["sellerDecision"]
            p["status"] = "both_accepted" if other == "accepted" else "open"
        self._notify_updated(p)
        return p

    def _pay(self, a: Dict[str, Any]) -> Dict[str, Any]:
        A = "payProposal"
        parent = self._parent(A, a.get("parentId"))
        p = self.proposals.get(a.get("proposalId", ""))
        if not p:
            raise err(A, "not_found", "proposal not found", 404)
        if p["buyerId"] != parent["id"]:
            raise err(A, "forbidden", "only the buyer can pay", 403)
        it = self.items[p["itemId"]]
        if p["status"] == "paid":
            return {"proposal": p, "item": it}
        if p["status"] != "both_accepted":
            msg = "Both of you need to accept before paying." if p["status"] == "open" else f"this trade is {p['status'].replace('_', ' ')}"
            raise err(A, "invalid_transition", msg, 409)
        now = self.clock
        child = self._child(p["buyerId"])
        for h in it["ownershipHistory"]:
            if h["ownerId"] == p["sellerId"] and not h.get("to"):
                h["to"] = now
        it["ownershipHistory"].append({"ownerId": p["buyerId"], "from": now, "priceCents": p["snapshot"]["priceCents"]})
        it.update(ownerCount=min(3, it["ownerCount"] + 1), currentOwnerId=p["buyerId"], childId=child["id"],
                  predictedOutgrowDate=predict_outgrow(it["size"], child["birthDate"], now), status="in_closet")
        self.listings[p["listingId"]]["status"] = "sold"
        p.update(status="paid", paymentRef="DEMO-MOCK01")
        existing = next((n for n in self.nudges.values() if n["parentId"] == p["buyerId"] and n["itemId"] == it["id"] and n["kind"] == "new_owner_welcome"), None)
        nudge = existing or {"id": nid("nudge"), "parentId": p["buyerId"], "itemId": it["id"], "kind": "new_owner_welcome",
                             "message": f"Say hi to the {it['name']}!", "createdAt": now, "resolved": False}
        self.nudges[nudge["id"]] = nudge
        done = {"type": "trade:completed", "proposalId": p["id"], "itemId": it["id"], "priceCents": p["snapshot"]["priceCents"]}
        if self.rich_trade_events:
            done.update(buyerId=p["buyerId"], sellerId=p["sellerId"], snapshot=copy.deepcopy(p["snapshot"]),
                        predictedOutgrowDate=it["predictedOutgrowDate"])
        self.event(p["sellerId"], {**done, "role": "seller"})
        self.event(p["buyerId"], {**done, "role": "buyer"})
        if not existing:
            self.event(p["buyerId"], {"type": "nudge:new", "nudgeId": nudge["id"], "itemId": it["id"], "kind": nudge["kind"], "message": nudge["message"]})
        return {"proposal": p, "item": it}
