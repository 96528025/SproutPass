// OWNER: B4. /bag/needs — what this family is looking for. The pet only tells other pets what's shared.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { Chip, PixelButton, PixelPanel } from "../app/ui";
import { errorText, parentRef, useApp } from "../app/store";
import { SIZE_ORDER } from "../app/types";
import type { Category, Need, SizeLabel } from "../app/types";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "top", label: "TOPS" }, { value: "bottom", label: "BOTTOMS" }, { value: "onesie", label: "ONESIES" },
  { value: "outerwear", label: "OUTERWEAR" }, { value: "dress", label: "DRESSES" }, { value: "set", label: "SETS" },
  { value: "other", label: "OTHER" },
];

function ToggleChip(p: { on: boolean; onToggle: () => void; children: string }) {
  return (
    <button type="button" className="b-chip-btn" aria-pressed={p.on} onClick={p.onToggle}>
      <Chip tone={p.on ? "gold" : "cream"}>{p.on ? `✓ ${p.children}` : p.children}</Chip>
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function NeedsScreen() {
  const closet = useApp((s) => s.closet);
  const closetStatus = useApp((s) => s.closetStatus);
  const closetError = useApp((s) => s.closetError);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const toast = useApp((s) => s.toast);
  const nav = useNavigate();

  const [needId, setNeedId] = useState<string | undefined>();
  const [sizes, setSizes] = useState<SizeLabel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [maxPrice, setMaxPrice] = useState("");
  const [shared, setShared] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = (n: Need | undefined) => {
    setNeedId(n?.id);
    setSizes(n?.sizes ?? []);
    setCategories(n?.categories ?? []);
    setMaxPrice(n?.maxPriceCents != null ? (n.maxPriceCents / 100).toFixed(2) : "");
    setShared(n?.shared ?? true);
  };

  // Fill the form once per parent from their first need (live refreshes don't clobber edits).
  useEffect(() => {
    if (!closet || loadedFor === closet.parent.id) return;
    setLoadedFor(closet.parent.id);
    load(closet.needs[0]);
  }, [closet, loadedFor]);

  if (!closet) {
    return closetStatus === "error"
      ? (
        <PixelPanel title="NEEDS">
          <div className="b-center">
            <p className="b-p">Couldn't open your needs.</p>
            <p className="b-p b-small b-muted">{closetError}</p>
            <PixelButton onClick={() => void refreshCloset()}>TRY AGAIN</PixelButton>
          </div>
        </PixelPanel>
      )
      : <div className="b-center"><Chip tone="cream">LOADING…</Chip></div>;
  }

  const priceCents = maxPrice.trim() === "" ? undefined : Math.round(Number(maxPrice) * 100);
  const priceBad = priceCents !== undefined && (!Number.isFinite(priceCents) || priceCents < 0);
  const ordered = SIZE_ORDER.filter((s) => sizes.includes(s));

  const save = async () => {
    if (!ordered.length || priceBad || saving) return;
    setSaving(true);
    try {
      const need = await api.upsertNeed({
        ...parentRef(), needId, sizes: ordered, categories: categories.length ? categories : undefined,
        maxPriceCents: priceCents, shared,
      });
      setNeedId(need.id);
      toast(shared ? "Saved. Your pet will ask around." : "Saved and kept private.", "mint");
      await refreshCloset();
      nav("/bag");
    } catch (e) {
      toast(errorText(e), "red");
    } finally {
      setSaving(false);
    }
  };

  const child = closet.child?.nickname ?? "your little one";

  return (
    <>
      <div className="b-row-between">
        <button type="button" className="b-link" onClick={() => nav("/bag")}>‹ BAG</button>
        {closet.needs.length > 1 && (
          <span className="b-row">
            {closet.needs.map((n, i) => (
              <button key={n.id} type="button" className="b-chip-btn" aria-pressed={n.id === needId} onClick={() => load(n)}>
                <Chip tone={n.id === needId ? "gold" : "cream"}>NEED {i + 1}</Chip>
              </button>
            ))}
          </span>
        )}
      </div>

      <PixelPanel title={needId ? "WHAT WE NEED" : "NEW NEED"}>
        <div className="b-stack">
          <p className="b-p">Tell your pet what {child} needs next.</p>

          <div className="b-stack" style={{ gap: 8 }}>
            <span className="b-label">SIZES</span>
            <div className="b-row" role="group" aria-label="Sizes">
              {SIZE_ORDER.map((s) => <ToggleChip key={s} on={sizes.includes(s)} onToggle={() => setSizes(toggle(sizes, s))}>{s}</ToggleChip>)}
            </div>
            {!ordered.length && <span className="b-small b-muted">Pick at least one size.</span>}
          </div>

          <div className="b-stack" style={{ gap: 8 }}>
            <span className="b-label">KINDS (OPTIONAL)</span>
            <div className="b-row" role="group" aria-label="Kinds of clothing">
              {CATEGORIES.map((c) => <ToggleChip key={c.value} on={categories.includes(c.value)} onToggle={() => setCategories(toggle(categories, c.value))}>{c.label}</ToggleChip>)}
            </div>
          </div>

          <label className="b-stack" style={{ gap: 4 }}>
            <span className="b-label">MAX PRICE (OPTIONAL)</span>
            <input className="b-input" inputMode="decimal" placeholder="$ any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
            {priceBad && <span className="b-small">That price doesn't look right.</span>}
          </label>

          <label className="b-toggle">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span className="b-switch" aria-hidden />
            <span className="b-stack" style={{ gap: 4 }}>
              <span className="b-label">SHARE {shared ? "ON" : "OFF"}</span>
              <span className="b-small">Your pet only tells other pets what's shared.</span>
            </span>
          </label>

          <div className="b-actions">
            {needId && <PixelButton variant="ghost" onClick={() => load(undefined)}>NEW NEED</PixelButton>}
            <PixelButton disabled={!ordered.length || priceBad || saving} onClick={save}>{saving ? "SAVING…" : "SAVE"}</PixelButton>
          </div>
        </div>
      </PixelPanel>
    </>
  );
}
