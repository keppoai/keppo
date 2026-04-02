import { describe, expect, it } from "vitest";
import {
  AUTOMATION_TIER_LIMITS,
  createAutomationRouteError,
  parseAutomationRouteErrorCode,
  toAutomationRouteError,
  AI_CREDIT_ALLOWANCES,
  AI_CREDIT_EXPIRY_DAYS,
  AI_CREDIT_PACKAGES,
  AI_CREDIT_USAGE_SOURCE,
  AUTOMATION_RUN_PACKAGES,
  AUTOMATION_RUN_TOPUP_EXPIRY_DAYS,
  AI_KEY_MODE,
  DYAD_GATEWAY_BUDGET_AI_CREDITS,
  DYAD_GATEWAY_BUDGET_USD_PER_300_AI_CREDITS,
  INCLUDED_AI_CREDITS,
  TOOL_CALLS_PER_RUN_MULTIPLIER,
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE,
  AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUS,
  AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS,
  buildLegacyEventProviderTrigger,
  buildLegacyEventProviderTriggerMigrationState,
  computeAutomationPromptHash,
  convertAiCreditsToDyadGatewayBudgetUsd,
  getAiKeyModeLabel,
  getAiModelProviderLabel,
  getAiCreditAllowance,
  getAutomationRunPackagesForTier,
  getIncludedAiCredits,
  getAutomationTierLimits,
  isAutomationLimitReached,
  isAutomationMermaidStale,
  isConcurrencyLimitReached,
  isRunPeriodLimitReached,
  resolveAutomationExecutionReadiness,
  supportsBundledAiRuntime,
} from "./automations.js";

describe("automations", () => {
  it("exposes tier limits for each subscription tier", () => {
    expect(getAutomationTierLimits("free")).toEqual(AUTOMATION_TIER_LIMITS.free);
    expect(getAutomationTierLimits("starter")).toEqual(AUTOMATION_TIER_LIMITS.starter);
    expect(getAutomationTierLimits("pro")).toEqual(AUTOMATION_TIER_LIMITS.pro);
  });

  it("checks automation count limits", () => {
    expect(isAutomationLimitReached("free", 1)).toBe(false);
    expect(isAutomationLimitReached("free", 2)).toBe(true);
  });

  it("checks run budget limits", () => {
    expect(isRunPeriodLimitReached("starter", 1_499)).toBe(false);
    expect(isRunPeriodLimitReached("starter", 1_500)).toBe(true);
  });

  it("checks concurrent run limits", () => {
    expect(isConcurrencyLimitReached("pro", 9)).toBe(false);
    expect(isConcurrencyLimitReached("pro", 10)).toBe(true);
  });

  it("returns AI credit allowance by tier", () => {
    expect(getAiCreditAllowance("free")).toBe(AI_CREDIT_ALLOWANCES.free);
    expect(getAiCreditAllowance("starter")).toBe(AI_CREDIT_ALLOWANCES.starter);
    expect(getAiCreditAllowance("pro")).toBe(AI_CREDIT_ALLOWANCES.pro);
    expect(AI_CREDIT_ALLOWANCES).toEqual({
      free: 20,
      starter: 100,
      pro: 300,
    });
  });

  it("describes bundled-runtime eligibility for included credits", () => {
    expect(getIncludedAiCredits("free")).toEqual(INCLUDED_AI_CREDITS.free);
    expect(getIncludedAiCredits("starter")).toEqual(INCLUDED_AI_CREDITS.starter);
    expect(getIncludedAiCredits("pro")).toEqual(INCLUDED_AI_CREDITS.pro);
    expect(supportsBundledAiRuntime("free")).toBe(true);
    expect(supportsBundledAiRuntime("starter")).toBe(true);
    expect(supportsBundledAiRuntime("pro")).toBe(true);
  });

  it("derives hosted automation execution mode from org credit state", () => {
    expect(
      resolveAutomationExecutionReadiness({
        bundledRuntimeEnabled: true,
        totalCreditsAvailable: 3,
        hasActiveByokKey: false,
      }),
    ).toMatchObject({
      mode: "bundled",
      can_run: true,
      requires_byok: false,
    });
    expect(
      resolveAutomationExecutionReadiness({
        bundledRuntimeEnabled: true,
        totalCreditsAvailable: 0,
        hasActiveByokKey: true,
      }),
    ).toMatchObject({
      mode: "bundled",
      can_run: false,
      requires_byok: false,
    });
    expect(
      resolveAutomationExecutionReadiness({
        bundledRuntimeEnabled: false,
        totalCreditsAvailable: 5,
        hasActiveByokKey: false,
      }),
    ).toMatchObject({
      mode: "byok",
      can_run: false,
      bundled_runtime_enabled: false,
    });
    expect(
      resolveAutomationExecutionReadiness({
        bundledRuntimeEnabled: false,
        totalCreditsAvailable: 0,
        hasActiveByokKey: true,
      }),
    ).toMatchObject({
      mode: "byok",
      can_run: true,
      requires_byok: true,
    });
  });

  it("exposes bundled mode and credit usage source helpers", () => {
    expect(AI_KEY_MODE.bundled).toBe("bundled");
    expect(AI_CREDIT_USAGE_SOURCE.generation).toBe("generation");
    expect(AI_CREDIT_USAGE_SOURCE.runtime).toBe("runtime");
  });

  it("describes AI provider and credential labels consistently", () => {
    expect(getAiModelProviderLabel("openai")).toBe("OpenAI");
    expect(getAiModelProviderLabel("anthropic")).toBe("Anthropic");
    expect(getAiKeyModeLabel("byok")).toBe("API key");
    expect(getAiKeyModeLabel("bundled")).toBe("bundled gateway key");
    expect(getAiKeyModeLabel("subscription_token")).toBe("subscription token");
  });

  it("converts product credits into Dyad gateway budget units with shared math", () => {
    expect(DYAD_GATEWAY_BUDGET_USD_PER_300_AI_CREDITS).toBe(20);
    expect(DYAD_GATEWAY_BUDGET_AI_CREDITS).toBe(300);
    expect(convertAiCreditsToDyadGatewayBudgetUsd(300)).toBe(20);
    expect(convertAiCreditsToDyadGatewayBudgetUsd(100)).toBeCloseTo(6.6667, 4);
    expect(convertAiCreditsToDyadGatewayBudgetUsd(0)).toBe(0);
  });

  it("keeps purchased package and expiry constants stable", () => {
    expect(AI_CREDIT_PACKAGES).toEqual([
      { price_cents: 1_000, credits: 100 },
      { price_cents: 2_500, credits: 250 },
    ]);
    expect(AI_CREDIT_EXPIRY_DAYS).toBe(90);
  });

  it("keeps automation top-up packages proportional to run budgets", () => {
    expect(TOOL_CALLS_PER_RUN_MULTIPLIER).toBe(50);
    expect(getAutomationRunPackagesForTier("free")).toEqual([]);
    expect(getAutomationRunPackagesForTier("starter")).toEqual(AUTOMATION_RUN_PACKAGES.starter);
    expect(getAutomationRunPackagesForTier("pro")).toEqual(AUTOMATION_RUN_PACKAGES.pro);
    expect(AUTOMATION_RUN_TOPUP_EXPIRY_DAYS).toBe(90);
    for (const packages of Object.values(AUTOMATION_RUN_PACKAGES)) {
      for (const pkg of packages) {
        expect(pkg.tool_calls).toBe(pkg.runs * TOOL_CALLS_PER_RUN_MULTIPLIER);
      }
    }
  });

  it("formats and parses typed automation-route errors", () => {
    const error = createAutomationRouteError(
      "missing_automation_run_id",
      "automation_run_id is required",
    );
    expect(error.message).toBe("missing_automation_run_id: automation_run_id is required");
    expect(parseAutomationRouteErrorCode(error.message)).toBe("missing_automation_run_id");
  });

  it("normalizes untyped errors to typed automation-route errors", () => {
    const normalized = toAutomationRouteError(new Error("boom"), "invalid_payload");
    expect(normalized.message).toBe("invalid_payload: boom");
    expect(parseAutomationRouteErrorCode(normalized.message)).toBe("invalid_payload");
  });

  it("builds compatibility provider-trigger definitions from legacy event fields", () => {
    expect(
      buildLegacyEventProviderTrigger({
        eventProvider: "github",
        eventType: "issues.opened",
        eventPredicate: "payload.action == 'opened'",
      }),
    ).toEqual({
      provider_id: "github",
      trigger_key: "issues.opened",
      schema_version: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
      filter: {
        predicate: "payload.action == 'opened'",
      },
      delivery: {
        preferred_mode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook,
        supported_modes: [
          AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook,
          AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
        ],
        fallback_mode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      },
      subscription_state: {
        status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.inactive,
        active_mode: null,
        last_error: null,
        updated_at: null,
      },
    });

    expect(
      buildLegacyEventProviderTriggerMigrationState({
        eventProvider: "github",
        eventType: "issues.opened",
        eventPredicate: "payload.action == 'opened'",
      }),
    ).toEqual({
      status: AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUS.legacyPassthrough,
      message:
        "This trigger was migrated from legacy event fields and still needs a provider-owned schema.",
      legacy_event_provider: "github",
      legacy_event_type: "issues.opened",
      legacy_event_predicate: "payload.action == 'opened'",
    });
  });

  it("hashes prompts and detects stale mermaid diagrams", () => {
    const promptHash = computeAutomationPromptHash("Summarize alerts every weekday at 9 AM");

    expect(promptHash).toMatch(/^[a-f0-9]{8}$/);
    expect(
      isAutomationMermaidStale({
        prompt: "Summarize alerts every weekday at 9 AM",
        mermaidContent: "flowchart TD\nA-->B",
        mermaidPromptHash: promptHash,
      }),
    ).toBe(false);
    expect(
      isAutomationMermaidStale({
        prompt: "Summarize alerts every weekday at 10 AM",
        mermaidContent: "flowchart TD\nA-->B",
        mermaidPromptHash: promptHash,
      }),
    ).toBe(true);
  });
});
