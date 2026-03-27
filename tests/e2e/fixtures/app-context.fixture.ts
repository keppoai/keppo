import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import {
  assertNoNamespaceRecordsRemain,
  assertNoPendingNamespaceActions,
} from "../helpers/convex-assertions";
import {
  assertNamespaceIsolation,
  resetGlobalState,
  startWorkerStack,
  stopWorkerStack,
  tailServiceLogs,
  type E2EStackRuntime,
} from "../infra/stack-manager";
import { setupScenarioForWorker, type E2ETestMetadata } from "./parallel-state";

export type AppContext = {
  namespace: string;
  metadata: E2ETestMetadata;
  runtime: E2EStackRuntime;
  dashboardBaseUrl: string;
  apiBaseUrl: string;
  fakeGatewayBaseUrl: string;
  headers: Record<string, string>;
};

type Fixtures = {
  runtime: E2EStackRuntime;
  app: AppContext;
};

type BrowserContextUsageRecord = {
  runId: string;
  workerIndex: number;
  testId: string;
  specPath: string;
  scenarioId: string;
  retryIndex: number;
  repeatEachIndex: number;
  contextId: string;
  contextGuid: string | null;
  startedAtMs: number;
  endedAtMs: number;
};

const browserContextUsageFileForRun = (runId: string): string => {
  return path.resolve(process.cwd(), "tests/e2e/.runtime", `browser-context-usage.${runId}.ndjson`);
};

const appendBrowserContextUsageRecord = async (
  record: BrowserContextUsageRecord,
): Promise<void> => {
  await appendFile(
    browserContextUsageFileForRun(record.runId),
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
};

export const maybeAttachServiceLogs = async (params: {
  status: string;
  expectedStatus: string;
  workerIndex: number;
  readLogs?: (workerIndex: number) => Promise<string>;
  attach: (name: string, options: { body: string; contentType: string }) => Promise<void>;
}): Promise<void> => {
  const unexpectedOutcome = params.status !== params.expectedStatus;
  if (!unexpectedOutcome) {
    return;
  }
  let serviceLogs: string;
  const readLogs = params.readLogs ?? tailServiceLogs;
  try {
    serviceLogs = await readLogs(params.workerIndex);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serviceLogs = `Failed to collect service logs: ${message}`;
  }
  await params.attach("service-logs", {
    body: serviceLogs,
    contentType: "text/plain",
  });
};

const detachPageFromRuntime = async (page: Page): Promise<void> => {
  if (page.isClosed()) {
    return;
  }
  try {
    await page.goto("about:blank", {
      waitUntil: "commit",
      timeout: 2_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /Target page, context or browser has been closed|Navigation failed because page was closed/i.test(
        message,
      )
    ) {
      return;
    }
    throw error;
  }
};

const detachBrowserContextFromRuntime = async (context: BrowserContext): Promise<void> => {
  for (const openPage of context.pages()) {
    await detachPageFromRuntime(openPage);
    if (openPage.isClosed()) {
      continue;
    }
    try {
      await openPage.close({
        runBeforeUnload: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Target page, context or browser has been closed/i.test(message)) {
        continue;
      }
      throw error;
    }
  }
};

const parseLocalAllowlist = (runtime: E2EStackRuntime): Set<string> => {
  const convexUrl = new URL(runtime.convexUrl);
  const convexPort = convexUrl.port || (convexUrl.protocol === "http:" ? "80" : "443");
  const convexPortNumber = Number.parseInt(convexPort, 10);
  const convexSitePort = Number.isFinite(convexPortNumber) ? String(convexPortNumber + 1) : null;
  const defaults = [
    `${convexUrl.hostname}:${convexPort}`.toLowerCase(),
    ...(convexSitePort ? [`${convexUrl.hostname}:${convexSitePort}`.toLowerCase()] : []),
    `localhost:${convexPort}`,
    ...(convexSitePort ? [`localhost:${convexSitePort}`] : []),
    `127.0.0.1:${runtime.ports.dashboard}`,
    `localhost:${runtime.ports.dashboard}`,
    `127.0.0.1:${runtime.ports.fakeGateway}`,
    `127.0.0.1:${runtime.ports.queueBroker}`,
    "127.0.0.1:80",
    "127.0.0.1:443",
    "localhost:80",
    "localhost:443",
    "checkout.stripe.test:443",
  ];
  const configured = (process.env.KEPPO_LOCAL_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...defaults, ...configured]);
};

export const test = base.extend<Fixtures>({
  runtime: [
    async ({}, use) => {
      // Playwright may still increment workerIndex across restarts even though
      // Keppo E2E runs with a single configured worker. Keep every run pinned
      // to worker-0's port block so the prebuilt dashboard URL stays stable.
      const resolvedIndex = 0;
      const runtime = await startWorkerStack(resolvedIndex);
      await use(runtime);
      await stopWorkerStack(resolvedIndex);
    },
    { scope: "worker" },
  ],

  app: async ({ runtime, page }, use, testInfo) => {
    const { namespace, metadata, headers } = setupScenarioForWorker({
      runId: runtime.runId,
      workerIndex: runtime.workerIndex,
      testInfo,
    });
    const browserContext = page.context();
    const contextGuidCandidate = (browserContext as { _guid?: unknown })._guid;
    const contextGuid = typeof contextGuidCandidate === "string" ? contextGuidCandidate : null;
    const contextId = `${runtime.workerIndex}:${contextGuid ?? `unknown-context-${runtime.workerIndex}`}`;
    const startedAtMs = Date.now();

    const allowlist = parseLocalAllowlist(runtime);

    await browserContext.setExtraHTTPHeaders(headers);
    await browserContext.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (
        requestUrl.protocol === "data:" ||
        requestUrl.protocol === "blob:" ||
        requestUrl.protocol === "about:"
      ) {
        await route.continue();
        return;
      }
      const port = requestUrl.port || (requestUrl.protocol === "http:" ? "80" : "443");
      const hostPort = `${requestUrl.hostname}:${port}`.toLowerCase();

      if (!allowlist.has(hostPort) && !hostPort.endsWith(".sentry.io:443")) {
        throw new Error(
          `Unexpected outbound browser request: ${JSON.stringify({
            namespace,
            workerIndex: metadata.workerIndex,
            attemptedUrl: requestUrl.toString(),
            hostPort,
            specPath: metadata.specPath,
            scenarioId: metadata.scenarioId,
          })}`,
        );
      }

      await route.continue({
        headers: {
          ...route.request().headers(),
          ...headers,
        },
      });
    });

    await page.addInitScript(
      (payload) => {
        (window as unknown as Record<string, unknown>).__KEPPO_E2E_NAMESPACE__ = payload.namespace;
        (window as unknown as Record<string, unknown>).__KEPPO_E2E_METADATA__ = payload.metadata;
        (window as unknown as Record<string, unknown>).__KEPPO_E2E_SCOPE__ = null;
      },
      {
        namespace,
        metadata,
      },
    );

    await resetGlobalState(runtime);

    const app: AppContext = {
      namespace,
      metadata,
      runtime,
      dashboardBaseUrl: runtime.dashboardBaseUrl,
      apiBaseUrl: runtime.apiBaseUrl,
      fakeGatewayBaseUrl: runtime.fakeGatewayBaseUrl,
      headers,
    };

    try {
      await use(app);
      await assertNoPendingNamespaceActions(runtime.convexUrl, namespace);
      await assertNamespaceIsolation(runtime, namespace);
    } finally {
      await appendBrowserContextUsageRecord({
        runId: runtime.runId,
        workerIndex: runtime.workerIndex,
        testId: metadata.testId,
        specPath: metadata.specPath,
        scenarioId: metadata.scenarioId,
        retryIndex: metadata.retryIndex,
        repeatEachIndex: metadata.repeatEachIndex,
        contextId,
        contextGuid,
        startedAtMs,
        endedAtMs: Date.now(),
      });
      await maybeAttachServiceLogs({
        status: testInfo.status,
        expectedStatus: testInfo.expectedStatus,
        workerIndex: runtime.workerIndex,
        attach: async (name, options) => {
          await testInfo.attach(name, options);
        },
      });
      await detachBrowserContextFromRuntime(browserContext);
      await resetGlobalState(runtime);
      await assertNoNamespaceRecordsRemain(runtime.convexUrl, namespace);
    }
  },
});

export { expect };
