"""pytest -q agents/tests  — the pets' personalities (personality.py, mirrored from personality.ts).

Each seeded pet speaks in its own voice in the meeting lines (t_*) and the friendly iMessage lines, with the same
facts and the same safety words; a pet without a personality says today's neutral lines word for word; no line ever
names a parent or a child. Word-for-word parity with the TypeScript side is base44/shared/c/parity_test.ts.
"""

from __future__ import annotations

import asyncio
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import wording as w  # noqa: E402
from closet_agent import ClosetBrain  # noqa: E402
from mock_base44 import MockBase44  # noqa: E402
from personality import PERSONALITIES, personality_of  # noqa: E402

ROMPER = "Yellow duck romper"
WHY = "it's over the price limit my family set for me."
PEOPLE = ("Mina", "Jo", "Sam", "Bean", "Pea", "Sprout")  # base44/shared/seed.ts: the parents and their children
SEEDED_PETS = ("Button", "Pip", "Moss")


def talk(pet):
    return {
        "hello": w.t_hello(pet),
        "looking_for": w.t_looking_for(pet, ["6-9M", "9-12M"], ["top", "onesie"]),
        "looking_for_any": w.t_looking_for(pet, ["6-9M"], []),
        "have": w.t_have(pet, ROMPER, "6-9M"),
        "no_fit": w.t_no_fit(pet),
        "fit_weeks": w.t_fit_check(pet, 4),
        "fit_size": w.t_fit_check(pet, None),
        "propose": w.t_propose(pet, 1800),
        "ack": w.t_ack(pet),
        "not_needed": w.t_not_needed(pet),
        "decline": w.t_decline(pet, WHY),
    }


def texts(pet):
    return {
        "hello": w.hello(pet),
        "started": w.started(pet),
        "keep": w.keep(pet),
        "later": w.later(pet),
        "sold": w.sold(ROMPER, 1800, pet),
        "completed": w.completed(ROMPER, "Nov 17", pet),
        "no_fit": w.no_fit(pet),
    }


NEUTRAL_TALK = {
    "hello": "Hi! Anything on your list for your little one?",
    "looking_for": "Looking for 6-9M/9-12M top or onesie!",
    "looking_for_any": "Looking for 6-9M anything!",
    "have": "I have a Yellow duck romper in 6-9M.",
    "no_fit": "Nothing in my closet fits today.",
    "fit_weeks": "My little one fits it for about 4 more weeks.",
    "fit_size": "Size looks right for my little one.",
    "propose": "Trade proposal! $18.00 — only the buyer needs to approve.",
    "ack": "Sounds good — over to the humans!",
    "not_needed": "Thanks, but that won't fit my little one.",
    "decline": f"Not this one — {WHY}",
}


def neutral_texts(pet):
    return {
        "hello": f'Hi! I\'m {pet}, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.',
        "started": f'{pet} is back! Text "help" to see what I can do.',
        "keep": "Keeping it! I'll check again in a couple of weeks.",
        "later": "No rush — I'll ask again later.",
        "sold": "The Yellow duck romper found its next home for $18.00. Flowers all round!",
        "completed": "Say hi to the Yellow duck romper! It should fit until ~Nov 17. I'll check in then.",
        "no_fit": "Nothing fits today — maybe next walk!",
    }


def test_every_seeded_pet_has_a_personality():
    for pet in SEEDED_PETS:
        p = personality_of(pet)
        assert p and p["pet"] == pet and all(p[k] for k in ("traits", "blurb", "style", "hello", "signOff"))
    assert personality_of(" pip ")["pet"] == "Pip"
    assert [personality_of(x) for x in ("Rex", "", None)] == [None, None, None]


@pytest.mark.parametrize("pet", SEEDED_PETS)
def test_meeting_lines_have_the_pets_voice_and_keep_every_fact(pet):
    p = personality_of(pet)
    lines = talk(pet)
    for kind, line in lines.items():
        said = line[len(pet) + 2:]
        assert line.startswith(f"{pet}: ") and said != NEUTRAL_TALK[kind], (kind, line)  # labelled, in its own voice
        assert len(said) <= 90 and ":" not in said, (kind, said)  # a short bubble; never read as a label
    assert "Anything on your list for your little one?" in lines["hello"] and p["hello"] in lines["hello"]
    assert "Looking for 6-9M/9-12M top or onesie" in lines["looking_for"]
    assert f"I have a {ROMPER} in 6-9M" in lines["have"]
    assert "nothing in my closet fits today." in lines["no_fit"].lower()
    assert "My little one fits it for about 4 more weeks." in lines["fit_weeks"]
    # the safety words, verbatim
    assert "Trade proposal! $18.00 — only the buyer needs to approve." in lines["propose"]
    assert "over to the humans" in lines["ack"] and lines["ack"].endswith(p["signOff"])
    assert lines["decline"].endswith(f"— {WHY}")


@pytest.mark.parametrize("pet", SEEDED_PETS)
def test_friendly_texts_have_the_pets_voice_and_house_style(pet):
    neutral = neutral_texts(pet)
    for kind, line in texts(pet).items():
        assert line != neutral[kind], (kind, line)
        assert "*" not in line and "#" not in line and line.count(". ") <= 2 and len(line) <= 240, line
        assert not re.search(r"\{\w+\}", line), line  # every placeholder filled
    lines = texts(pet)
    assert f"I'm {pet}, your closet pet." in lines["hello"]
    assert "found its next home for $18.00" in lines["sold"] and "~Nov 17" in lines["completed"]


def test_a_pet_without_a_personality_keeps_the_neutral_lines():
    assert talk("Rex") == {k: f"Rex: {v}" for k, v in NEUTRAL_TALK.items()}
    assert texts("Rex") == neutral_texts("Rex")
    assert [w.keep(), w.later(), w.no_fit()] == [neutral_texts("x")[k] for k in ("keep", "later", "no_fit")]
    assert w.sold(ROMPER, 1800) == neutral_texts("x")["sold"] and w.completed(ROMPER, "Nov 17") == neutral_texts("x")["completed"]


def test_no_personality_line_names_a_parent_or_a_child():
    names = re.compile(r"\b(" + "|".join(PEOPLE) + r")\b", re.I)
    for pet in SEEDED_PETS:
        p = PERSONALITIES[pet.lower()]
        every = [*talk(pet).values(), *texts(pet).values(), *p["talk"].values(), *p["texts"].values(),
                 p["traits"], p["blurb"], p["style"], p["hello"], p["signOff"]]
        assert not [line for line in every if names.search(line)]


def test_lines_about_deciding_paying_stopping_and_errors_have_no_voice():
    link = "https://sproutpass.test/trade/p1?as=jo"
    assert w.accept_or_decline() == 'Just to be sure: reply "accept" or "decline". Only the buyer needs to approve.'
    assert w.declined() == "Declined — $0 charged, and the listing is back up."
    assert w.pay_in_app(link) == f"I never pay by text. Approve it in the app (demo payment · no real charge): {link}"
    assert w.stopped() == 'Okay, I\'ll stop texting. Text "start" anytime to turn me back on — your closet is still in the app.'
    assert w.busy() == "The app is busy right now — give me a minute and try again."
    assert w.slow_down() == "That's a lot of texts at once! Give me a minute and I'll catch up."


def test_a_placeholder_inside_a_fact_is_never_filled_in():
    assert w.sold("{line} hat", 1800, "Moss") == "The {line} hat found its next home for $18.00 — a second life! Flowers all round."


def test_each_closet_brain_texts_in_its_own_pets_voice():
    app = MockBase44()
    for key, pet in (("mina", "Button"), ("jo", "Pip"), ("sam", "Moss")):
        brain = ClosetBrain(app, key, app.id(key), "http://app")
        assert asyncio.run(brain.owner_message("hi"))[0].text == w.hello(pet)
        assert asyncio.run(brain.owner_message("keep"))[0].text == w.keep(pet)
    assert w.hello("Pip").startswith("Ooh, hi hi! I'm Pip, your closet pet.")
