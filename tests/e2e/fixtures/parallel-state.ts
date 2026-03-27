import { createHash } from "node:crypto";
import type { TestInfo } from "@playwright/test";

export type E2ETestMetadata = {
  runId: string;
  workerIndex: number;
  testId: string;
  retryIndex: number;
  repeatEachIndex: number;
  specPath: string;
  scenarioId: string;
};

export type WorkerScenarioState = {
  namespace: string;
  metadata: E2ETestMetadata;
  headers: Record<string, string>;
};

const normalizeTestId = (value: string): string => {
  const hashed = createHash("sha1").update(value).digest("hex").slice(0, 10);
  return `t${hashed}`;
};

const toScenarioId = (testInfo: TestInfo): string => {
  return testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
};

const buildNamespace = (metadata: E2ETestMetadata): string => {
  return `${metadata.runId}.${metadata.workerIndex}.${metadata.testId}.${metadata.retryIndex}.${metadata.repeatEachIndex}`;
};

export const setupScenarioForWorker = (params: {
  runId: string;
  workerIndex: number;
  testInfo: TestInfo;
}): WorkerScenarioState => {
  const { runId, workerIndex, testInfo } = params;
  const metadata: E2ETestMetadata = {
    runId,
    workerIndex,
    testId: normalizeTestId(`${testInfo.file}:${testInfo.titlePath.join(" > ")}`),
    retryIndex: testInfo.retry,
    repeatEachIndex: testInfo.repeatEachIndex,
    specPath: testInfo.file,
    scenarioId: toScenarioId(testInfo),
  };

  const namespace = buildNamespace(metadata);
  const headers = {
    "x-keppo-e2e-namespace": namespace,
    "x-e2e-test-id": metadata.testId,
    "x-e2e-scenario-id": metadata.scenarioId,
  };

  return {
    namespace,
    metadata,
    headers,
  };
};
