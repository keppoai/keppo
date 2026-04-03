import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVercelProtectionBypassToUrl,
  assertRunnerAuthSupported,
  assertSandboxCallbackBaseUrlReachable,
  buildAutomationRunnerPrompt,
  buildRunnerAuthBootstrapCommand,
  buildRunnerBootstrapCommand,
  buildRunnerCommand,
  preflightMcpServer,
  resolveAutomationMcpServerUrl,
} from "./automations";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertSandboxCallbackBaseUrlReachable", () => {
  it("allows localhost for docker sandboxes", () => {
    expect(() =>
      assertSandboxCallbackBaseUrlReachable("http://localhost:8787", "docker"),
    ).not.toThrow();
  });

  it("rejects localhost for Vercel sandboxes", () => {
    expect(() => assertSandboxCallbackBaseUrlReachable("http://localhost:8787", "vercel")).toThrow(
      "automation_route_failed: Vercel sandbox callbacks cannot reach http://localhost:8787. Set KEPPO_API_INTERNAL_BASE_URL to a public API URL.",
    );
  });

  it("allows public callback bases for Vercel sandboxes", () => {
    expect(() =>
      assertSandboxCallbackBaseUrlReachable("https://api.example.com", "vercel"),
    ).not.toThrow();
  });

  it("builds the current Codex exec runner command shape", () => {
    const command = buildRunnerCommand({
      runnerType: "chatgpt_codex",
      aiModelProvider: "openai",
      aiKeyMode: "byok",
      credentialKind: "secret",
      networkAccess: "mcp_only",
      model: "gpt-5.2",
      prompt: "Review open issues",
    });

    expect(command).toContain(
      "sh -lc 'codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox",
    );
    expect(command).toContain('sandbox_mode="workspace-write"');
    expect(command).toContain("sandbox_workspace_write={ network_access = false }");
    expect(command).toContain("Review open issues");
    expect(command).toContain("trap '_keppo_on_term' TERM INT");
    expect(command).toContain('kill -TERM "$_keppo_runner_child_pid" 2>/dev/null || true');
    expect(command).toContain("sh -lc 'codex exec --json --skip-git-repo-check");
    expect(command).toContain("KEPPO_SESSION_ARTIFACT_CALLBACK_URL");
    expect(command).toContain("relative_path");
    expect(command).toContain("KEPPO_TIMEOUT_GRACE_MS:-5000");
  });

  it("wraps automation prompts with the record_outcome runtime contract", () => {
    const prompt = buildAutomationRunnerPrompt(
      "Review open issues",
      "Remember that the operator wants concise summaries.",
    );

    expect(prompt).toContain("record_outcome({ success, summary })");
    expect(prompt).toContain("add_memory or edit_memory");
    expect(prompt).toContain("exactly once as your final tool call");
    expect(prompt).toContain("Waiting only for a human approval");
    expect(prompt).toContain("<memory>");
    expect(prompt).toContain("Remember that the operator wants concise summaries.");
    expect(prompt).toContain("</memory>");
    expect(prompt).toContain("Automation task:\nReview open issues");
  });

  it("omits the memory block when automation memory is empty", () => {
    const prompt = buildAutomationRunnerPrompt("Review open issues", "");

    expect(prompt).not.toContain("<memory>");
    expect(prompt).not.toContain("</memory>");
  });

  it("leaves Codex network access at the default when the automation allows web access", () => {
    const command = buildRunnerCommand({
      runnerType: "chatgpt_codex",
      aiModelProvider: "openai",
      aiKeyMode: "byok",
      credentialKind: "secret",
      networkAccess: "mcp_and_web",
      model: "gpt-5.2",
      prompt: "Review open issues",
    });

    expect(command).toContain(
      "sh -lc 'codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox",
    );
    expect(command).toContain("Review open issues");
    expect(command).not.toContain('sandbox_mode="workspace-write"');
  });

  it("disallows Claude web tools when the automation is MCP-only", () => {
    expect(
      buildRunnerCommand({
        runnerType: "claude_code",
        aiModelProvider: "anthropic",
        aiKeyMode: "byok",
        credentialKind: "secret",
        networkAccess: "mcp_only",
        model: "claude-sonnet-4-6",
        prompt: "Review open issues",
      }),
    ).toBe(
      `claude --model 'claude-sonnet-4-6' --mcp-server "$KEPPO_MCP_SERVER_URL" --disallowed-tools 'WebFetch,WebSearch' -p 'Review open issues'`,
    );
  });

  it("allows Claude web tools when the automation enables web access", () => {
    expect(
      buildRunnerCommand({
        runnerType: "claude_code",
        aiModelProvider: "anthropic",
        aiKeyMode: "byok",
        credentialKind: "secret",
        networkAccess: "mcp_and_web",
        model: "claude-sonnet-4-6",
        prompt: "Review open issues",
      }),
    ).toBe(
      `claude --model 'claude-sonnet-4-6' --mcp-server "$KEPPO_MCP_SERVER_URL" -p 'Review open issues'`,
    );
  });

  it("routes bundled OpenAI Codex runs through the custom HTTPS-only provider", () => {
    const command = buildRunnerCommand({
      runnerType: "chatgpt_codex",
      aiModelProvider: "openai",
      aiKeyMode: "bundled",
      credentialKind: "secret",
      networkAccess: "mcp_and_web",
      model: "gpt-5.2",
      prompt: "Review open issues",
    });

    expect(command).toContain(
      "sh -lc 'codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox",
    );
    expect(command).toContain('model_provider="keppo_openai_api"');
    expect(command).toContain("Review open issues");
  });

  it("keeps the bootstrap command secret-free and separate from the runner command", () => {
    expect(
      buildRunnerBootstrapCommand({
        runnerType: "chatgpt_codex",
        providerMode: "docker",
      }),
    ).toBe(
      `mkdir -p '/sandbox/.keppo-codex-home' && export HOME='/sandbox/.keppo-codex-home' && codex mcp add keppo --url "$KEPPO_MCP_SERVER_URL" --bearer-token-env-var KEPPO_MCP_BEARER_TOKEN`,
    );
  });

  it("builds the auth bootstrap command for Codex BYOK", () => {
    expect(
      buildRunnerAuthBootstrapCommand({
        runnerType: "chatgpt_codex",
        providerMode: "docker",
        aiModelProvider: "openai",
        aiKeyMode: "byok",
        credentialKind: "secret",
      }),
    ).toBe(
      `mkdir -p '/sandbox/.keppo-codex-home' && export HOME='/sandbox/.keppo-codex-home' && printenv OPENAI_API_KEY | codex login --with-api-key`,
    );
  });

  it("configures a custom HTTPS-only OpenAI provider for bundled runs", () => {
    expect(
      buildRunnerAuthBootstrapCommand({
        runnerType: "chatgpt_codex",
        providerMode: "docker",
        aiModelProvider: "openai",
        aiKeyMode: "bundled",
        credentialKind: "secret",
      }),
    ).toBe(
      `mkdir -p '/sandbox/.keppo-codex-home/.codex' && export HOME='/sandbox/.keppo-codex-home' && touch "$HOME/.codex/config.toml" && printf '\\n[model_providers.keppo_openai_api]\\nname = "Keppo OpenAI API"\\nbase_url = "%s"\\nenv_key = "OPENAI_API_KEY"\\nwire_api = "responses"\\nrequires_openai_auth = false\\nsupports_websockets = false\\n' "$OPENAI_BASE_URL" >> "$HOME/.codex/config.toml" && chmod 600 "$HOME/.codex/config.toml"`,
    );
  });

  it("configures the fake OpenAI base URL via the custom HTTPS-only provider in E2E", () => {
    vi.stubEnv("KEPPO_E2E_MODE", "true");
    vi.stubEnv("KEPPO_E2E_OPENAI_BASE_URL", "http://127.0.0.1:9901");

    expect(
      buildRunnerCommand({
        runnerType: "chatgpt_codex",
        aiModelProvider: "openai",
        aiKeyMode: "byok",
        credentialKind: "secret",
        networkAccess: "mcp_and_web",
        model: "gpt-5.2",
        prompt: "Review open issues",
      }),
    ).toContain('model_provider="keppo_openai_api"');

    expect(
      buildRunnerAuthBootstrapCommand({
        runnerType: "chatgpt_codex",
        providerMode: "docker",
        aiModelProvider: "openai",
        aiKeyMode: "byok",
        credentialKind: "secret",
      }),
    ).toBe(
      `mkdir -p '/sandbox/.keppo-codex-home/.codex' && export HOME='/sandbox/.keppo-codex-home' && touch "$HOME/.codex/config.toml" && printf '\\n[model_providers.keppo_openai_api]\\nname = "Keppo OpenAI API"\\nbase_url = "%s"\\nenv_key = "OPENAI_API_KEY"\\nwire_api = "responses"\\nrequires_openai_auth = false\\nsupports_websockets = false\\n' "$KEPPO_E2E_OPENAI_BASE_URL" >> "$HOME/.codex/config.toml" && chmod 600 "$HOME/.codex/config.toml"`,
    );
  });

  it("allows Codex with an OpenAI BYOK key", () => {
    expect(() =>
      assertRunnerAuthSupported({
        runnerType: "chatgpt_codex",
        aiModelProvider: "openai",
        aiKeyMode: "byok",
      }),
    ).not.toThrow();
  });

  it("allows Codex with an OpenAI subscription token", () => {
    expect(() =>
      assertRunnerAuthSupported({
        runnerType: "chatgpt_codex",
        aiModelProvider: "openai",
        aiKeyMode: "subscription_token",
      }),
    ).not.toThrow();
  });

  it("builds the OpenAI OAuth auth bootstrap command shape", () => {
    expect(
      buildRunnerAuthBootstrapCommand({
        runnerType: "chatgpt_codex",
        providerMode: "docker",
        aiModelProvider: "openai",
        aiKeyMode: "subscription_token",
        credentialKind: "openai_oauth",
      }),
    ).toBe(
      `mkdir -p '/sandbox/.keppo-codex-home/.codex' && export HOME='/sandbox/.keppo-codex-home' && printf '%s' "$OPENAI_CODEX_AUTH_JSON" > "$HOME/.codex/auth.json" && chmod 600 "$HOME/.codex/auth.json"`,
    );
  });

  it("uses the Vercel sandbox workdir for Codex home", () => {
    expect(
      buildRunnerBootstrapCommand({
        runnerType: "chatgpt_codex",
        providerMode: "vercel",
      }),
    ).toBe(
      `mkdir -p '/vercel/sandbox/.keppo-codex-home' && export HOME='/vercel/sandbox/.keppo-codex-home' && codex mcp add keppo --url "$KEPPO_MCP_SERVER_URL" --bearer-token-env-var KEPPO_MCP_BEARER_TOKEN`,
    );
  });

  it("resolves the default automation MCP URL to a workspace route", () => {
    expect(resolveAutomationMcpServerUrl(undefined, "http://localhost:8787", "ws_test")).toBe(
      "http://localhost:8787/mcp/ws_test",
    );
  });

  it("appends the workspace id when the configured automation MCP URL is a base /mcp endpoint", () => {
    expect(
      resolveAutomationMcpServerUrl(
        "http://localhost:8787/mcp",
        "http://localhost:8787",
        "ws_test",
      ),
    ).toBe("http://localhost:8787/mcp/ws_test");
  });

  it("replaces workspace templates in configured automation MCP URLs", () => {
    expect(
      resolveAutomationMcpServerUrl(
        "https://api.example.com/mcp/:workspaceId",
        "http://localhost:8787",
        "ws_test",
      ),
    ).toBe("https://api.example.com/mcp/ws_test");
  });

  it("appends the Vercel protection bypass query param to automation MCP URLs", () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");

    expect(resolveAutomationMcpServerUrl(undefined, "https://keppo.ai/api", "ws_test")).toBe(
      "https://keppo.ai/mcp/ws_test?x-vercel-protection-bypass=bypass_secret_test",
    );
  });

  it("skips the Vercel protection bypass query param in production", () => {
    vi.stubEnv("KEPPO_ENVIRONMENT", "production");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");

    expect(resolveAutomationMcpServerUrl(undefined, "https://keppo.ai/api", "ws_test")).toBe(
      "https://keppo.ai/mcp/ws_test",
    );
    expect(applyVercelProtectionBypassToUrl("https://keppo.ai/internal/automations/log")).toBe(
      "https://keppo.ai/internal/automations/log",
    );
  });

  it("applies the Vercel protection bypass query param to parseable URLs only", () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");

    expect(applyVercelProtectionBypassToUrl("https://keppo.ai/internal/automations/log")).toBe(
      "https://keppo.ai/internal/automations/log?x-vercel-protection-bypass=bypass_secret_test",
    );
    expect(applyVercelProtectionBypassToUrl("not-a-url")).toBe("not-a-url");
  });

  it("accepts an MCP initialize response with streamable HTTP content", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");
    const fetchFn = vi
      .fn<typeof fetch>()
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

    await expect(
      preflightMcpServer("http://127.0.0.1:8787/mcp/ws_test", "keppo_secret_test", fetchFn),
    ).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8787/mcp/ws_test",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/mcp/ws_test",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    const firstHeaders = fetchFn.mock.calls[0]?.[1]?.headers as Headers;
    expect(firstHeaders.get("accept")).toBe("text/event-stream, application/json");
    expect(firstHeaders.get("authorization")).toBe("Bearer keppo_secret_test");
    expect(firstHeaders.get("content-type")).toBe("application/json");
    expect(firstHeaders.get("x-vercel-protection-bypass")).toBe("bypass_secret_test");
    const secondHeaders = fetchFn.mock.calls[1]?.[1]?.headers as Headers;
    expect(secondHeaders.get("accept")).toBe("text/event-stream, application/json");
    expect(secondHeaders.get("authorization")).toBe("Bearer keppo_secret_test");
    expect(secondHeaders.get("mcp-session-id")).toBe("mcp_test_session");
    expect(secondHeaders.get("x-vercel-protection-bypass")).toBe("bypass_secret_test");
  });

  it("rejects unsupported MCP preflight content types with the live response details", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("route not found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=UTF-8",
        },
      }),
    );

    await expect(
      preflightMcpServer(
        "http://127.0.0.1:8787/mcp/ws_test?x-vercel-protection-bypass=bypass_secret_test",
        "keppo_secret_test",
        fetchFn,
      ),
    ).rejects.toThrow(
      "automation_route_failed: MCP server preflight failed for http://127.0.0.1:8787/mcp/ws_test?x-vercel-protection-bypass=%5Bredacted%5D: status 404, content-type text/plain; charset=UTF-8, body route not found",
    );
  });
});
