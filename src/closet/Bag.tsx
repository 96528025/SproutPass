// OWNER: B4. The BAG (/bag): child card, 4-column inventory grid with status badges, the item card for
// the selected slot, the PASSED ON shelf and the NEEDS button. Live: the store refreshes on entity changes.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ItemIcon, PixelButton, PixelPanel, Sprite, isItemIconName } from "../app/ui";
import { useApp } from "../app/store";
import { shortDate } from "../app/format";
import type { ClosetView, ClothingItem } from "../app/types";
import { ItemCard } from "./ItemCard";

type Badge = { label: string; cls: string } | null;

function badgeFor(item: ClothingItem): Badge {
  if (item.status === "pending_trade") return { label: "TRADING", cls: "trading" };
  if (item.status === "listed") return { label: "LISTED", cls: "listed" };
  if (item.ownerCount >= 3) return { label: "FINAL HOME", cls: "final" };
  return null;
}

/** Text instead of the sprite when an item's icon isn't one of A's (ItemIcon would draw a stand-in). */
const shortName = (item: ClothingItem) => item.name.split(" ").slice(-1)[0];

function Slot(p: { item?: ClothingItem; selected?: boolean; passed?: boolean; alert?: boolean; onSelect?: () => void }) {
  if (!p.item) return <div className="b-slot empty" aria-hidden />;
  const badge = p.passed ? null : badgeFor(p.item);
  const label = `${p.item.name}, ${p.item.size}${badge ? `, ${badge.label.toLowerCase()}` : ""}${p.passed ? ", passed on" : ""}`;
  return (
    <button type="button" aria-label={label} aria-pressed={p.selected}
      className={`b-slot${p.selected ? " selected" : ""}${p.passed ? " passed" : ""}`} onClick={p.onSelect}>
      {isItemIconName(p.item.icon)
        ? <span className="b-slot-icon"><ItemIcon icon={p.item.icon} size={1} /></span>
        : <span className="b-slot-name">{shortName(p.item)}</span>}
      {badge && <span className={`b-badge ${badge.cls}`}>{badge.label}</span>}
      {p.alert && <span className="b-alert" aria-hidden>!</span>}
    </button>
  );
}

/** Pad to full rows of 4 (at least two rows) so the grid looks like an inventory. */
function padded<T>(rows: T[], min = 8): (T | undefined)[] {
  const n = Math.max(min, Math.ceil(rows.length / 4) * 4);
  return Array.from({ length: n }, (_, i) => rows[i]);
}

function ChildCard({ closet }: { closet: ClosetView }) {
  const { child, childAgeMonths, parent } = closet;
  return (
    <PixelPanel>
      <div className="b-child">
        <Sprite name={parent.pet.sprite} fallback="pet_a" anim="idle" scale={3} />
        <div className="b-stack" style={{ gap: 8 }}>
          <div className="b-h1">
            {child ? `${child.nickname} · ${childAgeMonths} MONTH${childAgeMonths === 1 ? "" : "S"}` : parent.name}
          </div>
          <div className="b-row">
            <Chip tone="lav">{parent.name}'S BAG</Chip>
            <Chip tone="cream">{shortDate(closet.now)}</Chip>
          </div>
        </div>
      </div>
    </PixelPanel>
  );
}

export function Bag() {
  const closet = useApp((s) => s.closet);
  const status = useApp((s) => s.closetStatus);
  const error = useApp((s) => s.closetError);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const toast = useApp((s) => s.toast);
  const nav = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { if (status === "error" && error) toast(error, "red"); }, [status, error, toast]);

  if (!closet) {
    if (status === "error") {
      return (
        <PixelPanel title="BAG">
          <div className="b-center">
            <p className="b-p">Couldn't open the bag.</p>
            <p className="b-p b-small b-muted">{error}</p>
            <PixelButton onClick={() => void refreshCloset()}>TRY AGAIN</PixelButton>
          </div>
        </PixelPanel>
      );
    }
    return <div className="b-center"><Chip tone="cream">OPENING BAG…</Chip></div>;
  }

  const items = closet.items;
  const all = [...items, ...closet.passedOn];
  const selected = all.find((i) => i.id === selectedId) ?? null;
  const nudged = new Set(closet.nudges.map((n) => n.itemId));
  const toggle = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  return (
    <>
      <ChildCard closet={closet} />

      <PixelPanel title={`BAG · ${items.length}`} tone="cream">
        <div className="b-stack">
          {items.length === 0 && <p className="b-p">Nothing in the bag yet. Hand-me-downs you get land here.</p>}
          <div className="b-grid" role="group" aria-label="Items in the bag">
            {padded(items).map((item, i) => (
              <Slot key={item?.id ?? `empty-${i}`} item={item} selected={!!item && item.id === selectedId}
                alert={!!item && nudged.has(item.id)} onSelect={item ? () => toggle(item.id) : undefined} />
            ))}
          </div>
          <div className="b-row-between">
            <span className="b-label b-muted">TAP A SLOT</span>
            <PixelButton variant="ghost" onClick={() => nav("/bag/needs")}>
              NEEDS{closet.needs.length ? ` · ${closet.needs.length}` : ""}
            </PixelButton>
          </div>
        </div>
      </PixelPanel>

      {selected && <ItemCard key={selected.id} item={selected} closet={closet} onClose={() => setSelectedId(null)} />}

      <PixelPanel title="PASSED ON">
        {closet.passedOn.length === 0
          ? <p className="b-p b-muted">Items you pass on to another family show up here.</p>
          : (
            <div className="b-grid" role="group" aria-label="Items passed on">
              {padded(closet.passedOn, 4).map((item, i) => (
                <Slot key={item?.id ?? `empty-${i}`} item={item} passed selected={!!item && item.id === selectedId}
                  onSelect={item ? () => toggle(item.id) : undefined} />
              ))}
            </div>
          )}
      </PixelPanel>
    </>
  );
}
