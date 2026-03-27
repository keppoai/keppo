import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProviderSdkCallRecord } from "./provider-sdk/port.js";
import {
  CONFORMANCE_NAMESPACE,
  createConnectorHarness,
  type SdkBackedProviderId,
} from "./test-utils/connector-harness.js";

type ConformanceOutputValueType = "array" | "object" | "string" | "number" | "boolean" | "null";

type ProviderActionGoldenResultExpectation = {
  status: string | string[];
  hasActionId?: boolean;
  outputShape?: Record<string, ConformanceOutputValueType | ConformanceOutputValueType[]>;
};

type ProviderActionGoldenErrorExpectation = {
  kind: "invalid_input" | "not_connected" | "auth" | "rate_limited" | "not_found" | "unknown";
  messageIncludes?: string[];
};

type ProviderActionScenario = {
  toolName: string;
  capability: "read" | "write";
  positiveInput: Record<string, unknown>;
  negativeInput: Record<string, unknown>;
  negativeMode?: "invalid_input" | "not_connected";
  expectedSdkCalls?: Array<{
    method: string;
    requireIdempotencyKey?: boolean;
    assertArgs?: (args: Record<string, unknown>) => boolean;
  }>;
  golden?: {
    positive: ProviderActionGoldenResultExpectation;
    negative: ProviderActionGoldenErrorExpectation;
    idempotency?: ProviderActionGoldenResultExpectation;
  };
};

type ProviderActionPack = {
  providerId: SdkBackedProviderId | "custom";
  gatewayProviderId?: string;
  scenarios: ProviderActionScenario[];
};

type GoldenModule = {
  assertGoldenError: (
    scope: string,
    actual: { kind: ProviderActionGoldenErrorExpectation["kind"]; message: string },
    expected: ProviderActionGoldenErrorExpectation,
  ) => void;
  assertGoldenResult: (
    scope: string,
    actual: {
      status: string;
      hasActionId: boolean;
      outputShape: Record<string, ConformanceOutputValueType>;
    },
    expected: ProviderActionGoldenResultExpectation,
  ) => void;
  normalizeConformanceError: (error: unknown) => {
    kind: ProviderActionGoldenErrorExpectation["kind"];
    message: string;
  };
  normalizeConformanceResult: (payload: Record<string, unknown>) => {
    status: string;
    hasActionId: boolean;
    outputShape: Record<string, ConformanceOutputValueType>;
  };
};

const scenarioDependenciesByTool: Partial<Record<string, string[]>> = {
  "gmail.deleteDraft": ["gmail.createDraft"],
  "github.deleteReaction": ["github.createReaction"],
  "x.deletePost": ["x.createPost"],
  "x.deleteList": ["x.createList"],
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const matrixModulePath = pathToFileURL(
  path.resolve(repoRoot, "tests/provider-conformance/action-matrix.ts"),
).href;
const goldenModulePath = pathToFileURL(
  path.resolve(repoRoot, "tests/provider-conformance/golden.ts"),
).href;

const matrixModule = (await import(matrixModulePath)) as {
  providerActionPacks: ProviderActionPack[];
  providerActionScenarioCount: number;
};
const goldenModule = (await import(goldenModulePath)) as GoldenModule;

const providerActionPacks = matrixModule.providerActionPacks;
const providerActionScenarioCount = matrixModule.providerActionScenarioCount;
const {
  assertGoldenError,
  assertGoldenResult,
  normalizeConformanceError,
  normalizeConformanceResult,
} = goldenModule;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const findCall = (
  calls: ProviderSdkCallRecord[],
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
): ProviderSdkCallRecord | null => {
  for (const call of calls) {
    if (call.method !== method) {
      continue;
    }
    if (!assertArgs || assertArgs(asRecord(call.args))) {
      return call;
    }
  }
  return null;
};

const getExpectedSdkCalls = (
  scenario: ProviderActionScenario,
): NonNullable<ProviderActionScenario["expectedSdkCalls"]> => {
  if (scenario.toolName === "notion.getPageAsMarkdown") {
    return [
      {
        method: "notion.pages.markdown.retrieve",
        assertArgs: (args) => args.pageId === scenario.positiveInput.pageId,
      },
    ];
  }
  if (scenario.toolName === "notion.updatePageMarkdown") {
    return [
      {
        method: "notion.pages.markdown.update",
        requireIdempotencyKey: true,
        assertArgs: (args) =>
          args.pageId === scenario.positiveInput.pageId &&
          args.markdown === scenario.positiveInput.markdown,
      },
    ];
  }
  return scenario.expectedSdkCalls ?? [];
};

const assertExpectedSdkCalls = (
  scope: string,
  scenario: ProviderActionScenario,
  calls: ProviderSdkCallRecord[],
): void => {
  const expectedCalls = getExpectedSdkCalls(scenario);
  expect(expectedCalls.length, `${scope} must define expected SDK calls`).toBeGreaterThan(0);

  for (const expected of expectedCalls) {
    const matched = findCall(calls, expected.method, expected.assertArgs);
    expect(matched, `${scope} missing expected SDK call ${expected.method}`).toBeTruthy();
    if (expected.requireIdempotencyKey) {
      expect(
        typeof matched?.idempotencyKey === "string" && String(matched.idempotencyKey).length > 0,
        `${scope} expected idempotency key for ${expected.method}`,
      ).toBe(true);
    }
  }
};

const toConnectorGoldenExpectation = (
  scenario: ProviderActionScenario,
): ProviderActionGoldenResultExpectation | null => {
  const positive = scenario.golden?.positive;
  if (!positive) {
    return null;
  }
  const { hasActionId: _ignored, ...withoutActionId } = positive;
  if (scenario.toolName === "notion.getPage") {
    return {
      ...withoutActionId,
      outputShape: {
        ...withoutActionId.outputShape,
        archived: ["boolean", "object"] as ConformanceOutputValueType[],
      },
    };
  }
  return withoutActionId;
};

const toGoldenPayload = (result: Record<string, unknown>): Record<string, unknown> => {
  return {
    status: "succeeded",
    output: result,
  };
};

const prepareScenarioDependencies = async (
  pack: ProviderActionPack,
  scenario: ProviderActionScenario,
  harness: ReturnType<typeof createConnectorHarness>,
): Promise<void> => {
  const dependencies = scenarioDependenciesByTool[scenario.toolName] ?? [];
  if (dependencies.length === 0) {
    return;
  }
  for (const dependencyToolName of dependencies) {
    const dependencyScenario = pack.scenarios.find(
      (entry) => entry.toolName === dependencyToolName,
    );
    if (!dependencyScenario || dependencyScenario.capability !== "write") {
      throw new Error(
        `${scenario.toolName} requires dependency scenario ${dependencyToolName} before execution.`,
      );
    }
    const preparedDependency = await harness.connector.prepareWrite(
      dependencyScenario.toolName,
      dependencyScenario.positiveInput,
      harness.context,
    );
    await harness.connector.executeWrite(
      dependencyScenario.toolName,
      preparedDependency.normalized_payload,
      harness.context,
    );
  }
};

const executePositivePhase = async (
  pack: ProviderActionPack,
  scenario: ProviderActionScenario,
  providerId: SdkBackedProviderId,
): Promise<void> => {
  const harness = createConnectorHarness(providerId);
  await prepareScenarioDependencies(pack, scenario, harness);
  harness.resetCallLog();

  const scope = `${providerId}/${scenario.toolName}/positive`;
  if (scenario.capability === "read") {
    const result = await harness.connector.executeRead(
      scenario.toolName,
      scenario.positiveInput,
      harness.context,
    );
    expect(isRecord(result), `${scope} returned non-object`).toBe(true);
    const expectedGolden = toConnectorGoldenExpectation(scenario);
    if (expectedGolden) {
      assertGoldenResult(
        scope,
        normalizeConformanceResult(toGoldenPayload(result)),
        expectedGolden,
      );
    }
    assertExpectedSdkCalls(scope, scenario, harness.callLog.list(CONFORMANCE_NAMESPACE));
    return;
  }

  const prepared = await harness.connector.prepareWrite(
    scenario.toolName,
    scenario.positiveInput,
    harness.context,
  );
  const result = await harness.connector.executeWrite(
    scenario.toolName,
    prepared.normalized_payload,
    harness.context,
  );
  expect(isRecord(result), `${scope} returned non-object`).toBe(true);

  const expectedGolden = toConnectorGoldenExpectation(scenario);
  if (expectedGolden) {
    assertGoldenResult(scope, normalizeConformanceResult(toGoldenPayload(result)), expectedGolden);
  }
  assertExpectedSdkCalls(scope, scenario, harness.callLog.list(CONFORMANCE_NAMESPACE));
};

const executeNegativePhase = async (
  pack: ProviderActionPack,
  scenario: ProviderActionScenario,
  providerId: SdkBackedProviderId,
): Promise<void> => {
  const harness = createConnectorHarness(providerId);
  await prepareScenarioDependencies(pack, scenario, harness);
  harness.resetCallLog();

  const negativeMode = scenario.negativeMode ?? "invalid_input";
  const scope = `${providerId}/${scenario.toolName}/negative/${negativeMode}`;

  if (negativeMode === "invalid_input") {
    if (scenario.capability === "read") {
      await expect(
        harness.connector.executeRead(scenario.toolName, scenario.negativeInput, harness.context),
      ).rejects.toThrow();
    } else {
      await expect(
        harness.connector.prepareWrite(scenario.toolName, scenario.negativeInput, harness.context),
      ).rejects.toThrow();
    }

    try {
      if (scenario.capability === "read") {
        await harness.connector.executeRead(
          scenario.toolName,
          scenario.negativeInput,
          harness.context,
        );
      } else {
        await harness.connector.prepareWrite(
          scenario.toolName,
          scenario.negativeInput,
          harness.context,
        );
      }
    } catch (error) {
      if (scenario.golden?.negative) {
        assertGoldenError(scope, normalizeConformanceError(error), scenario.golden.negative);
      }
    }

    expect(
      harness.callLog.list(CONFORMANCE_NAMESPACE).length,
      `${scope} emitted SDK calls on invalid input`,
    ).toBe(0);
    return;
  }

  const disconnectedContext = {
    ...harness.context,
  };
  delete disconnectedContext.access_token;
  delete disconnectedContext.refresh_token;

  let thrown: unknown;
  if (scenario.capability === "read") {
    try {
      await harness.connector.executeRead(
        scenario.toolName,
        scenario.negativeInput,
        disconnectedContext,
      );
    } catch (error) {
      thrown = error;
    }
  } else {
    const prepared = await harness.connector.prepareWrite(
      scenario.toolName,
      scenario.positiveInput,
      harness.context,
    );
    try {
      await harness.connector.executeWrite(
        scenario.toolName,
        prepared.normalized_payload,
        disconnectedContext,
      );
    } catch (error) {
      thrown = error;
    }
  }

  expect(thrown, `${scope} unexpectedly succeeded`).toBeTruthy();
  const normalized = normalizeConformanceError(thrown);
  expect(
    ["auth", "not_connected"].includes(normalized.kind),
    `${scope} unexpected error kind`,
  ).toBe(true);
  expect(
    harness.callLog.list(CONFORMANCE_NAMESPACE).length,
    `${scope} emitted SDK calls on not_connected flow`,
  ).toBe(0);
};

const executeIdempotencyPhase = async (
  pack: ProviderActionPack,
  scenario: ProviderActionScenario,
  providerId: SdkBackedProviderId,
): Promise<void> => {
  if (scenario.capability !== "write") {
    return;
  }

  const expectedWithIdempotency = getExpectedSdkCalls(scenario).filter(
    (entry) => entry.requireIdempotencyKey,
  );
  expect(
    expectedWithIdempotency.length,
    `${providerId}/${scenario.toolName} has no idempotency SDK expectations`,
  ).toBeGreaterThan(0);

  const runOnce = async (): Promise<ProviderSdkCallRecord[]> => {
    const harness = createConnectorHarness(providerId);
    await prepareScenarioDependencies(pack, scenario, harness);
    harness.resetCallLog();

    const prepared = await harness.connector.prepareWrite(
      scenario.toolName,
      scenario.positiveInput,
      harness.context,
    );
    await harness.connector.executeWrite(
      scenario.toolName,
      prepared.normalized_payload,
      harness.context,
    );
    return harness.callLog.list(CONFORMANCE_NAMESPACE);
  };

  const firstCalls = await runOnce();
  const secondCalls = await runOnce();

  for (const expectation of expectedWithIdempotency) {
    const first = findCall(firstCalls, expectation.method, expectation.assertArgs);
    const second = findCall(secondCalls, expectation.method, expectation.assertArgs);

    expect(
      first,
      `${providerId}/${scenario.toolName} first call missing ${expectation.method}`,
    ).toBeTruthy();
    expect(
      second,
      `${providerId}/${scenario.toolName} second call missing ${expectation.method}`,
    ).toBeTruthy();

    const firstKey = typeof first?.idempotencyKey === "string" ? first.idempotencyKey : "";
    const secondKey = typeof second?.idempotencyKey === "string" ? second.idempotencyKey : "";

    expect(
      firstKey.length,
      `${providerId}/${scenario.toolName} missing first idempotency key`,
    ).toBeGreaterThan(0);
    expect(
      secondKey.length,
      `${providerId}/${scenario.toolName} missing second idempotency key`,
    ).toBeGreaterThan(0);
    expect(secondKey, `${providerId}/${scenario.toolName} idempotency key mismatch`).toBe(firstKey);
  }
};

const executeAuthScopePhase = async (
  scenario: ProviderActionScenario,
  providerId: SdkBackedProviderId,
): Promise<void> => {
  const harness = createConnectorHarness(providerId, {
    contextOverrides: {
      scopes: [],
    },
  });
  harness.resetCallLog();
  const scope = `${providerId}/${scenario.toolName}/auth-scope`;

  if (scenario.capability === "read") {
    await expect(
      harness.connector.executeRead(scenario.toolName, scenario.positiveInput, harness.context),
    ).rejects.toThrow(/scope/i);
  } else {
    await expect(
      harness.connector.prepareWrite(scenario.toolName, scenario.positiveInput, harness.context),
    ).rejects.toThrow(/scope/i);
  }

  expect(
    harness.callLog.list(CONFORMANCE_NAMESPACE).length,
    `${scope} emitted SDK calls with empty scopes`,
  ).toBe(0);
};

const sdkBackedPacks = providerActionPacks.filter((pack) => pack.providerId !== "custom");
const customScenarioCount =
  providerActionPacks.find((pack) => pack.providerId === "custom")?.scenarios.length ?? 0;
const expectedScenarioCount = providerActionScenarioCount - customScenarioCount;
const observedScenarioCount = sdkBackedPacks.reduce(
  (total, pack) => total + pack.scenarios.length,
  0,
);

describe("connector conformance (sdk-backed providers)", () => {
  it("covers every non-custom provider action scenario", () => {
    expect(observedScenarioCount).toBe(expectedScenarioCount);
  });

  for (const pack of sdkBackedPacks) {
    const providerId = pack.providerId as SdkBackedProviderId;
    describe(`${providerId} connector conformance`, () => {
      for (const scenario of pack.scenarios) {
        it(`${scenario.toolName}`, async () => {
          await executePositivePhase(pack, scenario, providerId);
          await executeNegativePhase(pack, scenario, providerId);
          await executeAuthScopePhase(scenario, providerId);
          await executeIdempotencyPhase(pack, scenario, providerId);
        });
      }
    });
  }
});
