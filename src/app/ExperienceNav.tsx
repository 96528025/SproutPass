import { Link, useLocation } from "react-router-dom";
import { useApp } from "./store";
import { withQuery } from "../world/query";
import "./experience.css";

/** Mode navigation is always visible; demo stages open the existing, live screens. */
export function ExperienceNav() {
  const { pathname } = useLocation();
  const demo = useApp(s => s.demo);
  const parentKey = useApp(s => s.parentKey);
  const proposals = useApp(s => s.closet?.proposals);
  const proposal = [...(proposals ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const world = withQuery("/world", { demo: "1", as: parentKey ?? "jo", walk: parentKey === "sam" ? "jo" : "sam" });
  const steps = [
    { label: "1 · Setup", to: withQuery("/demo", { demo: "1" }), active: pathname === "/demo" || pathname === "/trial" },
    { label: "2 · Meet", to: world, active: pathname === "/world" },
    { label: "3 · Agents", to: withQuery("/agents", { demo: "1" }), active: pathname === "/agents" },
    { label: "4 · Offer", to: proposal ? withQuery(`/trade/${proposal.id}`, { demo: "1" }) : null, active: pathname.startsWith("/trade/") },
    { label: "5 · Receipt", to: withQuery("/log", { demo: "1" }), active: pathname === "/log" },
    { label: "6 · Feedback", to: withQuery("/feedback", { demo: "1" }), active: pathname === "/feedback" },
  ];
  return <header className="sp-experience">
    <nav className="sp-mode" aria-label="App mode">
      <Link className="sp-wordmark" to={withQuery("/")}>SproutPass</Link>
      <Link to={withQuery("/", { demo: "0" })} aria-current={!demo ? "page" : undefined}>App</Link>
      <Link to={world} aria-current={demo ? "page" : undefined}>Demo</Link>
    </nav>
    {demo && <>
      <nav className="sp-journey" aria-label="Demo journey">
        {steps.map(step => step.to
          ? <Link key={step.label} to={step.to} aria-current={step.active ? "step" : undefined}>{step.label}</Link>
          : <span key={step.label} aria-disabled="true" title="An offer opens after the agents find a match">{step.label}</span>)}
      </nav>
      <p className="sp-demo-note">Simulated location & payment · only the buyer approves</p>
    </>}
  </header>;
}
