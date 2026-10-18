// OWNER: B4. /bag/list/:itemId — PHOTO → CONDITION → PRICE, then api.listItem.
// The price shown is display-only (priceFor); the server sets the real one.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../app/api";
import { Chip, PixelButton, PixelPanel, PriceReceipt } from "../app/ui";
import { errorCode, errorText, parentRef, useApp } from "../app/store";
import { CONDITIONS } from "../app/format";
import { formatCents, priceFor, priceRuleText } from "../app/types";
import type { ClothingItem, Condition } from "../app/types";
import { RESALE_PCT } from "../../base44/shared/pricing.ts";

const STEPS = ["PHOTO", "CONDITION", "PRICE"] as const;

function Steps({ step }: { step: number }) {
  return (
    <div className="b-steps" role="img" aria-label={`Step ${step + 1} of 3: ${STEPS[step]}`}>
      {STEPS.map((s, i) => <span key={s} className={`b-dot${i === step ? " on" : i < step ? " done" : ""}`} />)}
    </div>
  );
}

function BackToBag({ label = "‹ BAG" }: { label?: string }) {
  const nav = useNavigate();
  return <button type="button" className="b-link" onClick={() => nav("/bag")}>{label}</button>;
}

function FinalHome({ item }: { item?: ClothingItem }) {
  const nav = useNavigate();
  return (
    <PixelPanel title="FINAL HOME" tone="lav">
      <div className="b-center">
        <p className="b-p">{item ? `The ${item.name.toLowerCase()} has had its 3 owners.` : "This item has had its 3 owners."}</p>
        <p className="b-p">It stays with you now. 💛</p>
        <PixelButton variant="ghost" onClick={() => nav("/bag")}>BACK TO BAG</PixelButton>
      </div>
    </PixelPanel>
  );
}

export function ListingFlow() {
  const { itemId = "" } = useParams();
  const nav = useNavigate();
  const closet = useApp((s) => s.closet);
  const closetStatus = useApp((s) => s.closetStatus);
  const closetError = useApp((s) => s.closetError);
  const toast = useApp((s) => s.toast);
  const refreshCloset = useApp((s) => s.refreshCloset);

  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [suggested, setSuggested] = useState<Condition | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finalHome, setFinalHome] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const suggestedFor = useRef<string | null>(null);

  const item = closet?.items.find((i) => i.id === itemId);

  // Free the local preview when it's replaced or we leave.
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  // Entering CONDITION with a new photo: ask the pet for a suggestion (C's suggestCondition).
  useEffect(() => {
    if (step !== 1 || !photoUrl || suggestedFor.current === photoUrl) return;
    suggestedFor.current = photoUrl;
    let live = true;
    setSuggesting(true);
    api.suggestCondition({ imageUrl: photoUrl })
      .then((r) => {
        if (!live) return;
        setSuggested(r.condition ?? null);
        if (r.condition) setCondition((c) => c ?? r.condition!);
        if (r.note) setNote((n) => n || r.note!);
      })
      .catch(() => { if (live) setSuggested(null); })
      .finally(() => { if (live) setSuggesting(false); });
    return () => { live = false; };
  }, [step, photoUrl]);

  if (!closet) {
    return closetStatus === "error"
      ? <PixelPanel title="LIST"><div className="b-center"><p className="b-p">{closetError}</p><PixelButton onClick={() => void refreshCloset()}>TRY AGAIN</PixelButton></div></PixelPanel>
      : <div className="b-center"><Chip tone="cream">LOADING…</Chip></div>;
  }
  if (finalHome || (item && priceFor(item) === null)) return <FinalHome item={item} />;
  if (!item) {
    return (
      <PixelPanel title="NOT IN YOUR BAG">
        <div className="b-center"><p className="b-p">This item isn't in {closet.parent.name}'s bag.</p><BackToBag label="BACK TO BAG" /></div>
      </PixelPanel>
    );
  }
  if (item.status !== "in_closet" && !submitting) {
    return (
      <PixelPanel title={item.status === "listed" ? "ALREADY LISTED" : "TRADING"}>
        <div className="b-center"><p className="b-p">The {item.name.toLowerCase()} is already {item.status === "listed" ? "listed" : "in a trade"}.</p><BackToBag label="BACK TO BAG" /></div>
      </PixelPanel>
    );
  }

  const price = priceFor(item)!;
  const ownerAfter = (item.ownerCount + 1) as 2 | 3;
  const pct = Math.round(RESALE_PCT[item.ownerCount as 1 | 2] * 100); // A's PriceReceipt takes 60, not 0.6
  const fallbackPhoto = item.photos[0] ?? new URL(`/sprites/${item.icon}.png`, window.location.origin).href;
  const shownPhoto = preview ?? photoUrl;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setPhotoUrl(null);
    setUploading(true);
    try {
      const { url } = await api.uploadPhoto(file);
      setPhotoUrl(url);
    } catch (e) {
      setPreview(null);
      toast(errorText(e), "red");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const useFallback = () => { setPreview(null); setPhotoUrl(fallbackPhoto); };

  const confirm = async () => {
    if (!photoUrl || !condition || submitting) return;
    setSubmitting(true);
    try {
      const listing = await api.listItem({ ...parentRef(), itemId: item.id, photo: photoUrl, condition, conditionNote: note.trim(), shared });
      window.dispatchEvent(new CustomEvent("sfx", { detail: "coin" }));
      toast(`Listed for ${formatCents(listing.priceCents)}!`, "gold");
      void refreshCloset();
      nav("/bag");
    } catch (e) {
      setSubmitting(false);
      const code = errorCode(e);
      if (code === "not_resellable") setFinalHome(true);
      else if (code === "not_found") {
        // The demo was reset under us (new ids): reload the bag instead of leaving a dead form.
        toast("That item moved, so we refreshed your bag.", "red");
        void refreshCloset();
        nav("/bag");
      } else toast(errorText(e), "red");
    }
  };

  return (
    <>
      <div className="b-row-between">
        <BackToBag />
        <span className="b-label">LIST · {item.name}</span>
      </div>
      <Steps step={step} />

      {step === 0 && (
        <PixelPanel title="1 · PHOTO">
          <div className="b-stack">
            <input ref={fileRef} className="b-hidden-input" type="file" accept="image/*" capture="environment"
              onChange={(e) => void onFile(e.target.files?.[0])} />
            <figure className="b-polaroid" style={{ margin: 0 }}>
              <div className="b-polaroid-img">
                {shownPhoto
                  ? <img src={shownPhoto} alt={`Photo of the ${item.name.toLowerCase()}`} className={shownPhoto.includes("/sprites/") ? "pixel" : undefined} />
                  : <span className="b-label b-muted">NO PHOTO YET</span>}
              </div>
              <figcaption className="b-polaroid-cap">{uploading ? <span className="b-spin">UPLOADING…</span> : `${item.name} · ${item.size}`}</figcaption>
            </figure>
            <div className="b-actions">
              <PixelButton variant={shownPhoto ? "ghost" : "primary"} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {shownPhoto ? "RETAKE" : "TAKE PHOTO"}
              </PixelButton>
              {shownPhoto && <PixelButton disabled={!photoUrl || uploading} onClick={() => setStep(1)}>NEXT</PixelButton>}
            </div>
            {!shownPhoto && (
              <button type="button" className="b-link" onClick={useFallback}>
                {item.photos[0] ? "Use the bag photo" : "No camera? Use the pixel art"}
              </button>
            )}
          </div>
        </PixelPanel>
      )}

      {step === 1 && (
        <PixelPanel title="2 · CONDITION">
          <div className="b-stack">
            {suggesting && <Chip tone="lav"><span className="b-spin">PET IS LOOKING…</span></Chip>}
            {CONDITIONS.map((c) => (
              <button key={c.value} type="button" className="b-option" aria-pressed={condition === c.value} onClick={() => setCondition(c.value)}>
                <span className="b-row">{c.label}{suggested === c.value && <Chip tone="lav">PET SUGGESTED</Chip>}</span>
                <span className="b-stars" aria-label={`${c.stars.split("★").length - 1} of 3 stars`}>{c.stars}</span>
              </button>
            ))}
            <label className="b-stack" style={{ gap: 4 }}>
              <span className="b-label">NOTE (OPTIONAL)</span>
              <input className="b-input" value={note} maxLength={120} placeholder="tiny stain on the cuff" onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="b-actions">
              <PixelButton variant="ghost" onClick={() => setStep(0)}>BACK</PixelButton>
              <PixelButton disabled={!condition} onClick={() => setStep(2)}>NEXT</PixelButton>
            </div>
          </div>
        </PixelPanel>
      )}

      {step === 2 && (
        <PixelPanel title="3 · PRICE">
          <div className="b-stack">
            <PriceReceipt original={item.originalPriceCents} pct={pct} price={price} ownerAfter={ownerAfter} />
            <p className="b-p">{priceRuleText(item)}</p>
            <label className="b-toggle">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              <span className="b-switch" aria-hidden />
              <span className="b-stack" style={{ gap: 4 }}>
                <span className="b-label">SHARE {shared ? "ON" : "OFF"}</span>
                <span className="b-small">Only shared listings can be found by other pets.</span>
              </span>
            </label>
            <div className="b-actions">
              <PixelButton variant="ghost" disabled={submitting} onClick={() => setStep(1)}>BACK</PixelButton>
              <PixelButton disabled={submitting || !photoUrl || !condition} onClick={confirm}>
                {submitting ? "LISTING…" : `CONFIRM ${formatCents(price)}`}
              </PixelButton>
            </div>
          </div>
        </PixelPanel>
      )}
    </>
  );
}
