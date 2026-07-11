/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vitest config lives here too (test field) so the domain has one source of truth.
export default defineConfig(({ command }) => ({
  // Project page is served under /learn-delta-lake/ on GitHub Pages; dev/preview
  // and the e2e server stay at the root.
  base: command === "build" ? "/learn-delta-lake/" : "/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
}));
