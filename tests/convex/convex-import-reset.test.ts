import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConvexDeploymentViaImport } from "../e2e/helpers/convex-import-reset";

const EMPTY_ZIP_ARCHIVE = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resetConvexDeploymentViaImport", () => {
  it("writes an empty snapshot and runs convex import --replace-all", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:test-reset");
    let observedZipPath: string | null = null;

    await resetConvexDeploymentViaImport({
      run: (command, args, options) => {
        observedZipPath = args[5] ?? null;
        expect(command).toBe(process.platform === "win32" ? "pnpm.cmd" : "pnpm");
        expect(args.slice(0, 5)).toEqual(["exec", "convex", "import", "--replace-all", "--yes"]);
        expect(options.env.CONVEX_DEPLOYMENT).toBe("local:test-reset");
        expect(observedZipPath).toBeTruthy();
        expect(readFileSync(observedZipPath!)).toEqual(EMPTY_ZIP_ARCHIVE);
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    expect(observedZipPath).toBeTruthy();
    expect(existsSync(observedZipPath!)).toBe(false);
  });

  it("surfaces convex import failures with stderr context", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:test-reset");

    await expect(
      resetConvexDeploymentViaImport({
        run: () => ({
          status: 1,
          signal: null,
          stdout: "",
          stderr: "replace-all failed",
        }),
      }),
    ).rejects.toThrow(/replace-all failed/);
  });

  it("retries the replace-all import once after a timeout", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:test-reset");
    let attempts = 0;

    await resetConvexDeploymentViaImport({
      run: () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: null,
            signal: "SIGTERM",
            stdout: "",
            stderr: "",
            error: new Error("spawnSync pnpm ETIMEDOUT"),
          };
        }
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    expect(attempts).toBe(2);
  });

  it("drops CONVEX_DEPLOYMENT when self-hosted selection is present", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:test-reset");
    vi.stubEnv("CONVEX_SELF_HOSTED_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SELF_HOSTED_ADMIN_KEY", "local-admin-key");
    const calls: Array<{ command: string; args: string[] }> = [];

    await resetConvexDeploymentViaImport({
      run: (command, args, options) => {
        calls.push({ command, args });
        expect(options.env.CONVEX_DEPLOYMENT).toBeUndefined();
        expect(options.env.CONVEX_SELF_HOSTED_URL).toBe("http://127.0.0.1:3210");
        expect(options.env.CONVEX_SELF_HOSTED_ADMIN_KEY).toBe("local-admin-key");
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe(process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    expect(calls[0]?.args).toContain("--env-file");
    expect(calls[1]).toEqual({
      command: "bash",
      args: ["-lc", "source scripts/_convex-env.sh; setup_common_convex_env; setup_e2e_convex_env"],
    });
  });

  it("fails fast when no deployment selection is available", async () => {
    await expect(
      resetConvexDeploymentViaImport({
        env: {
          CONVEX_DEPLOYMENT: "",
          CONVEX_URL: "",
        },
      }),
    ).rejects.toThrow(/Missing CONVEX_DEPLOYMENT or CONVEX_URL/);
  });
});
