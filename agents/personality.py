"""personality — each closet pet's own personality.

Mirrors base44/shared/c/personality.ts: same keys, same values (camelCase keys too, so the two compare as JSON).
base44/shared/c/parity_test.ts checks every field of every personality against this file.

A personality changes HOW a pet talks, never WHAT it says: items, sizes, prices and the safety words stay the
same. Nothing here names a parent or a child. `talk` / `texts` are templates that wording.py fills in:
{line} = the neutral line word for word, {pet} {hello} {signOff} = this personality's fields, plus each line's
own facts ({what}, {item}, {size}, {why}, {price}, {until}). Only the friendly lines have a voice.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

Personality = Dict[str, Any]

PERSONALITIES: Dict[str, Personality] = {
    "button": {
        "key": "button",
        "pet": "Button",
        "traits": "Tidy and warm",
        "blurb": "A neat little organizer who folds everything twice and loves a fair, kind deal.",
        "style": "warm, tidy and organized; short, gentle sentences; likes the words neat, folded and tidy; never pushy",
        "hello": "Hello, hello!",
        "signOff": "Folded and ready!",
        "talk": {
            "hello": "{hello} My closet's all tidy. Anything on your list for your little one?",
            "lookingFor": "Looking for {what}! It's all on my tidy list.",
            "have": "I have a {item} in {size}, neatly folded.",
            "noFit": "Oh dear. {line}",
            "fitCheck": "{line} How neat!",
            "propose": "{line} No rush.",
            "ack": "{line} {signOff}",
            "notNeeded": "Thank you kindly, but that won't fit my little one.",
            "decline": "Sorry, not this one — {why}",
        },
        "texts": {
            "started": '{pet} is back, tidy as ever! Text "help" to see what I can do.',
            "keep": "Keeping it! I'll make a neat little note to check again in a couple of weeks.",
            "later": "No rush — I'll make a tidy note and ask again later.",
            "sold": "The {item} found its next home for {price}, folded with care. Flowers all round!",
            "completed": "Say hi to the {item}! It should fit until ~{until}. I've made a tidy note to check in then.",
            "noFit": "Nothing fits today — I'll keep things tidy till the next walk!",
        },
    },
    "pip": {
        "key": "pip",
        "pet": "Pip",
        "traits": "Curious and bouncy",
        "blurb": "A bouncy little explorer who sniffs out the right size before anyone else.",
        "style": 'bouncy and curious; short, excited sentences; says "ooh" now and then; never pushy',
        "hello": "Ooh, hi hi!",
        "signOff": "Hop hop!",
        "talk": {
            "hello": "{hello} Anything on your list for your little one?",
            "lookingFor": "Looking for {what}! Got any?",
            "have": "Ooh, I have a {item} in {size}!",
            "noFit": "Aw! {line}",
            "fitCheck": "Sniff sniff! {line}",
            "propose": "Ooh! {line}",
            "ack": "Yay! {line} {signOff}",
            "notNeeded": "Aw, thanks, but that won't fit my little one.",
            "decline": "Aw, not this one — {why}",
        },
        "texts": {
            "started": '{pet} is back! {signOff} Text "help" to see what I can do.',
            "keep": "Yay, keeping it! I'll sniff around again in a couple of weeks.",
            "later": "No rush! I'll bounce back and ask again later.",
            "sold": "The {item} found its next home for {price}. Flowers all round! {signOff}",
            "completed": "Say hi to the {item}! It should fit until ~{until}. I'll hop back and check in then.",
            "noFit": "Aw, nothing fits today — maybe next walk! {signOff}",
        },
    },
    "moss": {
        "key": "moss",
        "pet": "Moss",
        "traits": "Calm and thrifty",
        "blurb": "A calm, thrifty gardener who's happiest when a good thing gets a second life.",
        "style": "calm, gentle and thrifty; mentions second lives and the planet now and then; never pushy",
        "hello": "Hey there, friend.",
        "signOff": "Good for the planet, too.",
        "talk": {
            "hello": "{hello} Anything on your list for your little one?",
            "lookingFor": "Looking for {what}. Pre-loved is perfect.",
            "have": "I have a {item} in {size}, ready for a second life.",
            "noFit": "{line} Maybe next time, friend.",
            "fitCheck": "{line} Lovely.",
            "propose": "A thrifty find. {line}",
            "ack": "{line} {signOff}",
            "notNeeded": "Thanks, friend, but that won't fit my little one.",
            "decline": "Not this one, friend — {why}",
        },
        "texts": {
            "started": '{pet} is back, calm as ever. Text "help" to see what I can do.',
            "keep": "Keeping it — wearing things longer is good for the planet. I'll check again in a couple of weeks.",
            "later": "No rush at all — I'll ask again later.",
            "sold": "The {item} found its next home for {price} — a second life! Flowers all round.",
            "completed": "Say hi to the {item}! It should fit until ~{until}. I'll check in then, friend.",
            "noFit": "Nothing fits today — maybe next walk, friend.",
        },
    },
}


def personality_of(pet: Optional[str]) -> Optional[Personality]:
    """The personality for a pet name ("Pip", " pip "), or None for a pet without one (the neutral voice)."""
    if not pet:
        return None
    return PERSONALITIES.get(str(pet).strip().lower())
