import { beforeEach, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "./testing/fakeDb";
import { applySeed, seedPlan } from "./seed";
import { prepareTrial } from "./prepareTrial";
import { trialStatus } from "./trial";
import { approveDemoTrade } from "./logic/trade";
import { feedbackInput } from "./feedback";

let db: FakeDb;
beforeEach(async () => { db = createFakeDb(); await applySeed(db, seedPlan()); });
it("prepares a labeled sample and compatible need without erasing inventory or approving a trade", async () => {
  const before = await db.ClothingItem.list();
  const a = await prepareTrial(db);
  const b = await prepareTrial(db);
  expect(a.itemId).toBe(b.itemId);
  expect(a.proposalId).toBeUndefined();
  expect(await db.ClothingItem.list()).toHaveLength(before.length + 1);
  const sample = await db.ClothingItem.get(a.itemId);
  expect(sample.trialSample).toBe(true);
  expect(sample.sourceMessageId).toBeUndefined();
  const progress = await trialStatus(db, a.itemId);
  expect(progress.steps.slice(0, 3).every(s => s.done)).toBe(true);
  expect(progress.steps[3].done).toBe(false);
});
it("creates the sample offer idempotently, leaves buyer pending, then transfers only on buyer approval", async () => {
  const a = await prepareTrial(db, true);
  const again = await prepareTrial(db, true);
  expect(again.proposalId).toBe(a.proposalId);
  const p = await db.MatchProposal.get(a.proposalId!);
  expect(p.buyerDecision).toBe("pending");
  expect(p.status).toBe("open");
  expect(p.snapshot.priceCents).toBe(1800);
  const paid = await approveDemoTrade(db, { parentId: p.buyerId, proposalId: p.id, decision: "accepted" });
  expect(paid.status).toBe("paid");
  expect((await db.ClothingItem.get(a.itemId)).currentOwnerId).toBe(p.buyerId);
  expect((await prepareTrial(db, true)).proposalId).toBe(p.id);
});
it("doesn't call an in-app mirror or a text-only send a delivered image receipt", async () => {
  const a = await prepareTrial(db, true);
  const p = await db.MatchProposal.get(a.proposalId!);
  const paid = await approveDemoTrade(db, { parentId: p.buyerId, proposalId: p.id, decision: "accepted" });
  const trialDb = { ...db, PetLine: { filter: async () => [{ text: paid.paymentRef, deliveryStatus: "submitted", imageSubmitted: false }] } };
  expect((await trialStatus(trialDb, a.itemId)).steps.at(-1)?.done).toBe(false);
  trialDb.PetLine.filter = async () => [{ text: paid.paymentRef, deliveryStatus: "submitted", imageSubmitted: true }];
  expect((await trialStatus(trialDb, a.itemId)).steps.at(-1)?.done).toBe(true);
});
const input = { requestId: "01234567-89ab-cdef-0123-456789abcdef", role: "teammate", outcome: "not_tried", useful: "maybe", currentProcess: "Testing the demo", confusing: "", improvement: "Make the upload action clearer" };
it("keeps teammate feedback distinct and quote permission opt-in", () => {
  expect(feedbackInput(input)).toMatchObject({ role: "teammate", quoteConsent: false, outcome: "not_tried" });
  expect(feedbackInput({ ...input, quoteConsent: true }).quoteConsent).toBe(true);
});
it("rejects incomplete or unbounded feedback", () => {
  expect(() => feedbackInput({ ...input, role: "fake_parent" })).toThrow();
  expect(() => feedbackInput({ ...input, improvement: "" })).toThrow();
  expect(() => feedbackInput({ ...input, confusing: "x".repeat(1501) })).toThrow();
});
