import type { VisaSimulation } from "./types.ts";

/** Local demo records only; deliberately no payment SDK or network calls. */
export function startVisaSimulation(proposalId: string, amountCents: number, reference: string): VisaSimulation {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Invalid simulated amount");
  return {
    simulated: true, network: "Visa", status: "authorizing", amountCents, currency: "USD",
    reference, token: `SIM-TOKEN-${proposalId}`, startedAt: new Date().toISOString(),
  };
}

export function visaReceiptText(v?: VisaSimulation): string {
  if (!v?.simulated || v.status !== "captured") return "Demo payment · no real charge.";
  return `Visa simulation: $${(v.amountCents / 100).toFixed(2)} ${v.currency} authorized and captured. Receipt ${v.reference}. No real charge or transfer of funds.`;
}
