import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { getKeppoClientEnvDefine } from "./vite.keppo-env";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const srcPath = path.resolve(configDir, "./src");
const appPath = path.resolve(configDir, "./app");
const reactEntryPath = require.resolve("react", { paths: [configDir] });
const reactPath = path.dirname(reactEntryPath);
const reactDomEntryPath = require.resolve("react-dom", { paths: [configDir] });
const reactDomPath = path.dirname(reactDomEntryPath);

export default defineConfig({
  root: configDir,
  define: {
    ...getKeppoClientEnvDefine(),
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${srcPath}/` },
      { find: /^@web\//, replacement: `${appPath}/` },
      { find: "react", replacement: reactPath },
      { find: "react/jsx-runtime", replacement: path.resolve(reactPath, "jsx-runtime.js") },
      { find: "react/jsx-dev-runtime", replacement: path.resolve(reactPath, "jsx-dev-runtime.js") },
      { find: "react-dom", replacement: reactDomPath },
      { find: "react-dom/client", replacement: path.resolve(reactDomPath, "client.js") },
      {
        find: "react-dom/test-utils",
        replacement: path.resolve(reactDomPath, "test-utils.js"),
      },
    ],
    dedupe: ["react", "react-dom"],
  },
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "web",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          restoreMocks: true,
          clearMocks: true,
          testTimeout: 10_000,
          hookTimeout: 10_000,
          exclude: ["e2e/**", "dist/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          include: ["app/**/*.test.{ts,tsx}"],
          environment: "node",
          globals: true,
          restoreMocks: true,
          clearMocks: true,
          testTimeout: 10_000,
          hookTimeout: 10_000,
          exclude: ["e2e/**", "dist/**"],
        },
      },
    ],
  },
});
