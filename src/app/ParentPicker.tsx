// OWNER: B4. "Who's playing?" — shown when ?as= is missing. Picking sets ?as= for this tab.
import { useLocation, useNavigate } from "react-router-dom";
import { PixelPanel, Sprite } from "./ui";
import { useApp } from "./store";
import { seedPlan } from "../../base44/shared/seed.ts";

const plan = seedPlan();
const CARDS = plan.parents.map((p) => ({
  key: p.key, name: p.name, sprite: p.avatar.sprite, pet: p.pet.name,
  child: plan.children.find((c) => c.parentKey === p.key)?.nickname,
}));

export function ParentPicker() {
  const setParent = useApp((s) => s.setParent);
  const nav = useNavigate();
  const loc = useLocation();
  const pick = (key: string) => {
    setParent(key);
    if (loc.pathname === "/") nav("/bag");
  };
  return (
    <div className="b-stack">
      <PixelPanel title="WHO'S PLAYING?">
        <p className="b-p">Pick a parent. Open a second tab as someone else to see both phones.</p>
      </PixelPanel>
      <div className="b-picker-grid">
        {CARDS.map((c) => (
          <button key={c.key} type="button" className="b-parent-card" onClick={() => pick(c.key)}>
            <Sprite name={c.sprite} anim="idle" scale={3} />
            <span className="b-stack" style={{ gap: 4 }}>
              <span className="b-parent-name">{c.name}</span>
              <span>{c.child ? `${c.child}'s closet` : "Closet"} · pet {c.pet}</span>
              <span className="b-label b-muted">?as={c.key}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
