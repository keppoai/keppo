import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/local-convex/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
