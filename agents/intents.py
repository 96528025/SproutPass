"""intents — turn an iMessage / ASI:One line into one of a dozen intents.

Mirrors base44/shared/c/wording.ts (parseIntent / parseCondition) so the
Deno side and the Python agent agree. Keep the regexes in sync
(base44/shared/c/parity_test.ts runs both and compares).
"""

from __future__ import annotations

import json
import re
from typing import Optional, Tuple

INTENTS = (
    "hi", "help", "bag", "sell", "keep", "later", "yes", "no",
    "accept", "decline", "pay", "condition", "status", "stop", "start", "cancel", "claim", "unknown",
)

# A trade decision is never guessed from a word inside a sentence: ACCEPT only matches the whole text
# ("accept", "I accept", "Deal!", "I'll take it"), refusals and negations are checked BEFORE it ("no deal",
# "I don't accept", "not interested", "I'll pass on this one"), and a question is never a decision.
_DECLINE = "|".join([
    r"\b(?:decline|reject)\b",
    r"\b(?:no|nah|nope)[\s,]+(?:deal|thanks|thank you|thx)\b",
    r"\bnot (?:interested|this (?:time|one)|a (?:good )?deal|for (?:me|us))\b",
    r"\b(?:don'?t|do not|can'?t|cannot|won'?t|will not|wouldn'?t|not going to|not gonna)\s+(?:want|accept|approve|take|buy|do)\b",
    r"\bpass on (?:this|that|it) one\b",
    r"\b(?:i'?ll|i will|i'?d|we'?ll|we will|gonna|going to)\s+pass\b(?!\s+(?:it|them|this|that)\s+on\b)",
    r"\bpass\b(?!\s+(?:(?:it|them|this|that)\s+)?on\b)",
])

_RULES = [
    ("claim", re.compile(r"^\s*claim\s+([a-z]+)-(\d{4})\s*$", re.I)),
    # Opt-out first, so "stop" always works: the whole text with polite words around it ("STOP please",
    # "please stop", "stop it"), or a clear "stop texting me" anywhere.
    ("stop", re.compile(r"^\s*(?:please[\s,]+)?(?:stop|stop ?all|quit|end|opt[\s-]?out|unsubscribe)"
                        r"(?:[\s,]+(?:please|pls|now|thanks|thank you|thx|it|all))*\s*[.!]*\s*$"
                        r"|\b(?:stop (?:texting|messaging)|unsubscribe|leave me alone|don'?t (?:text|message) me)\b", re.I)),
    ("start", re.compile(r"^\s*(?:please[\s,]+)?(?:start|unstop|resume|subscribe|opt[\s-]?in)"
                         r"(?:[\s,]+(?:please|pls|again|now|thanks|thank you))*\s*[.!]*\s*$", re.I)),
    ("cancel", re.compile(r"^\s*(cancel|never ?mind|nvm|forget it)\s*[.!]*\s*$", re.I)),
    # Refusals and negations before ACCEPT; a question ("should I decline?") is never one. "pass" declines,
    # but "pass it on" / a bare "pass on it" sells.
    ("decline", re.compile(r"^(?![\s\S]*\?)[\s\S]*?(?:" + _DECLINE + ")", re.I)),
    # Only an explicit, whole-text yes to the trade.
    ("accept", re.compile(r"^\s*(?:(?:yes|yep|yeah|ok|okay|sure)[\s,!]+)?(?:i\s+)?"
                          r"(?:(?:accept(?:ed)?|approve(?:d)?)(?:\s+(?:it|this|that|the (?:trade|deal|offer)))?|deal|it'?s a deal"
                          r"|i'?ll take it|we'?ll take it|yes to the trade)"
                          r"(?:[\s,]+(?:please|thanks|thank you|thx))?(?:\s*(?:[.!]|👍))*\s*$", re.I)),
    ("pay", re.compile(r"\b(pay|checkout|buy now)\b", re.I)),
    ("sell", re.compile(r"\b(sell|list|pass it on|pass on|give away)\b", re.I)),
    ("keep", re.compile(r"\b(keep|still fits|fits fine)\b", re.I)),
    ("later", re.compile(r"\b(later|not now|remind me|tomorrow)\b", re.I)),
    ("bag", re.compile(r"\b(bag|closet|inventory|what do i have)\b", re.I)),
    ("status", re.compile(r"\b(status|where are we|what'?s (new|happening|going on)|any (news|updates?)|updates?)\b", re.I)),
    ("help", re.compile(r"\b(help|commands|what can you do)\b", re.I)),
    ("condition", re.compile(r"\b(like new|gently used|well loved)\b", re.I)),
    ("yes", re.compile(r"^\s*(?:y|yes|yep|yeah|yup|sure|ok|okay|correct|right|👍)(?:[\s,]+(?:please|pls))?"
                       r"(?:\s*(?:[.!]|👍))*\s*$", re.I)),
    ("no", re.compile(r"^\s*(?:n|no|nope|nah|wrong)\s*[.!]*\s*$", re.I)),
    ("hi", re.compile(r"^\s*(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b", re.I)),
]


def _plain(text: str) -> str:
    """iPhones type curly apostrophes ("I’ll pass", "don’t accept"): read them as straight ones."""
    return re.sub("[‘’ʼ]", "'", text or "").strip()


def parse_intent(text: str) -> str:
    s = _plain(text)
    if not s:
        return "unknown"
    for intent, rx in _RULES:
        if rx.search(s):
            return intent
    return "unknown"


def is_trade_command(text: str) -> bool:
    """The accept / decline command itself (answers the open proposal whatever was asked last); see wording.ts."""
    return bool(re.search(r"^\s*(?:(?:yes|ok|okay)[\s,!]+)?(?:i\s+)?(?:accept(?:ed)?|approve(?:d)?|decline|reject)\b|\byes to the trade\b",
                          _plain(text), re.I))


def mentions_trade(text: str) -> bool:
    """Talks about the trade without deciding it ("is that a good deal?"): ask "accept or decline?", never guess."""
    return bool(re.search(r"\b(?:accept|approve|decline|reject|deal|take it|trade|offer|pass)\b", _plain(text), re.I))


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
        "pay": "pay", "yes": "yes", "no": "no", "status": "status",
    }.get(action, "unknown")
