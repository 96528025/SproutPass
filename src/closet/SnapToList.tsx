// OWNER: B7. /bag/add — AI snap-to-list: photograph an item (or its size tag), the pet fills in the form, the
// parent checks every field and taps "Add to bag" (api.recordPurchase). The pet only suggests; nothing is saved
// until the parent says so. No camera? Pick the pixel art instead.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, USE_MOCK } from "../app/api";
import { Chip, ItemIcon, PixelButton, PixelPanel, Sprite } from "../app/ui";
import { errorText, parentRef, useApp } from "../app/store";
import { formatCents, predictOutgrow, priceFor, SIZE_ORDER } from "../app/types";
import type { Category, ClosetView, ItemPhotoGuess, SizeLabel } from "../app/types";
import { addMonthsUTC, SIZE_RANGES } from "../../base44/shared/sizes.ts";
import {
  CATEGORY_ICON, CATEGORY_LABELS, ICON_CATEGORY, ICON_LABELS, SNAP_CATEGORIES, SNAP_ICONS, iconGuess, isDemoPick,
  isSnapIcon, type SnapIcon,
} from "../../base44/shared/logic/snap.ts";
import "./snap.css";

type Phase = "pick" | "looking" | "check";
type Source = "photo" | "pixel" | "manual";

interface Form {
  name: string;
  category: Category | null;
  size: SizeLabel | null;
  icon: SnapIcon;
  price: string;   // dollars, as typed
  date: string;    // YYYY-MM-DD
}

const MAX_PRICE_CENTS = 100_000;

const dayOf = (iso: string) => iso.slice(0, 10);
const niceDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const lowerFirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "24", "24.5", "$24.99" → cents; null when it isn't a price. */
function parseCents(text: string): number | null {
  const s = text.trim().replace(/^\$\s*/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents <= MAX_PRICE_CENTS ? cents : null;
}

const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

function formFromGuess(g: ItemPhotoGuess, today: string): Form {
  const icon = isSnapIcon(g.icon) ? g.icon : g.category ? CATEGORY_ICON[g.category] : "item_tee";
  return {
    name: g.name ?? "",
    category: g.category ?? (isSnapIcon(g.icon) ? ICON_CATEGORY[g.icon] : null),
    size: g.size ?? null,
    icon,
    price: g.estimatedRetailCents ? dollars(g.estimatedRetailCents) : "",
    date: today,
  };
}

function confidenceWords(c: number | undefined): string {
  if (c == null) return "";
  if (c >= 0.75) return "Pretty sure";
  if (c >= 0.45) return "Fairly sure";
  if (c > 0) return "Just a guess";
  return "Couldn't tell";
}

/** What the pet says about the photo, in one or two plain sentences. */
function verdict(g: ItemPhotoGuess | null, source: Source): string {
  if (source === "manual" || !g) return "No problem. Fill it in below and I'll keep an eye on the size.";
  if (source === "pixel") return `You picked the ${(ICON_LABELS[g.icon as SnapIcon] ?? "item").toLowerCase()} picture. Tell me the size and what you paid.`;
  const name = g.name ? lowerFirst(g.name) : "";
  if (isDemoPick(g)) return `Here's a sample to start from: ${article(name)} ${name}${g.size ? `, size ${g.size}` : ""}. Change anything that's wrong.`;
  if (name && g.size) return `I think it's ${article(name)} ${name}, size ${g.size}.`;
  if (name) return `I think it's ${article(name)} ${name}. I couldn't read a size, so please pick one.`;
  if (g.size) return `I can read size ${g.size}, but I can't tell what the item is. Please name it.`;
  return "I couldn't make this one out. Please fill it in below.";
}

/** Fit preview: when the child grows into / out of this size, and when the pet will ask "still fit?". */
function fitLine(closet: ClosetView, size: SizeLabel, boughtIso: string): string {
  const child = closet.child;
  const pet = closet.parent.pet.name;
  if (!child) return "";
  const outgrow = predictOutgrow(size, child.birthDate, boughtIso);
  const growsInto = addMonthsUTC(child.birthDate, Math.max(0, SIZE_RANGES[size].minMonths - 1));
  const now = new Date(closet.now).getTime();
  if (new Date(outgrow).getTime() <= now) {
    return `${child.nickname} has probably outgrown ${size} already. You can still add it and pass it on.`;
  }
  if (growsInto.getTime() > now) {
    return `${child.nickname} grows into ${size} around ${niceDate(growsInto)}. ${pet} will ask "still fit?" around ${niceDate(outgrow)}.`;
  }
  return `Fits ${child.nickname} now. ${pet} will ask "still fit?" around ${niceDate(outgrow)}.`;
}

/** Where a non-AI guess came from, said plainly (the mock has no AI; the real app falls back when the AI fails). */
function notAiLine(g: ItemPhotoGuess): string {
  if (isDemoPick(g)) return "Offline demo: the AI isn't connected here, so this is a sample guess. Check every field.";
  const why = USE_MOCK ? "Offline demo: the AI isn't connected here" : "The AI couldn't look at this one";
  return g.name || g.size || g.category
    ? `${why}, so this guess comes from the file name. Check every field.`
    : `${why}, so nothing was filled in.`;
}

function Suggested({ on }: { on: boolean }) {
  return on ? <Chip tone="lav" className="snap-suggested">PET SUGGESTED</Chip> : null;
}

function Field(p: { label: string; htmlFor?: string; suggested?: boolean; children: ReactNode; help?: ReactNode }) {
  return (
    <div className="snap-field">
      <div className="snap-field-head">
        {p.htmlFor ? <label className="b-label" htmlFor={p.htmlFor}>{p.label}</label> : <span className="b-label">{p.label}</span>}
        <Suggested on={!!p.suggested} />
      </div>
      {p.children}
      {p.help && <p className="snap-help">{p.help}</p>}
    </div>
  );
}

function Meter({ value }: { value: number }) {
  const lit = Math.round(value * 5);
  return (
    <span className="snap-meter" role="img" aria-label={`${Math.round(value * 100)} percent sure`}>
      {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < lit ? "on" : undefined} />)}
    </span>
  );
}

function Steps({ phase }: { phase: Phase }) {
  const step = phase === "check" ? 1 : 0;
  return (
    <div className="b-steps" role="img" aria-label={`Step ${step + 1} of 2: ${step ? "check it" : "snap it"}`}>
      {[0, 1].map((i) => <span key={i} className={`b-dot${i === step ? " on" : i < step ? " done" : ""}`} />)}
    </div>
  );
}

export function SnapToList() {
  const nav = useNavigate();
  const closet = useApp((s) => s.closet);
  const closetStatus = useApp((s) => s.closetStatus);
  const closetError = useApp((s) => s.closetError);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const toast = useApp((s) => s.toast);

  const [phase, setPhase] = useState<Phase>("pick");
  const [source, setSource] = useState<Source>("photo");
  const [preview, setPreview] = useState<string | null>(null);   // blob: URL of the local photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(null); // uploaded URL (saved with the item)
  const [uploading, setUploading] = useState(false);
  const [guess, setGuess] = useState<ItemPhotoGuess | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [iconTouched, setIconTouched] = useState(false);
  const [showPixels, setShowPixels] = useState(false);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const run = useRef(0); // a newer photo wins over a slower older one
  const skipped = useRef(false); // "Skip, I'll fill it in": keep the upload, drop the AI answer

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { run.current += 1; }, []); // leaving the screen drops answers still in flight

  if (!closet) {
    return closetStatus === "error"
      ? <PixelPanel title="ADD AN ITEM"><div className="b-center"><p className="snap-text">{closetError}</p><PixelButton onClick={() => void refreshCloset()}>Try again</PixelButton></div></PixelPanel>
      : <div className="b-center"><Chip tone="cream">LOADING…</Chip></div>;
  }

  const pet = closet.parent.pet;
  const today = dayOf(closet.now);

  const startCheck = (g: ItemPhotoGuess | null, src: Source) => {
    setGuess(g);
    setSource(src);
    setForm(formFromGuess(g ?? { via: "template" }, today));
    setIconTouched(false);
    setPhase("check");
  };

  const onFile = async (file: File | undefined) => {
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
    if (!file) return;
    const id = ++run.current;
    skipped.current = false;
    setPreview(URL.createObjectURL(file));
    setPhotoUrl(null);
    setGuess(null);
    setSource("photo");
    setShowPixels(false);
    setPhase("looking");
    setUploading(true);
    let url: string;
    try {
      url = (await api.uploadPhoto(file)).url;
    } catch (e) {
      if (id !== run.current) return;
      setUploading(false);
      setPreview(null);
      if (!skipped.current) setPhase("pick"); // already filling it in by hand: keep the form, lose the photo
      toast(errorText(e), "red");
      return;
    }
    if (id !== run.current) return;
    setPhotoUrl(url);
    setUploading(false);
    if (skipped.current) return;
    let g: ItemPhotoGuess;
    try {
      g = await api.analyzeItemPhoto({ imageUrl: url, hint: file.name });
    } catch (e) {
      console.info("[snap] analyzeItemPhoto failed:", errorText(e));
      g = { confidence: 0, via: "template" };
    }
    if (id !== run.current || skipped.current) return;
    startCheck(g, "photo");
  };

  const pickPixel = (icon: SnapIcon) => {
    run.current += 1;
    setPreview(null);
    setPhotoUrl(null);
    startCheck(iconGuess(icon), "pixel");
    setIconTouched(true);
  };

  const fillByHand = () => {
    skipped.current = true; // the upload (if any) still finishes and is saved with the item
    startCheck(null, preview ? "photo" : "manual");
  };

  const retake = () => {
    run.current += 1;
    setPhase("pick");
    setGuess(null);
    setForm(null);
    setPreview(null);
    setPhotoUrl(null);
    setUploading(false);
  };

  const inputs = (
    <>
      <input ref={cameraRef} className="b-hidden-input" type="file" accept="image/*" capture="environment"
        aria-label="Take a photo of the item" onChange={(e) => void onFile(e.target.files?.[0])} />
      <input ref={libraryRef} className="b-hidden-input" type="file" accept="image/*"
        aria-label="Choose a photo of the item" onChange={(e) => void onFile(e.target.files?.[0])} />
    </>
  );

  const header = (
    <>
      <div className="b-row-between">
        <button type="button" className="b-link" onClick={() => nav("/bag")}>‹ BAG</button>
        <span className="b-label">ADD AN ITEM</span>
      </div>
      <Steps phase={phase} />
    </>
  );

  // ---------------------------------------------------------------- 1 · snap it
  if (phase === "pick" || phase === "looking") {
    const looking = phase === "looking";
    return (
      <>
        {header}
        {inputs}
        <PixelPanel title={looking ? `${pet.name.toUpperCase()} IS LOOKING` : "1 · SNAP IT"}>
          <div className="b-stack">
            {!looking && (
              <p className="snap-text">
                Take a photo of the item or its size tag. {pet.name} fills in the rest, then you check it.
              </p>
            )}
            <figure className="b-polaroid snap-polaroid" style={{ margin: 0 }}>
              <div className="b-polaroid-img">
                {preview
                  ? <img src={preview} alt="Your photo of the item" />
                  : <Sprite name={pet.sprite} fallback="pet_a" anim="idle" scale={5} />}
              </div>
              <figcaption className="b-polaroid-cap" aria-live="polite">
                {looking
                  ? <span className="b-spin">{uploading ? "UPLOADING…" : `${pet.name.toUpperCase()} IS LOOKING…`}</span>
                  : "NO PHOTO YET"}
              </figcaption>
            </figure>
            {looking ? (
              <>
                <div className="snap-looking">
                  <Sprite name={pet.sprite} fallback="pet_a" anim="talk" scale={3} />
                  <p className="snap-text">Reading the tag and the fabric. This takes a few seconds.</p>
                </div>
                <PixelButton variant="ghost" onClick={fillByHand}>Skip, I'll fill it in</PixelButton>
              </>
            ) : (
              <>
                <div className="b-actions">
                  <PixelButton onClick={() => cameraRef.current?.click()}>Take photo</PixelButton>
                  <PixelButton variant="ghost" onClick={() => libraryRef.current?.click()}>Choose photo</PixelButton>
                </div>
                <button type="button" className="b-link snap-link" aria-expanded={showPixels} onClick={() => setShowPixels((v) => !v)}>
                  No camera? Pick the pixel art
                </button>
                {showPixels && (
                  <div className="snap-icons" role="group" aria-label="Pick what the item looks like">
                    {SNAP_ICONS.map((icon) => (
                      <button key={icon} type="button" className="snap-icon-btn" onClick={() => pickPixel(icon)}>
                        <ItemIcon icon={icon} size={1} />
                        <span>{ICON_LABELS[icon]}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="snap-help">
                  The photo goes to the AI only to fill in this form. Nothing goes in your bag until you tap Add to bag.
                </p>
              </>
            )}
          </div>
        </PixelPanel>
      </>
    );
  }

  // ---------------------------------------------------------------- 2 · check it
  if (!form) return null;
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const fromPet = source === "photo" && !!guess;
  const same = <K extends keyof ItemPhotoGuess>(k: K, v: unknown) => fromPet && guess![k] !== undefined && guess![k] === v;

  const name = form.name.trim();
  const priceCents = parseCents(form.price);
  const boughtIso = form.date === today ? closet.now : `${form.date}T12:00:00.000Z`;
  const issues = [
    uploading && "Waiting for the photo to finish uploading…",
    !closet.child && `Add ${closet.parent.name}'s child first.`,
    !name && "Give it a name.",
    !form.category && "Pick a category.",
    !form.size && "Pick a size.",
    priceCents === null && "Enter the price new in dollars, like 24 or 24.99.",
    (!form.date || form.date > today) && "The purchase date can't be in the future.",
  ].filter(Boolean) as string[];
  const resale = priceCents ? priceFor({ ownerCount: 1, originalPriceCents: priceCents }) : null;

  const pickCategory = (c: Category) => {
    const patch: Partial<Form> = { category: c };
    if (!iconTouched && ICON_CATEGORY[form.icon] !== c) patch.icon = CATEGORY_ICON[c];
    set(patch);
  };

  const save = async () => {
    if (issues.length || saving || !form.category || !form.size || priceCents === null) return;
    setSaving(true);
    try {
      const item = await api.recordPurchase({
        ...parentRef(),
        name,
        category: form.category,
        icon: form.icon,
        size: form.size,
        originalPriceCents: priceCents,
        purchaseDate: boughtIso,
        ...(photoUrl ? { photo: photoUrl } : {}),
      });
      window.dispatchEvent(new CustomEvent("sfx", { detail: "coin" }));
      toast("Added to your bag", "mint");
      await refreshCloset();
      nav("/bag", { state: { newItemId: item.id } });
    } catch (e) {
      setSaving(false);
      toast(errorText(e), "red");
    }
  };

  const conf = guess?.confidence;
  const showConf = fromPet && conf != null;

  return (
    <>
      {header}
      {inputs}
      <PixelPanel title="2 · CHECK IT">
        <div className="b-stack">
          <div className="snap-head">
            <div className="snap-thumb">
              {preview
                ? <img src={preview} alt="Your photo of the item" />
                : <ItemIcon icon={form.icon} size={2} />}
            </div>
            <div className="snap-verdict">
              <div className="snap-says">
                <Sprite name={pet.sprite} fallback="pet_a" anim="idle" scale={2} />
                <span className="b-label">{pet.name}</span>
              </div>
              <p className="snap-bubble">{verdict(guess, source)}</p>
              {(showConf || fromPet) && (
                <div className="b-row">
                  {showConf && <Meter value={conf!} />}
                  {showConf && <span className="snap-conf">{confidenceWords(conf)}{conf! > 0 ? ` · ${Math.round(conf! * 100)}%` : ""}</span>}
                  {fromPet && <Chip tone={guess!.via === "llm" ? "lav" : "paper"}>{guess!.via === "llm" ? "AI GUESS" : isDemoPick(guess) ? "DEMO PICK" : "QUICK GUESS"}</Chip>}
                </div>
              )}
            </div>
          </div>
          {fromPet && guess!.via === "template" && <p className="snap-help">{notAiLine(guess!)}</p>}
          <PixelButton variant="ghost" small onClick={retake}>{source === "photo" && preview ? "Retake photo" : "Use a photo instead"}</PixelButton>

          <Field label="NAME" htmlFor="snap-name" suggested={same("name", name)}>
            <input id="snap-name" className="b-input snap-input" value={form.name} maxLength={60} autoComplete="off"
              placeholder="Yellow duck romper" onChange={(e) => set({ name: e.target.value })} />
          </Field>

          <Field label="CATEGORY" suggested={same("category", form.category)}>
            <div className="snap-chips" role="group" aria-label="Category">
              {SNAP_CATEGORIES.map((c) => (
                <button key={c} type="button" className="snap-opt" aria-pressed={form.category === c} onClick={() => pickCategory(c)}>
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="SIZE" suggested={same("size", form.size)}
            help={form.size ? fitLine(closet, form.size, boughtIso) : closet.child ? `${closet.child.nickname} is ${closet.childAgeMonths} months old.` : undefined}>
            <div className="snap-chips" role="group" aria-label="Size">
              {SIZE_ORDER.map((s) => (
                <button key={s} type="button" className="snap-opt" aria-pressed={form.size === s} onClick={() => set({ size: s })}>
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="PICTURE" suggested={same("icon", form.icon)}>
            <div className="snap-icons snap-icons--pick" role="group" aria-label="Picture for the bag">
              {SNAP_ICONS.map((icon) => (
                <button key={icon} type="button" className="snap-icon-btn" aria-pressed={form.icon === icon} aria-label={ICON_LABELS[icon]}
                  onClick={() => { setIconTouched(true); set({ icon }); }}>
                  <ItemIcon icon={icon} size={1} />
                </button>
              ))}
            </div>
          </Field>

          <Field label="PRICE NEW" htmlFor="snap-price" suggested={same("estimatedRetailCents", priceCents)}
            help={resale !== null
              ? `${same("estimatedRetailCents", priceCents) ? `${pet.name}'s estimate of the store price. Change it to what you paid. ` : ""}If you pass it on, the next family pays 60%: ${formatCents(resale)}.`
              : "What you paid for it new."}>
            <div className="snap-money">
              <span aria-hidden>$</span>
              <input id="snap-price" className="b-input snap-input" inputMode="decimal" value={form.price} placeholder="24"
                autoComplete="off" onChange={(e) => set({ price: e.target.value })} />
            </div>
          </Field>

          <Field label="BOUGHT ON" htmlFor="snap-date">
            <input id="snap-date" className="b-input snap-input" type="date" value={form.date} max={today}
              onChange={(e) => set({ date: e.target.value })} />
          </Field>

          {fromPet && guess!.condition && (
            <p className="snap-help">
              It looks {guess!.condition.replace("_", " ")}{guess!.note ? ` (${guess!.note.replace(/\.$/, "")})` : ""}. You'll confirm the condition when you pass it on.
            </p>
          )}

          <PixelButton block disabled={issues.length > 0 || saving} onClick={() => void save()}>
            {saving ? "Adding…" : "Add to bag"}
          </PixelButton>
          {issues.length > 0 && <p className="snap-help snap-issue" role="status">{issues[0]}</p>}
          <p className="snap-help">{pet.name} only suggests. You check it and you save it.</p>
        </div>
      </PixelPanel>
    </>
  );
}
