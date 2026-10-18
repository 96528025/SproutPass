// OWNER: B4. Stand-ins for screens owned by A (title, world), Agent 2 (trade, log) and C (pet).
import { useNavigate } from "react-router-dom";
import { Chip, Modal, PixelButton, PixelPanel, Sprite } from "./ui";
import { useApp } from "./store";

export function TitlePlaceholder() {
  const nav = useNavigate();
  const closet = useApp((s) => s.closet);
  return (
    <PixelPanel title="HAND-ME-DOWN RELAY">
      <div className="b-stack">
        <p className="b-p">Your pet watches the closet. When two parents pass within 25 m, the pets find a trade.</p>
        {closet && <p className="b-p">Playing as <strong>{closet.parent.name}</strong> with {closet.parent.pet.name}.</p>}
        <div className="b-actions">
          <PixelButton onClick={() => nav("/bag")}>OPEN BAG</PixelButton>
          <PixelButton variant="ghost" onClick={() => nav("/world")}>WORLD</PixelButton>
        </div>
        <Chip tone="lav">TITLE SCREEN · A</Chip>
      </div>
    </PixelPanel>
  );
}

export function WorldPlaceholder() {
  const closet = useApp((s) => s.closet);
  return (
    <PixelPanel title="WORLD" tone="cream">
      <div className="b-center">
        <Sprite name={closet?.parent.avatar.sprite ?? "parent_a"} anim="idle" scale={3} />
        <p className="b-p">The park map is coming from A. Walk around and your pet listens for nearby pets.</p>
        <Chip tone="lav">WORLD · A</Chip>
      </div>
    </PixelPanel>
  );
}

export function TradeWindowPlaceholder(p: { proposalId: string; onClose: () => void }) {
  const proposal = useApp((s) => s.closet?.proposals.find((x) => x.id === p.proposalId));
  return (
    <Modal title="TRADE" onClose={p.onClose}>
      <div className="b-stack">
        <p className="b-p">{proposal ? `${proposal.snapshot.itemName} · ${proposal.status.replace("_", " ")}` : `Proposal ${p.proposalId}`}</p>
        <Chip tone="pink">NOTHING IS CHARGED UNTIL YOU BOTH ACCEPT</Chip>
        <p className="b-p b-muted b-small">The trade window is on its way (Agent 2).</p>
        <PixelButton variant="ghost" onClick={p.onClose}>CLOSE</PixelButton>
      </div>
    </Modal>
  );
}

export function RelayLogPlaceholder() {
  return (
    <PixelPanel title="RELAY LOG">
      <p className="b-p">Seconds to list, encounters → trades, and every item's owner chain show up here (Agent 2).</p>
    </PixelPanel>
  );
}

export function TradeWatcherPlaceholder() {
  return null;
}
