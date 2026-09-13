import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws outside the React Server Components bundler; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Migration tests boot an in-memory Postgres (PGlite), which takes a moment.
    testTimeout: 30_000,
    env: { LOG_LEVEL: "silent" },
  },
});
