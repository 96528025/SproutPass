import { expect, it } from "vitest";
import { proposalImage, proposalReview } from "./c/proposalReview.ts";
import { parseIntent, isTradeCommand } from "./c/wording.ts";
import type { MatchProposal } from "./types.ts";

it("keeps the receipt image consistent with offers for photos and demo illustrations", () => {
  expect(proposalImage({ photo: "https://example.com/garment.jpg" }, "app.test")).toBe("https://example.com/garment.jpg");
  expect(proposalImage({ icon: "item_jacket" }, "app.test")).toBe("https://app.test/sprites/item_jacket.png");
  expect(proposalImage({}, "app.test")).toBe("https://app.test/sprites/item_romper.png");
});

it("sends the final price, product photo and review link, with no invented photo", () => {
  const snapshot = { itemName: "Bear jacket", priceCents: 1800, originalPriceCents: 3000, previousOwners: 1, size: "9-12M", icon: "item_jacket", photo: "https://example.com/jacket.jpg" } as MatchProposal["snapshot"];
  const r = proposalReview(snapshot, "Button", "https://app.test/trade/1?as=jo", "app.test");
  expect(r.image).toBe(snapshot.photo);
  expect(r.text).toContain("$18.00");
  expect(r.text).toContain('Reply "approve"');
  expect(r.text).toContain("https://app.test/trade/1?as=jo");
  const illustrated = proposalReview({ ...snapshot, photo: "" }, "Button", "https://app.test/trade/1", "app.test");
  expect(illustrated.text).toContain("Product illustration; photo not provided");
  expect(illustrated.image).toBe("https://app.test/sprites/item_jacket.png");
});
it("accepts explicit APPROVE and protects negations and questions", () => {
  for (const text of ["APPROVE", "Approved", "I approve the trade"]) {
    expect(parseIntent(text)).toBe("accept");
    expect(isTradeCommand(text)).toBe(true);
  }
  expect(parseIntent("Do not approve")).toBe("decline");
  expect(parseIntent("Should I approve?")).not.toBe("accept");
});
it("the seller sees the same price and photo without an approval request", () => {
  const s = { itemName: "Jacket", priceCents: 1800, size: "9-12M", photo: "https://example.com/jacket.jpg" } as MatchProposal["snapshot"];
  const r = proposalReview(s, "Pip", "https://app.test/trade/1", "app.test", false);
  expect(r.image).toBe(s.photo);
  expect(r.text).toContain("$18.00");
  expect(r.text).toContain("No action needed from you");
  expect(r.text).not.toContain("Approve or Decline");
});
