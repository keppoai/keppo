import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CREDIT_ERROR_CODE } from "@keppo/shared/ai-credit-errors";
import { AUTOMATION_RUN_LOG_LEVEL } from "@keppo/shared/automations";
import {
  dispatchStartOwnedAutomationRuntimeRequest,
  handleInternalAutomationDispatchRequest,
  handleInternalAutomationTerminateRequest,
} from "./automation-runtime";
import { hasValidAutomationCallbackSignature } from "./api-runtime/routes/automations.ts";

const encryptStoredKeyForTest = async (secret: string, rawValue: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(rawValue),
  );
  const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  return `keppo-v1.${toHex(iv)}.${toHex(new Uint8Array(encrypted))}`;
};

const defaultTestEnv = {
  BETTER_AUTH_SECRET: "keppo-better-auth-fallback-secret",
  KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS: 60_000,
  KEPPO_LLM_GATEWAY_URL: undefined,
  KEPPO_AUTOMATION_MCP_SERVER_URL: undefined,
  KEPPO_CALLBACK_HMAC_SECRET: "keppo-callback-secret-for-start-runtime-tests",
  VERCEL_AUTOMATION_BYPASS_SECRET: "bypass_secret_test",
};

const createDeps = () => {
  const convex = {
    appendAutomationRunLog: vi.fn().mockResolvedValue(undefined),
    appendAutomationRunLogBatch: vi.fn().mockResolvedValue(undefined),
    claimAutomationRunDispatchContext: vi.fn().mockResolvedValue(null),
    createRun: vi.fn().mockResolvedValue({ id: "run_test" }),
    deductAiCredit: vi.fn().mockResolvedValue({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 0,
      allowance_remaining: 100,
      purchased_remaining: 0,
      total_available: 100,
      bundled_runtime_enabled: true,
    }),
    getAiCreditBalance: vi.fn().mockResolvedValue({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 100,
      allowance_remaining: 0,
      purchased_remaining: 0,
      total_available: 0,
      bundled_runtime_enabled: false,
    }),
    getAutomationRunDispatchContext: vi.fn().mockResolvedValue(null),
    getOrgAiKey: vi.fn().mockResolvedValue(null),
    issueAutomationWorkspaceCredential: vi.fn().mockResolvedValue("keppo_secret_test"),
    updateAutomationRunStatus: vi.fn().mockResolvedValue(undefined),
    upsertOpenAiOauthKey: vi.fn().mockResolvedValue(undefined),
  };
  const sandboxProvider = {
    dispatch: vi.fn().mockResolvedValue({ sandbox_id: "sandbox_test" }),
    terminate: vi.fn().mockResolvedValue(undefined),
  };

  return {
    authorizeInternalRequest: vi.fn((authorizationHeader: string | undefined) => ({
      ok: authorizationHeader === "Bearer secret_token",
      ...(authorizationHeader === "Bearer secret_token"
        ? {}
        : {
            reason: authorizationHeader ? "invalid_secret" : "missing_secret",
          }),
    })),
    convex,
    createSandboxProvider: vi.fn(() => sandboxProvider),
    getEnv: vi.fn(() => ({ ...defaultTestEnv }) as never),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    parseJsonPayload: (raw: string) => JSON.parse(raw),
    sandboxProvider,
  };
};

const withJson = (path: string, body: unknown, headers?: HeadersInit): Request =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("start-owned automation runtime handlers", () => {
  const originalEnv = {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    KEPPO_API_INTERNAL_BASE_URL: process.env.KEPPO_API_INTERNAL_BASE_URL,
    KEPPO_CALLBACK_HMAC_SECRET: process.env.KEPPO_CALLBACK_HMAC_SECRET,
    KEPPO_ENVIRONMENT: process.env.KEPPO_ENVIRONMENT,
    KEPPO_MASTER_KEY: process.env.KEPPO_MASTER_KEY,
    NODE_ENV: process.env.NODE_ENV,
    KEPPO_SANDBOX_PROVIDER: process.env.KEPPO_SANDBOX_PROVIDER,
    VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  };

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "keppo-better-auth-fallback-secret";
    process.env.KEPPO_CALLBACK_HMAC_SECRET = "keppo-callback-secret-for-start-runtime-tests";
    process.env.KEPPO_MASTER_KEY = "keppo-master-key-for-start-runtime-tests";
    process.env.NODE_ENV = "test";
    process.env.KEPPO_SANDBOX_PROVIDER = "docker";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass_secret_test";
    delete process.env.KEPPO_API_INTERNAL_BASE_URL;
    delete process.env.KEPPO_ENVIRONMENT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("terminates an active sandbox from the Start-owned internal route", async () => {
    const deps = createDeps();
    deps.convex.getAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_1",
        automation_id: "automation_1",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "running",
        sandbox_id: "sandbox_123",
      },
      automation: {
        id: "automation_1",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Daily triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Do work",
        network_access: "mcp_only",
      },
    });

    const response = await handleInternalAutomationTerminateRequest(
      withJson(
        "/internal/automations/terminate",
        { automation_run_id: "arun_1" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      terminated: true,
      sandbox_id: "sandbox_123",
    });
    expect(deps.sandboxProvider.terminate).toHaveBeenCalledWith("sandbox_123");
    expect(deps.convex.appendAutomationRunLog).toHaveBeenCalledWith({
      automationRunId: "arun_1",
      level: AUTOMATION_RUN_LOG_LEVEL.system,
      content: "Terminated sandbox sandbox_123",
    });
  });

  it("dispatches sandbox runs from the Start-owned internal route", async () => {
    const deps = createDeps();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_dispatch_test",
        automation_id: "automation_dispatch_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_dispatch_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Daily triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_dispatch_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convex.claimAutomationRunDispatchContext).toHaveBeenCalledWith({
      automationRunId: "arun_dispatch_test",
      dispatchToken: "dispatch_token_test",
    });
    const dispatchArg = deps.sandboxProvider.dispatch.mock.calls[0]?.[0];
    expect(dispatchArg).toMatchObject({
      bootstrap: {
        command:
          "mkdir -p '/sandbox/.keppo-codex-home' && export HOME='/sandbox/.keppo-codex-home' && codex mcp add keppo --url \"$KEPPO_MCP_SERVER_URL\" --bearer-token-env-var KEPPO_MCP_BEARER_TOKEN",
        env: {},
        network_access: "package_registry_only",
      },
      runtime: {
        network_access: "mcp_only",
        env: expect.objectContaining({
          OPENAI_API_KEY: "openai-secret-test",
          KEPPO_MCP_BEARER_TOKEN: "keppo_secret_test",
          KEPPO_MCP_SERVER_URL: expect.stringContaining(
            "/mcp/ws_test?x-vercel-protection-bypass=bypass_secret_test",
          ),
          KEPPO_MCP_SESSION_ID: expect.stringContaining("automation_automation_dispatch_test_"),
          VERCEL_AUTOMATION_BYPASS_SECRET: "bypass_secret_test",
        }),
      },
    });
    expect(dispatchArg.runtime.command).toContain(
      "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --model 'gpt-5.2'",
    );
    expect(dispatchArg.runtime.command).toContain("record_outcome({ success, summary })");
    expect(dispatchArg.runtime.command).toContain("Automation task:\nReview open issues");
    expect(dispatchArg.runtime.callbacks.log_url).toContain("/internal/automations/log?");
    expect(dispatchArg.runtime.callbacks.complete_url).toContain("/internal/automations/complete?");
    expect(deps.convex.issueAutomationWorkspaceCredential).toHaveBeenCalledWith({
      workspaceId: "ws_test",
      automationRunId: "arun_dispatch_test",
    });
    expect(deps.convex.updateAutomationRunStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        automationRunId: "arun_dispatch_test",
        status: "running",
        sandboxId: "sandbox_test",
      }),
    );
  });

  it("dispatches OpenAI runs with an active legacy subscription token when no BYOK key exists", async () => {
    const deps = createDeps();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_legacy_oauth_test",
        automation_id: "automation_legacy_oauth_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_legacy_oauth_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Legacy OpenAI triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce(null).mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        JSON.stringify({
          access_token: "oauth-access-token-test",
          refresh_token: "oauth-refresh-token-test",
          expires_at: "2026-04-01T00:00:00.000Z",
        }),
      ),
      credential_kind: "openai_oauth",
      is_active: true,
      key_hint: "...oauth",
      key_version: 1,
      subject_email: "operator@example.com",
      account_id: "acct_test",
      token_expires_at: "2026-04-01T00:00:00.000Z",
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
      key_mode: "subscription_token",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_legacy_oauth_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    const dispatchArg = deps.sandboxProvider.dispatch.mock.calls[0]?.[0];
    expect(dispatchArg.runtime.env.OPENAI_CODEX_AUTH_JSON).toContain("oauth-access-token-test");
    expect(dispatchArg.runtime.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("does not pass the Vercel bypass secret into production sandbox runs", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValueOnce({
      ...defaultTestEnv,
      KEPPO_ENVIRONMENT: "production",
    } as never);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_dispatch_prod_test",
        automation_id: "automation_dispatch_prod_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_dispatch_prod_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Daily triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_dispatch_prod_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    const dispatchArg = deps.sandboxProvider.dispatch.mock.calls[0]?.[0];
    expect(dispatchArg.runtime.env.VERCEL_AUTOMATION_BYPASS_SECRET).toBeUndefined();
  });

  it("keeps the Codex exec command at its default network-enabled shape when automation web access is enabled", async () => {
    const deps = createDeps();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_web_access_test",
        automation_id: "automation_web_access_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_web_access_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Web triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        ai_key_mode: "byok",
        prompt: "Review open issues",
        network_access: "mcp_and_web",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_web_access_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    const dispatchArg = deps.sandboxProvider.dispatch.mock.calls[0]?.[0];
    expect(dispatchArg.runtime.network_access).toBe("mcp_and_web");
    expect(dispatchArg.runtime.command).toContain(
      "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --model 'gpt-5.2'",
    );
    expect(dispatchArg.runtime.command).toContain("Automation task:\nReview open issues");
  });

  it("dispatches bundled runs through the gateway and deducts runtime credits", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...defaultTestEnv,
      KEPPO_LLM_GATEWAY_URL: "https://gateway.keppo.test",
    } as never);
    deps.convex.getAiCreditBalance.mockResolvedValueOnce({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 0,
      allowance_remaining: 100,
      purchased_remaining: 0,
      total_available: 100,
      bundled_runtime_enabled: true,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_bundled_test",
        automation_id: "automation_bundled_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_bundled_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Bundled triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "bundled-gateway-secret",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...bundled",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "billing",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_bundled_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convex.getOrgAiKey).toHaveBeenCalledWith({
      orgId: "org_test",
      provider: "openai",
      keyMode: "bundled",
    });
    expect(deps.convex.deductAiCredit).toHaveBeenCalledWith({
      orgId: "org_test",
      usageSource: "runtime",
    });
    const dispatchArg = deps.sandboxProvider.dispatch.mock.calls[0]?.[0];
    expect(dispatchArg.runtime.env).toMatchObject({
      OPENAI_API_KEY: "bundled-gateway-secret",
      OPENAI_BASE_URL: "https://gateway.keppo.test",
    });
    expect(dispatchArg.runtime.command).toContain(
      "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --config 'model_provider=\"keppo_openai_api\"' --model 'gpt-5.2'",
    );
    expect(dispatchArg.runtime.command).toContain("record_outcome({ success, summary })");
  });

  it("returns a bundled-specific missing-key response before any BYO fallback lookup", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...defaultTestEnv,
      KEPPO_LLM_GATEWAY_URL: "https://gateway.keppo.test",
    } as never);
    deps.convex.getAiCreditBalance.mockResolvedValueOnce({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 0,
      allowance_remaining: 100,
      purchased_remaining: 0,
      total_available: 100,
      bundled_runtime_enabled: true,
    });
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_bundled_missing_key",
        automation_id: "automation_bundled_missing_key",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_bundled_missing_key",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Bundled missing key",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValue(null);

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        {
          automation_run_id: "arun_bundled_missing_key",
          dispatch_token: "dispatch_token_test",
        },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "missing_ai_key",
      provider: "openai",
      key_mode: "bundled",
    });
    expect(deps.convex.getOrgAiKey).toHaveBeenCalledTimes(1);
    expect(deps.convex.getOrgAiKey).toHaveBeenCalledWith({
      orgId: "org_test",
      provider: "openai",
      keyMode: "bundled",
    });
    expect(deps.convex.updateAutomationRunStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        automationRunId: "arun_bundled_missing_key",
        status: "cancelled",
        errorMessage: "Bundled OpenAI access is unavailable for this org. Please contact support.",
      }),
    );
    expect(deps.sandboxProvider.dispatch).not.toHaveBeenCalled();
  });

  it("requires a self-managed key when the org has no bundled runtime available", async () => {
    const deps = createDeps();
    deps.convex.getAiCreditBalance.mockResolvedValueOnce({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 5,
      allowance_used: 5,
      allowance_remaining: 0,
      purchased_remaining: 0,
      total_available: 0,
      bundled_runtime_enabled: false,
    });
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_free_bundled",
        automation_id: "automation_free_bundled",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_free_bundled",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Free bundled",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_free_bundled", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "missing_ai_key",
      provider: "openai",
      key_mode: "byok",
    });
    expect(deps.convex.updateAutomationRunStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        automationRunId: "arun_free_bundled",
        status: "cancelled",
      }),
    );
    expect(deps.sandboxProvider.dispatch).not.toHaveBeenCalled();
  });

  it("cancels bundled runs when credits are exhausted before dispatch", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...defaultTestEnv,
      KEPPO_LLM_GATEWAY_URL: "https://gateway.keppo.test",
    } as never);
    deps.convex.getAiCreditBalance.mockResolvedValueOnce({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 0,
      allowance_remaining: 100,
      purchased_remaining: 0,
      total_available: 100,
      bundled_runtime_enabled: true,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.deductAiCredit.mockRejectedValueOnce(new Error(AI_CREDIT_ERROR_CODE.limitReached));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_bundled_fallback",
        automation_id: "automation_bundled_fallback",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_bundled_fallback",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Bundled fallback",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "bundled-gateway-secret",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...bundled",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "billing",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_bundled_fallback", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "ai_credit_limit_reached",
    });
    expect(deps.sandboxProvider.dispatch).not.toHaveBeenCalled();
  });

  it("does not deduct bundled credits before MCP preflight succeeds", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...defaultTestEnv,
      KEPPO_LLM_GATEWAY_URL: "https://gateway.keppo.test",
    } as never);
    deps.convex.getAiCreditBalance.mockResolvedValueOnce({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 0,
      allowance_remaining: 100,
      purchased_remaining: 0,
      total_available: 100,
      bundled_runtime_enabled: true,
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("MCP preflight failed"));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_bundled_preflight_failure",
        automation_id: "automation_bundled_preflight_failure",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_bundled_preflight_failure",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Bundled preflight failure",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "bundled-gateway-secret",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...bundled",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "billing",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        {
          automation_run_id: "arun_bundled_preflight_failure",
          dispatch_token: "dispatch_token_test",
        },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(500);
    expect(deps.convex.deductAiCredit).not.toHaveBeenCalled();
  });

  it("fails closed in strict environments when the callback HMAC secret is unset", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...defaultTestEnv,
      KEPPO_CALLBACK_HMAC_SECRET: undefined,
      NODE_ENV: "production",
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("event: message\ndata: {}\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "mcp-session-id": "mcp_test_session",
        },
      }),
    );
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_missing_callback_secret",
        automation_id: "automation_missing_callback_secret",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_missing_callback_secret",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Strict env triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        {
          automation_run_id: "arun_missing_callback_secret",
          dispatch_token: "dispatch_token_test",
        },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "dispatch_failed",
      error_code: "missing_env",
      error: "Missing KEPPO_CALLBACK_HMAC_SECRET.",
    });
    expect(deps.sandboxProvider.dispatch).not.toHaveBeenCalled();
  });

  it("uses the Better Auth fallback only in relaxed environments for callback signatures", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...defaultTestEnv,
      KEPPO_CALLBACK_HMAC_SECRET: undefined,
      NODE_ENV: "test",
    } as never);
    delete process.env.KEPPO_CALLBACK_HMAC_SECRET;
    process.env.NODE_ENV = "test";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_relaxed_callback_secret",
        automation_id: "automation_relaxed_callback_secret",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_relaxed_callback_secret",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Relaxed env triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        {
          automation_run_id: "arun_relaxed_callback_secret",
          dispatch_token: "dispatch_token_test",
        },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    const completeUrl = deps.sandboxProvider.dispatch.mock.calls[0]?.[0]?.runtime.callbacks
      .complete_url as string;
    expect(
      hasValidAutomationCallbackSignature(
        new Request(completeUrl, { method: "POST" }),
        "arun_relaxed_callback_secret",
      ),
    ).toBe(true);
    const completeCallback = new URL(completeUrl);
    expect(completeCallback.searchParams.get("signature")).toBe(
      createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
        .update(
          `${completeCallback.pathname}:arun_relaxed_callback_secret:${completeCallback.searchParams.get("expires")}`,
        )
        .digest("hex"),
    );
  });

  it("ingests callback logs and completion updates from Start-owned callback routes", async () => {
    const deps = createDeps();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_dispatch_test",
        automation_id: "automation_dispatch_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_dispatch_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Daily triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_dispatch_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    const callbacks =
      deps.sandboxProvider.dispatch.mock.calls[0]?.[0]?.runtime?.callbacks ??
      ({} as Record<string, string>);
    const logResponse = await dispatchStartOwnedAutomationRuntimeRequest(
      withJson(callbacks.log_url.replace("http://127.0.0.1", ""), {
        automation_run_id: "arun_dispatch_test",
        lines: [
          { level: AUTOMATION_RUN_LOG_LEVEL.stderr, content: "model: gpt-5.2" },
          {
            level: AUTOMATION_RUN_LOG_LEVEL.stderr,
            content: 'tool keppo.search_tools({"q":"ux"})',
          },
          {
            level: AUTOMATION_RUN_LOG_LEVEL.stdout,
            content: '{"items":[{"title":"Run logs UX"}]}',
          },
        ],
      }),
      deps,
    );

    expect(logResponse?.status).toBe(200);
    await expect(logResponse?.json()).resolves.toMatchObject({
      ok: true,
      ingested: 3,
    });
    expect(deps.convex.appendAutomationRunLogBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        automationRunId: "arun_dispatch_test",
        lines: expect.arrayContaining([
          expect.objectContaining({
            level: AUTOMATION_RUN_LOG_LEVEL.stderr,
            content: "model: gpt-5.2",
            eventType: "automation_config",
            eventData: { key: "model", value: "gpt-5.2" },
          }),
        ]),
      }),
    );

    const completeResponse = await dispatchStartOwnedAutomationRuntimeRequest(
      withJson(callbacks.complete_url.replace("http://127.0.0.1", ""), {
        automation_run_id: "arun_dispatch_test",
        status: "succeeded",
      }),
      deps,
    );

    expect(completeResponse?.status).toBe(200);
    await expect(completeResponse?.json()).resolves.toMatchObject({
      ok: true,
      status: "succeeded",
    });
    expect(deps.convex.updateAutomationRunStatus).toHaveBeenCalledWith({
      automationRunId: "arun_dispatch_test",
      status: "succeeded",
    });
  });

  it("classifies Codex mcp lifecycle lines for search_tools and execute_code as tool events", async () => {
    const deps = createDeps();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "mcp_test_session",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    deps.convex.claimAutomationRunDispatchContext.mockResolvedValueOnce({
      run: {
        id: "arun_dispatch_test",
        automation_id: "automation_dispatch_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        status: "pending",
        sandbox_id: null,
      },
      automation: {
        id: "automation_dispatch_test",
        org_id: "org_test",
        workspace_id: "ws_test",
        name: "Daily triage",
        status: "active",
      },
      config: {
        model_class: "value",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.2",
        prompt: "Review open issues",
        network_access: "mcp_only",
      },
    });
    deps.convex.getOrgAiKey.mockResolvedValueOnce({
      org_id: "org_test",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "openai-secret-test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "user_test",
    });

    await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_dispatch_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    const callbacks =
      deps.sandboxProvider.dispatch.mock.calls[0]?.[0]?.runtime?.callbacks ??
      ({} as Record<string, string>);
    const logResponse = await dispatchStartOwnedAutomationRuntimeRequest(
      withJson(callbacks.log_url.replace("http://127.0.0.1", ""), {
        automation_run_id: "arun_dispatch_test",
        lines: [
          {
            level: AUTOMATION_RUN_LOG_LEVEL.stderr,
            content: "mcp: keppo/search_tools started",
          },
          {
            level: AUTOMATION_RUN_LOG_LEVEL.stderr,
            content: "mcp: keppo/search_tools (completed)",
          },
          {
            level: AUTOMATION_RUN_LOG_LEVEL.stderr,
            content: "mcp: keppo/execute_code started",
          },
          {
            level: AUTOMATION_RUN_LOG_LEVEL.stderr,
            content: "mcp: keppo/execute_code (completed)",
          },
        ],
      }),
      deps,
    );

    expect(logResponse?.status).toBe(200);
    expect(deps.convex.appendAutomationRunLogBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        automationRunId: "arun_dispatch_test",
        lines: expect.arrayContaining([
          expect.objectContaining({
            content: "mcp: keppo/search_tools started",
            eventType: "tool_call",
            eventData: {
              tool_name: "search_tools",
              source: "mcp_lifecycle",
            },
          }),
          expect.objectContaining({
            content: "mcp: keppo/search_tools (completed)",
            eventType: "tool_call",
            eventData: {
              tool_name: "search_tools",
              status: "success",
              is_result: true,
              source: "mcp_lifecycle",
            },
          }),
          expect.objectContaining({
            content: "mcp: keppo/execute_code started",
            eventType: "tool_call",
            eventData: {
              tool_name: "execute_code",
              source: "mcp_lifecycle",
            },
          }),
          expect.objectContaining({
            content: "mcp: keppo/execute_code (completed)",
            eventType: "tool_call",
            eventData: {
              tool_name: "execute_code",
              status: "success",
              is_result: true,
              source: "mcp_lifecycle",
            },
          }),
        ]),
      }),
    );
  });

  it("claims only the Start-owned internal automation runtime paths", async () => {
    const deps = createDeps();

    const handled = await dispatchStartOwnedAutomationRuntimeRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_test", dispatch_token: "dispatch_token_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );
    const forwarded = await dispatchStartOwnedAutomationRuntimeRequest(
      withJson("/internal/queue/dispatch-approved-action", {
        actionId: "act_1",
      }),
      deps,
    );

    expect(handled?.status).toBe(404);
    expect(forwarded).toBeNull();
  });

  it("rejects dispatches without a valid per-run dispatch token", async () => {
    const deps = createDeps();

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_dispatch_test", dispatch_token: "wrong_token" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "run_not_found",
    });
    expect(deps.convex.claimAutomationRunDispatchContext).toHaveBeenCalledWith({
      automationRunId: "arun_dispatch_test",
      dispatchToken: "wrong_token",
    });
    expect(deps.sandboxProvider.dispatch).not.toHaveBeenCalled();
  });

  it("returns a 400 invalid payload response when dispatch_token is missing", async () => {
    const deps = createDeps();

    const response = await handleInternalAutomationDispatchRequest(
      withJson(
        "/internal/automations/dispatch",
        { automation_run_id: "arun_dispatch_test" },
        { authorization: "Bearer secret_token" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "invalid_payload",
      error_code: "missing_dispatch_token",
    });
    expect(deps.convex.claimAutomationRunDispatchContext).not.toHaveBeenCalled();
  });
});
