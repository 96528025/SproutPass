import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PixelButton, PixelPanel } from "../app/ui";
import { trialCall } from "./client";
import "./trial.css";

export function Feedback() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const id = useRef(crypto.randomUUID());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      await trialCall("submitFeedback", { ...Object.fromEntries(form), requestId: id.current, quoteConsent: form.get("quoteConsent") === "on" });
      setSaved(true);
    } catch { setError("Your feedback hasn't been saved. Check your connection and try again; your answers are still here."); }
    finally { setBusy(false); }
  }
  return <div className="sp-trial">
    <h1>Help shape SproutPass</h1>
    {saved ? <PixelPanel title="THANK YOU"><p role="status">Your feedback is saved. We’ll use it to improve SproutPass.</p><Link to="/">Back to SproutPass</Link></PixelPanel> : <>
      <p>First, try adding one garment on your own. Then tell us what worked. About two minutes; no name or contact details needed.</p>
      <Link to="/bag/add">Try adding a garment</Link>
      <form onSubmit={e => void submit(e)} className="sp-form">
        <label>I’m testing as<select name="role" required defaultValue=""><option value="" disabled>Choose one</option><option value="parent_caregiver">A parent or caregiver</option><option value="teammate">A teammate or friend testing the demo</option><option value="other">Another interested person</option></select></label>
        <label>What do you currently do with outgrown children’s clothes?<textarea name="currentProcess" required maxLength={1500} rows={3} /></label>
        <label>Were you able to add a garment?<select name="outcome" required defaultValue=""><option value="" disabled>Choose one</option><option value="unaided">Yes, without help</option><option value="needed_help">Yes, with help</option><option value="could_not_finish">I couldn't finish</option><option value="not_tried">I haven't tried yet</option></select></label>
        <label>Where did you hesitate or get confused?<textarea name="confusing" maxLength={1500} rows={2} /></label>
        <label>Would SproutPass save you effort?<select name="useful" required defaultValue=""><option value="" disabled>Choose one</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label>
        <label>What should we change, and why?<textarea name="improvement" required maxLength={1500} rows={3} /></label>
        <label className="sp-check"><input type="checkbox" name="quoteConsent" /> You may quote my feedback anonymously in the hackathon presentation. (Optional)</label>
        <p className="sp-muted">Responses are stored privately in Base44 for the SproutPass team. Please leave out names, phone numbers and details about your child.</p>
        {error && <p role="alert">{error}</p>}
        <PixelButton type="submit" disabled={busy}>{busy ? "SAVING…" : "SEND FEEDBACK"}</PixelButton>
      </form>
    </>}
  </div>;
}
