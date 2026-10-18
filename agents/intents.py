"""intents — turn an iMessage / ASI:One line into one of a dozen intents.

Mirrors base44/functions/_lib/wording.ts (parseIntent / parseCondition) so the
Deno fallback and the Python agent agree. Keep the regexes in sync.
"""

from __future__ import annotations

import json
import re
from typing import Optional, Tuple

INTENTS = (
    "hi", "help", "bag", "sell", "keep", "later", "yes", "no",
    "accept", "decline", "pay", "condition", "claim", "unknown",
)

_RULES = [
    ("claim", re.compile(r"^\s*claim\s+([a-z]+)-(\d{4})\s*$", re.I)),
    ("accept", re.compile(r"\b(accept|deal|take it|i'?ll take|yes to the trade)\b", re.I)),
    ("decline", re.compile(r"\b(decline|pass|no thanks|not this time|reject)\b", re.I)),
    ("pay", re.compile(r"\b(pay|checkout|buy now)\b", re.I)),
    ("sell", re.compile(r"\b(sell|list|pass it on|pass on|give away)\b", re.I)),
    ("keep", re.compile(r"\b(keep|still fits|fits fine)\b", re.I)),
    ("later", re.compile(r"\b(later|not now|remind me|tomorrow)\b", re.I)),
    ("bag", re.compile(r"\b(bag|closet|inventory|what do i have)\b", re.I)),
    ("help", re.compile(r"\b(help|commands|what can you do)\b", re.I)),
    ("condition", re.compile(r"\b(like new|gently used|well loved)\b", re.I)),
    ("yes", re.compile(r"^\s*(y|yes|yep|yeah|yup|sure|ok|okay|correct|right|👍)\s*[.!]?\s*$", re.I)),
    ("no", re.compile(r"^\s*(n|no|nope|nah|wrong)\s*[.!]?\s*$", re.I)),
    ("hi", re.compile(r"^\s*(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b", re.I)),
]


def parse_intent(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return "unknown"
    for intent, rx in _RULES:
        if rx.search(s):
            return intent
    return "unknown"


def parse_claim(text: str) -> Optional[Tuple[str, str]]:
    m = _RULES[0][1].match(text or "")
    return (m.group(1).lower(), m.group(2)) if m else None


def parse_condition(text: str) -> Optional[str]:
    s = (text or "").lower()
    if re.search(r"like[\s-]?new", s):
        return "like_new"
    if "gently" in s:
        return "gently_used"
    if re.search(r"well[\s-]?loved|worn", s):
        return "well_loved"
    return None


def parse_card_reply(text: str) -> Optional[dict]:
    """ASI:One card replies arrive as a JSON object serialized to a string
    (direct @mention) — try json first, then prose (rule from the cards doc)."""
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except (TypeError, ValueError):
        return None


def intent_from_card(sel: dict) -> str:
    """Map a card `selection` object to an intent."""
    action = str(sel.get("action", "")).lower()
    return {
        "sell": "sell", "keep": "keep", "later": "later",
        "accept": "accept", "confirm": "accept", "approve": "accept",
        "decline": "decline", "cancel": "decline", "reject": "decline",
        "pay": "pay", "yes": "yes", "no": "no",
    }.get(action, "unknown")
