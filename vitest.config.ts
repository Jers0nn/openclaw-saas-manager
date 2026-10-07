import { defineConfig } from "vitest/config";

// Plugin tests only. The backend has its own test suite in api/.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["api/**", "node_modules/**", "dist/**"],
    testTimeout: 15_000,
  },
});
