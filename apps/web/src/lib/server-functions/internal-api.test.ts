import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateAutomationPrompt,
  generateAutomationQuestions,
  normalizeOptionalBetterAuthCookie,
} from "./internal-api";

type MockWindow = {
  __KEPPO_E2E_METADATA__?: unknown;
  __KEPPO_E2E_SERVER_FN_MOCKS__?: Partial<
    Record<"generateAutomationPrompt" | "generateAutomationQuestions", unknown>
  >;
};

const getMockWindow = (): MockWindow => {
  const maybeWindow = globalThis as typeof globalThis & { window?: MockWindow };
  if (!maybeWindow.window) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {} as Window & typeof globalThis & MockWindow,
    });
  }
  return maybeWindow.window as MockWindow;
};

afterEach(() => {
  const maybeWindow = globalThis as typeof globalThis & { window?: MockWindow };
  if (maybeWindow.window) {
    delete maybeWindow.window.__KEPPO_E2E_METADATA__;
    delete maybeWindow.window.__KEPPO_E2E_SERVER_FN_MOCKS__;
    delete maybeWindow.window;
  }
});

describe("generateAutomationPrompt", () => {
  it("uses the browser E2E mock when one is registered", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      name: "Mocked builder draft",
    });
    const mockWindow = getMockWindow();
    mockWindow.__KEPPO_E2E_METADATA__ = { namespace: "test" };
    mockWindow.__KEPPO_E2E_SERVER_FN_MOCKS__ = {
      generateAutomationPrompt: mock,
    };

    await expect(
      generateAutomationPrompt({
        workspace_id: "ws_123",
        user_description: "Summarize new issues",
        generation_mode: "edit",
        automation_context: {
          automation_id: "aut_123",
          name: "Current automation",
          description: "Existing automation",
          mermaid_content: "flowchart TD\nA-->B",
          trigger_type: "manual",
          schedule_cron: null,
          event_provider: null,
          event_type: null,
          ai_model_provider: "openai",
          ai_model_name: "gpt-5.4",
          network_access: "mcp_only",
          prompt: "Existing prompt",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      name: "Mocked builder draft",
    });

    expect(mock).toHaveBeenCalledWith({
      workspace_id: "ws_123",
      user_description: "Summarize new issues",
      generation_mode: "edit",
      automation_context: {
        automation_id: "aut_123",
        name: "Current automation",
        description: "Existing automation",
        mermaid_content: "flowchart TD\nA-->B",
        trigger_type: "manual",
        schedule_cron: null,
        event_provider: null,
        event_type: null,
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        prompt: "Existing prompt",
      },
    });
  });
});

describe("generateAutomationQuestions", () => {
  it("uses the browser E2E mock when one is registered", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      questions: [],
    });
    const mockWindow = getMockWindow();
    mockWindow.__KEPPO_E2E_METADATA__ = { namespace: "test" };
    mockWindow.__KEPPO_E2E_SERVER_FN_MOCKS__ = {
      generateAutomationQuestions: mock,
    };

    await expect(
      generateAutomationQuestions({
        workspace_id: "ws_123",
        user_description: "Summarize new issues",
        automation_context: {
          name: "Current automation",
          description: "Existing automation",
          mermaid_content: "flowchart TD\nA-->B",
          trigger_type: "manual",
          schedule_cron: null,
          event_provider: null,
          event_type: null,
          ai_model_provider: "openai",
          ai_model_name: "gpt-5.4",
          network_access: "mcp_only",
          prompt: "Existing prompt",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      questions: [],
    });

    expect(mock).toHaveBeenCalledWith({
      workspace_id: "ws_123",
      user_description: "Summarize new issues",
      automation_context: {
        name: "Current automation",
        description: "Existing automation",
        mermaid_content: "flowchart TD\nA-->B",
        trigger_type: "manual",
        schedule_cron: null,
        event_provider: null,
        event_type: null,
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        prompt: "Existing prompt",
      },
    });
  });
});

describe("normalizeOptionalBetterAuthCookie", () => {
  it("treats nullish auth cookies as omitted", () => {
    expect(normalizeOptionalBetterAuthCookie(null)).toBeUndefined();
    expect(normalizeOptionalBetterAuthCookie(undefined)).toBeUndefined();
  });

  it("preserves string auth cookies", () => {
    expect(normalizeOptionalBetterAuthCookie("better-auth.session_token=session_token_test")).toBe(
      "better-auth.session_token=session_token_test",
    );
  });
});
