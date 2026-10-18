// Temporary entry (B owns src/app/main.tsx + routes.tsx). See NEEDS.md.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@/pixel/fonts.css";
import "@/pixel/tokens.css";
import { FrameLayout, KitWithChrome, TabPlaceholder } from "@/mocks/a3";
import { TitleScreen } from "@/world/TitleScreen";
import { ArtPage } from "@/world/ArtPage";
import { EncounterDev } from "@/world/EncounterDev";

const router = createBrowserRouter([
  {
    element: <FrameLayout />, // A3: HandheldFrame around every route
    children: [
      // A:
      { path: "/", element: <TitleScreen /> },
      { path: "/kit", element: <KitWithChrome /> },
      { path: "/dev/art", element: <ArtPage /> },
      { path: "/dev/encounter", element: <EncounterDev /> },
      { path: "/world", element: <TabPlaceholder label="WORLD (A4)" /> }, // A4 replaces
      { path: "/bag", element: <TabPlaceholder label="BAG (B)" /> }, // B owns
      { path: "/log", element: <TabPlaceholder label="LOG (B)" /> }, // B owns
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
