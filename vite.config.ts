import path from "node:path";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      treeshake: {
        // The validators are pure `v.*` definitions, but a top-level
        // `v.union(...)` is a call the bundler cannot prove side-effect-free,
        // so it kept every one of them — including the server-only billing
        // validators that spell out the lead-data provider's name. Client code
        // imports the validators index for a handful of unions and uses none
        // of those, so declaring the folder side-effect-free lets the unused
        // ones drop and keeps provider names out of the browser (PLAN §4).
        //
        // Holds only while no file in that folder does work at import time.
        // A module that registers or mutates anything on load must not live
        // there.
        moduleSideEffects: [
          { test: /\/convex\/lib\/validators\//, sideEffects: false },
        ],
      },
    },
  },
});
