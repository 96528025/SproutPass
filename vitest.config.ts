// Separate from vite.config.js so tests don't load the Base44 vite plugin.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["base44/**/*.test.ts", "src/**/*.test.{ts,tsx}"] },
});
