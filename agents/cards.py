"""cards — ASI:One Interactive Cards (card_protocol_version "1").

Verified against innovationlab.fetch.ai/resources/docs/interactive-cards:
  * a card is a ChatMessage with a TextContent narration + one MetadataContent
  * metadata values are strings; card_payload is json.dumps(...)
  * detail card: title, hero_image?, summary_rows[{label,value}], ctas[{label,selection,primary?}]
  * review card: title, summary_rows, approve_cta{label,selection,primary?}, reject_cta{label,selection}
  * the user's choice comes back as the `selection` object (JSON string on direct @mention)
  * forgetting card_protocol_version silently drops the card
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from uagents_core.contrib.protocols.chat import ChatMessage, MetadataContent, TextContent

from wording import dollars, hearts, price_rule


def _now() -> datetime:
    return datetime.now(timezone.utc)


def text_message(text: str) -> ChatMessage:
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=[TextContent(type="text", text=text)])


def card_message(narration: str, card_kind: str, payload: Dict[str, Any], terminal: bool = False) -> ChatMessage:
    meta = {
        "card_protocol_version": "1",
        "requires_card_interaction": "false" if terminal else "true",
        "card_kind": card_kind,
        "card_payload": json.dumps(payload),
    }
    if terminal:
        meta["is_terminal"] = "true"
    return ChatMessage(
        timestamp=_now(),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=narration), MetadataContent(type="metadata", metadata=meta)],
    )


# ---- payload builders (pure, unit-tested) ---------------------------------

def nudge_card(item: Dict[str, Any], nudge_id: str) -> Dict[str, Any]:
    """detail card: 'Does this still fit?' with SELL / KEEP / LATER."""
    rows = [
        {"label": "Size", "value": item.get("size", "")},
        {"label": "Owners", "value": hearts(int(item.get("ownerCount", 1)))},
        {"label": "Bought", "value": str(item.get("originalPurchaseDate", ""))[:10]},
        {"label": "Original price", "value": dollars(int(item.get("originalPriceCents", 0)))},
    ]
    if item.get("predictedOutgrowDate"):
        rows.append({"label": "Fits until", "value": str(item["predictedOutgrowDate"])[:10]})
    payload: Dict[str, Any] = {
        "title": f"Still fits? {item.get('name', 'item')}",
        "summary_rows": rows,
        "ctas": [
            {"label": "Pass it on", "selection": {"action": "sell", "nudge_id": nudge_id, "item_id": item.get("id")}, "primary": True},
            {"label": "Still fits", "selection": {"action": "keep", "nudge_id": nudge_id}},
            {"label": "Ask me later", "selection": {"action": "later", "nudge_id": nudge_id}},
        ],
    }
    photos = item.get("photos") or []
    if photos:
        payload["hero_image"] = photos[0]
    return payload


def condition_card(item_name: str, suggested: str, note: str) -> Dict[str, Any]:
    """detail card with a radio for condition, pre-selected from suggestCondition."""
    return {
        "title": f"Condition of the {item_name}",
        "summary_rows": [{"label": "Pet suggests", "value": suggested.replace("_", " ")}] + ([{"label": "Note", "value": note}] if note else []),
        "sub_options": {
            "name": "condition",
            "kind": "radio",
            "label": "Condition",
            "choices": [
                {"value": "like_new", "label": "Like new"},
                {"value": "gently_used", "label": "Gently used"},
                {"value": "well_loved", "label": "Well loved"},
            ],
        },
        "ctas": [
            {"label": "List it", "selection": {"action": "yes"}, "primary": True},
            {"label": "Cancel", "selection": {"action": "later"}},
        ],
    }


def proposal_card(prop: Dict[str, Any], me: str) -> Dict[str, Any]:
    """review card: the trade proposal with ACCEPT / DECLINE."""
    s = prop.get("snapshot", {})
    owners = int(s.get("previousOwners", 1))
    rows = [
        {"label": "Item", "value": f"{s.get('itemName', '')} · {s.get('size', '')}"},
        {"label": "Condition", "value": str(s.get("condition", "")).replace("_", " ")},
        {"label": "Previous owners", "value": hearts(owners)},
        {"label": "Bought", "value": f"{str(s.get('originalPurchaseDate', ''))[:10]} for {dollars(int(s.get('originalPriceCents', 0)))}"},
        {"label": "Price", "value": f"{dollars(int(s.get('priceCents', 0)))} — {price_rule(int(s.get('originalPriceCents', 0)), owners)}"},
    ]
    if s.get("wearWeeksLeft") is not None:
        rows.append({"label": "Fits for", "value": f"~{s['wearWeeksLeft']} weeks"})
    rows.append({"label": "Charged now", "value": "$0.00 — nothing until you both accept"})
    role = "buyer" if prop.get("buyerId") == me else "seller"
    return {
        "title": f"Trade proposal ({role})",
        "summary_rows": rows,
        "approve_cta": {"label": "Accept", "selection": {"action": "accept", "proposal_id": prop.get("id")}, "primary": True},
        "reject_cta": {"label": "Decline", "selection": {"action": "decline", "proposal_id": prop.get("id")}},
    }


def pay_card(prop: Dict[str, Any]) -> Dict[str, Any]:
    s = prop.get("snapshot", {})
    return {
        "title": "Demo payment · no real charge",
        "summary_rows": [
            {"label": "Item", "value": s.get("itemName", "")},
            {"label": "Total", "value": dollars(int(s.get("priceCents", 0)))},
        ],
        "approve_cta": {"label": "Pay (demo)", "selection": {"action": "pay", "proposal_id": prop.get("id")}, "primary": True},
        "reject_cta": {"label": "Not now", "selection": {"action": "later"}},
    }


def bag_card(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "title": "Your closet",
        "summary_rows": [
            {"label": f"{i.get('name')} {i.get('size')}", "value": f"{hearts(int(i.get('ownerCount', 1)))} · {i.get('status', '')}"}
            for i in items if i.get("status") != "transferred_out"
        ][:12] or [{"label": "Empty", "value": "text me when you buy something"}],
        "ctas": [{"label": "OK", "selection": {"action": "ok"}}],
    }
