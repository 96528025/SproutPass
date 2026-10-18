// OWNER: B6 (trust UI). /bag/pet — "Your pet's spending rules": what this parent's pet agent may do on their
// behalf (max price a trade, a monthly budget, which kinds of clothes, whether it may propose at all) and whether
// every payment needs Face ID / a passkey. The server enforces the same rules (B5's trust.ts); this screen sets them.
// The pet can find and propose. Only the person can pay. It also shows how to text the pet on iMessage.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { errorText, parentRef, useApp } from "../app/store";
import type { Category, PetMandate as Mandate } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, PixelButton, PixelPanel, Sprite } from "../app/ui";
import { LIMITS } from "../../base44/shared/logic/trust.ts";
import { PET_COMMANDS, petLine } from "./imessageLine";
import {
  biometric, passkeySupport, PasskeyCancelled, passkeysMadeHere, registerPasskey, USE_MOCK,
} from "./passkey";
import { encodeQr, qrPath } from "./qr";
import {
  budgetBar, CATEGORY_LABELS, dollarsInput, expectedMode, isAlreadyRegistered, mandateChanges, parseDollars,
  type ApprovalMode,
} from "./trustLogic";
import { patchTrust, useTrust } from "./useTrust";
import "./trust.css";

/** What the form edits. Face ID approval isn't here: it follows the saved passkeys (see FaceIdToggle). */
interface Form {
  maxPrice: string;
  budget: string;
  categories: Category[];
  agentMayPropose: boolean;
}

const toForm = (m: Mandate): Form => ({
  maxPrice: dollarsInput(m.maxPriceCents),
  budget: dollarsInput(m.monthlyBudgetCents),
  categories: [...m.categories],
  agentMayPropose: m.agentMayPropose,
});

const MAX_PRESETS = [1000, 1500, 2500, 5000];
const BUDGET_PRESETS = [5000, 10000, 20000];

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** "October" for the demo clock's month (UTC, like every other demo date). */
const monthName = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }) : "this month";

/** "Oct 12" */
const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A money field's value in cents, or why it can't be saved. */
function money(text: string, limit: number, what: string): { cents: number | null; problem: string | null } {
  const cents = parseDollars(text);
  if (cents === null) return { cents: null, problem: `Enter ${what} above $0.` };
  if (cents > limit) return { cents: null, problem: `${what[0].toUpperCase()}${what.slice(1)} can be at most ${formatCents(limit)}.` };
  return { cents, problem: null };
}

/** Face ID / passkey set-up, shared by the toggle and the passkey panel. Saving the first passkey turns Face ID
 *  approval on (the server's rule), so the whole TrustView is reloaded afterwards. */
function usePasskeySetup() {
  const toast = useApp((s) => s.toast);
  const { trust, parentKey, reload } = useTrust();
  const [mode, setMode] = useState<ApprovalMode | null>(null);
  const [busy, setBusy] = useState(false);
  /** Passkeys this browser made (re-read after each set-up). */
  const [here, setHere] = useState<string[]>(() => passkeysMadeHere());
  useEffect(() => {
    let live = true;
    void passkeySupport().then((s) => { if (live) setMode(expectedMode(s, USE_MOCK)); });
    return () => { live = false; };
  }, []);
  useEffect(() => { setHere(passkeysMadeHere()); }, [parentKey]);
  const setUp = useCallback(async () => {
    if (busy || !parentKey || mode === "unavailable") return;
    setBusy(true);
    try {
      const { passkeys, via } = await registerPasskey();
      // The server turns Face ID approval on with the first passkey: show both at once, then confirm with a reload.
      patchTrust(parentKey, { passkeys, ...(trust ? { mandate: { ...trust.mandate, requirePasskey: true } } : {}) });
      setHere(passkeysMadeHere());
      await reload();
      toast(via === "demo" ? "Demo passkey ready · payments need it now" : `${biometric()} ready · payments need it now`, "mint");
    } catch (e) {
      if (e instanceof PasskeyCancelled) toast("Set-up cancelled · nothing changed", "lav");
      else if (isAlreadyRegistered(e)) toast("This device already has a passkey saved.", "lav");
      else toast(errorText(e), "red");
    } finally {
      setBusy(false);
    }
  }, [busy, trust, parentKey, mode, reload, toast]);
  /** "Face ID", "Windows Hello"… or "passkey" for the demo stand-in. */
  const face = mode === "demo" ? "passkey" : biometric();
  return { mode, busy, setUp, here, face };
}

export function PetMandate() {
  const closet = useApp((s) => s.closet);
  const toast = useApp((s) => s.toast);
  const nav = useNavigate();
  const { trust, error, parentKey, reload } = useTrust();
  const setup = usePasskeySetup();
  const [form, setForm] = useState<Form | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Fill the form once per parent (a later refresh, e.g. after a payment, doesn't clobber edits).
  useEffect(() => {
    if (!trust || !parentKey || loadedFor === parentKey) return;
    setLoadedFor(parentKey);
    setForm(toForm(trust.mandate));
  }, [trust, parentKey, loadedFor]);

  const pet = closet?.parent.pet ?? { name: "Your pet", sprite: "pet_a" };
  const petName = pet.name;

  if (!trust || !form) {
    return (
      <>
        <BackLink onClick={() => nav("/bag")} />
        <PixelPanel title="PET'S RULES">
          <div className="b-center">
            {error ? (
              <>
                <p className="tr-text">Your pet's rules couldn't load right now. Nothing changes until they do.</p>
                <p className="tr-text tr-muted">{error}</p>
                <PixelButton disabled={retrying} onClick={() => { setRetrying(true); void reload().finally(() => setRetrying(false)); }}>
                  {retrying ? "TRYING…" : "TRY AGAIN"}
                </PixelButton>
              </>
            ) : <Chip tone="cream">LOADING…</Chip>}
          </div>
        </PixelPanel>
        <PetImessage petName={petName} />
      </>
    );
  }

  const max = money(form.maxPrice, LIMITS.maxPriceCents, "a price");
  const budget = money(form.budget, LIMITS.monthlyBudgetCents, "a budget");
  const next: Mandate | null = max.cents !== null && budget.cents !== null
    ? { maxPriceCents: max.cents, monthlyBudgetCents: budget.cents, categories: form.categories,
        agentMayPropose: form.agentMayPropose, requirePasskey: trust.mandate.requirePasskey }
    : null;
  const changes = next ? mandateChanges(trust.mandate, next) : {};
  const dirty = Object.keys(changes).length > 0;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  async function save() {
    if (!next || !dirty || saving || !parentKey) return;
    setSaving(true);
    try {
      const saved = await api.setMandate({ ...parentRef(), mandate: changes });
      patchTrust(parentKey, { mandate: saved });
      setForm(toForm({ ...next, ...saved }));
      toast(`Saved · ${petName} will follow these rules`, "mint");
    } catch (e) {
      toast(errorText(e), "red");
    } finally {
      setSaving(false);
    }
  }

  const bar = budgetBar(trust.spentThisMonthCents, budget.cents ?? trust.mandate.monthlyBudgetCents);
  const month = monthName(closet?.now);

  return (
    <>
      <BackLink onClick={() => nav("/bag")} />

      <PixelPanel title="PET'S RULES">
        <div className="tr-stack">
          <div className="tr-hero">
            <Sprite name={pet.sprite} fallback="pet_a" anim="idle" scale={3} />
            <div className="tr-stack-tight">
              <h1 className="tr-h1">{petName}'s spending rules</h1>
              <p className="tr-text"><strong>{petName} can find and propose trades. Only you can pay.</strong></p>
            </div>
          </div>

          {/* ---- max price a trade */}
          <Field label="Max price a trade" why={`${petName} never proposes a trade above this.`}>
            <MoneyInput value={form.maxPrice} onChange={(v) => set({ maxPrice: v })} label="Max price a trade" />
            <Presets values={MAX_PRESETS} current={max.cents} onPick={(c) => set({ maxPrice: dollarsInput(c) })} />
            {max.problem && <p className="tr-warn">{max.problem}</p>}
          </Field>

          {/* ---- monthly budget + spent bar */}
          <Field label="Monthly budget" why={`When the month's budget is used up, ${petName} stops proposing until next month.`}>
            <MoneyInput value={form.budget} onChange={(v) => set({ budget: v })} label="Monthly budget" />
            <Presets values={BUDGET_PRESETS} current={budget.cents} onPick={(c) => set({ budget: dollarsInput(c) })} />
            {budget.problem && <p className="tr-warn">{budget.problem}</p>}
            <div className="tr-bar-wrap">
              <div className={bar.over ? "tr-bar tr-bar-over" : "tr-bar"} role="meter" aria-label={`Spent in ${month}`}
                aria-valuemin={0} aria-valuemax={budget.cents ?? trust.mandate.monthlyBudgetCents} aria-valuenow={trust.spentThisMonthCents}>
                {Array.from({ length: bar.cells }, (_, i) => <i key={i} className={i < bar.filled ? "on" : ""} />)}
              </div>
              <p className="tr-text">
                {formatCents(trust.spentThisMonthCents)} spent in {month} · {formatCents(bar.leftCents)} left
              </p>
            </div>
            {max.cents !== null && budget.cents !== null && max.cents > budget.cents && (
              <p className="tr-warn">One trade can't go over the monthly budget, so {petName} stops at {formatCents(budget.cents)}.</p>
            )}
          </Field>

          {/* ---- kinds of clothes */}
          <Field label="Kinds of clothes" why={`${petName} only proposes these kinds. None picked means any kind.`}>
            <div className="b-row" role="group" aria-label="Kinds of clothes">
              {CATEGORY_LABELS.map((c) => {
                const on = form.categories.includes(c.value);
                return (
                  <button key={c.value} type="button" className="b-chip-btn" aria-pressed={on}
                    onClick={() => set({ categories: toggle(form.categories, c.value) })}>
                    <Chip tone={on ? "gold" : "cream"}>{on ? `✓ ${c.label}` : c.label}</Chip>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* ---- may the pet propose at all */}
          <Toggle on={form.agentMayPropose} onChange={(v) => set({ agentMayPropose: v })}
            label="Pet may propose trades"
            why={form.agentMayPropose
              ? `${petName} proposes a trade when another pet has a fit. Only the buyer approves. Payment is simulated.`
              : `${petName} only tells you about a fit. It never proposes one for you.`} />

          <div className="b-actions">
            <PixelButton disabled={!next || !dirty || saving} onClick={() => void save()}>
              {saving ? "SAVING…" : dirty ? "SAVE RULES" : "SAVED ✓"}
            </PixelButton>
          </div>
        </div>
      </PixelPanel>

      <PixelPanel title={`${setup.face.toUpperCase()} TO PAY`} tone="cream">
        <div className="tr-stack">
          <FaceIdToggle on={trust.mandate.requirePasskey} hasPasskey={trust.passkeys.length > 0} setup={setup} />
          <PasskeyList keys={trust.passkeys} setup={setup} />
        </div>
      </PixelPanel>

      <PetImessage petName={petName} />

      <div className="tr-footer">
        <Chip tone="cream" plain>Demo payment · no real charge</Chip>
        <p className="tr-text">Only the buyer approves the final trade. Payment is simulated.</p>
      </div>
    </>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <div className="b-row-between">
      <button type="button" className="b-link" onClick={onClick}>‹ BAG</button>
    </div>
  );
}

function Field({ label, why, children }: { label: string; why: string; children: ReactNode }) {
  return (
    <div className="tr-field">
      <span className="tr-label">{label}</span>
      {children}
      <p className="tr-why">{why}</p>
    </div>
  );
}

function MoneyInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="tr-money">
      <span className="tr-money-sign" aria-hidden>$</span>
      <input className="b-input tr-money-input" inputMode="decimal" aria-label={label} value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
    </div>
  );
}

function Presets({ values, current, onPick }: { values: number[]; current: number | null; onPick: (cents: number) => void }) {
  return (
    <div className="b-row">
      {values.map((c) => (
        <button key={c} type="button" className="b-chip-btn" aria-pressed={current === c} aria-label={`$${c / 100}`}
          onClick={() => onPick(c)}>
          <Chip tone={current === c ? "gold" : "cream"}>${c / 100}</Chip>
        </button>
      ))}
    </div>
  );
}

/** A switch with its label in the readable face and the state as its own On / Off chip. */
function Toggle({ on, onChange, label, why, disabled }: {
  on: boolean; onChange: (v: boolean) => void; label: string; why: string; disabled?: boolean;
}) {
  return (
    <label className={disabled ? "b-toggle tr-toggle tr-toggle-locked" : "b-toggle tr-toggle"}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="b-switch" aria-hidden />
      <span className="tr-stack-tight">
        <span className="tr-toggle-head">
          <span className="tr-toggle-label">{label}</span>
          <Chip tone={on ? "mint" : "cream"}>{on ? "On" : "Off"}</Chip>
        </span>
        <span className="tr-why">{why}</span>
      </span>
    </label>
  );
}

type Setup = ReturnType<typeof usePasskeySetup>;

/**
 * "Require Face ID to pay". The server keeps it on whenever a passkey is saved, so: off → turning it on sets up
 * Face ID right away; on → locked on, and it says why. The bold line always says what is true right now.
 */
function FaceIdToggle({ on, hasPasskey, setup }: { on: boolean; hasPasskey: boolean; setup: Setup }) {
  const demo = setup.mode === "demo";
  const face = setup.face;
  const what = demo ? "your passkey" : "your face or fingerprint";
  const where = demo ? "browser" : "device";
  const locked = on && hasPasskey;
  return (
    <>
      <p className="tr-text">
        <strong>
          {!on
            ? `Right now a tap on Pay is enough. Turn this on so every payment needs ${what}.`
            : demo
              ? "Every payment needs your approval with the demo passkey first. Here it's a stand-in; on a phone it is your face or fingerprint, so nobody else can pay, not even your pet."
              : `Every payment needs ${what} on this ${where}, so nobody else can pay with it, not even your pet.`}
        </strong>
      </p>
      <Toggle on={on} disabled={locked || setup.busy || setup.mode === "unavailable"}
        onChange={(v) => { if (v) void setup.setUp(); }}
        label={`Require ${face} to pay`}
        why={locked
          ? `Stays on while a passkey is saved: you approve each payment with ${demo ? "your passkey" : face}. Remove your passkeys below to turn it off.`
          : setup.busy ? `Setting up ${demo ? "a demo passkey" : face}…`
          : setup.mode === "unavailable" ? "This browser can't make a passkey. Open the app on your phone to turn this on."
          : `Turn it on to set up ${demo ? "a demo passkey" : face} on this ${where}.`} />
    </>
  );
}

function PasskeyList({ keys, setup }: { keys: { id: string; createdAt: string; label: string }[]; setup: Setup }) {
  const toast = useApp((s) => s.toast);
  const { parentKey, reload } = useTrust();
  const [removing, setRemoving] = useState<string | null>(null);
  const sorted = useMemo(() => [...keys].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [keys]);
  const hereIds = new Set(setup.here);
  const thisDeviceSaved = sorted.some((k) => hereIds.has(k.id));
  /** Forget one passkey on the server. The last one gone turns Face ID approval off (the server's rule). */
  const remove = async (k: { id: string; label: string }) => {
    if (removing || setup.busy || !parentKey) return;
    setRemoving(k.id);
    try {
      const view = await api.passkeyRemove({ ...parentRef(), passkeyId: k.id });
      patchTrust(parentKey, view);
      await reload();
      toast(view.passkeys.length ? `${k.label || "Passkey"} removed` : "Passkey removed · a tap on Pay is enough now", "lav");
    } catch (e) {
      toast(errorText(e), "red");
    } finally {
      setRemoving(null);
    }
  };
  return (
    <div className="tr-field">
      <span className="tr-label">Your passkeys</span>
      <p className="tr-why">
        Your face or fingerprint never leaves your phone or computer. We only keep a public key that proves it was you.
      </p>
      {sorted.length > 0 ? (
        <ul className="tr-keys" aria-label="Your passkeys">
          {sorted.map((k) => (
            <li key={k.id} className="tr-key">
              <span className="tr-text">{k.label || "Passkey"}</span>
              {hereIds.has(k.id) && <Chip tone="mint">This device</Chip>}
              <span className="tr-muted tr-text">added {shortDay(k.createdAt)}</span>
              <button type="button" className="b-link tr-key-remove" aria-label={`Remove ${k.label || "passkey"}`}
                disabled={!!removing || setup.busy} onClick={() => void remove(k)}>
                {removing === k.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tr-text tr-muted">No passkey yet.</p>
      )}
      {setup.mode === "unavailable" ? (
        <p className="tr-warn">This browser can't make a passkey. Open the app on your phone to set one up.</p>
      ) : thisDeviceSaved ? (
        <p className="tr-why">This device is set up. To pay from another phone or computer, open the app there and add it.</p>
      ) : (
        <>
          {setup.mode === "demo" && (
            <p className="tr-why">This browser has no built-in passkey, so the demo makes a stand-in. No real biometrics are used.</p>
          )}
          {sorted.length > 0 && (
            <p className="tr-why">Paying from this {setup.mode === "demo" ? "browser" : "device"} too? Add it here.</p>
          )}
          <PixelButton variant={sorted.length ? "ghost" : "primary"} disabled={setup.busy || !setup.mode} onClick={() => void setup.setUp()}>
            {setup.busy ? "SETTING UP…" : sorted.length ? "ADD THIS DEVICE" : `SET UP ${(setup.mode === "demo" ? "demo passkey" : setup.face).toUpperCase()}`}
          </PixelButton>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the pet in iMessage (Photon)

/**
 * "Text Pip on iMessage": the pet's own number (a Photon line, never the parent's phone), a tap-to-text link, a QR
 * code for someone on a laptop, whether the line is connected, and what to text. A shared iMessage line can't
 * send the first message, so the parent texts "hi" once and the pet can reply from then on.
 */
function PetImessage({ petName }: { petName: string }) {
  const closet = useApp((s) => s.closet);
  const parentKey = useApp((s) => s.parentKey);
  const line = useMemo(
    () => petLine(parentKey, closet, import.meta.env.VITE_PET_LINES as string | undefined),
    [parentKey, closet],
  );
  const qr = useMemo(() => {
    if (!line) return null;
    try {
      const q = encodeQr(line.qrText);
      return { path: qrPath(q), box: q.size + 8 };
    } catch {
      return null;
    }
  }, [line]);

  return (
    <PixelPanel title={`TEXT ${petName.toUpperCase()}`} tone="lav">
      <div className="tr-stack">
        <p className="tr-text">
          <strong>{petName} also lives in iMessage.</strong> Text it to pass something on, check on a trade or say
          yes to one, without opening the app.
        </p>

        {line ? (
          <div className="tr-imsg">
            <div className="tr-stack-tight tr-imsg-main">
              <span className="tr-label">{petName}'s number</span>
              <a className="tr-imsg-link" href={line.smsHref}>
                <span className="tr-imsg-num">{line.display}</span>
                <span>Text {petName} “hi”</span>
              </a>
              {line.connected === true ? (
                <p className="tr-text"><Chip tone="mint">Connected ✓</Chip> {petName} texts you from this number.</p>
              ) : (
                <p className="tr-why">
                  {line.connected === false && <Chip tone="cream">Not connected yet</Chip>}{" "}
                  {line.connected === false ? "Text" : "First time? Text"} “hi” once to connect. An iMessage line can't
                  text you first, so {petName} waits for your hello.
                </p>
              )}
            </div>
            {qr && (
              <figure className="tr-qr">
                <svg viewBox={`0 0 ${qr.box} ${qr.box}`} role="img" aria-label={`QR code: text ${petName} at ${line.display}`}
                  shapeRendering="crispEdges">
                  <rect width={qr.box} height={qr.box} fill="#fff" />
                  <path d={qr.path} fill="#000" />
                </svg>
                <figcaption className="tr-why">On a laptop? Scan with your phone's camera.</figcaption>
              </figure>
            )}
          </div>
        ) : (
          <p className="tr-why tr-why-warn">
            {USE_MOCK
              ? `This local demo isn't connected to iMessage, so there's no number to text here. On the live app, ${petName}'s number shows here once it's set up.`
              : `${petName}'s iMessage number isn't set up on this app yet. Ask the person running the demo for it.`}
          </p>
        )}

        <div className="tr-field">
          <span className="tr-label">What you can text</span>
          <dl className="tr-cmds">
            {PET_COMMANDS.map((c) => (
              <div key={c.say} className="tr-cmd">
                <dt><code>{c.say}</code></dt>
                <dd>{c.does}</dd>
              </div>
            ))}
          </dl>
          <p className="tr-why">
            {petName} never decides or pays for you: only the buyer approves a trade, then the simulated payment completes automatically.
            Your phone number stays private; the other parent never sees it.
          </p>
        </div>
      </div>
    </PixelPanel>
  );
}
