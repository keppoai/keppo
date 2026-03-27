import { test, expect } from "../../fixtures/golden.fixture";
import {
  providerActionPacks,
  type ProviderActionPack,
  type ProviderActionScenario,
} from "../../../provider-conformance/action-matrix";
import {
  assertGoldenResult,
  normalizeConformanceResult,
} from "../../../provider-conformance/golden";
import { listProviderSdkCallsSince } from "../../helpers/api-client";
import { createResilientToolClient, waitForSuccessfulAction } from "../../helpers/mcp-client";

const TEST_TIMEOUT_MS = 60_000;

type SmokeScenarioSelection = {
  readScenarios: ProviderActionScenario[];
  writeScenario: ProviderActionScenario;
  includeReplay: boolean;
};

type SdkCallRecord = {
  method: string;
  args: Record<string, unknown>;
  idempotencyKey?: string;
};

const SIMPLE_READ_TOOL_BY_PROVIDER: Record<string, string> = {
  google: "gmail.listUnread",
  stripe: "stripe.listCharges",
  github: "github.listIssues",
  slack: "slack.listChannels",
  notion: "notion.searchPages",
  reddit: "reddit.searchPosts",
  x: "x.searchPosts",
  custom: "custom.callRead",
};

const WRITE_TOOL_BY_PROVIDER: Record<string, string> = {
  google: "gmail.sendEmail",
  stripe: "stripe.issueRefund",
  github: "github.commentIssue",
  slack: "slack.postMessage",
  notion: "notion.createPage",
  reddit: "reddit.createPost",
  x: "x.createPost",
  custom: "custom.callWrite",
};

const authUserOverrides = (
  providerId: string,
  metadata: {
    testId: string;
    workerIndex: number;
    retryIndex: number;
    repeatEachIndex: number;
  },
) => {
  const normalized =
    `${providerId}_${metadata.testId}_${String(metadata.workerIndex)}_${String(metadata.retryIndex)}_${String(metadata.repeatEachIndex)}`.replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    );
  return {
    fakeAuthUserId: `usr_${normalized}`,
    fakeAuthUserEmail: `${normalized}@example.com`,
    fakeAuthUserName: `E2E ${normalized}`,
  };
};

const matrixSeedOptions = (
  providerId: string,
  metadata: {
    testId: string;
    workerIndex: number;
    retryIndex: number;
    repeatEachIndex: number;
  },
) => {
  return {
    ...authUserOverrides(providerId, metadata),
    defaultActionBehavior: "auto_approve_all" as const,
    skipWorkspaceIntegrationBinding: true,
    skipUiWorkspaceSelectionSync: true,
  };
};

const createCachedSdkCallFetcher = (
  baseUrl: string,
  namespace: string,
  providerId: string,
): (() => Promise<Array<Record<string, unknown>>>) => {
  let cachedCalls: Array<Record<string, unknown>> = [];
  let cursor = 0;
  return async (): Promise<Array<Record<string, unknown>>> => {
    const next = await listProviderSdkCallsSince(baseUrl, namespace, providerId, cursor);
    if (next.total < cursor) {
      const resetSnapshot = await listProviderSdkCallsSince(baseUrl, namespace, providerId);
      cachedCalls = resetSnapshot.calls;
      cursor = resetSnapshot.total;
      return cachedCalls;
    }
    if (next.calls.length > 0) {
      cachedCalls = [...cachedCalls, ...next.calls];
    }
    cursor = next.total;
    return cachedCalls;
  };
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const toSdkCalls = (calls: Array<Record<string, unknown>>): SdkCallRecord[] => {
  return calls.map((entry) => {
    const idempotencyKeyValue = entry.idempotencyKey;
    return {
      method: String(entry.method ?? ""),
      args: asRecord(entry.args),
      ...(typeof idempotencyKeyValue === "string" && idempotencyKeyValue.length > 0
        ? { idempotencyKey: idempotencyKeyValue }
        : {}),
    };
  });
};

const countMatchingCalls = (
  calls: SdkCallRecord[],
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
  requireIdempotencyKey = false,
): number => {
  return calls.filter((call) => {
    if (call.method !== method) {
      return false;
    }
    if (requireIdempotencyKey && !call.idempotencyKey) {
      return false;
    }
    if (!assertArgs) {
      return true;
    }
    return assertArgs(call.args);
  }).length;
};

const idempotencyKeysFor = (
  calls: SdkCallRecord[],
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
): Set<string> => {
  const keys = new Set<string>();
  for (const call of calls) {
    if (call.method !== method) {
      continue;
    }
    if (assertArgs && !assertArgs(call.args)) {
      continue;
    }
    if (typeof call.idempotencyKey === "string" && call.idempotencyKey.length > 0) {
      keys.add(call.idempotencyKey);
    }
  }
  return keys;
};

const assertWriteSdkCalls = (
  scope: string,
  scenario: ProviderActionScenario,
  beforeCalls: SdkCallRecord[],
  afterCalls: SdkCallRecord[],
): void => {
  const expected = scenario.expectedSdkCalls ?? [];
  expect(expected.length, `${scope} must include expectedSdkCalls`).toBeGreaterThan(0);

  for (const entry of expected) {
    const beforeCount = countMatchingCalls(
      beforeCalls,
      entry.method,
      entry.assertArgs,
      entry.requireIdempotencyKey,
    );
    const afterCount = countMatchingCalls(
      afterCalls,
      entry.method,
      entry.assertArgs,
      entry.requireIdempotencyKey,
    );
    expect(afterCount, `${scope} missing SDK call ${entry.method}`).toBeGreaterThan(beforeCount);

    if (!entry.requireIdempotencyKey) {
      continue;
    }

    const matched = afterCalls.find((call) => {
      if (call.method !== entry.method) {
        return false;
      }
      if (entry.requireIdempotencyKey && !call.idempotencyKey) {
        return false;
      }
      if (!entry.assertArgs) {
        return true;
      }
      return entry.assertArgs(call.args);
    });
    expect(
      typeof matched?.idempotencyKey === "string" && matched.idempotencyKey.length > 0,
      `${scope} expected idempotency key on ${entry.method}`,
    ).toBe(true);
  }
};

const findScenario = (pack: ProviderActionPack, toolName: string): ProviderActionScenario => {
  const scenario = pack.scenarios.find((entry) => entry.toolName === toolName);
  if (!scenario) {
    throw new Error(`${pack.providerId} smoke selection missing scenario ${toolName}`);
  }
  return scenario;
};

const pickComplexReadScenario = (
  pack: ProviderActionPack,
  simpleReadToolName: string,
): ProviderActionScenario => {
  const complexByExpectedCalls = pack.scenarios.find(
    (entry) =>
      entry.capability === "read" &&
      entry.toolName !== simpleReadToolName &&
      (entry.expectedSdkCalls?.length ?? 0) > 1,
  );
  if (complexByExpectedCalls) {
    return complexByExpectedCalls;
  }

  const fallbackRead = pack.scenarios.find(
    (entry) => entry.capability === "read" && entry.toolName !== simpleReadToolName,
  );
  if (!fallbackRead) {
    throw new Error(`${pack.providerId} smoke selection requires a second read scenario`);
  }
  return fallbackRead;
};

const SMOKE_SCENARIOS: Record<string, SmokeScenarioSelection> = Object.fromEntries(
  providerActionPacks.map((pack) => {
    const simpleReadTool = SIMPLE_READ_TOOL_BY_PROVIDER[pack.providerId];
    const writeTool = WRITE_TOOL_BY_PROVIDER[pack.providerId];
    if (!simpleReadTool || !writeTool) {
      throw new Error(`Missing smoke selection mapping for ${pack.providerId}`);
    }

    const simpleReadScenario = findScenario(pack, simpleReadTool);
    const writeScenario = findScenario(pack, writeTool);

    if (pack.providerId === "custom") {
      return [
        pack.providerId,
        {
          readScenarios: [simpleReadScenario],
          writeScenario,
          includeReplay: false,
        },
      ];
    }

    const complexReadScenario = pickComplexReadScenario(pack, simpleReadTool);
    return [
      pack.providerId,
      {
        readScenarios: [simpleReadScenario, complexReadScenario],
        writeScenario,
        includeReplay: true,
      },
    ];
  }),
);

const smokeScenarioCount = Object.entries(SMOKE_SCENARIOS).reduce(
  (total, [providerId, selection]) => {
    const replayCount = selection.includeReplay ? 1 : 0;
    const providerTotal = selection.readScenarios.length + 1 + replayCount;
    if (providerId === "custom") {
      expect(providerTotal).toBe(2);
    } else {
      expect(providerTotal).toBe(4);
    }
    return total + providerTotal;
  },
  0,
);
expect(smokeScenarioCount).toBe(30);

test.describe("provider action matrix conformance", () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  for (const pack of providerActionPacks) {
    const smoke = SMOKE_SCENARIOS[pack.providerId];
    if (!smoke) {
      throw new Error(`Missing smoke scenarios for ${pack.providerId}`);
    }

    test(`${pack.providerId}-provider-action-matrix`, async ({ app, auth, provider }, testInfo) => {
      const seeded = await auth.seedWorkspaceWithProvider(
        `action-matrix-${pack.providerId}`,
        pack.providerId,
        {},
        matrixSeedOptions(pack.providerId, app.metadata),
      );
      await auth.setOrgSubscription(seeded.orgId, "pro");

      const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
      try {
        await mcp.initialize();
        const resilientClient = createResilientToolClient(mcp);

        for (const scenario of smoke.readScenarios) {
          const response = await resilientClient.callTool(
            scenario.toolName,
            scenario.positiveInput,
          );
          expect(response.status, `${pack.providerId}/${scenario.toolName} read status`).toBe(
            "succeeded",
          );
          if (scenario.golden?.positive) {
            assertGoldenResult(
              `${pack.providerId}/${scenario.toolName} read`,
              normalizeConformanceResult(response),
              scenario.golden.positive,
            );
          }
        }

        const writeScenario = smoke.writeScenario;
        const fetchSdkCalls =
          pack.providerId === "custom"
            ? null
            : createCachedSdkCallFetcher(
                app.fakeGatewayBaseUrl,
                app.namespace,
                pack.gatewayProviderId ?? pack.providerId,
              );

        const beforeWriteCalls = fetchSdkCalls ? toSdkCalls(await fetchSdkCalls()) : [];
        const writeResponse = await resilientClient.callTool(
          writeScenario.toolName,
          writeScenario.positiveInput,
        );

        expect(["succeeded", "approval_required", "approved", "executing", "pending"]).toContain(
          String(writeResponse.status ?? ""),
        );
        const settledWriteResponse = await waitForSuccessfulAction(resilientClient, {
          scope: `${pack.providerId}/${writeScenario.toolName}`,
          response: writeResponse,
        });
        if (writeScenario.golden?.positive) {
          assertGoldenResult(
            `${pack.providerId}/${writeScenario.toolName} write`,
            normalizeConformanceResult(settledWriteResponse),
            writeScenario.golden.positive,
          );
        }

        if (fetchSdkCalls) {
          let afterWriteCalls = toSdkCalls(await fetchSdkCalls());
          const expectedCalls = writeScenario.expectedSdkCalls ?? [];
          const deadline = Date.now() + 2_000;
          while (
            expectedCalls.some((entry) => {
              const beforeCount = countMatchingCalls(
                beforeWriteCalls,
                entry.method,
                entry.assertArgs,
                entry.requireIdempotencyKey,
              );
              const afterCount = countMatchingCalls(
                afterWriteCalls,
                entry.method,
                entry.assertArgs,
                entry.requireIdempotencyKey,
              );
              return afterCount <= beforeCount;
            }) &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            afterWriteCalls = toSdkCalls(await fetchSdkCalls());
          }

          assertWriteSdkCalls(
            `${pack.providerId}/${writeScenario.toolName} write-sdk-calls`,
            writeScenario,
            beforeWriteCalls,
            afterWriteCalls,
          );

          if (smoke.includeReplay) {
            const replay = await resilientClient.callTool(
              writeScenario.toolName,
              writeScenario.positiveInput,
            );
            expect(replay.status).toBe("idempotent_replay");
            if (writeScenario.golden?.idempotency) {
              assertGoldenResult(
                `${pack.providerId}/${writeScenario.toolName} replay`,
                normalizeConformanceResult(replay),
                writeScenario.golden.idempotency,
              );
            }

            const afterReplayCalls = toSdkCalls(await fetchSdkCalls());
            for (const entry of writeScenario.expectedSdkCalls ?? []) {
              const writeCount = countMatchingCalls(
                afterWriteCalls,
                entry.method,
                entry.assertArgs,
                entry.requireIdempotencyKey,
              );
              const replayCount = countMatchingCalls(
                afterReplayCalls,
                entry.method,
                entry.assertArgs,
                entry.requireIdempotencyKey,
              );
              if (entry.requireIdempotencyKey) {
                const writeKeys = idempotencyKeysFor(
                  afterWriteCalls,
                  entry.method,
                  entry.assertArgs,
                );
                const replayKeys = idempotencyKeysFor(
                  afterReplayCalls,
                  entry.method,
                  entry.assertArgs,
                );
                expect(
                  replayKeys.size,
                  `${pack.providerId}/${writeScenario.toolName} replay emitted unexpected idempotency key count for ${entry.method}`,
                ).toBe(writeKeys.size);
                for (const key of writeKeys) {
                  expect(
                    replayKeys.has(key),
                    `${pack.providerId}/${writeScenario.toolName} replay idempotency key changed for ${entry.method}`,
                  ).toBe(true);
                }
                expect(
                  replayCount,
                  `${pack.providerId}/${writeScenario.toolName} replay emitted ${entry.method}`,
                ).toBeGreaterThanOrEqual(writeCount);
                continue;
              }

              expect(
                replayCount,
                `${pack.providerId}/${writeScenario.toolName} replay emitted ${entry.method}`,
              ).toBeGreaterThanOrEqual(writeCount);
            }
          }
        } else if (smoke.includeReplay) {
          const replay = await resilientClient.callTool(
            writeScenario.toolName,
            writeScenario.positiveInput,
          );
          expect(replay.status).toBe("idempotent_replay");
          if (writeScenario.golden?.idempotency) {
            assertGoldenResult(
              `${pack.providerId}/${writeScenario.toolName} replay`,
              normalizeConformanceResult(replay),
              writeScenario.golden.idempotency,
            );
          }
        }
      } finally {
        await mcp.close();
      }
    });
  }
});
