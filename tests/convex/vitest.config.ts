import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/convex/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
