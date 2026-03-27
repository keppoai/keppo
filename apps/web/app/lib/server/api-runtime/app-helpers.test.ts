import { afterEach, describe, expect, it } from "vitest";
import { resolveClientIp, resolveOrigins } from "./app-helpers";

const ENV_KEYS = ["CORS_ALLOWED_ORIGINS", "KEPPO_TRUSTED_PROXY"] as const;

const restoreEnv = (snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
};

const snapshotEnv = (): Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> => {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
};

afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.KEPPO_TRUSTED_PROXY;
});

describe("resolveOrigins", () => {
  it("validates and normalizes configured CORS origins", () => {
    process.env.CORS_ALLOWED_ORIGINS =
      "https://dashboard.example.com, https://dashboard.example.com , http://localhost:5173";

    expect(resolveOrigins("http://localhost:5173")).toEqual([
      "https://dashboard.example.com",
      "http://localhost:5173",
    ]);
  });

  it("rejects wildcard CORS origins", () => {
    process.env.CORS_ALLOWED_ORIGINS = "*";

    expect(() => resolveOrigins("http://localhost:5173")).toThrow("wildcard '*' is not allowed");
  });

  it("rejects malformed CORS origins", () => {
    process.env.CORS_ALLOWED_ORIGINS = "not-a-url";

    expect(() => resolveOrigins("http://localhost:5173")).toThrow("is not a valid URL");
  });

  it("falls back to validated dashboard origin when env list is unset", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;

    expect(resolveOrigins("https://keppo.example.com")).toEqual(["https://keppo.example.com"]);
  });
});

describe("resolveClientIp", () => {
  const requestIp = async (headers: Record<string, string>) => {
    return resolveClientIp(new Request("http://localhost/", { headers }));
  };

  it("ignores forwarded IP headers when trusted proxy mode is disabled", async () => {
    const ip = await requestIp({
      "x-forwarded-for": "203.0.113.10, 10.0.0.5",
      "x-real-ip": "198.51.100.8",
    });

    expect(ip).toBe("::");
  });

  it("uses Vercel header ordering when KEPPO_TRUSTED_PROXY=vercel", async () => {
    const snapshot = snapshotEnv();
    process.env.KEPPO_TRUSTED_PROXY = "vercel";

    try {
      const ip = await requestIp({
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "198.51.100.8",
      });

      expect(ip).toBe("198.51.100.8");
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("uses Cloudflare header ordering when KEPPO_TRUSTED_PROXY=cloudflare", async () => {
    const snapshot = snapshotEnv();
    process.env.KEPPO_TRUSTED_PROXY = "cloudflare";

    try {
      const ip = await requestIp({
        "cf-connecting-ip": "192.0.2.45",
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "198.51.100.8",
      });

      expect(ip).toBe("192.0.2.45");
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("returns placeholder when no IP headers are available", async () => {
    const ip = await requestIp({});
    expect(ip).toBe("::");
  });
});
