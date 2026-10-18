// Temporary entry (B owns src/app/main.tsx + routes.tsx). See NEEDS.md.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@/pixel/fonts.css";
import "@/pixel/tokens.css";
import { KitPage } from "@/world/KitPage";

const router = createBrowserRouter([
  // A:
  { path: "/kit", element: <KitPage /> },
  { path: "/", element: <KitPage /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
