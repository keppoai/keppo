import type { ActionCapability, ProviderActionPack, ProviderActionScenario } from "./action-matrix";
import {
  assertGoldenError,
  assertGoldenResult,
  normalizeConformanceError,
  normalizeConformanceResult,
} from "./golden";
import { waitForSuccessfulAction } from "../e2e/helpers/mcp-client";

export type ToolClient = {
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type SdkCallRecord = {
  method?: unknown;
  args?: unknown;
  idempotencyKey?: unknown;
};

export type RunProviderActionConformanceOptions = {
  client: ToolClient;
  pack: ProviderActionPack;
  fetchSdkCalls?: () => Promise<SdkCallRecord[]>;
  assertSdkCalls: boolean;
  assertGolden?: boolean;
  disconnectProvider?: () => Promise<void>;
  reconnectProvider?: () => Promise<void>;
  includeCapabilities?: ActionCapability[];
  runNegativeCases?: boolean;
  runAuthScopeCases?: boolean;
  runIdempotencyCases?: boolean;
  /** Run the per-scenario positive/negative/idempotency loop. Default true. */
  runMainCases?: boolean;
  onlyTools?: string[];
};

const providerActionDebugEnabled = process.env.KEPPO_PROVIDER_ACTION_DEBUG === "1";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const debugLog = (...parts: Array<string | number>): void => {
  if (!providerActionDebugEnabled) {
    return;
  }
  console.log(`[provider-action][${new Date().toISOString()}]`, ...parts);
};

const toMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isValidationFailure = (error: unknown): boolean => {
  const message = toMessage(error).toLowerCase();
  return (
    message.includes("invalid input") ||
    message.includes("invalid request") ||
    message.includes("validation") ||
    message.includes("must")
  );
};

const includesStatus = (
  payload: Record<string, unknown>,
  allowed: string[],
  context: string,
): string => {
  const status = String(payload.status ?? "");
  assert(
    allowed.includes(status),
    `${context} returned unexpected status "${status}" (allowed: ${allowed.join(", ")}).`,
  );
  return status;
};

const waitForDisconnectedAuthState = async (
  client: ToolClient,
  scenarios: ProviderActionScenario[],
): Promise<void> => {
  const probeScenario = scenarios.find((scenario) => scenario.capability === "read");
  if (!probeScenario) {
    return;
  }

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      await client.callTool(probeScenario.toolName, probeScenario.positiveInput);
    } catch (error) {
      const kind = normalizeConformanceError(error).kind;
      if (kind === "auth" || kind === "not_connected") {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const isMatchingCall = (
  call: SdkCallRecord,
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
): boolean => {
  if (String(call.method ?? "") !== method) {
    return false;
  }
  if (!assertArgs) {
    return true;
  }
  return assertArgs(asRecord(call.args));
};

const findMatchingCall = (
  calls: SdkCallRecord[],
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
): SdkCallRecord | null => {
  for (const call of calls) {
    if (isMatchingCall(call, method, assertArgs)) {
      return call;
    }
  }
  return null;
};

const countMatchingCalls = (
  calls: SdkCallRecord[],
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
): number => {
  let count = 0;
  for (const call of calls) {
    if (isMatchingCall(call, method, assertArgs)) {
      count += 1;
    }
  }
  return count;
};

const buildMethodCounts = (calls: SdkCallRecord[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const method = String(call.method ?? "");
    if (!method) {
      continue;
    }
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  return counts;
};

const assertNoMethodCountIncrease = (
  scope: string,
  phase: string,
  before: SdkCallRecord[],
  after: SdkCallRecord[],
): void => {
  const beforeCounts = buildMethodCounts(before);
  const afterCounts = buildMethodCounts(after);
  const methods = new Set<string>([...beforeCounts.keys(), ...afterCounts.keys()]);
  for (const method of methods) {
    const beforeCount = beforeCounts.get(method) ?? 0;
    const afterCount = afterCounts.get(method) ?? 0;
    assert(
      afterCount <= beforeCount,
      `${scope} ${phase} emitted SDK call ${method} (${beforeCount} -> ${afterCount}).`,
    );
  }
};

const hasExpectedCallIncrements = (
  before: SdkCallRecord[],
  after: SdkCallRecord[],
  expectations: Array<{
    method: string;
    assertArgs?: (args: Record<string, unknown>) => boolean;
  }>,
): boolean => {
  for (const expectation of expectations) {
    const beforeCount = countMatchingCalls(before, expectation.method, expectation.assertArgs);
    const afterCount = countMatchingCalls(after, expectation.method, expectation.assertArgs);
    if (afterCount <= beforeCount) {
      return false;
    }
  }
  return true;
};

const filterScenarios = (
  scenarios: ProviderActionScenario[],
  includeCapabilities: ActionCapability[] | undefined,
  onlyTools: string[] | undefined,
): ProviderActionScenario[] => {
  const capabilitySet = new Set(includeCapabilities ?? ["read", "write"]);
  const onlyToolSet = onlyTools ? new Set(onlyTools) : null;
  return scenarios.filter((scenario) => {
    if (!capabilitySet.has(scenario.capability)) {
      return false;
    }
    if (onlyToolSet && !onlyToolSet.has(scenario.toolName)) {
      return false;
    }
    return true;
  });
};

export const runProviderActionConformance = async (
  options: RunProviderActionConformanceOptions,
): Promise<void> => {
  const runMainCases = options.runMainCases ?? true;
  const runNegativeCases = options.runNegativeCases ?? true;
  const runAuthScopeCases = options.runAuthScopeCases ?? true;
  const runIdempotencyCases = options.runIdempotencyCases ?? true;
  const assertGolden = options.assertGolden ?? true;
  const scenarios = filterScenarios(
    options.pack.scenarios,
    options.includeCapabilities,
    options.onlyTools,
  );

  assert(scenarios.length > 0, `No conformance scenarios selected for ${options.pack.providerId}.`);

  if (runMainCases) {
    for (const scenario of scenarios) {
      const scope = `${options.pack.providerId}/${scenario.toolName}`;
      const scenarioStartMs = Date.now();
      debugLog(scope, "start");
      try {
        const beforePositive = options.fetchSdkCalls ? await options.fetchSdkCalls() : [];
        const initialPositive = await options.client.callTool(
          scenario.toolName,
          scenario.positiveInput,
        );

        if (scenario.capability === "read") {
          includesStatus(initialPositive, ["succeeded"], `${scope} positive`);
        } else {
          includesStatus(
            initialPositive,
            ["succeeded", "approval_required", "approved", "executing", "pending"],
            `${scope} positive`,
          );
        }

        const positive =
          scenario.capability === "write"
            ? await waitForSuccessfulAction(options.client, {
                scope,
                response: initialPositive,
              })
            : initialPositive;

        if (assertGolden) {
          assert(!!scenario.golden?.positive, `${scope} is missing positive golden expectation.`);
          assertGoldenResult(
            `${scope} positive`,
            normalizeConformanceResult(positive),
            scenario.golden!.positive,
          );
        }

        const expectations = scenario.expectedSdkCalls ?? [];
        if (options.assertSdkCalls) {
          assert(
            typeof options.fetchSdkCalls === "function",
            `${scope} requires fetchSdkCalls when assertSdkCalls is enabled.`,
          );
          assert(
            expectations.length > 0,
            `${scope} is missing expectedSdkCalls while SDK assertion mode is enabled.`,
          );
        }

        let afterPositive = options.fetchSdkCalls ? await options.fetchSdkCalls() : [];
        if (options.assertSdkCalls && options.fetchSdkCalls) {
          const deadline = Date.now() + 2_000;
          while (
            !hasExpectedCallIncrements(beforePositive, afterPositive, expectations) &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            afterPositive = await options.fetchSdkCalls();
          }
        }
        const newPositiveCalls =
          afterPositive.length >= beforePositive.length
            ? afterPositive.slice(beforePositive.length)
            : afterPositive;

        if (options.assertSdkCalls) {
          for (const expectation of expectations) {
            const beforeCount = countMatchingCalls(
              beforePositive,
              expectation.method,
              expectation.assertArgs,
            );
            const afterCount = countMatchingCalls(
              afterPositive,
              expectation.method,
              expectation.assertArgs,
            );
            assert(
              afterCount > beforeCount,
              `${scope} produced no new SDK call ${expectation.method} on positive path.`,
            );
            if (expectation.requireIdempotencyKey) {
              const matched =
                findMatchingCall(newPositiveCalls, expectation.method, expectation.assertArgs) ??
                findMatchingCall(afterPositive, expectation.method, expectation.assertArgs);
              assert(
                typeof matched?.idempotencyKey === "string" &&
                  String(matched.idempotencyKey).length > 0,
                `${scope} expected SDK call ${expectation.method} to include idempotencyKey.`,
              );
            }
          }
        }

        if (runNegativeCases) {
          const beforeNegative = options.fetchSdkCalls ? await options.fetchSdkCalls() : [];
          let afterNegativeSnapshot: SdkCallRecord[] | null = null;
          let rejected = false;
          let normalizedError: ReturnType<typeof normalizeConformanceError> | null = null;
          const negativeMode = scenario.negativeMode ?? "invalid_input";

          if (negativeMode === "not_connected") {
            assert(
              typeof options.disconnectProvider === "function" &&
                typeof options.reconnectProvider === "function",
              `${scope} negative mode not_connected requires disconnectProvider/reconnectProvider hooks.`,
            );
            await options.disconnectProvider?.();
          }

          try {
            try {
              await options.client.callTool(scenario.toolName, scenario.negativeInput);
            } catch (error) {
              rejected = true;
              normalizedError = normalizeConformanceError(error);
              if (negativeMode === "not_connected") {
                const message = toMessage(error).toLowerCase();
                assert(
                  message.includes("not connected"),
                  `${scope} not_connected negative path returned unexpected error: ${toMessage(error)}`,
                );
              } else {
                assert(
                  isValidationFailure(error),
                  `${scope} negative path returned unexpected error: ${toMessage(error)}`,
                );
              }
            }
          } finally {
            if (options.assertSdkCalls && options.fetchSdkCalls) {
              // Capture call-log state before reconnect hooks because reconnect can legitimately emit SDK calls.
              afterNegativeSnapshot = await options.fetchSdkCalls();
            }
            if (negativeMode === "not_connected") {
              await options.reconnectProvider?.();
            }
          }
          assert(rejected, `${scope} negative path unexpectedly succeeded.`);
          if (assertGolden) {
            assert(!!scenario.golden?.negative, `${scope} is missing negative golden expectation.`);
            assert(normalizedError !== null, `${scope} did not capture normalized negative error.`);
            assertGoldenError(`${scope} negative`, normalizedError!, scenario.golden!.negative);
          }

          if (options.assertSdkCalls && options.fetchSdkCalls && scenario.capability === "read") {
            const afterNegative = afterNegativeSnapshot ?? (await options.fetchSdkCalls());
            assertNoMethodCountIncrease(scope, "negative path", beforeNegative, afterNegative);
          }
        }

        if (runIdempotencyCases && scenario.capability === "write") {
          const replay = await options.client.callTool(scenario.toolName, scenario.positiveInput);
          includesStatus(replay, ["idempotent_replay"], `${scope} idempotency replay`);
          if (assertGolden) {
            assert(
              !!scenario.golden?.idempotency,
              `${scope} is missing idempotency golden expectation.`,
            );
            assertGoldenResult(
              `${scope} idempotency replay`,
              normalizeConformanceResult(replay),
              scenario.golden!.idempotency!,
            );
          }

          if (typeof positive.action_id === "string" && positive.action_id.length > 0) {
            assert(
              replay.action_id === positive.action_id,
              `${scope} replay action_id mismatch (${String(positive.action_id)} vs ${String(replay.action_id)}).`,
            );
          }
        }
      } finally {
        debugLog(scope, "end", `${Date.now() - scenarioStartMs}ms`);
      }
    }
  }

  if (
    runAuthScopeCases &&
    options.pack.providerId !== "custom" &&
    options.disconnectProvider &&
    options.reconnectProvider
  ) {
    await options.disconnectProvider();
    try {
      await waitForDisconnectedAuthState(options.client, scenarios);
      for (const scenario of scenarios) {
        const scope = `${options.pack.providerId}/${scenario.toolName}`;
        const beforeAuth = options.fetchSdkCalls ? await options.fetchSdkCalls() : [];
        let rejected = false;
        let normalizedError: ReturnType<typeof normalizeConformanceError> | null = null;
        try {
          await options.client.callTool(scenario.toolName, scenario.positiveInput);
        } catch (error) {
          rejected = true;
          normalizedError = normalizeConformanceError(error);
        }

        assert(rejected, `${scope} auth/scope path unexpectedly succeeded.`);
        assert(normalizedError !== null, `${scope} auth/scope path did not produce an error.`);
        assert(
          normalizedError!.kind === "auth" || normalizedError!.kind === "not_connected",
          `${scope} auth/scope path returned unexpected error kind ${normalizedError!.kind}: ${normalizedError!.message}`,
        );

        if (options.assertSdkCalls && options.fetchSdkCalls) {
          const afterAuth = await options.fetchSdkCalls();
          assertNoMethodCountIncrease(scope, "auth/scope path", beforeAuth, afterAuth);
        }
      }
    } finally {
      await options.reconnectProvider();
    }
  }
};
