import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Database-backed suites share one test database, so run files serially.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
