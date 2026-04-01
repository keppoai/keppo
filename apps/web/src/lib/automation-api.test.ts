import { describe, expect, it, vi } from "vitest";
import {
  dispatchStartOwnedAutomationApiRequest,
  handleOpenAiCallbackRequest,
  handleOpenAiConnectRequest,
  handleCompleteOpenAiOauthRequest,
  handleGenerateAutomationQuestionsRequest,
  handleGenerateAutomationPromptRequest,
} from "../../app/lib/server/automation-api";

const createDeps = () => {
  const convex = {
    checkRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterMs: 0,
    }),
    deductAiCredit: vi.fn().mockResolvedValue({
      org_id: "org_test",
      period_start: "2026-03-14T00:00:00.000Z",
      period_end: "2026-04-14T00:00:00.000Z",
      allowance_total: 100,
      allowance_used: 1,
      allowance_remaining: 99,
      purchased_remaining: 25,
      total_available: 124,
    }),
    getWorkspaceCodeModeContext: vi.fn().mockResolvedValue({
      workspace: {
        id: "ws_test",
        org_id: "org_test",
        name: "Workspace Test",
        status: "active",
        policy_mode: "allow_all",
        default_action_behavior: "allow",
        code_mode_enabled: true,
        created_at: "2026-03-14T00:00:00.000Z",
      },
      enabled_providers: ["google"],
    }),
    listToolCatalogForWorkspace: vi.fn().mockResolvedValue([
      {
        name: "keppo.search_tools",
        description: "Search tools",
      },
    ]),
    resolveApiSessionFromToken: vi.fn().mockResolvedValue({
      userId: "user_test",
      orgId: "org_test",
      role: "owner",
    }),
    upsertOpenAiOauthKey: vi.fn().mockResolvedValue(undefined),
  };

  return {
    convex,
    generateAutomationQuestions: vi.fn().mockResolvedValue([
      {
        id: "delivery_target",
        label: "Where should the summary go?",
        input_type: "radio",
        required: true,
        options: [
          {
            value: "slack",
            label: "Slack",
          },
          {
            value: "email",
            label: "Email",
          },
        ],
      },
    ]),
    generateAutomationPrompt: vi.fn().mockResolvedValue({
      prompt: "Search tools for UX regressions",
      description: "Find UX regressions",
      mermaid_content: "flowchart TD\nA-->B",
      name: "Find UX regressions",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5.4",
      network_access: "mcp_only",
      trigger_type: "manual",
      provider_recommendations: [
        {
          provider: "google",
          reason: "Needed for product search",
          confidence: "recommended",
        },
      ],
    }),
    generateAutomationMermaid: vi.fn().mockResolvedValue({
      mermaid_content: "flowchart TD\nPrompt-->Review",
    }),
    getEnv: vi.fn(
      () =>
        ({
          KEPPO_DASHBOARD_ORIGIN: "http://127.0.0.1:3000",
          KEPPO_RATE_LIMIT_AUTOMATION_QUESTIONS_PER_ORG_PER_MINUTE: 10,
          OPENAI_OAUTH_CLIENT_ID: "openai_client_test",
          OPENAI_OAUTH_REDIRECT_URI: "http://localhost:1455/auth/callback",
          OPENAI_OAUTH_TOKEN_URL: "https://auth.openai.test/oauth/token",
        }) as never,
    ),
    parseJsonPayload: (raw: string) => JSON.parse(raw),
    readBetterAuthSessionToken: (cookieHeader: string | undefined) => {
      if (!cookieHeader) {
        return null;
      }
      const match =
        cookieHeader.match(/better-auth\.session_token=([^;]+)/) ??
        cookieHeader.match(/session_token=([^;]+)/);
      return match?.[1]?.split(".")[0] ?? null;
    },
    safeReturnToPath: (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
        return "/settings";
      }
      return trimmed;
    },
    signOAuthStatePayload: (payloadRaw: string) =>
      Buffer.from(payloadRaw, "utf8").toString("base64url"),
    verifyAndDecodeOAuthStatePayload: (signedState: string | null | undefined) => {
      if (!signedState) {
        return { ok: false as const, reason: "missing_state" as const };
      }
      return {
        ok: true as const,
        payloadRaw: Buffer.from(signedState, "base64url").toString("utf8"),
      };
    },
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

describe("start-owned automation api handlers", () => {
  it("generates clarification questions without deducting a credit", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationQuestionsRequest(
      withJson(
        "/api/automations/generate-questions",
        {
          workspace_id: "ws_test",
          user_description: "Find regressions",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      questions: [
        {
          id: "delivery_target",
          label: "Where should the summary go?",
        },
      ],
      billing: {
        stage: "questions",
        charged_credits: 0,
        cycle_total_credits: 1,
      },
    });
    expect(deps.generateAutomationQuestions).toHaveBeenCalledWith({
      userDescription: "Find regressions",
      availableActions: [
        {
          name: "keppo.search_tools",
          description: "Search tools",
        },
      ],
    });
    expect(deps.convex.deductAiCredit).not.toHaveBeenCalled();
    expect(deps.convex.checkRateLimit).toHaveBeenCalledWith({
      key: "automation_question_requests:org_test",
      limit: 10,
      windowMs: 60_000,
    });
  });

  it("rate limits free clarification question generation per org", async () => {
    const deps = createDeps();
    deps.convex.checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30_000,
    });

    const response = await handleGenerateAutomationQuestionsRequest(
      withJson(
        "/api/automations/generate-questions",
        {
          workspace_id: "ws_test",
          user_description: "Find regressions",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "rate_limited",
      retry_after_ms: 30_000,
    });
    expect(deps.generateAutomationQuestions).not.toHaveBeenCalled();
  });

  it("requires an authenticated session for prompt generation", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationPromptRequest(
      withJson("/api/automations/generate-prompt", {
        workspace_id: "ws_test",
        user_description: "Find regressions",
      }),
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.convex.getWorkspaceCodeModeContext).not.toHaveBeenCalled();
  });

  it("generates automation prompts in-process with Start-owned auth context", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationPromptRequest(
      withJson(
        "/api/automations/generate-prompt",
        {
          workspace_id: "ws_test",
          user_description: "Find regressions",
          clarification_questions: [
            {
              id: "delivery_target",
              label: "Where should the summary go?",
              input_type: "radio",
              required: true,
              options: [
                {
                  value: "slack",
                  label: "Slack",
                },
              ],
            },
          ],
          clarification_answers: [
            {
              question_id: "delivery_target",
              value: "slack",
            },
          ],
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      prompt: "Search tools for UX regressions",
      mermaid_content: "flowchart TD\nA-->B",
      credit_balance: {
        allowance_remaining: 99,
        purchased_remaining: 25,
        total_available: 124,
      },
      billing: {
        stage: "draft",
        charged_credits: 1,
        cycle_total_credits: 1,
      },
    });
    expect(deps.generateAutomationPrompt).toHaveBeenCalledWith({
      userDescription: "Find regressions",
      availableActions: [
        {
          name: "keppo.search_tools",
          description: "Search tools",
        },
      ],
      clarificationQuestions: [
        {
          id: "delivery_target",
          label: "Where should the summary go?",
          input_type: "radio",
          required: true,
          options: [
            {
              value: "slack",
              label: "Slack",
            },
          ],
        },
      ],
      clarificationAnswers: [
        {
          question_id: "delivery_target",
          value: "slack",
        },
      ],
    });
  });

  it("passes existing automation context through the edit generation flow", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationPromptRequest(
      withJson(
        "/api/automations/generate-prompt",
        {
          workspace_id: "ws_test",
          user_description: "Send the summary to Slack instead of email.",
          generation_mode: "edit",
          automation_context: {
            automation_id: "automation_123",
            name: "Daily summary",
            description: "Current summary",
            mermaid_content: "flowchart TD\nA-->B",
            trigger_type: "manual",
            schedule_cron: null,
            event_provider: null,
            event_type: null,
            ai_model_provider: "openai",
            ai_model_name: "gpt-5.4",
            network_access: "mcp_only",
            prompt: "Send a daily email summary.",
          },
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.generateAutomationPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        automationContext: expect.objectContaining({
          automation_id: "automation_123",
          prompt: "Send a daily email summary.",
        }),
      }),
    );
  });

  it("supports mermaid-only regeneration from the current prompt", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationPromptRequest(
      withJson(
        "/api/automations/generate-prompt",
        {
          workspace_id: "ws_test",
          user_description: "Summarize the latest issues.",
          generation_mode: "mermaid_only",
          automation_context: {
            name: "Issue summary",
            description: "desc",
            mermaid_content: "flowchart TD\nA-->B",
            trigger_type: "manual",
            schedule_cron: null,
            event_provider: null,
            event_type: null,
            ai_model_provider: "openai",
            ai_model_name: "gpt-5.4",
            network_access: "mcp_only",
            prompt: "Summarize the latest issues.",
          },
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mermaid_content: "flowchart TD\nPrompt-->Review",
      billing: {
        summary: "Keppo deducted 1 credit to regenerate the workflow diagram.",
      },
    });
    expect(deps.generateAutomationMermaid).toHaveBeenCalledWith({
      prompt: "Summarize the latest issues.",
    });
  });

  it("rejects prompt generation when a required clarification answer is missing", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationPromptRequest(
      withJson(
        "/api/automations/generate-prompt",
        {
          workspace_id: "ws_test",
          user_description: "Find regressions",
          clarification_questions: [
            {
              id: "delivery_target",
              label: "Where should the summary go?",
              input_type: "radio",
              required: true,
              options: [
                {
                  value: "slack",
                  label: "Slack",
                },
              ],
            },
          ],
          clarification_answers: [],
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "invalid_payload",
      error_code: "invalid_payload",
    });
    expect(deps.generateAutomationPrompt).not.toHaveBeenCalled();
    expect(deps.convex.deductAiCredit).not.toHaveBeenCalled();
  });

  it("treats clarification answers as untrusted input instead of enforcing client option lists", async () => {
    const deps = createDeps();

    const response = await handleGenerateAutomationPromptRequest(
      withJson(
        "/api/automations/generate-prompt",
        {
          workspace_id: "ws_test",
          user_description: "Find regressions",
          clarification_questions: [
            {
              id: "delivery_target",
              label: "Where should the summary go?",
              input_type: "radio",
              required: true,
              options: [
                {
                  value: "slack",
                  label: "Slack",
                },
              ],
            },
          ],
          clarification_answers: [
            {
              question_id: "delivery_target",
              value: "pagerduty",
            },
          ],
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.generateAutomationPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        clarificationAnswers: [
          {
            question_id: "delivery_target",
            value: "pagerduty",
          },
        ],
      }),
    );
  });

  it("returns OpenAI connect launch metadata for authenticated admins", async () => {
    const deps = createDeps();

    const response = await handleOpenAiConnectRequest(
      new Request("http://127.0.0.1/api/automations/openai/connect?return_to=%2Fsettings", {
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      localhost_redirect_uri: "http://localhost:1455/auth/callback",
    });
  });

  it("completes OpenAI OAuth with the authenticated Start session", async () => {
    const deps = createDeps();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access_test",
          refresh_token: "refresh_test",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid profile email offline_access",
          id_token: "header.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const oauthState = deps.signOAuthStatePayload(
      JSON.stringify({
        kind: "openai_automation_key",
        org_id: "org_test",
        user_id: "user_test",
        return_to: "/settings",
        verifier: "verifier_test",
        issued_at: Date.now(),
      }),
    );

    const response = await handleCompleteOpenAiOauthRequest(
      withJson(
        "/api/automations/openai/complete",
        {
          callback_url: `http://localhost:1455/auth/callback?code=oauth_code_test&state=${encodeURIComponent(oauthState)}`,
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "connected",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.openai.test/oauth/token",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(deps.convex.upsertOpenAiOauthKey).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_test",
        userId: "user_test",
      }),
    );
    fetchMock.mockRestore();
  });

  it("redirects successful direct OpenAI callbacks back into the dashboard", async () => {
    const deps = createDeps();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access_test",
          refresh_token: "refresh_test",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    const oauthState = deps.signOAuthStatePayload(
      JSON.stringify({
        kind: "openai_automation_key",
        org_id: "org_test",
        user_id: "user_test",
        return_to: "/settings",
        verifier: "verifier_test",
        issued_at: Date.now(),
      }),
    );

    const response = await handleOpenAiCallbackRequest(
      new Request(
        `http://127.0.0.1/api/automations/openai/callback?code=oauth_code_test&state=${encodeURIComponent(oauthState)}`,
      ),
      deps,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/settings?ai_key_status=connected&ai_key_provider=openai&ai_key_mode=subscription_token",
    );
    fetchMock.mockRestore();
  });

  it("dispatches the migrated automation family in-process", async () => {
    const deps = createDeps();

    const handled = await dispatchStartOwnedAutomationApiRequest(
      withJson(
        "/api/automations/generate-prompt",
        {
          workspace_id: "ws_test",
          user_description: "Find regressions",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );
    const connectHandled = await dispatchStartOwnedAutomationApiRequest(
      new Request("http://127.0.0.1/api/automations/openai/connect", {
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );
    const unhandled = await dispatchStartOwnedAutomationApiRequest(
      new Request("http://127.0.0.1/api/oauth/integrations/google/connect", { method: "POST" }),
      deps,
    );

    expect(handled?.status).toBe(200);
    expect(connectHandled?.status).toBe(200);
    expect(unhandled).toBeNull();
  });
});
