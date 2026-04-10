import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals:     true,
    environment: "node",
    setupFiles:  ["./tests/setup.ts"],
    coverage: {
      provider:   "v8",
      reporter:   ["text", "lcov"],
      include:    ["src/lib/**", "src/validation/**"],
      exclude:    ["src/lib/logger.ts", "src/lib/redis-client.ts"],
      thresholds: {
        lines:      70,
        functions:  70,
        branches:   60,
      },
    },
    testTimeout:   15_000,
    hookTimeout:   15_000,
    pool:          "forks",   // isolate each test file in its own process
  },
});
