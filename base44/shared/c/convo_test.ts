// (C) npx -y deno@2 test --no-lock -A base44/shared/c/
// The pet over iMessage, end to end: every text goes through the real photonWebhook handler (inbound.ts), is
// answered in the same request by inboxFallback.ts, which runs B's real handlers (cbridge) on B's fakeDb with the
// real seed, and every reply goes out through sendToParent to a stubbed Photon. No network, no LLM.

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertMatch, DEMO_DATES, LINES, sayHi, withWorld, type World } from "./convo_testkit.ts";
import { t } from "./wording.ts";
import { callB } from "../cbridge.ts";
import { FLOW_TTL_MS, INBOUND_PER_MINUTE, namedItem, rateGate } from "./inboxFallback.ts";
import { inventoryReceipt } from "./photoInventory.ts";
import { NO_PERSONAL_DETAILS } from "./condition.ts";
import { PERSONALITIES } from "./personality.ts";

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
    assertEquals(t.hello("Button"), `Hello, hello! I'm Button, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.`);
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
    assertMatch(help, /trades complete after the buyer approves \(demo only, no real charge\)/);
    assertMatch(bag, /^In the bag: .*Yellow duck romper 6-9M ♥♡♡.*Knit bear sweater 9-12M ♥♥♡/);
    assertEquals(status, "Here's where things stand: Spare star sleep sack listed at $19.20."); // the seed lists it for Sam
    // Jo lists nothing in the seed and has no trades yet: all quiet.
    await sayHi(w, "jo");
    await w.text("jo", "status");
    assertEquals(w.inbox("jo"), ["All quiet: nothing listed and no open trades. Send a photo to pass something on."]);
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
    const unlisted = await itemNamed(w, "Yellow duck romper");
    assertEquals((await w.db.Listing.filter({ itemId: unlisted.id })).length, 0); // nothing listed until the parent says yes
    assertEquals((await w.db.ClothingItem.filter({ name: "Yellow duck romper" })).length, 1); // the nudge asked for this photo: no new garment

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
    const tee = await itemNamed(w, "Striped long-sleeve tee");
    assertEquals((await w.db.Listing.filter({ itemId: tee.id })).length, 0);
    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [t.unknown()]); // the flow is over: a stray "yes" lists nothing
    assertEquals((await w.db.Listing.filter({ itemId: tee.id })).length, 0);
    assertEquals((await w.db.Listing.list()).length, 3); // only the seed's 3 listings
  });
});

Deno.test("a 2nd-owner item is quoted at 40%; the AI's 'match' picks the item from the bag", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.text("mina", "sell"); // "Which one? Send a photo…": the photo that answers it is for selling
    assertEquals(w.inbox("mina"), [t.askWhich()]);
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
    await w.text("mina", "sell");
    w.inbox("mina");
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

Deno.test("the AI looks first: a water bottle is said back, never quoted as an item in the bag", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.setClock(DEMO_DATES.nudge); // the pet is asking about the romper: a photo still has to show it
    await w.tick();
    w.inbox("mina");
    w.llm.photo = { seen: "Black water bottle.", kidsItem: false, condition: "gently_used", note: "", match: "" };
    await w.text("mina", "", ["att_bottle"]);
    assertEquals(w.inbox("mina"), [t.notKidsItem("a black water bottle")]);
    assertMatch(w.llm.calls.at(-1).prompt, /Look at this photo/);
    const romper = await itemNamed(w, "Yellow duck romper");
    assertEquals((await w.db.Listing.filter({ itemId: romper.id })).length, 0);

    // A kids' item the AI can't place among the bag's items: it asks which one instead of assuming the nudged romper.
    w.llm.photo = { seen: "a red toddler raincoat", kidsItem: true, condition: "gently_used", note: "", name: "Red raincoat", match: "" };
    await w.text("mina", "", ["att_coat"]);
    assertEquals(w.inbox("mina"), [t.photoWhich()]);
  });
});

Deno.test("the parent named the item but the photo shows something else: the pet says so and waits for the right photo", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.text("mina", "sell the striped tee");
    w.inbox("mina");
    w.llm.photo = { seen: "a blue rain jacket", kidsItem: true, isThatItem: false, condition: "gently_used", note: "", match: "" };
    await w.text("mina", "", ["att_jacket"]);
    assertEquals(w.inbox("mina"), [t.notThatItem("a blue rain jacket", "Striped long-sleeve tee")]);
    assertEquals((await w.convo("mina")).step, "await_photo");
    w.llm.photo = { seen: "a striped shirt", kidsItem: true, isThatItem: true, condition: "like_new", note: "", match: "" };
    await w.text("mina", "", ["att_tee"]);
    assertMatch(w.inbox("mina")[0], /^That's the Striped long-sleeve tee, like new\. Fair price \$8\.40/);
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
    await w.text("sam", "sell");
    assertEquals(w.inbox("sam"), [t.askWhich()]);
    w.llm.photo = { condition: "like_new", note: "", name: "Cardigan", match: "Oatmeal knit cardigan" };
    await w.text("sam", "", ["att_cardigan"]);
    assertEquals(w.inbox("sam"), [t.finalHome("Oatmeal knit cardigan")]);
    await w.text("sam", "yes");
    assertEquals(w.inbox("sam"), [t.unknown()]);
    const cardigan = await itemNamed(w, "Oatmeal knit cardigan");
    assertEquals((await w.db.Listing.filter({ itemId: cardigan.id })).length, 0);
  });
});

Deno.test("a photo nobody asked for (or after a nudge older than the selling flow's 15 minutes) adds a new garment to the inventory", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.setClock(DEMO_DATES.nudge);
    await w.tick();
    w.inbox("mina");
    const convo = await w.convo("mina");
    await w.db.Parent.update(w.ids.mina, { convo: { ...convo, lastAsk: { ...convo.lastAsk, at: Date.now() - FLOW_TTL_MS - 1_000 } } } as any);
    w.llm.photo = { isClothing: true, name: "Green fleece vest", category: "outerwear", size: "", color: "green", brand: "", material: "fleece", pattern: "", condition: "gently_used", note: "" };
    await w.text("mina", "", ["att_vest"]);
    const [vest] = await w.db.ClothingItem.filter({ name: "Green fleece vest" }) as any[];
    assertEquals([vest?.currentOwnerId, vest?.size, vest?.status], [w.ids.mina, "unknown", "in_closet"]);
    assertEquals(w.inbox("mina"), [inventoryReceipt(vest)]);
    assertEquals((await w.convo("mina")).step, "await_inventory_details");
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
    assertEquals(w.inbox("mina"), [t.keep("Button")]);
    assert((await w.db.AgentNudge.list()).every((n: any) => n.resolved));
  });
});

// ---- the trade ----------------------------------------------------------------------------------------------------

Deno.test("trade by text: the final offer (price + product photo) → the buyer's APPROVE accepts for both → the simulated Visa receipt on both phones, no tick", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop, romper } = await proposeRomper(w);
    const link = (who: "mina" | "jo") => `https://sproutpass.test/trade/${prop.id}?as=${who}`;
    const visa = "Buyer approval runs a simulated Visa payment; no real money moves.\nSize: 6-9M.";
    // The shared listing is the seller's consent: Mina sees the same final offer, with nothing to answer.
    assertEquals(w.inbox("mina"), [`Pip and I found a buyer for your Yellow duck romper. Final price: $18.00. Your shared listing authorizes this offer; waiting for the buyer to approve. No action needed from you. Demo only, no real charge.\n${visa}\nView product: ${link("mina")}`]);
    assertEquals(w.inbox("jo"), [`${t.proposal("Yellow duck romper", 1800, 3000, 1, "Button")}\n${visa}\nApprove or Decline: ${link("jo")}`]);
    assertEquals([w.images("jo"), w.images("mina")], [1, 1]); // the product photo on both phones
    assertEquals((await w.convo("mina")).lastAsk, undefined); // nothing was asked of the seller
    assertEquals((await w.convo("jo")).lastAsk?.id, prop.id); // a plain "yes" from Jo answers this offer

    // Not approved yet: "pay" charges nothing, and STATUS says it's Jo's turn.
    await w.text("jo", "pay");
    assertEquals(w.inbox("jo"), [t.notYet()]);
    await w.text("jo", "status");
    assertEquals(w.inbox("jo"), [`Here's where things stand: Yellow duck romper for $18.00, your turn (reply "accept" or "decline").`]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "open");

    // Jo approves by text: it accepts for both and runs the simulated Visa payment in the same request, and both
    // phones get the receipt with the product photo (no app tick, nobody else texting).
    await w.text("jo", "approve");
    const p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.sellerDecision, p.buyerDecision, p.visaSimulation?.status], ["paid", "accepted", "accepted", "captured"]);
    const receipt = `Visa simulation: $18.00 USD authorized and captured. Receipt ${p.paymentRef}. No real charge or transfer of funds.`;
    const jo = w.inbox("jo"), mina = w.inbox("mina");
    assertEquals(jo.length, 1); // no "you accepted", no pay link, and the welcome nudge doesn't say hi twice
    assertMatch(jo[0], /^Say hi to the Yellow duck romper! It should fit until ~\w{3} \d{1,2}\. I'll hop back and check in then\.\n/);
    assert(jo[0].endsWith(`\n${receipt}\nView product and receipt: ${link("jo")}`), jo[0]);
    assertEquals(mina, [`The Yellow duck romper found its next home for $18.00, folded with care. Flowers all round!\n${receipt}\nView receipt: ${link("mina")}`]);
    assertEquals([w.images("jo"), w.images("mina")], [2, 2]);
    assert(!w.all("jo").join(" ").match(/\+1|555-?01/), "no phone number ever goes out");
    const moved = await w.db.ClothingItem.get(romper.id);
    assertEquals([moved.currentOwnerId, moved.ownerCount, moved.status], [w.ids.jo, 2, "in_closet"]);

    // Never pay by text, and nothing is left to pay.
    await w.text("jo", "pay now");
    assertEquals(w.inbox("jo"), [t.noOpenProposal()]);
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

Deno.test("questions and refusals never approve a trade: 'is that a good deal?' asks, 'I'll take a look' decides nothing, 'No deal, thanks' declines", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    w.inbox("mina"); w.inbox("jo");
    // Only the buyer approves, and that approval pays (demo): one misread "approve" from Jo would close the deal.
    for (const text of ["is that a good deal?", "should I take it?", "what’s the deal with the price", "Deal?"]) {
      await w.text("jo", text);
      assertEquals(w.inbox("jo"), [t.acceptOrDecline()], text);
    }
    await w.text("jo", "I'll take a look");
    assertEquals(w.inbox("jo"), [t.unknown()]); // the chat line (no LLM here): no decision
    await w.text("jo", "I’ll take a look later");
    assertEquals(w.inbox("jo"), [t.later("Pip")]);
    let p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.sellerDecision, p.buyerDecision], ["open", "pending", "pending"]);
    assertEquals(w.inbox("mina"), []);

    await w.text("jo", "No deal, thanks");
    assertEquals(w.inbox("jo"), [t.declined()]);
    assertEquals(w.inbox("mina"), [t.declined()]);
    p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.buyerDecision, p.paymentRef ?? null], ["declined", "declined", null]);
    assert(!w.all("jo").some((s) => /You accepted|Both of you said yes|Visa simulation/.test(s)), "Jo never approved");
  });
});

Deno.test("'I don’t accept' and 'I'll pass on this one' decline (curly apostrophes too); nothing is ever accepted", async () => {
  for (const text of ["I don’t accept", "I'll pass on this one", "not interested", "nah thanks"]) {
    await withWorld(async (w) => {
      await sayHi(w, "mina", "jo");
      const { prop, romper } = await proposeRomper(w);
      w.inbox("mina"); w.inbox("jo");
      await w.text("jo", text);
      assertEquals(w.inbox("jo"), [t.declined()], text);
      assertEquals((await w.db.MatchProposal.get(prop.id)).buyerDecision, "declined", text);
      assert(await activeListing(w, romper.id), "the romper is back up");
    });
  }
});

// The offer asks only the buyer (the shared listing is the seller's consent), so these run on Jo's phone.
Deno.test("the newest question wins: quote → the offer text → 'yes' approves the trade and lists nothing; the quote is asked again", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    await w.text("jo", "sell the joggers");
    w.llm.photo = { condition: "like_new", note: "", name: "Joggers", match: "" };
    await w.text("jo", "", ["att_joggers"]);
    const quote = w.inbox("jo").at(-1)!;
    assertMatch(quote, /^That's the Sage cotton joggers, like new\. Fair price \$9\.60/);
    const { prop } = await proposeRomper(w);
    assertMatch(w.inbox("jo").at(-1), /found a match: the Yellow duck romper/);

    await w.text("jo", "yes");
    const done = w.inbox("jo");
    assertEquals(done.length, 1);
    assertMatch(done[0], /^Say hi to the Yellow duck romper!.*\nVisa simulation: \$18\.00 USD authorized and captured\./s);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "paid");
    const joggers = await itemNamed(w, "Sage cotton joggers");
    assertEquals([joggers.status, (await w.db.Listing.filter({ itemId: joggers.id })).length], ["in_closet", 0]);

    // An echoed "yes" never lists the older quote: the pet asks it again, and the next "yes" lists it.
    await w.text("jo", "yes!");
    assertEquals(w.inbox("jo"), [quote]);
    assertEquals((await w.db.Listing.filter({ itemId: joggers.id })).length, 0);
    await w.text("jo", "yes please");
    assertMatch(w.inbox("jo")[0], /^Listed! The Sage cotton joggers is up for \$9\.60/);
  });
});

Deno.test("the newest question wins: quote → the offer text → 'no' declines the trade (it doesn't re-ask the condition)", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    await w.text("jo", "sell the joggers");
    await w.text("jo", "", ["att_joggers"]);
    const { prop, romper } = await proposeRomper(w);
    w.inbox("mina"); w.inbox("jo");
    await w.text("jo", "no");
    assertEquals(w.inbox("jo"), [t.declined()]);
    assertEquals(w.inbox("mina"), [t.declined()]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "declined");
    assert(await activeListing(w, romper.id), "the romper is back up");
    const joggers = await itemNamed(w, "Sage cotton joggers");
    assertEquals((await w.db.Listing.filter({ itemId: joggers.id })).length, 0); // the quote wasn't listed
  });
});

Deno.test("the newest question wins: the offer text → a newer quote → 'yes' lists it and leaves the trade alone; 'no thanks' to a quote stops it", async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    w.inbox("jo");
    await w.text("jo", "sell the joggers");
    await w.text("jo", "", ["att_joggers"]);
    w.inbox("jo");
    await w.text("jo", "yes");
    assertMatch(w.inbox("jo")[0], /^Listed! The Sage cotton joggers/);
    assertEquals((await w.db.MatchProposal.get(prop.id)).buyerDecision, "pending");
    // The offer question is older than that answer: "yes" again asks, it doesn't approve.
    await w.text("jo", "yes");
    assertEquals(w.inbox("jo"), [t.acceptOrDecline()]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).buyerDecision, "pending");

    // A soft "no thanks" answers a fresh quote (nothing listed), not the open trade.
    await w.text("jo", "sell the dino socks");
    await w.text("jo", "", ["att_socks"]);
    w.inbox("jo");
    await w.text("jo", "no thanks");
    assertEquals(w.inbox("jo"), [t.cancelled()]);
    const socks = await itemNamed(w, "Dino sock four-pack");
    assertEquals((await w.db.Listing.filter({ itemId: socks.id })).length, 0);
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "open");
  });
});

Deno.test(`a selling question older than ${FLOW_TTL_MS / 60_000} minutes is forgotten: a late 'yes' lists nothing`, async () => {
  await withWorld(async (w) => {
    await sayHi(w, "mina");
    await w.text("mina", "sell the romper");
    await w.text("mina", "", ["att_romper"]);
    w.inbox("mina");
    const convo = await w.convo("mina");
    assertEquals(convo.step, "await_condition");
    await w.db.Parent.update(w.ids.mina, { convo: { ...convo, flowAt: Date.now() - FLOW_TTL_MS - 1_000 } } as any);
    await w.text("mina", "yes");
    assertEquals(w.inbox("mina"), [t.unknown()]);
    const romper = await itemNamed(w, "Yellow duck romper");
    assertEquals((await w.db.Listing.filter({ itemId: romper.id })).length, 0);
    assertEquals((await w.convo("mina")).step, "idle");
  });
});

Deno.test("'with Face ID' only when the buyer really approves with one (a saved passkey): then APPROVE stops at the app link", async () => {
  // No passkey (the demo default): the buyer's APPROVE pays at once (demo), so no pay link and no Face ID promise.
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    await w.text("jo", "approve");
    assertEquals((await w.db.MatchProposal.get(prop.id)).status, "paid");
    assert(!w.all("jo").some((s) => /Face ID|Approve the payment in the app/.test(s)), "no pay link, no Face ID");
  });
  // B5's mandate: Face ID approval is on exactly while a passkey is saved. The approval accepts for both, and the
  // payment waits for Face ID in the app; never by text.
  await withWorld(async (w) => {
    await sayHi(w, "mina", "jo");
    const { prop } = await proposeRomper(w);
    await w.db.Parent.update(w.ids.jo, { passkeys: [{ key: "pk_1", credentialId: "cred_1", createdAt: new Date().toISOString() }] } as any);
    w.inbox("jo"); w.inbox("mina");
    await w.text("jo", "approve");
    const link = `https://sproutpass.test/trade/${prop.id}?as=jo`;
    // One text each: no "your turn" for the listing's automatic accept after Jo already approved.
    assertEquals(w.inbox("jo"), [t.approveInApp(link, true)]);
    assertEquals(w.inbox("mina"), [t.accepted("the buyer to pay")]);
    const p = await w.db.MatchProposal.get(prop.id);
    assertEquals([p.status, p.paymentRef ?? null], ["both_accepted", null]);
    await w.text("jo", "pay");
    assertEquals(w.inbox("jo"), [`I never pay by text. Approve it in the app with Face ID (demo payment · no real charge): ${link}`]);
    await w.text("jo", "status");
    assertEquals(w.inbox("jo"), [`Here's where things stand: Yellow duck romper, ready to approve in the app (text "pay" for the link).`]);
    assertEquals((await w.db.MatchProposal.get(prop.id)).paymentRef ?? null, null);
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
    await w.text("mina", "sell");
    w.inbox("mina");
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
    // Button's own personality: who it is and how it talks
    assert(prompt.includes(PERSONALITIES.button.blurb) && prompt.includes(PERSONALITIES.button.style), "the pet's blurb and style");
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
    await w.text("mina", "sell");
    w.inbox("mina");
    w.llm.photo = { condition: "gently_used", note: "", name: "Hat", match: "Fox-ear knit hat" };
    await w.text("mina", "", ["att_hat"]);
    const quote = w.inbox("mina")[0];
    assertMatch(quote, /^That's the Fox-ear knit hat, gently used\. Fair price \$7\.20/);
    await w.text("mina", "sell the hat");
    assertEquals(w.inbox("mina"), [quote]);
    await w.text("mina", "stop", ["att_hat2"]);
    assertEquals(w.inbox("mina"), [t.stopped()]);
    const hat = await itemNamed(w, "Fox-ear knit hat");
    assertEquals((await w.db.Listing.filter({ itemId: hat.id })).length, 0);
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
