// A5 stubs: only what others own. Types here mirror the A-team contract until C's useEncounter / B's proposal land.
// A1 kit, A2 Sprite/ItemIcon and sfx are real and imported directly, not stubbed.
import type { ItemIconName, SpriteName } from "@/pixel/sprites";
import { Modal } from "@/pixel/components/Modal";
import { PixelButton } from "@/pixel/components/PixelButton";

// ---- contract types (C / B own the real ones) ------------------------------------------------------------------
export interface Pet {
  sprite: SpriteName;
  name: string;
}
export interface Parent {
  id: string;
  name: string;
  avatar: { sprite: SpriteName; palette: string };
  pet: Pet;
  discoverable: boolean;
}
export type EncounterStatus = "meeting" | "talking" | "proposed" | "no_match";
export interface Encounter {
  id: string;
  status: EncounterStatus;
  proposalId?: string;
}
export interface MatchProposal {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  source: "local" | string;
  snapshot: {
    itemName: string;
    icon: ItemIconName;
    size: string;
    originalPurchaseDate: string;
    originalPriceCents: number;
    condition: string;
    previousOwners: number;
    priceCents: number;
    wearWeeksLeft: number;
  };
  reason: string;
  status: "open" | "both_accepted" | "paid" | "declined" | "expired" | "payment_failed";
  sellerDecision: "pending" | "accepted" | "declined";
  buyerDecision: "pending" | "accepted" | "declined";
}

// ---- fixtures from the contract ------------------------------------------------------------------------------
export const MINA: Parent = { id: "mina", name: "Mina", avatar: { sprite: "parent_a", palette: "peach" }, pet: { sprite: "pet_a", name: "Button" }, discoverable: true };
export const JO: Parent = { id: "jo", name: "Jo", avatar: { sprite: "parent_b", palette: "sky" }, pet: { sprite: "pet_b", name: "Pip" }, discoverable: true };
export const SAM: Parent = { id: "sam", name: "Sam", avatar: { sprite: "parent_c", palette: "mint" }, pet: { sprite: "pet_c", name: "Moss" }, discoverable: true };

export const PROPOSAL: MatchProposal = {
  id: "prop_1",
  listingId: "lst_1",
  sellerId: "mina",
  buyerId: "jo",
  source: "local",
  snapshot: {
    itemName: "Yellow duck romper",
    icon: "item_romper",
    size: "6-9M",
    originalPurchaseDate: "2026-05-15",
    originalPriceCents: 3000,
    condition: "gently_used",
    previousOwners: 1,
    priceCents: 1800,
    wearWeeksLeft: 4,
  },
  reason: "Jo is looking for 6-9M tops and onesies",
  status: "open",
  sellerDecision: "pending",
  buyerDecision: "pending",
};

export const TRANSCRIPT: { speaker: "Pip" | "Button"; text: string }[] = [
  { speaker: "Pip", text: "Looking for 6-9M tops or onesies!" },
  { speaker: "Button", text: "I have a yellow duck romper in 6-9M." },
  { speaker: "Pip", text: "Gently used, 1 owner — nice." },
  { speaker: "Button", text: "Your little one fits it for about 4 more weeks." },
  { speaker: "Pip", text: "$18.00 — 60% of $30. Shall we?" },
  { speaker: "Button", text: "Trade proposal!" },
];

// ---- C stub: <AgentBubbles> fills EncounterScene's `bubbles` slot -----------------------------------------------
// Alternating pixel speech bubbles, Pip (peer pet, right) and Button (my pet, left). Shows the last 2 lines.
export function AgentBubbles({ lines }: { lines: { speaker: string; text: string }[] }) {
  const shown = lines.slice(-2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {shown.map((l, i) => {
        const left = l.speaker === "Button";
        return (
          <div key={lines.length - shown.length + i} style={{ display: "flex", justifyContent: left ? "flex-start" : "flex-end" }}>
            <div
              style={{
                maxWidth: 260,
                padding: "8px 12px",
                background: left ? "var(--paper)" : "var(--cream)",
                border: "var(--border-ink)",
                boxShadow: "var(--shadow-hard)",
                fontFamily: "var(--font-ui)",
                fontSize: 16,
                lineHeight: "20px",
                color: "var(--ink)",
              }}
            >
              <span className="px-label-12" style={{ display: "block" }}>{l.speaker}</span>
              {l.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- B stub: TradeWindow ----------------------------------------------------------------------------------------
export function TradeWindow({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  return (
    <Modal title="TRADE" onClose={onClose}>
      <p className="px-label-16" style={{ margin: "0 0 12px" }}>TradeWindow (B)</p>
      <p className="px-label-12" style={{ margin: "0 0 16px" }}>{proposalId}</p>
      <PixelButton block onClick={onClose}>CLOSE</PixelButton>
    </Modal>
  );
}
