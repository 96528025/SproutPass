// OWNER: B4. Details for the selected bag slot: size, owners, fit, purchase, status, and SELL / WITHDRAW.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { Chip, FitBar, Hearts, ItemIcon, PixelButton, PixelPanel, isItemIconName } from "../app/ui";
import { errorText, parentRef, useApp } from "../app/store";
import { ownedSince, shortDate } from "../app/format";
import { formatCents, priceFor, priceRuleText } from "../app/types";
import type { ClosetView, ClothingItem } from "../app/types";

const STATUS_TEXT: Record<ClothingItem["status"], string> = {
  in_closet: "IN THE BAG",
  listed: "LISTED",
  pending_trade: "TRADING",
  transferred_out: "PASSED ON",
};

export function ItemCard(p: { item: ClothingItem; closet: ClosetView; onClose?: () => void }) {
  const { item, closet } = p;
  const nav = useNavigate();
  const toast = useApp((s) => s.toast);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const [busy, setBusy] = useState(false);

  const passed = closet.passedOn.some((i) => i.id === item.id);
  const listing = closet.listings.find((l) => l.itemId === item.id && l.status === "active");
  const proposal = closet.proposals.find((x) => x.itemId === item.id && (x.status === "open" || x.status === "both_accepted"));
  const finalHome = priceFor(item) === null;
  const since = ownedSince(item);

  const withdraw = async () => {
    if (!listing) return;
    setBusy(true);
    try {
      await api.withdrawListing({ ...parentRef(), listingId: listing.id });
      toast("Listing withdrawn. It's back in your bag.", "cream");
      await refreshCloset();
    } catch (e) {
      toast(errorText(e), "red");
      void refreshCloset(); // e.g. a pet proposed a moment ago: show TRADING / OPEN TRADE now
    } finally {
      setBusy(false);
    }
  };

  return (
    <PixelPanel>
      <div className="b-stack">
        <div className="b-card-head">
          <span className="b-card-icon">
            {isItemIconName(item.icon)
              ? <span className="b-slot-icon"><ItemIcon icon={item.icon} size={2} /></span>
              : <span className="b-slot-name">{item.name.split(" ").slice(-1)[0]}</span>}
          </span>
          <div className="b-stack" style={{ gap: 8 }}>
            <div className="b-row-between">
              <strong className="b-h1" style={{ fontSize: 16 }}>{item.name}</strong>
              {p.onClose && <button type="button" className="b-link" onClick={p.onClose} aria-label="Close item">✕</button>}
            </div>
            <div className="b-row">
              <Chip tone="cream">{item.size === "unknown" ? "SIZE NEEDED" : item.size}</Chip>
              <Hearts filled={item.ownerCount} />
              <span className="b-label">{item.ownerCount} OWNER{item.ownerCount > 1 ? "S" : ""}</span>
            </div>
          </div>
        </div>

        {!passed && item.predictedOutgrowDate && (
          // Calendar days (A's FitBar reads YYYY-MM-DD as a local day), so it agrees with the UTC dates B prints.
          <FitBar until={item.predictedOutgrowDate.slice(0, 10)} now={closet.now.slice(0, 10)} from={since.slice(0, 10)} />
        )}

        {item.photos?.[0] && <img src={item.photos[0]} alt={item.name} style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8 }} />}
        <dl className="b-facts">
          <dt>{item.sourceMessageId ? "ADDED" : "BOUGHT NEW"}</dt>
          <dd>{shortDate(item.originalPurchaseDate)} · {item.photoMetadata?.priceConfirmed === false ? "Price needed" : formatCents(item.originalPriceCents)}</dd>
          {item.photoMetadata && <>
            <dt>PHOTO DETAILS</dt>
            <dd>{[item.photoMetadata.brand, item.photoMetadata.color, item.photoMetadata.material, item.photoMetadata.pattern,
              item.photoMetadata.condition.replaceAll("_", " "), item.photoMetadata.note].filter(Boolean).join(" · ")}</dd>
          </>}
          {!passed && since !== item.originalPurchaseDate && (<><dt>YOURS SINCE</dt><dd>{shortDate(since)}</dd></>)}
          <dt>STATUS</dt>
          <dd>{passed ? "PASSED ON" : STATUS_TEXT[item.status]}</dd>
        </dl>

        {passed ? (
          <p className="b-p b-muted">Now with another family. Thanks for passing it on!</p>
        ) : item.status === "pending_trade" ? (
          <div className="b-stack">
            <div className="b-row"><Chip tone="pink">TRADING</Chip>{proposal && <Chip tone="gold">{formatCents(proposal.snapshot.priceCents)}</Chip>}</div>
            {proposal && <PixelButton onClick={() => nav(`/trade/${proposal.id}`)}>OPEN TRADE</PixelButton>}
          </div>
        ) : item.status === "listed" ? (
          <div className="b-stack">
            <div className="b-row">
              <Chip tone="gold">LISTED · {listing ? formatCents(listing.priceCents) : "…"}</Chip>
              {listing && <Chip tone={listing.shared ? "mint" : "cream"}>{listing.shared ? "SHARED" : "PRIVATE"}</Chip>}
            </div>
            <PixelButton variant="ghost" disabled={busy || !listing} onClick={withdraw}>{busy ? "…" : "WITHDRAW"}</PixelButton>
          </div>
        ) : item.size === "unknown" || item.photoMetadata?.priceConfirmed === false ? (
          <p className="b-p">Saved from iMessage. Reply to your pet with the size and original price (for example, 6-9M $24) before selling.</p>
        ) : finalHome ? (
          <div className="b-final">Final home 💛 This one stays with you.</div>
        ) : (
          <div className="b-stack">
            <p className="b-p b-small">{priceRuleText(item)}</p>
            <PixelButton onClick={() => nav(`/bag/list/${item.id}`)}>SELL</PixelButton>
          </div>
        )}
      </div>
    </PixelPanel>
  );
}
