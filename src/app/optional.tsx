// OWNER: B4. Mount screens other people are still writing: if the file exists it's lazy-loaded,
// otherwise (or if it crashes) the placeholder renders. Vite re-runs the globs when files appear.
import { Component, lazy, Suspense } from "react";
import type { ComponentType, ReactNode } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;
type Loader = () => Promise<Record<string, unknown>>;

// Literal globs only (Vite resolves them at build time).
const FILES: Record<string, Loader> = {
  ...import.meta.glob<Record<string, unknown>>("../trade/{TradeWindow,TradeWatcher,RelayLog}.tsx"),
  ...import.meta.glob<Record<string, unknown>>("../world/{TitleScreen,WorldScreen}.tsx"),
  ...import.meta.glob<Record<string, unknown>>("../agent/AgentPet.tsx"),
};

/** Error boundary: renders `fallback` instead of blanking the whole app when a child throws. */
export class Guard extends Component<{ fallback: ReactNode; name: string; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(`[relay] ${this.props.name} crashed; showing placeholder`, e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * optional("../trade/TradeWindow.tsx", "TradeWindow", Placeholder) → a component that renders the real
 * export (named `exportName`, else default) when the file exists, else `Fallback`. Same props either way.
 */
export function optional<P extends object>(path: string, exportName: string, Fallback: ComponentType<P>, loading: ReactNode = null): ComponentType<P> {
  const load = FILES[path];
  if (!load) return Fallback;
  const Lazy = lazy(async () => {
    const mod = await load();
    const Real = (mod[exportName] ?? mod.default) as AnyComponent | undefined;
    return { default: (Real ?? Fallback) as AnyComponent };
  });
  function Optional(props: P) {
    return (
      <Guard name={exportName} fallback={<Fallback {...props} />}>
        <Suspense fallback={loading}><Lazy {...props} /></Suspense>
      </Guard>
    );
  }
  Optional.displayName = `Optional(${exportName})`;
  return Optional;
}
