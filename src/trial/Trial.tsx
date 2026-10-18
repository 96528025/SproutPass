import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "../api/base44Client";
import { PixelButton, PixelPanel } from "../app/ui";
import type { TrialView } from "../../base44/shared/trial";
import { trialCall } from "./client";
import "./trial.css";

export function Trial() {
  const [data, setData] = useState<TrialView | null>(null);
  const [itemId, setItemId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++seq.current; setBusy(true);
    try { const d = await trialCall<TrialView>("trialStatus", { itemId }); if (n === seq.current) { setData(d); setError(""); } }
    catch { if (n === seq.current) setError("Couldn't refresh progress. The last snapshot may be out of date. Try again."); }
    finally { if (n === seq.current) setBusy(false); }
  }, [itemId]);
  useEffect(() => {
    void refresh(); let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 2000); };
    const stops = ["ClothingItem", "Need", "Listing", "MatchProposal", "PetLine", "Parent"].map(name => base44.entities[name].subscribe(changed));
    return () => { ++seq.current; clearTimeout(timer); stops.forEach(stop => stop()); };
  }, [refresh]);
  async function prepare(makeOffer: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await trialCall<{ itemId: string }>("prepareTrial", { makeOffer });
      if (r.itemId !== itemId) setItemId(r.itemId);
      else await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't prepare the sample. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="sp-trial">
    <h1>SproutPass demo guide</h1>
    <p>A staged children’s-clothing demo. Freja shares a sample, Olivia needs it, and only Olivia approves.</p>
    <p className="sp-muted">Progress comes from saved Base44 records. Payment is simulated. The demo walk uses simulated location. Preparing the sample adds a labeled garment and shared need. Nothing is purchased until Olivia approves; no real money moves.</p>
    <p><b>iMessage stays real in demo mode.</b> Both connected phones receive the final offer with the garment image. After the buyer approves, both receive the simulated-payment receipt and garment image.</p>
    <div className="sp-actions"><PixelButton small disabled={busy} onClick={() => void refresh()}>{busy ? "REFRESHING…" : "REFRESH PROGRESS"}</PixelButton><Link to="/feedback">Give feedback</Link></div>
    <PixelPanel title="PLAY THE FULL JOURNEY">
      <ol>
        <li><b>Meet:</b> open Olivia’s world, choose Freja, and tap Walk. Simulated movement brings the families together.</li>
        <li><b>Agents:</b> watch their pets check the shared item, need, size, and price. The Agents tab shows the conversation and outcome.</li>
        <li><b>Offer:</b> when there is a match, review the garment and final price. Only Olivia, the buyer, approves or declines.</li>
        <li><b>Payment & receipt:</b> approval starts the Visa simulation and transfers ownership. Check the receipt and both iMessage threads.</li>
        <li><b>Feedback:</b> share what worked, what confused you, and whether it saved effort.</li>
      </ol>
      <div className="sp-actions"><Link to="/world?as=jo&demo=1&walk=sam">ENTER DEMO WORLD →</Link><Link to="/agents?as=jo&demo=1">Watch agent negotiation</Link></div>
      <p className="sp-muted">If the agents find no compatible item, they explain why and stop without payment. This walkthrough uses saved inventory and needs; it does not force a match.</p>
    </PixelPanel>
    <PixelPanel title="QUICK DEMO SETUP">
      <p>Create a sample duck romper in Freja’s inventory and a compatible need for Olivia. Original price $30; demo resale price $18. The sample uses an illustration, not a real garment photo.</p>
      <PixelButton disabled={busy} onClick={() => void prepare(false)}>PREPARE SAMPLE + NEED</PixelButton>
      {data?.item?.trialSample && !data.proposal && <details><summary>Skip the walk and prepare an offer</summary><p>This shortcut creates a staged offer directly; it does not demonstrate a meeting or agent negotiation.</p><PixelButton disabled={busy} onClick={() => void prepare(true)}>CREATE DEMO OFFER</PixelButton></details>}
      <p className="sp-muted">After setup, use the Meet tab to enter the original demo world. Existing inventories are preserved.</p>
    </PixelPanel>
    {error && <p role="alert">{error}</p>}
    <PixelPanel title="CONNECT BOTH PHONES">
      <p>Freja: text <b>hi</b> to <a href="sms:+16283166196">+1 (628) 316-6196</a>.</p>
      <p>Olivia: text <b>hi</b> to <a href="sms:+16283167976">+1 (628) 316-7976</a>.</p>
      {data?.families.map(p => <p key={p.name}>{p.connected ? "✓" : "○"} {p.name}: {p.connected ? "message connection saved" : "waiting for first message"}</p>)}
      <p className="sp-muted">Use two private iMessage threads. Family group chat needs a dedicated Photon line.</p>
    </PixelPanel>
    {data && <>
      <label className="sp-select">Choose Freja’s garment<select value={itemId || data.item?.id || ""} onChange={e => setItemId(e.target.value)}><option value="">{data.garments.length ? "Latest garment" : "No garment yet"}</option>{data.garments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      {data.item && <PixelPanel title={data.item.trialSample ? "STAGED SAMPLE · ILLUSTRATION" : "UPLOADED GARMENT"}><img className="sp-garment" src={data.item.photos[0]} alt={data.item.name} /><h2>{data.item.name}</h2><p>{data.item.category} · {data.item.size} · original price ${(data.item.originalPriceCents / 100).toFixed(2)}</p><p>Olivia can describe a genuine need for <b>{data.item.category}, size {data.item.size}</b>. Confirm the saved details before matching.</p></PixelPanel>}
      <ol className="sp-steps">{data.steps.map(s => <li key={s.label} className={s.done ? "sp-done" : ""}><strong>{s.done ? "✓" : "○"} {s.label}</strong><p>{s.detail}</p></li>)}</ol>
      <div className="sp-actions"><Link to="/bag?as=sam">Freja’s inventory</Link><Link to="/bag/needs?as=jo">Olivia’s needs</Link><Link to="/world?as=sam&demo=1">Freja’s demo world</Link><Link to="/world?as=jo&demo=1&walk=sam">Olivia approaches Freja</Link>{data.proposal && <Link to={`/trade/${data.proposal.id}?as=jo`}>Buyer’s offer / receipt</Link>}</div>
      <p className="sp-muted">Checked {new Date(data.checkedAt).toLocaleTimeString()}. To demonstrate iMessage delivery, also show the image and receipt arriving on both actual phones.</p>
    </>}
    <PixelPanel title="RECORD THE DEMONSTRATION"><p>Start screen recording on both phones. For a staged trial, show the sample setup, saved need, final offer, Olivia’s approval, and the changed inventory. For a photo trial, also record the actual photo being sent. End on both iMessage receipts. Get participants’ permission and hide personal notifications before sharing the recording.</p><p>For parent feedback, let two parents or caregivers try adding an item without coaching, then share the feedback form. Don’t count teammate tests as parent interviews.</p></PixelPanel>
  </div>;
}
