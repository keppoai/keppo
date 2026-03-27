import { describe, expect, it } from "vitest";
import {
  isHostedApiRuntimeEnvironment,
  normalizeBundledRuntimeEnvContents,
  resolveKeppoRuntimeEnvironment,
  resolveRuntimeEnvFiles,
  resolveRuntimeEnvFilesFromSearchDirs,
  resolveRuntimeEnvSource,
} from "./runtime-env";

describe("resolveKeppoRuntimeEnvironment", () => {
  it("uses the explicit KEPPO_ENVIRONMENT when provided", () => {
    expect(
      resolveKeppoRuntimeEnvironment({
        KEPPO_ENVIRONMENT: "preview",
      } as NodeJS.ProcessEnv),
    ).toBe("preview");
  });

  it("rejects when KEPPO_ENVIRONMENT is unset", () => {
    expect(() => resolveKeppoRuntimeEnvironment({} as NodeJS.ProcessEnv)).toThrow(
      "Missing KEPPO_ENVIRONMENT",
    );
  });

  it("rejects unsupported KEPPO_ENVIRONMENT values", () => {
    expect(() =>
      resolveKeppoRuntimeEnvironment({
        KEPPO_ENVIRONMENT: "development",
      } as NodeJS.ProcessEnv),
    ).toThrow("Unsupported KEPPO_ENVIRONMENT");
  });
});

describe("resolveRuntimeEnvFiles", () => {
  it("maps preview to the generated preview runtime env asset", () => {
    expect(resolveRuntimeEnvFiles("/repo", "preview")).toEqual(["/repo/.env.preview"]);
  });

  it("maps staging to .env.staging", () => {
    expect(resolveRuntimeEnvFiles("/repo", "staging")).toEqual(["/repo/.env.staging"]);
  });

  it("maps production to .env.production", () => {
    expect(resolveRuntimeEnvFiles("/repo", "production")).toEqual(["/repo/.env.production"]);
  });
});

describe("resolveRuntimeEnvFilesFromSearchDirs", () => {
  it("finds preview env files by walking ancestor directories", () => {
    expect(
      resolveRuntimeEnvFilesFromSearchDirs(
        ["/var/task/functions/__server.func"],
        "preview",
        (path) => path === "/var/task/.env.preview",
      ),
    ).toEqual(["/var/task/.env.preview"]);
  });

  it("finds staged env files by walking ancestor directories", () => {
    expect(
      resolveRuntimeEnvFilesFromSearchDirs(
        ["/var/task/functions/__server.func"],
        "staging",
        (path) => path === "/var/task/.env.staging",
      ),
    ).toEqual(["/var/task/.env.staging"]);
  });

  it("checks each search root before falling back", () => {
    expect(
      resolveRuntimeEnvFilesFromSearchDirs(
        ["/", "/repo/apps/web/.vercel/output/functions/__server.func"],
        "staging",
        (path) => path === "/repo/.env.staging",
      ),
    ).toEqual(["/repo/.env.staging"]);
  });

  it("falls back to the first search root when the env file is absent", () => {
    expect(
      resolveRuntimeEnvFilesFromSearchDirs(["/repo/runtime"], "production", () => false),
    ).toEqual(["/repo/runtime/.env.production"]);
  });
});

describe("normalizeBundledRuntimeEnvContents", () => {
  it("accepts plain string asset contents", () => {
    expect(normalizeBundledRuntimeEnvContents("KEY=value")).toBe("KEY=value");
  });

  it("decodes Uint8Array asset contents from Nitro storage", () => {
    expect(normalizeBundledRuntimeEnvContents(new TextEncoder().encode("KEY=value"))).toBe(
      "KEY=value",
    );
  });
});

describe("resolveRuntimeEnvSource", () => {
  it("prefers bundled Nitro server assets for preview env files", () => {
    expect(
      resolveRuntimeEnvSource(
        "preview",
        ["/repo/apps/web/.vercel/output/functions/__server.func"],
        {
          preview: "CONVEX_URL=https://example.convex.cloud",
        },
      ),
    ).toEqual({
      kind: "bundled",
      contents: "CONVEX_URL=https://example.convex.cloud",
    });
  });

  it("prefers bundled Nitro server assets for hosted env files", () => {
    expect(
      resolveRuntimeEnvSource(
        "staging",
        ["/repo/apps/web/.vercel/output/functions/__server.func"],
        {
          staging: "CONVEX_URL=https://example.convex.cloud",
        },
      ),
    ).toEqual({
      kind: "bundled",
      contents: "CONVEX_URL=https://example.convex.cloud",
    });
  });

  it("falls back to filesystem lookup when bundled assets are absent", () => {
    expect(resolveRuntimeEnvSource("production", ["/repo/runtime"], {}, () => false)).toEqual({
      kind: "files",
      filepaths: ["/repo/runtime/.env.production"],
    });
  });
});

describe("isHostedApiRuntimeEnvironment", () => {
  it("accepts hosted deployment environments", () => {
    expect(isHostedApiRuntimeEnvironment("preview")).toBe(true);
    expect(isHostedApiRuntimeEnvironment("staging")).toBe(true);
    expect(isHostedApiRuntimeEnvironment("production")).toBe(true);
  });

  it("rejects non-hosted environments", () => {
    expect(isHostedApiRuntimeEnvironment(undefined)).toBe(false);
    expect(isHostedApiRuntimeEnvironment("development")).toBe(false);
  });
});
