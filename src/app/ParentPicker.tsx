// OWNER: B4. "Who's playing?" — shown when ?as= is missing. Picking sets ?as= for this tab.
// A's TitleScreen uses <ParentPicker onPick={(key) => …} /> inside its own "WHO ARE YOU?" panel: then the picker
// is a compact row of three cards, still sets this tab's parent (so the store and ?as= agree), and leaves the
// navigation to onPick. Without onPick it is B's full-screen picker and opens the bag from "/".
import { useLocation, useNavigate } from "react-router-dom";
import { PixelPanel, Sprite } from "./ui";
import { useApp } from "./store";
import { seedPlan } from "../../base44/shared/seed.ts";

export type ParentKey = "mina" | "jo" | "sam";

const plan = seedPlan();
const CARDS = plan.parents.map((p) => ({
  key: p.key as ParentKey, name: p.name, sprite: p.avatar.sprite, pet: p.pet.name,
  child: plan.children.find((c) => c.parentKey === p.key)?.nickname,
}));

export interface ParentPickerProps {
  /** Called after the parent is set; the caller navigates (e.g. to /world?as=…). */
  onPick?: (key: ParentKey) => void;
  /** Compact row of cards without the intro panel. Defaults to on when onPick is given. */
  compact?: boolean;
}

export function ParentPicker({ onPick, compact = !!onPick }: ParentPickerProps = {}) {
  const setParent = useApp((s) => s.setParent);
  const nav = useNavigate();
  const loc = useLocation();
  const pick = (key: ParentKey) => {
    setParent(key);
    if (onPick) onPick(key);
    else if (loc.pathname === "/") nav("/bag");
  };

  if (compact) {
    return (
      <div className="b-picker-row" role="group" aria-label="Who's playing?">
        {CARDS.map((c) => (
          <button key={c.key} type="button" className="b-parent-mini" onClick={() => pick(c.key)}
            aria-label={`${c.name}${c.child ? `, ${c.child}'s closet` : ""}, pet ${c.pet}`}>
            <Sprite name={c.sprite} anim="idle" scale={2} />
            <span className="b-parent-mini-name">{c.name}</span>
            <span className="b-label b-muted">{c.pet}</span>
          </button>
        ))}
      </div>
    );
  }

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
