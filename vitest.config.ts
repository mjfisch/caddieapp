import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a React Server graph; stub it for Node tests.
      // This does NOT weaken invariant #3 — the real guard is the build-time check
      // in tests/invariants.test.ts that the client bundle never contains the key.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Mirror apps/web/.env.local into process.env before any test module loads,
    // so the live-DB tests (round-trip, migrations) can find DATABASE_URL.
    setupFiles: ["tests/setup.env.ts"],
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
