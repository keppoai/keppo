import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
