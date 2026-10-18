// (C) npx -y deno@2 test --no-lock -A base44/shared/c/
// Python parity: runs agents/wording.py + agents/intents.py and checks they say exactly what wording.ts says and
// read texts the same way, so the pet sounds the same whichever side answers. Skipped when no Python is found.

// deno-lint-ignore-file no-explicit-any
import {
  isTradeCommand, label, mentionsTrade, noteBit, parseCondition, parseIntent, priceRule, redactPhones, st, t, tl,
} from "./wording.ts";

function assertEquals(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  python: ${x}\n  deno:   ${y}`);
}

const AGENTS = new URL("../../../agents/", import.meta.url);
const CANDIDATES = [
  new URL(".venv/Scripts/python.exe", AGENTS), new URL(".venv/bin/python", AGENTS),
].map((u) => decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, "$1"))).concat(["python3", "python"]);

async function findPython(): Promise<string | null> {
  for (const exe of CANDIDATES) {
    try {
      const out = await new Deno.Command(exe, { args: ["-c", "import sys; print(sys.version_info[0])"], stdout: "piped", stderr: "null" }).output();
      if (out.success && new TextDecoder().decode(out.stdout).trim() === "3") return exe;
    } catch { /* not this one */ }
  }
  return null;
}
const PY = await findPython();

const LINK = "https://sproutpass.test/trade/p1?as=jo";
const TEXTS = [
  "hi", "Hello there", "help", "what can you do", "bag", "what do i have", "status", "any updates?", "what's new",
  "sell", "sell the striped tee", "pass it on", "pass on it", "I'll pass", "give away", "keep", "still fits", "later please",
  "not now", "yes", "Yep!", "ok", "👍", "no", "nope", "accept", "I'll take it", "deal", "decline", "no thanks", "reject",
  "pay", "checkout", "like new", "gently used", "well loved", "STOP", "stop all", "please stop texting me", "unsubscribe",
  "Start", "resume", "cancel", "never mind", "stop by the park later", "what's the weather", "", "  ",
  // trade decisions: never from a word inside a sentence, refusals first, questions never decide
  "no deal", "No deal, thanks", "Not a deal I want", "is that a good deal?", "what's the deal", "I'll take a look later",
  "I'll take a look", "should I take it?", "I don't accept", "do not accept", "can't accept that", "not a good deal",
  "don't take it", "I'll pass on this one", "I'll pass on it", "I'll pass it on", "I’ll pass", "I don’t accept",
  "no thank you", "nah thanks", "not interested", "should I decline?", "Deal!", "Deal?", "it's a deal", "it’s a deal",
  "I accept", "yes, accept", "accept the trade", "I’ll take it 👍", "yes to the trade", "passing it on",
  // opt-out with polite words, yes with "please"
  "STOP please", "please stop", "Stop, thanks", "stop it!", "don’t text me", "start please", "yes please", "yes!!",
];
const CONDITION_TEXTS = ["it's like-new", "gently used I'd say", "well loved", "pretty worn", "great", ""];
const REDACT = ["call 310.555.0100 or 13105550100", "Jo: +1 (424) 555-0102 https://app/trade/13105550100", "$18.00 on 2026-10-18"];

/** [python expression, the TS value]. Expressions run with `import wording as w, intents as i`. */
const LINES: [string, string][] = [
  ['w.hello("Pip")', t.hello("Pip")],
  ["w.help_text()", t.help()],
  ['w.nudge("Yellow duck romper", "6-9M")', t.nudge("Yellow duck romper", "6-9M")],
  ["w.nudge_which()", t.nudgeWhich()],
  ['w.ask_photo("romper")', t.askPhoto("romper")],
  ["w.ask_which()", t.askWhich()],
  ["w.photo_which()", t.photoWhich()],
  ['w.ask_condition("well_loved")', t.askCondition("well_loved")],
  ['w.quote("romper", "gently_used", 1800, 3000, 1, "Tiny stain on the cuff.")', t.quote("romper", "gently_used", 1800, 3000, 1, "Tiny stain on the cuff.")],
  ['w.quote("sweater", "well_loved", 1440, 3600, 2)', t.quote("sweater", "well_loved", 1440, 3600, 2)],
  ['w.quote("x", "like_new", 1, 2, 1, "y" * 200)', t.quote("x", "like_new", 1, 2, 1, "y".repeat(200))],
  ['w.note_bit("  a  b. ")', noteBit("  a  b. ")],
  ["w.pick_condition()", t.pickCondition()],
  ["w.listed(1800, 3000, 1)", t.listed(1800, 3000, 1)],
  ['w.listed_now("romper", 1800, 3000, 1)', t.listedNow("romper", 1800, 3000, 1)],
  ["w.cancelled()", t.cancelled()],
  ["w.nothing_to_cancel()", t.nothingToCancel()],
  ["w.keep()", t.keep()],
  ["w.later()", t.later()],
  ['w.proposal("romper", 1800, 3000, 1, "Pip")', t.proposal("romper", 1800, 3000, 1, "Pip")],
  ['w.accepted("Mina")', t.accepted("Mina")],
  [`w.both_accepted("${LINK}")`, t.bothAccepted(LINK)],
  [`w.approve_in_app("${LINK}")`, t.approveInApp(LINK)],
  [`w.approve_in_app("${LINK}", True)`, t.approveInApp(LINK, true)],
  [`w.pay_in_app("${LINK}")`, t.payInApp(LINK)],
  [`w.pay_in_app("${LINK}", face_id=True)`, t.payInApp(LINK, true)],
  ["w.accept_or_decline()", t.acceptOrDecline()],
  ["w.declined()", t.declined()],
  ["w.expired()", t.expired()],
  ["w.payment_failed()", t.paymentFailed()],
  ["w.not_yet()", t.notYet()],
  ['w.in_trade("romper")', t.inTrade("romper")],
  ['w.already_listed("romper", 1800)', t.alreadyListed("romper", 1800)],
  ['w.list_failed("romper")', t.listFailed("romper")],
  ["w.busy()", t.busy()],
  ['w.completed("romper", "Nov 17")', t.completed("romper", "Nov 17")],
  ['w.sold("romper", 1800)', t.sold("romper", 1800)],
  ["w.no_fit()", t.noFit()],
  ["w.unknown()", t.unknown()],
  ['w.final_home("cardigan")', t.finalHome("cardigan")],
  ["w.nothing_due()", t.nothingDue()],
  ['w.other_accepted("Jo")', t.otherAccepted("Jo")],
  ["w.no_open_proposal()", t.noOpenProposal()],
  ['w.bag(["romper 6-9M ♥♡♡", "tee"])', t.bag(["romper 6-9M ♥♡♡", "tee"])],
  ["w.bag([])", t.bag([])],
  ['w.status(["a", "b"])', t.status(["a", "b"])],
  ["w.status([])", t.status([])],
  ["w.stopped()", t.stopped()],
  ['w.started("Pip")', t.started("Pip")],
  ["w.paused_help()", t.pausedHelp()],
  ["w.slow_down()", t.slowDown()],
  ['w.st_decide("romper", 1800)', st.decide("romper", 1800)],
  ['w.st_waiting("romper", "Jo")', st.waiting("romper", "Jo")],
  ['w.st_pay("romper")', st.pay("romper")],
  ['w.st_to_pay("romper")', st.toPay("romper")],
  ['w.st_listed("romper", 1800)', st.listed("romper", 1800)],
  ['w.st_nudge("romper")', st.nudge("romper")],
  ["w.price_rule(3000, 1)", priceRule(3000, 1)],
  ["w.price_rule(3000, 2)", priceRule(3000, 2)],
  ["w.price_rule(3000, 3)", priceRule(3000, 3)],
  ['w.LABEL["gently_used"]', label("gently_used")],
  // the pets' transcript lines (Python always names the pet)
  ['w.t_hello("Pip")', tl.hello("Pip")],
  ['w.t_looking_for("Pip", ["6-9M"], ["top", "onesie"])', tl.lookingFor(["6-9M"], ["top", "onesie"], "Pip")],
  ['w.t_looking_for("Pip", ["6-9M"], [])', tl.lookingFor(["6-9M"], [], "Pip")],
  ['w.t_have("Button", "romper", "6-9M")', tl.have("romper", "6-9M", "Button")],
  ['w.t_no_fit("Button")', tl.noFit("Button")],
  ['w.t_fit_check("Pip", 4)', tl.fitCheck(4, "Pip")],
  ['w.t_fit_check("Pip", None)', tl.fitCheck(null, "Pip")],
  ['w.t_propose("Pip", 1800)', tl.propose(1800, "Pip")],
  ['w.t_ack("Button")', tl.ack("Button")],
  ['w.t_not_needed("Pip")', tl.notNeeded("Pip")],
  ['w.t_decline("Pip", "too small")', tl.decline("too small", "Pip")],
];

async function runPython(code: string): Promise<any> {
  const out = await new Deno.Command(PY!, {
    args: ["-c", code],
    cwd: decodeURIComponent(AGENTS.pathname.replace(/^\/([A-Za-z]:)/, "$1")),
    env: { PYTHONIOENCODING: "utf-8", PYTHONPATH: "." },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout));
}

const PRELUDE = "import json, wording as w, intents as i\n";

Deno.test({ name: "parity: every iMessage line is word-for-word the same in agents/wording.py", ignore: !PY, fn: async () => {
  const py: string[] = await runPython(`${PRELUDE}print(json.dumps([${LINES.map(([e]) => e).join(", ")}], ensure_ascii=False))`);
  LINES.forEach(([expr, ts], k) => assertEquals(py[k], ts, expr));
} });

Deno.test({ name: "parity: agents/intents.py reads every text the same way", ignore: !PY, fn: async () => {
  const py = await runPython(`${PRELUDE}T = json.loads(${JSON.stringify(JSON.stringify(TEXTS))})\n` +
    `C = json.loads(${JSON.stringify(JSON.stringify(CONDITION_TEXTS))})\n` +
    `R = json.loads(${JSON.stringify(JSON.stringify(REDACT))})\n` +
    `print(json.dumps({"intents": [i.parse_intent(x) for x in T], "commands": [i.is_trade_command(x) for x in T], ` +
    `"mentions": [i.mentions_trade(x) for x in T], "conditions": [i.parse_condition(x) for x in C], "redact": [w.redact_phones(x) for x in R]}, ensure_ascii=False))`);
  TEXTS.forEach((text, k) => assertEquals(py.intents[k], parseIntent(text), `intent of ${JSON.stringify(text)}`));
  TEXTS.forEach((text, k) => assertEquals(py.commands[k], isTradeCommand(text), `trade command ${JSON.stringify(text)}`));
  TEXTS.forEach((text, k) => assertEquals(py.mentions[k], mentionsTrade(text), `mentions trade ${JSON.stringify(text)}`));
  CONDITION_TEXTS.forEach((text, k) => assertEquals(py.conditions[k], parseCondition(text), `condition of ${JSON.stringify(text)}`));
  REDACT.forEach((text, k) => assertEquals(py.redact[k], redactPhones(text), `redact ${JSON.stringify(text)}`));
} });
