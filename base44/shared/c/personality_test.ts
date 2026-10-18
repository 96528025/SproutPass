// (C) npx -y deno@2 test --no-lock -A base44/shared/c/
// The pets' personalities (personality.ts): each seeded pet speaks in its own voice in the meeting lines (tl.*) and
// the friendly iMessage lines (t.*), with the same facts and the same safety words; a pet without a personality says
// today's neutral lines word for word; no line ever names a parent or a child; the local fallback's unlabelled lines
// are the labelled ones minus "Pip: ". Python parity for all of it is in parity_test.ts.

// deno-lint-ignore-file no-explicit-any
import { PERSONALITIES, personalityOf } from "./personality.ts";
import { type FindMatches, localTranscript, stageEncounter } from "./location.ts";
import { type Speaker, t, tl, unlabelled } from "./wording.ts";
import { applySeed, seedPlan } from "../seed.ts";
import { createFakeDb } from "../testing/fakeDb.ts";

function assert(c: unknown, msg = "assert"): asserts c {
  if (!c) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg ? msg + ": " : ""}expected ${y} got ${x}`);
}

const ALL = Object.values(PERSONALITIES);
const WHY = "it's over the price limit my family set for me.";
const ROMPER = "Yellow duck romper";
const LINK = "https://sproutpass.test/trade/p1?as=jo";
/** AgentBubbles / the Agent Console read "Pip: …" as a label this way (src/agent/AgentBubbles.tsx splitWho). */
const LABEL_RE = /^([A-Za-z][\w' -]{0,16}):\s+(.*)$/s;

/** Every meeting line, said by `who`. */
function talk(who: Speaker) {
  return {
    hello: tl.hello(who),
    lookingFor: tl.lookingFor(["6-9M", "9-12M"], ["top", "onesie"], who),
    lookingForAny: tl.lookingFor(["6-9M"], [], who),
    lookingForSizes: tl.lookingFor(["6-9M"], undefined, who),
    have: tl.have(ROMPER, "6-9M", who),
    noFit: tl.noFit(who),
    fitWeeks: tl.fitCheck(4, who),
    fitSize: tl.fitCheck(null, who),
    propose: tl.propose(1800, who),
    ack: tl.ack(who),
    notNeeded: tl.notNeeded(who),
    decline: tl.decline(WHY, who),
  };
}

/** Every friendly iMessage line, said by `pet`. */
function texts(pet: string) {
  return {
    hello: t.hello(pet),
    started: t.started(pet),
    keep: t.keep(pet),
    later: t.later(pet),
    sold: t.sold(ROMPER, 1800, pet),
    completed: t.completed(ROMPER, "Nov 17", pet),
    noFit: t.noFit(pet),
  };
}

/** Today's neutral lines, word for word (a pet without a personality, or none at all). */
const NEUTRAL_TALK = {
  hello: "Hi! Anything on your list for your little one?",
  lookingFor: "Looking for 6-9M/9-12M top or onesie!",
  lookingForAny: "Looking for 6-9M anything!",
  lookingForSizes: "Looking for 6-9M!",
  have: "I have a Yellow duck romper in 6-9M.",
  noFit: "Nothing in my closet fits today.",
  fitWeeks: "My little one fits it for about 4 more weeks.",
  fitSize: "Size looks right for my little one.",
  propose: "Trade proposal! $18.00 — nothing is charged until you both accept.",
  ack: "Sounds good — over to the humans!",
  notNeeded: "Thanks, but that won't fit my little one.",
  decline: `Not this one — ${WHY}`,
};
const neutralTexts = (pet: string) => ({
  hello: `Hi! I'm ${pet}, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.`,
  started: `${pet} is back! Text "help" to see what I can do.`,
  keep: "Keeping it! I'll check again in a couple of weeks.",
  later: "No rush — I'll ask again later.",
  sold: "The Yellow duck romper found its next home for $18.00. Flowers all round!",
  completed: "Say hi to the Yellow duck romper! It should fit until ~Nov 17. I'll check in then.",
  noFit: "Nothing fits today — maybe next walk!",
});

Deno.test("every seeded pet has a personality", () => {
  for (const parent of seedPlan().parents) {
    const p = personalityOf(parent.pet.name);
    assert(p, `${parent.pet.name} has a personality`);
    assertEquals(p.pet, parent.pet.name);
    assert(p.traits && p.blurb && p.style && p.hello && p.signOff, `${p.pet}: every field filled`);
  }
  assertEquals(personalityOf(" pip ")?.pet, "Pip");
  assertEquals([personalityOf("Rex"), personalityOf(""), personalityOf(null), personalityOf("constructor")], [null, null, null, null]);
});

Deno.test("each pet's meeting lines: its own voice, the same facts, the safety words, short", () => {
  for (const p of ALL) {
    const lines = talk(p.pet);
    for (const [kind, line] of Object.entries(lines)) {
      assert(line.startsWith(`${p.pet}: `), `${p.pet} ${kind}: labelled`);
      const said = line.slice(p.pet.length + 2);
      assert(said !== NEUTRAL_TALK[kind as keyof typeof NEUTRAL_TALK], `${p.pet} ${kind}: in its own voice`);
      assert(said.length <= 90, `${p.pet} ${kind}: a short bubble (${said.length}): ${said}`);
      assert(!said.includes(":"), `${p.pet} ${kind}: no colon, so no bubble mistakes it for a label: ${said}`);
    }
    assert(lines.hello.includes(p.hello) && lines.hello.includes("Anything on your list for your little one?"), `${p.pet} hello`);
    assert(lines.lookingFor.includes("Looking for 6-9M/9-12M top or onesie"), `${p.pet} lookingFor`);
    assert(lines.lookingForAny.includes("Looking for 6-9M anything"), `${p.pet} lookingFor anything`);
    assert(lines.have.includes(`I have a ${ROMPER} in 6-9M`), `${p.pet} have`);
    assert(lines.noFit.toLowerCase().includes("nothing in my closet fits today."), `${p.pet} noFit`);
    assert(lines.fitWeeks.includes("My little one fits it for about 4 more weeks."), `${p.pet} fit weeks`);
    assert(lines.fitSize.includes("Size looks right for my little one."), `${p.pet} fit size`);
    // the propose line keeps the price and the safety words verbatim; the ack keeps "over to the humans"
    assert(lines.propose.includes("Trade proposal! $18.00 — nothing is charged until you both accept."), `${p.pet} propose`);
    assert(lines.ack.includes("over to the humans") && lines.ack.endsWith(p.signOff), `${p.pet} ack: hand-over + sign-off`);
    assert(lines.notNeeded.includes("won't fit my little one."), `${p.pet} notNeeded`);
    assert(lines.decline.endsWith(`— ${WHY}`), `${p.pet} decline keeps the reason`);
  }
});

Deno.test("what each pet sounds like", () => {
  assertEquals(tl.ack("Button"), "Button: Sounds good — over to the humans! Folded and ready!");
  assertEquals(tl.have(ROMPER, "6-9M", "Button"), "Button: I have a Yellow duck romper in 6-9M, neatly folded.");
  assertEquals(tl.propose(1800, "Pip"), "Pip: Ooh! Trade proposal! $18.00 — nothing is charged until you both accept.");
  assertEquals(tl.fitCheck(4, "Pip"), "Pip: Sniff sniff! My little one fits it for about 4 more weeks.");
  assertEquals(tl.have(ROMPER, "6-9M", "Moss"), "Moss: I have a Yellow duck romper in 6-9M, ready for a second life.");
  assertEquals(tl.ack("Moss"), "Moss: Sounds good — over to the humans! Good for the planet, too.");
  assertEquals(t.hello("Pip"), `Ooh, hi hi! I'm Pip, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.`);
  assertEquals(t.keep("Moss"), "Keeping it — wearing things longer is good for the planet. I'll check again in a couple of weeks.");
  assertEquals(t.sold(ROMPER, 1800, "Button"), "The Yellow duck romper found its next home for $18.00, folded with care. Flowers all round!");
});

Deno.test("each pet's friendly iMessage lines: its own voice, the same facts, house style", () => {
  for (const p of ALL) {
    const lines = texts(p.pet);
    const neutral = neutralTexts(p.pet);
    for (const [kind, line] of Object.entries(lines)) {
      assert(line !== neutral[kind as keyof typeof neutral], `${p.pet} ${kind}: in its own voice`);
      assert(!/[*#`]/.test(line), `${p.pet} ${kind}: no markdown`);
      assert(line.split(/[.!?] /).length <= 3, `${p.pet} ${kind}: ≤ 2 sentences-ish: ${line}`);
      assert(line.length <= 240, `${p.pet} ${kind}: short`);
      assert(!/\{\w+\}/.test(line), `${p.pet} ${kind}: every placeholder filled: ${line}`);
    }
    assert(lines.hello.startsWith(`${p.hello} I'm ${p.pet}, your closet pet.`) && lines.hello.includes(`"sell"`), `${p.pet} hello`);
    assert(lines.started.startsWith(`${p.pet} is back`) && lines.started.includes(`Text "help"`), `${p.pet} started`);
    assert(lines.keep.includes("in a couple of weeks"), `${p.pet} keep`);
    assert(lines.later.includes("ask again later"), `${p.pet} later`);
    assert(lines.sold.includes(`The ${ROMPER} found its next home for $18.00`) && lines.sold.includes("Flowers all round"), `${p.pet} sold`);
    assert(lines.completed.startsWith(`Say hi to the ${ROMPER}! It should fit until ~Nov 17.`), `${p.pet} completed`);
    assert(lines.noFit.toLowerCase().includes("nothing fits today"), `${p.pet} noFit`);
  }
});

Deno.test("a pet without a personality (or no pet) keeps today's neutral lines exactly", () => {
  for (const who of ["Rex", "Pet", ""]) {
    const lines = talk(who);
    for (const [kind, line] of Object.entries(lines)) {
      const neutral = NEUTRAL_TALK[kind as keyof typeof NEUTRAL_TALK];
      assertEquals(line, who ? `${who}: ${neutral}` : neutral, `${who || "no pet"} ${kind}`);
    }
  }
  assertEquals(talk(undefined), NEUTRAL_TALK, "no pet");
  assertEquals(talk(unlabelled("Rex")), NEUTRAL_TALK, "unlabelled, no personality");
  assertEquals(texts("Rex"), neutralTexts("Rex"));
  assertEquals([t.keep(), t.later(), t.sold(ROMPER, 1800), t.completed(ROMPER, "Nov 17"), t.noFit()],
    [neutralTexts("").keep, neutralTexts("").later, neutralTexts("").sold, neutralTexts("").completed, neutralTexts("").noFit]);
});

Deno.test("no personality line ever names a parent or a child (only pets' names)", () => {
  const plan = seedPlan();
  const people = [...plan.parents.map((p) => p.name), ...plan.children.map((c) => c.nickname)].filter(Boolean);
  assert(people.length >= 6, "the seed's parents and children");
  const nameRe = new RegExp(`\\b(${people.join("|")})\\b`, "i");
  for (const p of ALL) {
    const all = [
      ...Object.values(talk(p.pet)), ...Object.values(talk(unlabelled(p.pet))), ...Object.values(texts(p.pet)),
      p.traits, p.blurb, p.style, p.hello, p.signOff, ...Object.values(p.talk), ...Object.values(p.texts),
    ];
    for (const line of all) assert(!nameRe.test(line), `${p.pet}: no person's name in ${JSON.stringify(line)}`);
  }
});

Deno.test("the lines about accepting, declining, paying, STOP, errors and rate limits have no voice", () => {
  // They take no pet: every pet sends exactly these words.
  assertEquals(t.acceptOrDecline(), `Just to be sure: reply "accept" or "decline". Nothing is charged until you both accept.`);
  assertEquals(t.declined(), "Declined — $0 charged, and the listing is back up.");
  assertEquals(t.notYet(), "Both of you need to accept first — nothing is charged until then.");
  assertEquals(t.payInApp(LINK), `I never pay by text. Approve it in the app (demo payment · no real charge): ${LINK}`);
  assertEquals(t.approveInApp(LINK), `Both of you said yes! Approve the payment in the app (demo payment · no real charge): ${LINK}`);
  assertEquals(t.stopped(), `Okay, I'll stop texting. Text "start" anytime to turn me back on — your closet is still in the app.`);
  assertEquals(t.pausedHelp(), `I'm paused because you texted "stop". Text "start" to turn me back on.`);
  assertEquals(t.busy(), "The app is busy right now — give me a minute and try again.");
  assertEquals(t.slowDown(), "That's a lot of texts at once! Give me a minute and I'll catch up.");
  assertEquals(t.proposal(ROMPER, 1800, 3000, 1, "Pip"),
    `Pip and I found a match: the Yellow duck romper for $18.00 (2nd owner pays 60% of $30.00). Nothing is charged until you both accept — reply "accept" or "decline".`);
});

Deno.test("unlabelled: the same voice without the 'Pip: ' prefix, and the bubbles read the label back the same way", () => {
  for (const p of ALL) {
    const labelled = talk(p.pet), bare = talk(unlabelled(p.pet));
    for (const kind of Object.keys(labelled) as (keyof typeof labelled)[]) {
      assertEquals(labelled[kind], `${p.pet}: ${bare[kind]}`, `${p.pet} ${kind}`);
      const m = LABEL_RE.exec(labelled[kind]);
      assertEquals([m?.[1], m?.[2]], [p.pet, bare[kind]], `${p.pet} ${kind}: AgentBubbles reads the label`);
      assert(!LABEL_RE.test(bare[kind]), `${p.pet} ${kind}: an unlabelled line is never read as a label`);
    }
  }
});

Deno.test("the local fallback's lines: each pet's voice, unlabelled (AgentBubbles names the pet by parentId)", () => {
  const m = { listingId: "l", itemName: ROMPER, size: "6-9M", priceCents: 1800, wearWeeksLeft: 4 };
  const lines = localTranscript("jo", "mina", m, 0, { buyer: "Pip", seller: "Button" });
  assertEquals(lines.map((l) => l.text), [
    "Looking for 6-9M! Got any?",
    "I have a Yellow duck romper in 6-9M, neatly folded.",
    "Sniff sniff! My little one fits it for about 4 more weeks.",
    "Ooh! Trade proposal! $18.00 — nothing is charged until you both accept.",
    "Sounds good — over to the humans! Folded and ready!",
  ]);
  assertEquals(lines.map((l) => l.parentId), ["jo", "mina", "jo", "jo", "mina"]);
  // a pet whose name isn't known speaks neutrally
  assertEquals(localTranscript("jo", "mina", m, 0, { buyer: "Pip" })[1].text, "I have a Yellow duck romper in 6-9M.");
});

/** The fakeDb, counting Parent reads (Base44's rate limit is shared by the whole team). */
function countingParentReads(raw: any) {
  const reads = { n: 0 };
  const Parent = new Proxy(raw.Parent, {
    get: (target, k) => {
      const v = Reflect.get(target, k);
      return typeof v === "function" && ["get", "list", "filter"].includes(String(k))
        ? (...args: unknown[]) => (reads.n++, v.apply(target, args))
        : v;
    },
  });
  return { db: new Proxy(raw, { get: (target, k) => (k === "Parent" ? Parent : Reflect.get(target, k)) }), reads };
}

Deno.test("the local fallback's voices cost no extra read: one Parent.list in place of withRules' Parent.get", async () => {
  const raw = createFakeDb();
  const ids = (await applySeed(raw, seedPlan())).parentIds as Record<string, string>;
  const romper = { listingId: "l1", itemName: ROMPER, size: "6-9M", priceCents: 1800, wearWeeksLeft: 4 };
  // Jo buys Mina's romper. B's ranking is stubbed (it reads nothing), so every Parent read counted below is C's own.
  const findMatches: FindMatches = async (_db, q) => (q.buyerId === ids.jo ? [romper] : []);
  const nothing: FindMatches = async () => [];
  const talking = () =>
    raw.Encounter.create({ aId: ids.mina, bId: ids.jo, band: "<25m", simulated: true, status: "talking", startedAt: new Date().toISOString(), transcript: [] } as any);
  const { db, reads } = countingParentReads(raw);

  const step = await stageEncounter(db, await talking(), findMatches);
  assertEquals(step.status, "staged");
  assertEquals(reads.n, 1, "one Parent read, like withRules' read of the buyer before the voices");
  assertEquals(step.transcript.slice(0, 2).map((l) => l.text), ["Looking for 6-9M! Got any?", "I have a Yellow duck romper in 6-9M, neatly folded."]);

  // Rows the request already read (demoWalk reads every parent): no read at all.
  const parents = new Map((await raw.Parent.list()).map((p: any) => [p.id, p]));
  reads.n = 0;
  assertEquals((await stageEncounter(db, await talking(), findMatches, Date.now(), { parents })).transcript[0].text, "Looking for 6-9M! Got any?");
  assertEquals(reads.n, 0, "known rows: no read");

  // Nothing fits: nothing is read for the voices; the pets speak in theirs only when the rows are known.
  const opener = ids.mina < ids.jo ? ids.mina : ids.jo;
  const helloOf = (pet: string | undefined) => tl.hello(unlabelled(pet));
  reads.n = 0;
  const plain = await talking();
  await stageEncounter(db, plain, nothing);
  assertEquals(reads.n, 0, "no read for a no-fit exchange");
  assertEquals((await raw.Encounter.get(plain.id)).transcript[0].text, helloOf(undefined));
  const voiced = await talking();
  await stageEncounter(db, voiced, nothing, Date.now(), { parents });
  assertEquals((await raw.Encounter.get(voiced.id)).transcript[0].text, helloOf(opener === ids.mina ? "Button" : "Pip"));
  assertEquals(reads.n, 0);
});

Deno.test("templates: a fact that looks like a placeholder is never filled in", () => {
  assertEquals(t.sold("{line} hat", 1800, "Moss"), "The {line} hat found its next home for $18.00 — a second life! Flowers all round.");
  assertEquals(tl.have("{signOff} romper", "{size}", "Button"), "Button: I have a {signOff} romper in {size}, neatly folded.");
});
