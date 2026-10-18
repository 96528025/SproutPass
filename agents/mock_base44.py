"""mock_base44 — an in-memory stand-in for the app, for local_demo.py and tests.

Implements the same methods as Base44Client, with just enough of B's rules
(60/40 pricing, max 3 owners, two-sided accept) to run the whole story
offline: nudge → sell → encounter → agents talk → proposal → accept → pay.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from base44_client import Base44Client, Base44Error

_ids = itertools.count(1)


def nid(prefix: str) -> str:
    return f"{prefix}_{next(_ids)}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


PCT = {1: 60, 2: 40}


def price_for(item: Dict[str, Any]) -> int:
    pct = PCT.get(item["ownerCount"])
    if pct is None:
        raise Base44Error("max 3 owners")
    return round(item["originalPriceCents"] * pct / 100)


class MockBase44(Base44Client):
    def __init__(self):
        super().__init__(base_url="mock://", agent_key="mock")
        self.parents: Dict[str, Dict[str, Any]] = {}
        self.children: Dict[str, Dict[str, Any]] = {}
        self.items: Dict[str, Dict[str, Any]] = {}
        self.listings: Dict[str, Dict[str, Any]] = {}
        self.needs: Dict[str, Dict[str, Any]] = {}
        self.nudges: Dict[str, Dict[str, Any]] = {}
        self.proposals: Dict[str, Dict[str, Any]] = {}
        self.encounters: Dict[str, Dict[str, Any]] = {}
        self.inbox: List[Dict[str, Any]] = []
        self.sent: List[Dict[str, Any]] = []  # every "iMessage" we would have sent
        self.now = "2026-09-20T12:00:00Z"
        self.seed()

    # ---- seed (mirrors B's seed, Part 0) ----------------------------------
    def seed(self) -> None:
        for name, pet, sprite in (("mina", "Button", "parent_a"), ("jo", "Pip", "parent_b"), ("sam", "Moss", "parent_c")):
            pid = name
            self.parents[pid] = {"id": pid, "name": name.title(), "pet": {"name": pet, "sprite": f"pet_{sprite[-1]}"},
                                 "avatar": {"sprite": sprite}, "phone": None, "agentAddress": None, "discoverable": True}
        self.children["c_mina"] = {"id": "c_mina", "parentId": "mina", "nickname": "Bean", "birthDate": "2025-12-10"}
        self.children["c_jo"] = {"id": "c_jo", "parentId": "jo", "nickname": "Pip Jr", "birthDate": "2026-03-01"}
        self.items["romper"] = {"id": "romper", "name": "Yellow duck romper", "category": "onesie", "icon": "item_romper", "size": "6-9M",
                                "originalPriceCents": 3000, "originalPurchaseDate": "2026-05-15", "ownerCount": 1,
                                "currentOwnerId": "mina", "childId": "c_mina", "photos": [], "status": "in_closet",
                                "predictedOutgrowDate": "2026-08-27", "ownershipHistory": [{"ownerId": "mina", "from": "2026-05-15"}]}
        self.items["hat"] = {"id": "hat", "name": "Sun hat", "category": "other", "icon": "item_hat", "size": "2T",
                             "originalPriceCents": 1200, "originalPurchaseDate": "2025-01-01", "ownerCount": 3,
                             "currentOwnerId": "sam", "childId": None, "photos": [], "status": "in_closet", "ownershipHistory": []}
        self.needs["n_jo"] = {"id": "n_jo", "parentId": "jo", "childId": "c_jo", "sizes": ["6-9M"], "categories": ["top", "onesie"], "shared": True}

    # ---- helpers ----------------------------------------------------------
    def push(self, parent_id: str, type_: str, payload: Dict[str, Any]) -> None:
        self.inbox.append({"id": nid("inbox"), "parentId": parent_id, "type": type_, "payload": payload, "status": "pending", "createdAt": now_iso()})

    def closet(self, parent_id: str) -> Dict[str, Any]:
        child = next((c for c in self.children.values() if c["parentId"] == parent_id), None)
        if child:
            b = datetime.fromisoformat(child["birthDate"])
            n = datetime.fromisoformat(self.now.replace("Z", ""))
            child = {**child, "ageMonths": (n.year - b.year) * 12 + n.month - b.month}
        return {
            "parent": self.parents[parent_id],
            "child": child,
            "items": [i for i in self.items.values() if i["currentOwnerId"] == parent_id],
            "listings": [l for l in self.listings.values() if l["sellerId"] == parent_id],
            "needs": [n for n in self.needs.values() if n["parentId"] == parent_id],
            "nudges": [n for n in self.nudges.values() if n["parentId"] == parent_id and not n["resolved"]],
            "proposals": [p for p in self.proposals.values() if parent_id in (p["buyerId"], p["sellerId"]) and p["status"] in ("open", "both_accepted")],
        }

    # ---- demo clock (B's demoClock set → nudge scan) ----------------------
    def set_clock(self, iso: str) -> None:
        self.now = iso
        for it in self.items.values():
            if it["status"] == "in_closet" and it["ownerCount"] < 3 and it.get("predictedOutgrowDate") and it["predictedOutgrowDate"] <= iso[:10]:
                if any(n["itemId"] == it["id"] and not n["resolved"] for n in self.nudges.values()):
                    continue
                n = {"id": nid("nudge"), "parentId": it["currentOwnerId"], "itemId": it["id"], "kind": "outgrow_check",
                     "message": "", "createdAt": now_iso(), "resolved": False}
                self.nudges[n["id"]] = n
                self.push(it["currentOwnerId"], "event", {"type": "nudge:new", "nudgeId": n["id"]})

    # ---- C's updatePresence/demoWalk, condensed: an encounter ---------------
    def meet(self, a: str, b: str) -> str:
        enc = {"id": nid("enc"), "aId": a, "bId": b, "band": "<25m", "simulated": True, "status": "talking",
               "startedAt": now_iso(), "transcript": []}
        self.encounters[enc["id"]] = enc
        for me, peer in ((a, b), (b, a)):
            self.push(me, "encounter", {"encounterId": enc["id"], "role": "buyer" if me < peer else "seller",
                                        "peer": {"parentId": peer, "agentAddress": self.parents[peer].get("agentAddress")}})
        return enc["id"]

    # ---- Base44Client surface ---------------------------------------------
    async def call(self, fn: str, payload: Dict[str, Any]) -> Any:
        if fn == "sendImessage":
            self.sent.append(payload)
            return {"sent": True}
        if fn == "agentApi":
            return await self._api(payload.pop("action"), payload)
        raise Base44Error(f"mock: unknown function {fn}")

    async def _api(self, action: str, a: Dict[str, Any]) -> Any:  # noqa: C901 — one big switch is clearest here
        if action == "claimInbox":
            rows = [r for r in self.inbox if r["status"] == "pending" and r["parentId"] == a["parentId"]][: a.get("limit", 5)]
            for r in rows:
                r["status"] = "claimed"
            return {"rows": rows}
        if action == "complete":
            for r in self.inbox:
                if r["id"] == a["inboxId"]:
                    r["status"] = "done"
            return {"ok": True}
        if action == "lookupParent":
            return {"id": a["name"].lower()}
        if action == "registerAgent":
            self.parents[a["parentId"]]["agentAddress"] = a["agentAddress"]
            return {"ok": True}
        if action == "now":
            return {"now": self.now, "matchVia": "fetch", "imessage": False}
        if action == "getState":
            s = self.closet(a["parentId"])
            if not a.get("peerOf"):
                return s
            items = {i["id"]: i for i in s["items"]}
            return {
                "parentId": a["parentId"], "petName": s["parent"]["pet"]["name"], "childAgeMonths": (s["child"] or {}).get("ageMonths"),
                "listings": [{"listingId": l["id"], "itemName": items[l["itemId"]]["name"], "icon": items[l["itemId"]]["icon"],
                              "category": items[l["itemId"]]["category"], "size": items[l["itemId"]]["size"],
                              "ownerCount": items[l["itemId"]]["ownerCount"], "condition": l["condition"], "priceCents": l["priceCents"],
                              "originalPriceCents": items[l["itemId"]]["originalPriceCents"]}
                             for l in s["listings"] if l["shared"] and l["status"] == "active"],
                "needs": [{"sizes": n["sizes"], "categories": n.get("categories", []), "maxPriceCents": n.get("maxPriceCents")} for n in s["needs"] if n["shared"]],
            }
        if action == "fit":
            out = []
            for l in self.listings.values():
                it = self.items[l["itemId"]]
                if l["sellerId"] != a["sellerId"] or l["status"] != "active" or not l["shared"] or it["ownerCount"] >= 3:
                    continue
                for n in self.needs.values():
                    if n["parentId"] == a["buyerId"] and n["shared"] and it["size"] in n["sizes"] and (not n.get("categories") or it["category"] in n["categories"]):
                        out.append({"listingId": l["id"], "itemName": it["name"], "size": it["size"], "priceCents": l["priceCents"],
                                    "wearWeeksLeft": 4, "reason": f"{it['size']} is on the wish list and fits for ~4 more weeks."})
            return {"matches": out}
        if action == "suggestCondition":
            return {"condition": "gently_used", "note": "A little fading on the collar.", "via": "template"}
        if action == "appendTurn":
            self.encounters[a["encounterId"]]["transcript"].append(a["turn"])
            return {"ok": True}
        if action == "noMatch":
            self.encounters[a["encounterId"]]["status"] = "no_match"
            return {"ok": True}
        if action == "bindAsiUser":
            if a["code"] != "0000":
                raise Base44Error("bad claim code")
            return {"ok": True}
        # ---- B's functions, condensed ----
        if action == "listItem":
            it = self.items[a["itemId"]]
            if it["ownerCount"] >= 3:
                raise Base44Error("max 3 owners")
            l = {"id": nid("listing"), "itemId": it["id"], "sellerId": a["sellerId"], "condition": a["condition"], "conditionNote": a.get("conditionNote", ""),
                 "priceCents": price_for(it), "shared": a.get("shared", True), "status": "active", "createdAt": now_iso()}
            self.listings[l["id"]] = l
            it["status"] = "listed"
            it["photos"] = a.get("photos", [])
            return {"listing": l, "item": it}
        if action == "resolveNudge":
            self.nudges[a["nudgeId"]]["resolved"] = True
            return {"ok": True}
        if action == "createProposal":
            l = self.listings[a["listingId"]]
            it = self.items[l["itemId"]]
            if l["status"] != "active" or it["ownerCount"] >= 3 or l["sellerId"] != a["sellerId"]:
                raise Base44Error("createProposal: invalid")
            if any(p["listingId"] == l["id"] and p["status"] in ("open", "both_accepted") for p in self.proposals.values()):
                raise Base44Error("createProposal: one open proposal per listing")
            p = {"id": nid("prop"), "listingId": l["id"], "sellerId": a["sellerId"], "buyerId": a["buyerId"], "encounterId": a.get("encounterId"),
                 "snapshot": {"itemName": it["name"], "icon": it["icon"], "photo": (it["photos"] or [None])[0], "size": it["size"],
                              "originalPurchaseDate": it["originalPurchaseDate"], "originalPriceCents": it["originalPriceCents"],
                              "condition": l["condition"], "conditionNote": l["conditionNote"], "previousOwners": it["ownerCount"],
                              "priceCents": l["priceCents"], "wearWeeksLeft": 4},
                 "reason": a.get("reason", ""), "transcript": a.get("transcript", []), "source": a.get("source", "fetch"),
                 "sellerDecision": "pending", "buyerDecision": "pending", "status": "open", "handover": "now", "createdAt": now_iso()}
            self.proposals[p["id"]] = p
            it["status"] = "pending_trade"
            if a.get("encounterId"):
                self.encounters[a["encounterId"]]["status"] = "proposed"
            for pid in (p["buyerId"], p["sellerId"]):
                peer = p["sellerId"] if pid == p["buyerId"] else p["buyerId"]
                self.push(pid, "event", {"type": "proposal:new", "proposalId": p["id"], "peerPet": self.parents[peer]["pet"]["name"]})
            return p
        if action == "decideProposal":
            p = self.proposals[a["proposalId"]]
            side = "buyerDecision" if a["parentId"] == p["buyerId"] else "sellerDecision"
            p[side] = a["decision"]
            if a["decision"] == "declined":
                p["status"] = "declined"
                self.items[self.listings[p["listingId"]]["itemId"]]["status"] = "listed"
            elif p["buyerDecision"] == p["sellerDecision"] == "accepted":
                p["status"] = "both_accepted"
            for pid in (p["buyerId"], p["sellerId"]):
                self.push(pid, "event", {"type": "proposal:updated", "proposalId": p["id"], "status": p["status"], "otherName": self.parents[a["parentId"]]["name"]})
            return p
        if action == "payProposal":
            p = self.proposals[a["proposalId"]]
            if p["status"] != "both_accepted" or a["parentId"] != p["buyerId"]:
                raise Base44Error("pay before both accept rejected")
            l = self.listings[p["listingId"]]
            it = self.items[l["itemId"]]
            it["ownershipHistory"][-1]["to"] = self.now
            it["ownershipHistory"].append({"ownerId": p["buyerId"], "from": self.now, "priceCents": p["snapshot"]["priceCents"]})
            it["ownerCount"] += 1
            it["currentOwnerId"] = p["buyerId"]
            it["childId"] = next((c["id"] for c in self.children.values() if c["parentId"] == p["buyerId"]), None)
            it["status"] = "in_closet"
            it["predictedOutgrowDate"] = "2026-11-17"
            l["status"] = "sold"
            p["status"] = "paid"
            n = {"id": nid("nudge"), "parentId": p["buyerId"], "itemId": it["id"], "kind": "new_owner_welcome", "message": "", "createdAt": now_iso(), "resolved": False}
            self.nudges[n["id"]] = n
            for pid in (p["buyerId"], p["sellerId"]):
                self.push(pid, "event", {"type": "trade:completed", "proposalId": p["id"], "itemId": it["id"], "buyerId": p["buyerId"], "sellerId": p["sellerId"],
                                         "snapshot": p["snapshot"], "predictedOutgrowDate": it["predictedOutgrowDate"],
                                         "role": "buyer" if pid == p["buyerId"] else "seller"})
            return p
        raise Base44Error(f"mock: unknown action {action}")
