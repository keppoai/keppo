import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { mswServer } from "./msw-server";

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// Keep the default dashboard runtime importable in jsdom tests.
vi.stubEnv("VITE_CONVEX_URL", "https://keppo-web-test.convex.cloud");
vi.stubEnv("VITE_CONVEX_SITE_URL", "https://keppo-web-test.convex.site");

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: TestResizeObserver,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: TestResizeObserver,
  });
}

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  mswServer.resetHandlers();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterAll(() => {
  vi.unstubAllEnvs();
  mswServer.close();
});
