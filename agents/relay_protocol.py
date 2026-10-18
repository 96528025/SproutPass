"""RelayProtocol — what two closet agents say to each other when their parents meet.

Privacy (rule 3): the models below carry only shared listings, shared needs and
the child's age in months. No names, phones, birth dates or coordinates.

Flow (buyer side opens, see closet_agent.py):
    LookingFor  →  HaveListings | NoFit  →  ProposeTrade  →  TradeAck
"""

from __future__ import annotations

from typing import List, Optional

from uagents import Model, Protocol

PROTOCOL_NAME = "HandMeDownRelay"
PROTOCOL_VERSION = "0.1.0"


class Need(Model):
    sizes: List[str]
    categories: List[str] = []
    max_price_cents: Optional[int] = None


class LookingFor(Model):
    encounter_id: str
    needs: List[Need]
    child_age_months: Optional[int] = None


class ListingCard(Model):
    listing_id: str
    item_name: str
    icon: str = ""
    category: str = ""
    size: str
    owner_count: int = 1
    condition: str = "gently_used"
    price_cents: int
    original_price_cents: int = 0


class HaveListings(Model):
    encounter_id: str
    listings: List[ListingCard]


class NoFit(Model):
    encounter_id: str
    reason: str = "Nothing in my closet fits today."


class ProposeTrade(Model):
    encounter_id: str
    listing_id: str
    price_cents: int
    reason: str
    wear_weeks_left: Optional[int] = None


class TradeAck(Model):
    encounter_id: str
    listing_id: str
    ok: bool
    reason: str = ""


# One Protocol object per agent process; the handlers are attached in closet_agent.py
def make_relay_protocol() -> Protocol:
    return Protocol(name=PROTOCOL_NAME, version=PROTOCOL_VERSION)
