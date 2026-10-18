// (C) npx -y deno@2 test --no-lock -A base44/shared/c/
// The pet over iMessage, end to end: every text goes through the real photonWebhook handler (inbound.ts), is
// answered in the same request by inboxFallback.ts, which runs B's real handlers (cbridge) on B's fakeDb with the
// real seed, and every reply goes out through sendToParent to a stubbed Photon. No network, no LLM.

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertMatch, DEMO_DATES, LINES, sayHi, withWorld, type World } from "./convo_testkit.ts";
import { t } from "./wording.ts";
import { callB } from "../cbridge.ts";
import { payProposal } from "../logic/trade.ts";
import { FLOW_TTL_MS, INBOUND_PER_MINUTE, namedItem, rateGate, sendEventTexts } from "./inboxFallback.ts";
import { NO_PERSONAL_DETAILS } from "./condition.ts";

const itemNamed = async (w: World, name: string) => (await w.db.ClothingItem.filter({ name }))[0] as any;
const activeListing = async (w: World, itemId: string) => (await w.db.Listing.filter({ itemId, status: "active" }))[0] as any;

async function listRomper(w: World) {
  const romper = await itemNamed(w, "Yellow duck romper");
  await callB(w.db, "listItem", { itemId: romper.id, sellerId: w.ids.mina, condition: "gently_used", conditionNote: "", photos: ["https://x/romper.jpg"], shared: true });
  return romper;
}

/** Mina's romper listed, the clock at the meeting, and a fresh proposal for Jo (both pets told). */
async function proposeRomper(w: World) {
  const romper = await listRomper(w);
  await w.setClock(DEMO_DATES.meet);
  await w.tick();
  w.inbox("mina"); w.inbox("jo");
  const listing = await activeListing(w, romper.id);
  const prop: any = await callB(w.db, "createProposal", { listingId: listing.id, buyerId: w.ids.jo, reason: "", transcript: [], source: "local" });
  await w.tick();
  return { romper, listing, prop };
}

// ---- first contact ----------------------------------------------------------------------------------------------

Deno.test("first 'hi': answered in the same webhook request, from the parent's own pool line", async () => {
  await withWorld(async (w) => {
    const r = await w.text("mina", "hi");
    assertEquals(r, { accepted: 1, answered: 1 });
    assertEquals(w.inbox("mina"), [t.hello("Button")]);
    assertEquals(t.hello("Button"), `Hi! I'm Button, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.`);
    const msg = w.sent.find((s) => s.path.endsWith("/messages"))!;
    assertEquals(msg.body.senderId, LINES.mina);
    assert(msg.idem, "idempotency-key on every send");
    const row = (await w.db.AgentInbox.filter({ parentId: w.ids.mina, type: "imessage" }))[0] as any;
    assertEquals([row.status, row.doneBy], ["done", "webhook"]);
  });
});

Deno.test("help, bag and an all-quiet status", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.text("mina", "help");
    await w.text("mina", "what's in my bag?");
    await w.text("mina", "status");
    const [help, bag, status] = w.inbox("mina");
    assertEquals(help, t.help());
    assertMatch(help, /never decide or pay for you/);
    assertMatch(bag, /^In the bag: .*Yellow duck romper 6-9M ♥♡♡.*Knit bear sweater 9-12M ♥♥♡/);
    assertEquals(status, "All quiet: nothing listed and no open trades. Send a photo to pass something on.");
  });
});

// ---- selling by text ----------------------------------------------------------------------------------------------

Deno.test("nudge → photo → the AI's name + condition + the fair price → 'like new' → 'yes' lists it", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    assertEquals(await w.setClock(DEMO_DATES.nudge), 1);
    await w.tick();
    assertEquals(w.inbox("mina"), [`The Yellow duck romper (6-9M) is probably getting snug — still fit? Text "keep", or send a photo and I'll help pass it on.`]);

    await w.text("mina", "", ["att_romper"]);
    assertEquals(w.inbox("mina"), [
      `That's the Yellow duck romper, gently used (Tiny stain on the cuff). Fair price $18.00 (2nd owner pays 60% of $30.00) — reply "yes" to list it, or tell me a different condition.`,
    ]);
    // The model saw the photo and the names in Mina's bag (so it can say which item it is).
    const ask = w.llm.calls.at(-1);
    assertEquals(ask.file_urls, ["https://files.sproutpass.test/att_romper.jpg"]);
    assertMatch(ask.prompt, /Striped long-sleeve tee/);
    assertEquals((await w.db.Listing.list()).length, 0); // nothing listed until the parent says yes

    await w.text("mina", "actually it's like new");
    assertMatch(w.inbox("mina")[0], /^That's the Yellow duck romper, like new \(Tiny stain on the cuff\)\. Fair price \$18\.00/);

    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [`Listed! The Yellow duck romper is up for $18.00 (2nd owner pays 60% of $30.00). I'll text you when a friend's pet wants it.`]);
    const romper = await itemNamed(w, "Yellow duck romper");
    const listing = await activeListing(w, romper.id);
    assertEquals([listing.priceCents, listing.condition, listing.conditionNote, romper.status], [1800, "like_new", "Tiny stain on the cuff.", "listed"]);
    assertEquals(romper.photos[0], "https://files.sproutpass.test/att_romper.jpg");
    assert((await w.db.AgentNudge.list()).every((n: any) => n.resolved), "listing resolves the outgrow nudge");
    assertEquals((await w.convo("mina")).step, "idle");

    await w.text("mina", "sell the romper");
    assertEquals(w.inbox("mina"), [t.alreadyListed("Yellow duck romper", 1800)]);
  });
});

Deno.test("'sell <name>' → asks for a photo → quote (60% for a 2nd owner) → 'cancel' lists nothing", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.text("mina", "sell the striped tee");
    assertEquals(w.inbox("mina"), [`Great! Send a photo of the Striped long-sleeve tee and I'll suggest its condition and a fair price.`]);
    w.llm.photo = { condition: "like_new", note: "", name: "Striped shirt", match: "" };
    await w.text("mina", "", ["att_tee"]);
    assertEquals(w.inbox("mina"), [`That's the Striped long-sleeve tee, like new. Fair price $8.40 (2nd owner pays 60% of $14.00) — reply "yes" to list it, or tell me a different condition.`]);
    assertMatch(w.llm.calls.at(-1).prompt, /Striped long-sleeve tee/);
    await w.text("mina", "no");
    assertEquals(w.inbox("mina"), [t.pickCondition()]);
    await w.text("mina", "cancel");
    assertEquals(w.inbox("mina"), [t.cancelled()]);
    assertEquals((await w.db.Listing.list()).length, 0);
    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [t.unknown()]); // the flow is over: a stray "yes" lists nothing
    assertEquals((await w.db.Listing.list()).length, 0);
  });
});

Deno.test("a 2nd-owner item is quoted at 40%; the AI's 'match' picks the item from the bag", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    w.llm.photo = { condition: "well_loved", note: "Some pilling", name: "Bear sweater", match: "Knit bear sweater" };
    await w.text("mina", "", ["att_sweater"]);
    assertEquals(w.inbox("mina"), [`That's the Knit bear sweater, well loved (Some pilling). Fair price $14.40 (3rd owner pays 40% of $36.00) — reply "yes" to list it, or tell me a different condition.`]);
    await w.text("mina", "yep!");
    assertMatch(w.inbox("mina")[0], /^Listed! The Knit bear sweater is up for \$14\.40 \(3rd owner pays 40% of \$36\.00\)/);
  });
});

Deno.test("a photo the pet can't place: it asks which one, and the name finishes the quote", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    w.llm.photo = { condition: "well_loved", note: "", name: "Blue garment", match: "" };
    await w.text("mina", "", ["att_x"]);
    assertEquals(w.inbox("mina"), [t.photoWhich()]);
    assertEquals((await w.convo("mina")).step, "await_item");
    await w.text("mina", "the corduroy pants");
    assertEquals(w.inbox("mina"), [`That's the Navy corduroy pants, well loved. Fair price $13.20 (2nd owner pays 60% of $22.00) — reply "yes" to list it, or tell me a different condition.`]);
    await w.text("mina", "ok");
    assertMatch(w.inbox("mina")[0], /^Listed! The Navy corduroy pants is up for \$13\.20/);
    const pants = await itemNamed(w, "Navy corduroy pants");
    assertEquals(pants.photos[0], "https://files.sproutpass.test/att_x.jpg"); // the photo from before the name
  });
});

Deno.test("no LLM: the photo still works (template guess + the open nudge's item)", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.setClock(DEMO_DATES.nudge);
    await w.tick();
    w.inbox("mina");
    w.llm.photo = null;
    await w.text("mina", "", ["att_romper"]);
    assertEquals(w.inbox("mina"), [`That's the Yellow duck romper, gently used. Fair price $18.00 (2nd owner pays 60% of $30.00) — reply "yes" to list it, or tell me a different condition.`]);
  });
});

Deno.test("a 3rd-owner item can never be listed — by name or by photo", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "sam");
    await w.text("sam", "sell the oatmeal cardigan");
    assertEquals(w.inbox("sam"), [t.finalHome("Oatmeal knit cardigan")]);
    w.llm.photo = { condition: "like_new", note: "", name: "Cardigan", match: "Oatmeal knit cardigan" };
    await w.text("sam", "", ["att_cardigan"]);
    assertEquals(w.inbox("sam"), [t.finalHome("Oatmeal knit cardigan")]);
    await w.text("sam", "yes");
    assertEquals(w.inbox("sam"), [t.unknown()]);
    assertEquals((await w.db.Listing.list()).length, 0);
  });
});

Deno.test("a nudge answered 'yes' is clarified, never guessed; 'keep' resolves it", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.setClock(DEMO_DATES.nudge);
    await w.tick();
    w.inbox("mina");
    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [t.nudgeWhich()]);
    assert((await w.db.AgentNudge.list()).every((n: any) => !n.resolved), "a bare yes decides nothing");
    await w.text("mina", "keep it, still fits");
    assertEquals(w.inbox("mina"), [t.keep()]);
    assert((await w.db.AgentNudge.list()).every((n: any) => n.resolved));
  });
});

// ---- the trade ----------------------------------------------------------------------------------------------------

Deno.test("trade by text: proposal → ACCEPT from both → deep link to approve in the app → paid in the app → flowers, no tick", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop, romper } = await proposeRomper(w);
    assertEquals(w.inbox("mina"), [`Pip and I found a match: the Yellow duck romper for $18.00 (2nd owner pays 60% of $30.00). Nothing is charged until you both accept — reply "accept" or "decline".`]);
    assertEquals(w.inbox("jo"), [t.proposal("Yellow duck romper", 1800, 3000, 1, "Button")]);

    // Jo accepts by text: both phones hear about it in the same request.
    await w.text("jo", "accept");
    assertEquals(w.inbox("jo"), ["You accepted! Waiting on Mina now."]);
    assertEquals(w.inbox("mina"), [`Jo accepted — your turn! Reply "accept" or "decline".`]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "open"); // one side is not enough (rule 1)

    await w.text("jo", "pay");
    assertEquals(w.inbox("jo"), [t.notYet()]);

    await w.text("mina", "status");
    assertEquals(w.inbox("mina"), [`Here's where things stand: Yellow duck romper for $18.00, your turn (reply "accept" or "decline").`]);

    // Mina answers the proposal text with a plain "yes": that proposal is what the pet just asked her about.
    await w.text("mina", "yes");
    const link = `https://sproutpass.test/trade/${prop.id}?as=jo`;
    // Jo's rules don't ask for Face ID (no passkey saved), so the text doesn't promise it.
    assertEquals(w.inbox("jo"), [`Both of you said yes! Approve the payment in the app (demo payment · no real charge): ${link}`]);
    assertEquals(w.inbox("mina"), ["You accepted! Waiting on the buyer to pay now."]);
    let p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.paymentRef ?? null], ["both_accepted", null]);

    // Never pay by text: "pay" only sends the link again.
    await w.text("jo", "pay now");
    assertEquals(w.inbox("jo"), [`I never pay by text. Approve it in the app (demo payment · no real charge): ${link}`]);
    await w.text("jo", "status");
    assertEquals(w.inbox("jo"), [`Here's where things stand: Yellow duck romper, ready to approve in the app (text "pay" for the link).`]);
    p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.paymentRef ?? null], ["both_accepted", null]);
    assert(!w.all("jo").join(" ").match(/\+1|555-?01/), "no phone number ever goes out");

    // Jo approves in the app (B's payProposal entry, then sendEventTexts in the same request): both phones get the
    // flowers GIF with no app tick and nobody texting.
    await payProposal(w.db, { proposalId: prop.id, parentId: w.ids.jo }, { delayMs: 0 });
    assert(await sendEventTexts(w.db) >= 2, "trade:completed for both sides");
    const jo = w.inbox("jo"), mina = w.inbox("mina");
    assertMatch(jo[0], /^Say hi to the Yellow duck romper! It should fit until ~\w{3} \d{1,2}\. I'll check in then\.$/);
    assertEquals(mina, ["The Yellow duck romper found its next home for $18.00. Flowers all round!"]);
    assertEquals([w.images("jo"), w.images("mina")], [1, 1]);
    assertEquals(jo.length, 1); // the welcome nudge doesn't say hi twice
    const moved = await w.db.ClothingItem.get(romper.id);
    assertEquals([moved.currentOwnerId, moved.ownerCount, moved.status], [w.ids.jo, 2, "in_closet"]);
  });
});

Deno.test("DECLINE by text: $0 charged and the listing is back up; a stray 'no' after that decides nothing", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop, romper } = await proposeRomper(w);
    w.inbox("mina"); w.inbox("jo");
    await w.text("mina", "decline");
    assertEquals(w.inbox("mina"), [t.declined()]);
    assertEquals(w.inbox("jo"), [t.declined()]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "declined");
    assertEquals((await w.db.ClothingItem.get(romper.id)).status, "listed");
    await w.text("jo", "accept");
    assertEquals(w.inbox("jo"), [t.noOpenProposal()]);
    await w.text("jo", "no");
    assertEquals(w.inbox("jo"), [t.unknown()]);
  });
});

Deno.test("questions and refusals never accept a trade: 'is that a good deal?' asks, 'I'll take a look' decides nothing, 'No deal, thanks' declines", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    await w.text("jo", "accept"); // the buyer already said yes: one misread "accept" from Mina would close the deal
    w.inbox("mina"); w.inbox("jo");
    for (const text of ["is that a good deal?", "should I take it?", "what’s the deal with the price", "Deal?"]) {
      await w.text("mina", text);
      assertEquals(w.inbox("mina"), [t.acceptOrDecline()], text);
    }
    await w.text("mina", "I'll take a look");
    assertEquals(w.inbox("mina"), [t.unknown()]); // the chat line (no LLM here): no decision
    await w.text("mina", "I’ll take a look later");
    assertEquals(w.inbox("mina"), [t.later()]);
    let p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.sellerDecision, p.buyerDecision], ["open", "pending", "accepted"]);
    assertEquals(w.inbox("jo"), []);

    await w.text("mina", "No deal, thanks");
    assertEquals(w.inbox("mina"), [t.declined()]);
    assertEquals(w.inbox("jo"), [t.declined()]);
    p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.sellerDecision], ["declined", "declined"]);
    assert(!w.all("mina").some((s) => /You accepted|Both of you said yes/.test(s)), "Mina never accepted");
  });
});

Deno.test("'I don’t accept' and 'I'll pass on this one' decline (curly apostrophes too); nothing is ever accepted", async () => {
  for (const text of ["I don’t accept", "I'll pass on this one", "not interested", "nah thanks"]) {
    await withWorld(async (w) => {
      await sayHi(w, "mina", "jo");
      const { prop } = await proposeRomper(w);
      w.inbox("mina"); w.inbox("jo");
      await w.text("jo", text);
      assertEquals(w.inbox("jo"), [t.declined()], text);
      assertEquals((await w.db.MatchProposal.get(prop.id)).buyerDecision, "declined", text);
      assertEquals((await w.db.Listing.list()).filter((l: any) => l.status === "active").length, 1, "the romper is back up");
    });
  }
});

Deno.test("the newest question wins: quote → proposal text → 'yes' accepts the trade and lists nothing; the quote is asked again", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    await w.text("mina", "sell the striped tee");
    w.llm.photo = { condition: "like_new", note: "", name: "Striped shirt", match: "" };
    await w.text("mina", "", ["att_tee"]);
    const quote = w.inbox("mina").at(-1)!;
    assertMatch(quote, /^That's the Striped long-sleeve tee, like new\. Fair price \$8\.40/);
    const { prop } = await proposeRomper(w);
    assertMatch(w.inbox("mina").at(-1), /found a match: the Yellow duck romper/);

    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), ["You accepted! Waiting on Jo now."]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).sellerDecision, "accepted");
    const tee = await itemNamed(w, "Striped long-sleeve tee");
    assertEquals([tee.status, (await w.db.Listing.filter({ itemId: tee.id })).length], ["in_closet", 0]);

    // An echoed "yes" never lists the older quote: the pet asks it again, and the next "yes" lists it.
    await w.text("mina", "yes!");
    assertEquals(w.inbox("mina"), [quote]);
    assertEquals((await w.db.Listing.filter({ itemId: tee.id })).length, 0);
    await w.text("mina", "yes please");
    assertMatch(w.inbox("mina")[0], /^Listed! The Striped long-sleeve tee is up for \$8\.40/);
  });
});

Deno.test("the newest question wins: quote → proposal text → 'no' declines the trade (it doesn't re-ask the condition)", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    await w.text("mina", "sell the striped tee");
    await w.text("mina", "", ["att_tee"]);
    const { prop } = await proposeRomper(w);
    w.inbox("mina"); w.inbox("jo");
    await w.text("mina", "no");
    assertEquals(w.inbox("mina"), [t.declined()]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "declined");
    assertEquals((await w.db.Listing.list()).filter((l: any) => l.status === "active").length, 1); // only the romper, back up
  });
});

Deno.test("the newest question wins: proposal text → a newer quote → 'yes' lists it and leaves the trade alone; 'no thanks' to a quote stops it", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    w.inbox("mina");
    await w.text("mina", "sell the striped tee");
    await w.text("mina", "", ["att_tee"]);
    w.inbox("mina");
    await w.text("mina", "yes");
    assertMatch(w.inbox("mina")[0], /^Listed! The Striped long-sleeve tee/);
    assertEquals((await w.db.MatchProposal.get(prop.id)).sellerDecision, "pending");
    // The proposal question is older than that answer: "yes" again asks, it doesn't accept.
    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [t.acceptOrDecline()]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).sellerDecision, "pending");

    // A soft "no thanks" answers a fresh quote (nothing listed), not the open trade.
    await w.text("mina", "sell the corduroy pants");
    await w.text("mina", "", ["att_pants"]);
    w.inbox("mina");
    await w.text("mina", "no thanks");
    assertEquals(w.inbox("mina"), [t.cancelled()]);
    const pants = await itemNamed(w, "Navy corduroy pants");
    assertEquals((await w.db.Listing.filter({ itemId: pants.id })).length, 0);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "open");
  });
});

Deno.test(`a selling question older than ${FLOW_TTL_MS / 60_000} minutes is forgotten: a late 'yes' lists nothing`, async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.text("mina", "", ["att_romper"]);
    w.inbox("mina");
    const convo = await w.convo("mina");
    assertEquals(convo.step, "await_condition");
    await w.db.Parent.update(w.ids.mina, { convo: { ...convo, flowAt: Date.now() - FLOW_TTL_MS - 1_000 } } as any);
    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [t.unknown()]);
    assertEquals((await w.db.Listing.list()).length, 0);
    assertEquals((await w.convo("mina")).step, "idle");
  });
});

Deno.test("the pay link says 'with Face ID' only when the buyer really approves with one (a saved passkey)", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    await w.text("jo", "accept");
    await w.text("mina", "accept");
    const link = `https://sproutpass.test/trade/${prop.id}?as=jo`;
    assertEquals(w.inbox("jo").at(-1), t.approveInApp(link, false));
    // B5's mandate: Face ID approval is on exactly while a passkey is saved.
    await w.db.Parent.update(w.ids.jo, { passkeys: [{ key: "pk_1", credentialId: "cred_1", createdAt: new Date().toISOString() }] } as any);
    await w.text("jo", "pay");
    assertEquals(w.inbox("jo"), [`I never pay by text. Approve it in the app with Face ID (demo payment · no real charge): ${link}`]);
  });
});

Deno.test("a text that fails to process still gets a short 'busy' reply (never silence), and the row is closed", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    const items = w.db.ClothingItem as any;
    const list = items.list;
    items.list = () => Promise.reject(new Error("db hiccup")); // getCloset fails (not a rate limit)
    try {
      await w.text("mina", "bag");
    } finally {
      items.list = list;
    }
    assertEquals(w.inbox("mina"), [t.busy()]);
    const rows = await w.db.AgentInbox.filter({ parentId: w.ids.mina, type: "imessage" });
    assert(rows.every((r: any) => r.status === "done"), "no row left claimed");
    await w.text("mina", "bag");
    assertMatch(w.inbox("mina")[0], /^In the bag: /);
  });
});

Deno.test("a photo note never carries a name from a label: the prompt says so, and the shared listing's note is scrubbed", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    w.llm.photo = { condition: "gently_used", note: "Small stain on the cuff, name Emma R. written on the tag. Call 310-555-0199.", name: "Romper", match: "Yellow duck romper" };
    await w.text("mina", "", ["att_romper"]);
    const quote = w.inbox("mina")[0];
    assertEquals(quote, `That's the Yellow duck romper, gently used (Small stain on the cuff). Fair price $18.00 (2nd owner pays 60% of $30.00) — reply "yes" to list it, or tell me a different condition.`);
    assert(w.llm.calls.at(-1).prompt.includes(NO_PERSONAL_DETAILS), "the photo prompt says not to copy names");
    await w.text("mina", "yes");
    const romper = await itemNamed(w, "Yellow duck romper");
    assertEquals((await activeListing(w, romper.id)).conditionNote, "Small stain on the cuff");
  });
});

// ---- trust: STOP / START, rate limit, phone numbers, the LLM ------------------------------------------------------

Deno.test("STOP: one confirmation, then silence (events too) until START; HELP still explains", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    await w.text("jo", "STOP");
    assertEquals(w.inbox("jo"), [t.stopped()]);
    assertEquals((await w.convo("jo")).optedOut, true);
    await w.text("jo", "bag");
    await w.text("jo", "stop");
    await proposeRomper(w); // a proposal for Jo while paused
    assertEquals(w.inbox("jo"), []);
    assertEquals(w.inbox("mina").length, 1); // Mina still hears about it
    await w.text("jo", "help");
    assertEquals(w.inbox("jo"), [t.pausedHelp()]);
    await w.text("jo", "start");
    assertEquals(w.inbox("jo"), [t.started("Pip")]);
    await w.text("jo", "status");
    assertMatch(w.inbox("jo")[0], /^Here's where things stand: Yellow duck romper for \$18\.00, your turn/);
  });
});

Deno.test("STOP with polite words ('STOP please', 'please stop', 'Stop, thanks') still opts out, and START comes back", async () => {
  for (const text of ["STOP please", "please stop", "Stop, thanks", "stop it!"]) {
    await withWorld(async (w) => {
      await sayHi(w, "mina");
      await w.text("mina", text);
      assertEquals(w.inbox("mina"), [t.stopped()], text);
      assertEquals((await w.convo("mina")).optedOut, true, text);
      assertEquals(w.llm.calls.length, 0, "never sent to the chat model");
      await w.text("mina", "start please");
      assertEquals(w.inbox("mina"), [t.started("Button")], text);
    });
  }
});

Deno.test("rate limit: a flood gets INBOUND_PER_MINUTE answers, one 'slow down', then quiet", async () => {
  await withWorld(async (w) => {
    for (let i = 0; i < INBOUND_PER_MINUTE + 4; i++) await w.text("mina", "hi");
    const got = w.inbox("mina");
    assertEquals(got.length, INBOUND_PER_MINUTE + 1);
    assertEquals(got.at(-1), t.slowDown());
    assert(got.slice(0, -1).every((s) => s === t.hello("Button")));
    await w.text("mina", "stop"); // STOP is never rate limited
    assertEquals(w.inbox("mina"), [t.stopped()]);
  });
});

Deno.test("rateGate: fixed one-minute window, one warning", () => {
  let g = rateGate(undefined, 1_000, 2);
  assertEquals([g.allow, g.rl.n], [true, 1]);
  g = rateGate(g.rl, 2_000, 2); assertEquals([g.allow, g.warn], [true, false]);
  g = rateGate(g.rl, 3_000, 2); assertEquals([g.allow, g.warn], [false, true]);
  g = rateGate(g.rl, 4_000, 2); assertEquals([g.allow, g.warn], [false, false]);
  g = rateGate(g.rl, 61_001, 2); assertEquals([g.allow, g.rl.n, g.rl.since], [true, 1, 61_001]);
  g = rateGate({ since: 99_999, n: 50 }, 1_000, 2); assertEquals(g.allow, true); // a clock from the future resets
});

Deno.test("anything else: the LLM answers in the pet's voice, phone numbers masked; no LLM → the template", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    w.llm.chat = "**Sure!** Call my friend at (310) 555-0199 — or just send me a photo.";
    await w.text("mina", "what's the weather like for the park?");
    assertEquals(w.inbox("mina"), ["Sure! Call my friend at [number hidden] — or just send me a photo."]);
    const prompt = w.llm.calls.at(-1).prompt as string;
    assertMatch(prompt, /cannot buy, sell, list, accept, decline or pay anything yourself/);
    w.llm.chat = null;
    await w.text("mina", "what's the weather like?");
    assertEquals(w.inbox("mina"), [t.unknown()]);
  });
});

Deno.test("iMessage off (Setting.imessage=false): the pet still answers in the app, nothing goes to Photon", async () => {
  await withWorld(async (w) => {
    const r = await w.text("mina", "hi");
    assertEquals(r.answered, 1);
    assertEquals(w.sent.length, 0);
  }, { imessage: false });
});

Deno.test("namedItem: most shared words wins; a tie is no guess", () => {
  const items = [{ id: "a", name: "Yellow duck romper" }, { id: "b", name: "Yellow rain jacket" }, { id: "c", name: "Fox-ear knit hat" }];
  assertEquals(namedItem(items, "sell the duck romper")?.id, "a");
  assertEquals(namedItem(items, "the yellow one"), null);
  assertEquals(namedItem(items, "sell it please"), null);
});

Deno.test("'sell' again mid-quote repeats the quote; a photo captioned 'stop' still opts out", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    w.llm.photo = { condition: "gently_used", note: "", name: "Hat", match: "Fox-ear knit hat" };
    await w.text("mina", "", ["att_hat"]);
    const quote = w.inbox("mina")[0];
    assertMatch(quote, /^That's the Fox-ear knit hat, gently used\. Fair price \$7\.20/);
    await w.text("mina", "sell the hat");
    assertEquals(w.inbox("mina"), [quote]);
    await w.text("mina", "stop", ["att_hat2"]);
    assertEquals(w.inbox("mina"), [t.stopped()]);
    assertEquals((await w.db.Listing.list()).length, 0);
  });
});

Deno.test("sweep: texts and events are answered at once; encounter rows stay with the Fetch agents for 5 s", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    const enc = await w.db.AgentInbox.create({ parentId: w.ids.mina, type: "encounter", payload: {}, status: "pending", createdAt: new Date().toISOString() } as any);
    await w.setClock(DEMO_DATES.nudge); // writes a nudge:new event
    assertEquals(await w.tick(), 1);
    assertEquals(w.inbox("mina").length, 1);
    assertEquals((await w.db.AgentInbox.get(enc.id)).status, "pending");
    assertEquals(await w.tick(), 0); // nothing answered twice
  });
});
