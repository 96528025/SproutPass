import { expect, it } from "vitest";
import { startVisaSimulation, visaReceiptText } from "./visaSimulation.ts";

it("labels the text receipt as simulation and never calls a pending payment complete", () => {
  const v = startVisaSimulation("proposal-1", 1800, "DEMO-ABC234");
  expect(visaReceiptText(v)).not.toContain("captured");
  expect(visaReceiptText({ ...v, status: "captured" })).toBe("Visa simulation: $18.00 USD authorized and captured. Receipt DEMO-ABC234. No real charge or transfer of funds.");
});
it("rejects malformed simulated amounts", () => {
  for (const n of [-1, 1.5, NaN, Infinity]) expect(() => startVisaSimulation("p", n, "ref")).toThrow();
});
