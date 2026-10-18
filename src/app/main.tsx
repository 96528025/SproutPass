// OWNER: B4. App entry: router + shell. A's fonts.css (Google Fonts) and tokens.css (palette, grid, z-layers,
// resets) load once here, first, so every component's CSS (A's kit, B's b.css) cascades on top of them.
import "@/pixel/fonts.css";
import "@/pixel/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Shell } from "./Shell";
import { api, USE_MOCK } from "./api";
import { mockDev } from "./api.mock";
import { useApp } from "./store";
import "../styles/b.css";

// Dev console handle: relay.api.demoClock(…), relay.store.getState().closet, relay.mockDev.triggerEncounter()
if (import.meta.env.DEV) Object.assign(window, { relay: { api, store: useApp, mockDev: USE_MOCK ? mockDev : null } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
