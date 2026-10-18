// /kit — every A1 component with every variant, plus palette, fonts and a sound test.
import { useState, type ReactNode } from "react";
import { PixelPanel } from "@/pixel/components/PixelPanel";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { Hearts } from "@/pixel/components/Hearts";
import { FitBar } from "@/pixel/components/FitBar";
import { PriceReceipt } from "@/pixel/components/PriceReceipt";
import { DialogBox } from "@/pixel/components/DialogBox";
import { Modal } from "@/pixel/components/Modal";
import { Toast, type ToastTone } from "@/pixel/components/Toast";
import { sfx, useSfx, type SfxName } from "@/pixel/sfx";
import { Sprite, ItemIcon } from "@/mocks/a1";

const PALETTE = [
  "ink", "paper", "cream", "grass", "grass-dark", "path", "sky", "peach", "pink", "gold", "lav", "red", "mint",
];
const SOUNDS: SfxName[] = ["start", "blip", "alert", "select", "accept", "decline", "coin", "jingle", "step"];

function Section({ name, props, children }: { name: string; props: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 className="px-label-16" style={{ color: "var(--paper)", marginBottom: 4 }}>{name}</h2>
      <p className="px-label-12" style={{ color: "var(--cream)", marginBottom: 12, opacity: 0.9 }}>{props}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>;
}

export function KitPage() {
  const { muted, unlocked, toggle } = useSfx();
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: ToastTone; n: number } | null>(null);
  const [dialogLog, setDialogLog] = useState("—");
  const [dlgKey, setDlgKey] = useState(0);

  const showToast = (text: string, tone: ToastTone) => setToast({ text, tone, n: Date.now() });

  return (
    <main style={{ maxWidth: 430, margin: "0 auto", padding: "16px 16px 96px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 className="font-wordmark" style={{ fontSize: 16, lineHeight: "24px", color: "var(--gold)", textShadow: "4px 4px 0 var(--ink)" }}>
          PIXEL KIT
        </h1>
        <p className="px-ui-16" style={{ color: "var(--paper)", marginTop: 4 }}>
          Hand-Me-Down Relay · A1 components. Tap once to unlock sound.
        </p>
        <Row>
          <Chip tone={unlocked ? "mint" : "red"}>{unlocked ? "AUDIO UNLOCKED" : "AUDIO LOCKED"}</Chip>
          <PixelButton small variant="ghost" onClick={() => void sfx.unlock()}>Unlock</PixelButton>
          <PixelButton small variant="ghost" silent onClick={toggle}>{muted ? "Unmute" : "Mute"}</PixelButton>
        </Row>
      </header>

      <Section name="Palette" props="tokens.css · add colours only through A">
        <Row>
          {PALETTE.map((c) => (
            <div key={c} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ width: 40, height: 40, background: `var(--${c})`, border: "4px solid var(--ink)" }} />
              <span className="px-label-12" style={{ color: "var(--paper)" }}>{c}</span>
            </div>
          ))}
        </Row>
      </Section>

      <Section name="Type" props="Pixelify Sans 16/20/24 · Silkscreen 12/16 · Press Start 2P (wordmark only)">
        <PixelPanel>
          <p className="px-ui-24">Does this still fit?</p>
          <p className="px-ui-20">Want to pass it on?</p>
          <p className="px-ui-16">The yellow duck romper (6-9M) is probably getting snug.</p>
          <p className="px-label-16" style={{ marginTop: 8 }}>Silkscreen 16 · $18.00</p>
          <p className="px-label-12">Silkscreen 12 · GPS ±12M · 2ND OWNER PAYS 60%</p>
          <p className="font-wordmark" style={{ fontSize: 12, lineHeight: "20px", marginTop: 8 }}>PRESS START 2P</p>
        </PixelPanel>
      </Section>

      <Section name="PixelPanel" props='title? · tone?: "paper" | "cream" | "lav" | "ink" · flat?'>
        <PixelPanel>Paper (default). 4px ink outline, stepped corners, hard shadow.</PixelPanel>
        <PixelPanel tone="cream" title="Cream + title">Cream panel with a title tab.</PixelPanel>
        <PixelPanel tone="lav" title="Pet says">Lav is the agent / pet colour.</PixelPanel>
        <PixelPanel tone="ink" title="Ink">Ink tone for banners.</PixelPanel>
        <PixelPanel tone="cream" title="Nested">
          <PixelPanel flat>A flat (no shadow) panel inside another.</PixelPanel>
        </PixelPanel>
      </Section>

      <Section name="PixelButton" props='variant: "primary" | "ghost" | "danger" · icon? · small? · block? · pressed? · disabled · onClick (plays "select")'>
        <Row>
          <PixelButton onClick={() => showToast("PRIMARY TAPPED", "gold")}>Accept</PixelButton>
          <PixelButton variant="ghost" onClick={() => showToast("GHOST TAPPED", "paper")}>Later</PixelButton>
          <PixelButton variant="danger" onClick={() => showToast("DANGER TAPPED", "red")}>Decline</PixelButton>
        </Row>
        <Row>
          <PixelButton icon={<span>★</span>}>With icon</PixelButton>
          <PixelButton small>Small</PixelButton>
          <PixelButton small variant="ghost" pressed>Pressed</PixelButton>
          <PixelButton disabled>Disabled</PixelButton>
        </Row>
        <PixelButton block onClick={() => sfx.play("coin")}>Pay · demo payment · no real charge</PixelButton>
      </Section>

      <Section name="Chip" props='tone: "ink" | "gold" | "red" | "mint" | "lav" | "sky" | "paper" | "pink"'>
        <Row>
          <Chip tone="mint">GPS ±12M</Chip>
          <Chip tone="gold">WEAK GPS — STEP OUTSIDE</Chip>
          <Chip tone="red">NO GPS</Chip>
          <Chip tone="lav">SIMULATED GPS</Chip>
          <Chip tone="ink">DEMO PAYMENT</Chip>
          <Chip tone="sky">&lt;25 M</Chip>
          <Chip tone="paper">LISTED</Chip>
          <Chip tone="pink">PET SUGGESTED</Chip>
        </Row>
      </Section>

      <Section name="Hearts" props="filled: 1 | 2 | 3 · of? (default 3)">
        <PixelPanel>
          <Row>
            <Hearts filled={1} /> <span className="px-label-12">1ST OWNER</span>
          </Row>
          <Row>
            <Hearts filled={2} /> <span className="px-label-12">2ND OWNER</span>
          </Row>
          <Row>
            <Hearts filled={3} /> <span className="px-label-12">FINAL HOME</span>
          </Row>
        </PixelPanel>
      </Section>

      <Section name="FitBar" props="until · now · from? (default now − 120 d) · green → gold within 14 d → red past">
        <PixelPanel>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FitBar until="2026-08-27" now="2026-05-20" from="2026-05-15" />
            <FitBar until="2026-08-27" now="2026-08-20" from="2026-05-15" />
            <FitBar until="2026-08-27" now="2026-09-20" from="2026-05-15" />
            <FitBar until="2026-11-17" now="2026-10-18" />
          </div>
        </PixelPanel>
      </Section>

      <Section name="PriceReceipt" props="original · pct · price (all cents, from the backend) · ownerAfter: 2 | 3 · stamp?">
        <PriceReceipt original={3000} pct={60} price={1800} ownerAfter={2} />
        <PriceReceipt original={3000} pct={40} price={1200} ownerAfter={3} stamp="DEMO PAYMENT · NO REAL CHARGE" />
      </Section>

      <Section name="ItemIcon · Sprite (A2 stubs)" props="icon · size: 1 | 2 — name · anim · scale · facing">
        <PixelPanel>
          <Row>
            <ItemIcon icon="item_romper" size={1} />
            <ItemIcon icon="item_onesie" size={2} />
            <Sprite name="parent_a" scale={3} />
            <Sprite name="pet_b" scale={3} facing="left" />
          </Row>
        </PixelPanel>
      </Section>

      <Section name="DialogBox" props="speaker · lines · choices? · onDone?(value) · portrait? · inline? · speed? — tap: reveal / next · ↑↓ Enter">
        <p className="px-label-12" style={{ color: "var(--paper)" }}>LAST RESULT: {dialogLog}</p>
        <DialogBox
          key={dlgKey}
          inline
          speaker={{ name: "Button", sprite: "pet_a" }}
          portrait={<Sprite name="pet_a" scale={3} />}
          lines={[
            "The yellow duck romper (6-9M) is probably getting snug.",
            "Still fit? Want to pass it on?",
          ]}
          choices={[
            { label: "Sell it", value: "sell" },
            { label: "Keep", value: "keep" },
            { label: "Ask me later", value: "later" },
          ]}
          onDone={(v) => {
            setDialogLog(v ?? "done");
            showToast(`CHOSE ${String(v ?? "done")}`, "lav");
          }}
        />
        <Row>
          <PixelButton small variant="ghost" onClick={() => setDlgKey((k) => k + 1)}>Replay dialog</PixelButton>
        </Row>
      </Section>

      <Section name="Modal" props="title · children · open? · onClose? · tone? · noClose?">
        <Row>
          <PixelButton variant="ghost" onClick={() => setModal(true)}>Open modal</PixelButton>
        </Row>
        <Modal title="Trade proposal" open={modal} onClose={() => setModal(false)}>
          <p className="px-ui-20" style={{ marginBottom: 12 }}>Nothing is charged until you both accept.</p>
          <Row>
            <PixelButton onClick={() => { sfx.play("accept"); setModal(false); }}>Accept</PixelButton>
            <PixelButton variant="danger" onClick={() => { sfx.play("decline"); setModal(false); }}>Decline</PixelButton>
          </Row>
        </Modal>
      </Section>

      <Section name="Toast" props='text · tone · duration? (2400) · onHide? — slides in 4px steps'>
        <Row>
          <PixelButton small variant="ghost" onClick={() => showToast("LISTED!", "gold")}>Gold</PixelButton>
          <PixelButton small variant="ghost" onClick={() => showToast("KEEP THIS SCREEN OPEN WHILE YOU WALK", "ink")}>Ink</PixelButton>
          <PixelButton small variant="ghost" onClick={() => showToast("PAYMENT FAILED", "red")}>Red</PixelButton>
          <PixelButton small variant="ghost" onClick={() => showToast("TRADE COMPLETE", "mint")}>Mint</PixelButton>
        </Row>
        {toast && <Toast key={toast.n} text={toast.text} tone={toast.tone} onHide={() => setToast(null)} />}
      </Section>

      <Section name="Sound test" props="sfx.play(name) · files from A2 in public/sfx/<name>.wav · silent if missing">
        <Row>
          {SOUNDS.map((s) => (
            <PixelButton key={s} small variant="ghost" silent onClick={() => { void sfx.unlock(); sfx.play(s); }}>
              {s}
            </PixelButton>
          ))}
        </Row>
      </Section>
    </main>
  );
}
