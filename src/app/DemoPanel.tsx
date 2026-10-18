// OWNER: B4. ?demo=1 — collapsible strip at the top: demo clock, reset, and (mock only) a fake encounter.
import { useEffect, useState } from "react";
import { api, USE_MOCK } from "./api";
import { mockDev } from "./api.mock";
import { errorText, useApp } from "./store";
import { shortDate } from "./format";
import { DEMO_DATES } from "../../base44/shared/seed.ts";

const CLOCK = [
  { label: "MAY 15", now: DEMO_DATES.start },
  { label: "SEP 20", now: DEMO_DATES.nudge },
  { label: "OCT 18", now: DEMO_DATES.meet },
] as const;

const SS_OPEN = "relay:demo-open";
const day = (iso: string) => iso.slice(0, 10);

export function DemoPanel() {
  const closetNow = useApp((s) => s.closet?.now);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(SS_OPEN) !== "0"; } catch { return true; } });
  const [now, setNow] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { try { sessionStorage.setItem(SS_OPEN, open ? "1" : "0"); } catch { /* ignore */ } }, [open]);
  // The date comes from the closet (no extra demoClock read: on Base44 a read also runs the nudge scan).
  useEffect(() => { if (closetNow) setNow(closetNow); }, [closetNow]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    try {
      const msg = await fn();
      await refreshCloset();
      toast(msg, "gold");
    } catch (e) {
      toast(errorText(e), "red");
    } finally {
      setBusy(null);
    }
  };

  const setClock = (label: string, iso: string) => run(label, async () => {
    const r = await api.demoClock({ now: iso });
    setNow(r.now);
    return `Clock set to ${label.charAt(0)}${label.slice(1).toLowerCase()}${r.nudgesCreated ? ` · ${r.nudgesCreated} new nudge${r.nudgesCreated > 1 ? "s" : ""}` : ""}`;
  });

  const reset = () => run("RESET", async () => {
    await api.demoReset();
    setNow(null);
    return "Demo reset. Everyone starts fresh.";
  });

  const encounter = () => run("ENCOUNTER", async () => {
    const p = await mockDev.triggerEncounter();
    return p ? `Encounter: ${p.snapshot.itemName}` : "List an item first, then try again.";
  });

  return (
    <section className="b-demo" aria-label="Demo controls">
      <div className="b-demo-head">
        <button type="button" className="b-demo-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "▼" : "▶"} DEMO{USE_MOCK ? " · MOCK" : ""}
        </button>
        <span className="b-label">{now ? shortDate(now) : "…"}</span>
      </div>
      {open && (
        <div className="b-demo-body">
          {CLOCK.map((c) => (
            <button key={c.label} type="button" disabled={!!busy}
              className={`b-demo-btn${now && day(now) === day(c.now) ? " on" : ""}`}
              onClick={() => setClock(c.label, c.now)}>
              {busy === c.label ? "…" : c.label}
            </button>
          ))}
          <button type="button" className="b-demo-btn warn" disabled={!!busy} onClick={reset}>
            {busy === "RESET" ? "…" : "RESET"}
          </button>
          {USE_MOCK && (
            <button type="button" className="b-demo-btn" disabled={!!busy} onClick={encounter}>
              {busy === "ENCOUNTER" ? "…" : "TRIGGER ENCOUNTER"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
