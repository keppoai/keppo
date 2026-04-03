import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveLocalAdminKey } from "../../../packages/shared/src/convex-admin";
import {
  acquireE2ERunOwnership,
  assertSingleE2EWorkerConfigured,
  buildStartupFailureError,
  persistStartupFailureArtifact,
  readActiveE2ERunOwnership,
  releaseE2ERunOwnership,
  resolveConvexAdminKey,
  redactServiceLogText,
  serviceLogFileForWorker,
  shouldSurfaceServiceLogLine,
  stopE2EStack,
  tailServiceLogs,
} from "./stack-manager";

const runtimeRoot = path.resolve(process.cwd(), "tests/e2e/.runtime");
const workerIndex = 991;
const activeRunFile = path.join(runtimeRoot, "active-run.json");
const runtimeFileForWorker = (index: number): string =>
  path.join(runtimeRoot, `worker-${index}.json`);
const startupFailureFileForWorker = (index: number): string =>
  path.join(runtimeRoot, `worker-${index}.startup-failure.json`);

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  delete process.env.KEPPO_E2E_RUN_ID;
  await rm(activeRunFile, { force: true });
  await rm(serviceLogFileForWorker(workerIndex, "api"), { force: true });
  await rm(serviceLogFileForWorker(workerIndex, "dashboard"), { force: true });
  await rm(serviceLogFileForWorker(workerIndex, "queue-broker"), { force: true });
  await rm(serviceLogFileForWorker(workerIndex, "fake-gateway"), { force: true });
  await rm(runtimeFileForWorker(workerIndex), { force: true });
  await rm(runtimeFileForWorker(17), { force: true });
  await rm(startupFailureFileForWorker(workerIndex), { force: true });
});

describe("service log filtering", () => {
  it("keeps quiet stdout lines hidden in non-verbose mode", () => {
    expect(shouldSurfaceServiceLogLine("[api] [info] listening", "stdout")).toBe(false);
  });

  it("surfaces warn/error structured levels", () => {
    expect(shouldSurfaceServiceLogLine("[api] [warn] issue", "stdout")).toBe(true);
    expect(shouldSurfaceServiceLogLine("[api] [error] issue", "stdout")).toBe(true);
  });

  it("surfaces stderr failures without structured levels", () => {
    expect(shouldSurfaceServiceLogLine("operation failed", "stderr")).toBe(true);
  });

  it("shows all lines in verbose mode", () => {
    expect(shouldSurfaceServiceLogLine("[api] [info] listening", "stdout", { verbose: true })).toBe(
      true,
    );
  });
});

describe("service log redaction", () => {
  it("redacts bearer tokens, oauth tokens, and KEPPO env values", () => {
    const input = [
      "Authorization: Bearer abc.def",
      '{"access_token":"token-123"}',
      "KEPPO_SECRET=my-secret",
    ].join("\n");
    const redacted = redactServiceLogText(input);

    expect(redacted).not.toContain("abc.def");
    expect(redacted).not.toContain("token-123");
    expect(redacted).not.toContain("my-secret");
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).toContain('"access_token":"[REDACTED]"');
    expect(redacted).toContain("KEPPO_SECRET=[REDACTED]");
  });
});

describe("tailServiceLogs", () => {
  it("returns bounded, redacted tails for requested services", async () => {
    await mkdir(runtimeRoot, { recursive: true });
    const apiLog = serviceLogFileForWorker(workerIndex, "api");
    const dashboardLog = serviceLogFileForWorker(workerIndex, "dashboard");

    await writeFile(
      apiLog,
      [
        "[2026-03-02T00:00:00.000Z] [stdout] first-line",
        "[2026-03-02T00:00:01.000Z] [stdout] keep-this",
        "[2026-03-02T00:00:02.000Z] [stderr] Authorization: Bearer abc.def",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      dashboardLog,
      [
        "[2026-03-02T00:00:00.000Z] [stdout] dashboard-1",
        "[2026-03-02T00:00:01.000Z] [stdout] dashboard-2",
      ].join("\n"),
      "utf8",
    );

    const tail = await tailServiceLogs(workerIndex, ["api", "dashboard"], 2, 120);

    expect(tail).toContain("== api ==");
    expect(tail).toContain("== dashboard ==");
    expect(tail).not.toContain("first-line");
    expect(tail).not.toContain("abc.def");
    expect(tail).toContain("Bearer [REDACTED]");
    expect(tail).toContain("dashboard-2");
  });
});

describe("startup failure context", () => {
  it("embeds worker id and recent service logs in startup errors", () => {
    const error = buildStartupFailureError(
      3,
      new Error("dashboard failed"),
      "== dashboard ==\nline",
    );
    expect(error.message).toContain("worker 3");
    expect(error.message).toContain("dashboard failed");
    expect(error.message).toContain("Recent service logs:");
    expect(error.message).toContain("== dashboard ==\nline");
  });

  it("persists startup failure artifacts with runtime state", async () => {
    await mkdir(runtimeRoot, { recursive: true });
    const filePath = await persistStartupFailureArtifact({
      workerIndex,
      cause: new Error("dashboard failed"),
      logs: "== dashboard ==\nline",
      runtime: {
        runId: "run_artifact",
        workerIndex,
        namespacePrefix: "run_artifact.991",
        ownerPid: process.pid,
        status: "starting",
        startedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
        ports: {
          fakeGateway: 9911,
          api: 9912,
          dashboard: 9913,
          queueBroker: 9914,
        },
        convexUrl: "http://127.0.0.1:3210",
        fakeGatewayBaseUrl: "http://127.0.0.1:9911",
        fakeExternalBaseUrl: "http://127.0.0.1:9911",
        apiBaseUrl: "http://localhost:9913",
        queueBrokerBaseUrl: "http://127.0.0.1:9914",
        cronAuthorizationHeader: null,
        dashboardBaseUrl: "http://localhost:9913",
        readyServices: [],
        services: [],
      },
    });

    const artifact = JSON.parse(await readFile(filePath, "utf8")) as {
      error: string;
      logs: string;
      runtime: { runId: string; ownerPid: number };
    };
    expect(artifact.error).toContain("dashboard failed");
    expect(artifact.logs).toContain("== dashboard ==");
    expect(artifact.runtime.runId).toBe("run_artifact");
    expect(artifact.runtime.ownerPid).toBe(process.pid);
  });
});

describe("resolveConvexAdminKey", () => {
  it("prefers the local Convex config key over a stale env key", async () => {
    vi.stubEnv("KEPPO_CONVEX_ADMIN_KEY", "stale-admin-key");
    const tempRoot = await mkdtemp(path.join(tmpdir(), "keppo-stack-manager-"));
    const localAdminKey = "local-admin-key";
    const localConfigDir = path.join(tempRoot, ".convex", "local", "default");
    const localConfigPath = path.join(localConfigDir, "config.json");
    await mkdir(localConfigDir, { recursive: true });
    await writeFile(localConfigPath, `${JSON.stringify({ adminKey: localAdminKey })}\n`, "utf8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    try {
      expect(resolveLocalAdminKey()).toBe(localAdminKey);
      await expect(resolveConvexAdminKey()).resolves.toBe(localAdminKey);
    } finally {
      cwdSpy.mockRestore();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the env key when no local Convex config exists", async () => {
    vi.stubEnv("KEPPO_CONVEX_ADMIN_KEY", "fresh-admin-key");
    const tempRoot = await mkdtemp(path.join(tmpdir(), "keppo-stack-manager-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);

    try {
      expect(resolveLocalAdminKey()).toBeNull();
      await expect(resolveConvexAdminKey()).resolves.toBe("fresh-admin-key");
    } finally {
      cwdSpy.mockRestore();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("e2e worker config", () => {
  it("accepts the single-worker configuration", () => {
    expect(() => assertSingleE2EWorkerConfigured()).not.toThrow();
  });

  it("rejects multiple workers", () => {
    vi.stubEnv("E2E_WORKERS", "2");

    expect(() => assertSingleE2EWorkerConfigured()).toThrow(/single Playwright worker/i);
  });
});

describe("active run ownership", () => {
  it("acquires and releases repo-local run ownership", async () => {
    const ownership = await acquireE2ERunOwnership("run_owner_test");

    expect(ownership.runId).toBe("run_owner_test");
    expect(ownership.ownerPid).toBe(process.pid);
    await expect(readActiveE2ERunOwnership()).resolves.toMatchObject({
      runId: "run_owner_test",
      ownerPid: process.pid,
    });

    await releaseE2ERunOwnership("run_owner_test");
    await expect(readActiveE2ERunOwnership()).resolves.toBeNull();
  });

  it("fails fast when another live run already owns the runtime", async () => {
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      activeRunFile,
      `${JSON.stringify(
        {
          runId: "foreign_run",
          ownerPid: process.pid,
          acquiredAt: new Date().toISOString(),
          cwd: process.cwd(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(acquireE2ERunOwnership("new_run")).rejects.toThrow(/Another local e2e run/);
  });

  it("reclaims stale active-run ownership from a dead process", async () => {
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      activeRunFile,
      `${JSON.stringify(
        {
          runId: "stale_run",
          ownerPid: 999_999,
          acquiredAt: new Date().toISOString(),
          cwd: process.cwd(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const ownership = await acquireE2ERunOwnership("replacement_run");
    expect(ownership.runId).toBe("replacement_run");
    expect(ownership.ownerPid).toBe(process.pid);
  });
});

describe("persisted worker cleanup", () => {
  it("removes high-index worker runtime files during stopE2EStack", async () => {
    await mkdir(runtimeRoot, { recursive: true });
    process.env.KEPPO_E2E_RUN_ID = "run_cleanup";
    await writeFile(
      runtimeFileForWorker(17),
      `${JSON.stringify(
        {
          runId: "stale_run",
          workerIndex: 17,
          namespacePrefix: "stale_run.17",
          ownerPid: 999_999,
          status: "ready",
          startedAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
          ports: {
            fakeGateway: 10241,
            api: 10242,
            dashboard: 10243,
            queueBroker: 10244,
          },
          convexUrl: "http://127.0.0.1:3210",
          fakeGatewayBaseUrl: "http://127.0.0.1:10241",
          fakeExternalBaseUrl: "http://127.0.0.1:10241",
          apiBaseUrl: "http://localhost:10243",
          queueBrokerBaseUrl: "http://127.0.0.1:10244",
          cronAuthorizationHeader: null,
          dashboardBaseUrl: "http://localhost:10243",
          readyServices: [],
          services: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await stopE2EStack();

    await expect(readFile(runtimeFileForWorker(17), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
