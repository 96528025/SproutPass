"""wording — the pet's voice. ≤ 2 sentences, no markdown (iMessage shows it raw).

Mirrors base44/shared/c/wording.ts. If you change a line here, change it
there too, so the Deno fallback sounds like the same pet.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

PCT_BY_OWNER = {1: 60, 2: 40}
LABEL = {"like_new": "like new", "gently_used": "gently used", "well_loved": "well loved"}


def dollars(cents: int) -> str:
    return f"${cents / 100:.2f}"


def price_rule(original_cents: int, owner_count: int) -> str:
    pct = PCT_BY_OWNER.get(owner_count)
    if not pct:
        return "This one has reached its final home."
    nth = "2nd" if owner_count == 1 else "3rd"
    return f"{nth} owner pays {pct}% of {dollars(original_cents)}"


def short_date(iso: Optional[str]) -> str:
    if not iso:
        return "soon"
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %-d")
    except ValueError:
        return iso


def hearts(owner_count: int) -> str:
    return "♥" * owner_count + "♡" * (3 - owner_count)


def hello(pet: str) -> str:
    return f'Hi! I\'m {pet}, your closet pet. Text "bag" to see what\'s in the closet, or "help".'


def help_text() -> str:
    return "I understand: sell · keep · later · yes · accept · decline · pay · bag · help. Short and sweet!"


def nudge(item: str, size: str) -> str:
    return f"The {item} ({size}) is probably getting snug — still fit? Want to pass it on?"


def ask_photo(item: str) -> str:
    return f"Great! Snap a photo of the {item} and I'll suggest a condition."


def ask_condition(condition: str) -> str:
    return f'Looks {LABEL.get(condition, condition)} — right? Reply "yes" or tell me a different one.'


def listed(price_cents: int, original_cents: int, owner_count: int) -> str:
    return f"Listed at {dollars(price_cents)} — {price_rule(original_cents, owner_count)}."


def keep() -> str:
    return "Keeping it! I'll check again in a couple of weeks."


def later() -> str:
    return "No rush — I'll ask again later."


def proposal(item: str, price_cents: int, original_cents: int, owner_count: int, peer_pet: str) -> str:
    return (
        f"{peer_pet} and I found a match: the {item} for {dollars(price_cents)} "
        f"({price_rule(original_cents, owner_count)}). "
        f'Nothing is charged until you both accept — reply "accept" or "decline".'
    )


def accepted(other: str) -> str:
    return f"You accepted! Waiting on {other} now."


def both_accepted(pay_link: str) -> str:
    return f"Both of you said yes! Tap to pay (demo payment · no real charge): {pay_link}"


def declined() -> str:
    return "Declined — $0 charged, and the listing is back up."


def completed(item: str, until: str) -> str:
    return f"Say hi to the {item}! It should fit until ~{until}. I'll check in then."


def sold(item: str, price_cents: int) -> str:
    return f"The {item} found its next home for {dollars(price_cents)}. Flowers all round!"


def no_fit() -> str:
    return "Nothing fits today — maybe next walk!"


def unknown() -> str:
    return 'Hmm, I didn\'t catch that. Try "bag" or "help".'


def final_home(item: str) -> str:
    return f"The {item} is on its 3rd owner — that's its final home, so no selling. 💛"


def nothing_due() -> str:
    return "Nothing's due to be passed on right now — text \"bag\" to see the closet."


def other_accepted(other: str) -> str:
    return f'{other} accepted — your turn! Reply "accept" or "decline".'


def no_open_proposal() -> str:
    return "There's no open trade right now. Walk around — your pet will find one!"


def bag(lines: List[str]) -> str:
    return ("In the bag: " + " · ".join(lines)) if lines else "The bag is empty — text me when you buy something!"


# --- agent-to-agent transcript lines (shown as pixel bubbles in the app) ---

def t_looking_for(pet: str, sizes: List[str], categories: List[str]) -> str:
    cats = " or ".join(categories) if categories else "anything"
    return f"{pet}: Looking for {'/'.join(sizes)} {cats}!"


def t_have(pet: str, item: str, size: str) -> str:
    return f"{pet}: I have a {item} in {size}."


def t_no_fit(pet: str) -> str:
    return f"{pet}: Nothing in my closet fits today."


def t_fit_check(pet: str, weeks: Optional[int]) -> str:
    if weeks is None:
        return f"{pet}: Size looks right for your little one."
    return f"{pet}: Your little one fits it for about {weeks} more weeks."


def t_propose(pet: str, price_cents: int) -> str:
    return f"{pet}: Trade proposal! {dollars(price_cents)} — nothing is charged until you both accept."


def t_ack(pet: str) -> str:
    return f"{pet}: Sounds good — over to the humans!"


def t_decline(pet: str, why: str) -> str:
    return f"{pet}: Not this one — {why}"
