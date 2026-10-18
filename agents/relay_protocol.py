"""RelayProtocol — what two closet agents say to each other when their parents meet.

Privacy (rule 3): the models below carry only shared listings, shared needs,
the child's age in months and the speaking pet's bubble line. No phones,
birth dates, ids or coordinates. The one place a parent's first name travels
is a Decline (the buyer's pet saying whose rule it follows, as the app shows
it on the radar); never an amount from those rules.

Flow (the encounter's "buyer" side opens, see closet_agent.py):
    LookingFor  →  HaveListings | NoFit  →  ProposeTrade  →  TradeAck
                                         ↘  Decline (the buyer's pet rules say no: nothing is proposed)

C's encounter picks the "buyer" by comparing parent ids, not by who needs what.
So an agent that has nothing for the other side but has its own shared needs
answers a LookingFor with its own LookingFor (the roles swap once); NoFit only
comes back when neither direction fits.

`line` is the sender's bubble ("Pip: Looking for 6-9M onesie!"), so the agent
that creates the proposal can hand B the whole two-sided transcript.
"""

from __future__ import annotations

from typing import List, Optional

from uagents import Model, Protocol

PROTOCOL_NAME = "HandMeDownRelay"
PROTOCOL_VERSION = "0.3.0"


class Need(Model):
    sizes: List[str]
    categories: List[str] = []
    max_price_cents: Optional[int] = None


class LookingFor(Model):
    encounter_id: str
    needs: List[Need]
    child_age_months: Optional[int] = None
    line: str = ""


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
    line: str = ""


class NoFit(Model):
    encounter_id: str
    reason: str = "Nothing in my closet fits today."
    line: str = ""


class ProposeTrade(Model):
    encounter_id: str
    listing_id: str
    price_cents: int
    reason: str
    wear_weeks_left: Optional[int] = None
    line: str = ""


class TradeAck(Model):
    encounter_id: str
    listing_id: str
    ok: bool
    reason: str = ""
    line: str = ""


class Decline(Model):
    """The buyer's side turns an offer down instead of proposing it: its parent's pet rules say no (`rule` =
    over_price | over_budget | category | agent_may_not_propose, `reason` = the app's sentence, never an amount), or
    the app refused the proposal after the TradeAck (`rule` empty, `reason` = B's code: already_open | not_resellable |
    not_eligible). The receiver answers it like a NoFit: it asks with its own needs once (the other direction may
    still trade), else it ends the encounter with noMatch."""
    encounter_id: str
    listing_id: str = ""
    rule: str = ""
    reason: str = ""
    line: str = ""


RELAY_MODELS = (LookingFor, HaveListings, NoFit, ProposeTrade, TradeAck, Decline)


# One Protocol object per agent process; the handlers are attached in closet_agent.py
def make_relay_protocol() -> Protocol:
    return Protocol(name=PROTOCOL_NAME, version=PROTOCOL_VERSION)
