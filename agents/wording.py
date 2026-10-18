"""wording — the pet's voice. ≤ 2 sentences, no markdown (iMessage shows it raw).

Mirrors base44/shared/c/wording.ts. If you change a line here, change it
there too, so the Deno side sounds like the same pet
(base44/shared/c/parity_test.ts runs this file and compares every line).
"""

from __future__ import annotations

import re
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
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    return f"{d:%b} {d.day}"  # not strftime("%-d"): Windows has no "%-d"


def hearts(owner_count: int) -> str:
    return "♥" * owner_count + "♡" * (3 - owner_count)


def note_bit(note: Optional[str]) -> str:
    """The AI's condition note, trimmed to fit one iMessage line: " (tiny stain on the cuff)" or ""."""
    n = re.sub(r"[.!]+$", "", re.sub(r"\s+", " ", note or "").strip())
    if not n:
        return ""
    return f" ({n[:79].rstrip()}…)" if len(n) > 80 else f" ({n})"


def hello(pet: str) -> str:
    return f'Hi! I\'m {pet}, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.'


def help_text() -> str:
    return ('Text "sell" (or just send a photo), "bag", "status", "accept", "decline", "pay" or "stop". '
            "I never decide or pay for you: a trade needs both of you to accept, and payments happen in the app.")


def nudge(item: str, size: str) -> str:
    return f'The {item} ({size}) is probably getting snug — still fit? Text "keep", or send a photo and I\'ll help pass it on.'


def nudge_which() -> str:
    return 'Just to be sure: text "keep" if it still fits, or "sell" to pass it on.'


def ask_photo(item: str) -> str:
    return f"Great! Send a photo of the {item} and I'll suggest its condition and a fair price."


def ask_which() -> str:
    return 'Which one? Send a photo, or text "sell" plus its name, like "sell the romper".'


def photo_which() -> str:
    return 'Cute! I couldn\'t tell which item that is. Text "sell" plus its name, like "sell the romper".'


def ask_condition(condition: str) -> str:
    return f'Looks {LABEL.get(condition, condition)} — right? Reply "yes" or tell me a different one.'


def quote(item: str, condition: str, price_cents: int, original_cents: int, owner_count: int, note: str = "") -> str:
    """After a photo: the item, the AI's condition guess and the fair price (the 60/40 rule)."""
    return (f"That's the {item}, {LABEL.get(condition, condition)}{note_bit(note)}. "
            f"Fair price {dollars(price_cents)} ({price_rule(original_cents, owner_count)}) — "
            'reply "yes" to list it, or tell me a different condition.')


def pick_condition() -> str:
    return 'Okay — tell me "like new", "gently used" or "well loved".'


def listed(price_cents: int, original_cents: int, owner_count: int) -> str:
    return f"Listed at {dollars(price_cents)} — {price_rule(original_cents, owner_count)}."


def listed_now(item: str, price_cents: int, original_cents: int, owner_count: int) -> str:
    return (f"Listed! The {item} is up for {dollars(price_cents)} ({price_rule(original_cents, owner_count)}). "
            "I'll text you when a friend's pet wants it.")


def cancelled() -> str:
    return "Okay, I stopped there — nothing was listed."


def nothing_to_cancel() -> str:
    return 'Nothing\'s in progress. To turn down a trade, reply "decline".'


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


def approve_in_app(pay_link: str, face_id: bool = False) -> str:
    """Both accepted, to the buyer: never pay by text — approve in the app. "with Face ID" only when the
    buyer's pet rules really ask for it (a saved passkey or requirePasskey); otherwise it's a tap on Pay."""
    how = " with Face ID" if face_id else ""
    return f"Both of you said yes! Approve the payment in the app{how} (demo payment · no real charge): {pay_link}"


def pay_in_app(pay_link: str, face_id: bool = False) -> str:
    how = " with Face ID" if face_id else ""
    return f"I never pay by text. Approve it in the app{how} (demo payment · no real charge): {pay_link}"


def accept_or_decline() -> str:
    """A text about the trade that isn't a clear answer: ask, never guess."""
    return 'Just to be sure: reply "accept" or "decline". Nothing is charged until you both accept.'


def declined() -> str:
    return "Declined — $0 charged, and the listing is back up."


def expired() -> str:
    return "That trade timed out — $0 charged, and the listing is back up."


def payment_failed() -> str:
    return "The demo payment didn't go through — $0 charged, and the listing is back up."


def not_yet() -> str:
    return "Both of you need to accept first — nothing is charged until then."


def in_trade(item: str) -> str:
    return f"The {item} already has a trade open — answer that one first."


def already_listed(item: str, price_cents: int) -> str:
    return f"The {item} is already listed at {dollars(price_cents)}. I'll tell you when a friend's pet wants it."


def list_failed(item: str) -> str:
    return f"I couldn't list the {item} just now — try again from the bag."


def busy() -> str:
    return "The app is busy right now — give me a minute and try again."


def t_hello(pet: str) -> str:
    return f"{pet}: Hi! Anything on your list for your little one?"


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


def status(parts: List[str]) -> str:
    if parts:
        return "Here's where things stand: " + " · ".join(parts) + "."
    return "All quiet: nothing listed and no open trades. Send a photo to pass something on."


def stopped() -> str:
    return 'Okay, I\'ll stop texting. Text "start" anytime to turn me back on — your closet is still in the app.'


def started(pet: str) -> str:
    return f'{pet} is back! Text "help" to see what I can do.'


def paused_help() -> str:
    return 'I\'m paused because you texted "stop". Text "start" to turn me back on.'


def slow_down() -> str:
    return "That's a lot of texts at once! Give me a minute and I'll catch up."


# --- the parts of a STATUS reply (joined with " · " by status) ---

def st_decide(item: str, price_cents: int) -> str:
    return f'{item} for {dollars(price_cents)}, your turn (reply "accept" or "decline")'


def st_waiting(item: str, other: str) -> str:
    return f"{item}, waiting on {other}"


def st_pay(item: str) -> str:
    return f'{item}, ready to approve in the app (text "pay" for the link)'


def st_to_pay(item: str) -> str:
    return f"{item}, waiting for the buyer to pay"


def st_listed(item: str, price_cents: int) -> str:
    return f"{item} listed at {dollars(price_cents)}"


def st_nudge(item: str) -> str:
    return f"{item} may be getting snug"


# --- privacy: never echo a phone number (same patterns as wording.ts redactPhones) ---

_URL = re.compile(r"https?://\S+")
_PHONE = re.compile(r"(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d[\d\s().-]{8,}\d|\b\d{10,15}\b")


def redact_phones(text: str) -> str:
    """Replace anything that looks like a phone number with "[number hidden]" (links are left alone)."""
    urls: List[str] = []

    def stash(m: "re.Match[str]") -> str:
        urls.append(m.group(0))
        return f"\x00{len(urls) - 1}\x00"

    masked = _PHONE.sub("[number hidden]", _URL.sub(stash, text or ""))
    return re.sub(r"\x00(\d+)\x00", lambda m: urls[int(m.group(1))], masked)


# --- agent-to-agent transcript lines (shown as pixel bubbles in the app) ---

def t_looking_for(pet: str, sizes: List[str], categories: List[str]) -> str:
    cats = " or ".join(categories) if categories else "anything"
    return f"{pet}: Looking for {'/'.join(sizes)} {cats}!"


def t_have(pet: str, item: str, size: str) -> str:
    return f"{pet}: I have a {item} in {size}."


def t_no_fit(pet: str) -> str:
    return f"{pet}: Nothing in my closet fits today."


def t_fit_check(pet: str, weeks: Optional[int]) -> str:
    """Said by the BUYER's pet (it ran B's fit for its own child), like wording.ts tl.fitCheck."""
    if weeks is None:
        return f"{pet}: Size looks right for my little one."
    return f"{pet}: My little one fits it for about {weeks} more weeks."


def t_propose(pet: str, price_cents: int) -> str:
    return f"{pet}: Trade proposal! {dollars(price_cents)} — nothing is charged until you both accept."


def t_ack(pet: str) -> str:
    return f"{pet}: Sounds good — over to the humans!"


def t_not_needed(pet: str) -> str:
    return f"{pet}: Thanks, but that won't fit my little one."


def t_decline(pet: str, why: str) -> str:
    return f"{pet}: Not this one — {why}"
