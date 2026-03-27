import { describe, expect, it } from "vitest";
import {
  automationClarificationQuestionsJsonSchema,
  automationGenerationJsonSchema,
  buildAutomationQuestionGenerationMetaPrompt,
  buildAutomationGenerationMetaPrompt,
  parseAutomationClarificationAnswersPayload,
  parseAutomationClarificationQuestionsPayload,
  parseGenerationResponse,
  parseMermaidGenerationResponse,
  parseQuestionGenerationResponse,
  summarizeAutomationClarifications,
} from "./ai_generation";

/** Meta prompts use a literal backslash + `n` between lines; expand for readable snapshots. */
const expandMetaPromptForSnapshot = (value: string): string => value.replace(/\\n/g, "\n");

describe("ai_generation", () => {
  describe("meta prompt snapshots", () => {
    it("matches snapshot for buildAutomationGenerationMetaPrompt", () => {
      const prompt = buildAutomationGenerationMetaPrompt({
        userDescription: "Triages GitHub issues every morning",
        availableActions: [
          {
            name: "github.list_issues",
            description: "List open issues for a repository",
            capabilities: ["filter by label", "sort by updated_at"],
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

      expect(expandMetaPromptForSnapshot(prompt)).toMatchInlineSnapshot(`
        "You are generating a production-ready autonomous automation configuration for Keppo.

        Context:
        - User request: Triages GitHub issues every morning
        - The automation runs in a sandbox and can only use the workspace actions listed below.

        Resolved clarifications from the operator:
        - Where should the summary go?: Slack

        Available workspace actions:
        - github.list_issues: List open issues for a repository
          Capabilities: filter by label, sort by updated_at

        Requirements:
        1. Produce a clear, executable automation prompt that focuses on business logic and operator intent, not implementation mechanics.
        2. Treat the resolved clarifications as higher-confidence than your own guesses. Use them when they materially shape the automation.
        3. Assume the listed workspace actions are already available. Do not tell the automation to discover tools, check whether tools are enabled, or branch on missing/disabled tools unless the user explicitly asked for setup or diagnostics.
        4. The prompt must include objective, step-by-step behavior, safeguards, and expected output format.
        5. Produce a concise human-facing description in plain language only.
        6. Produce Mermaid diagram source separately in mermaid_content.
        7. Do not mention internal tool names, APIs, or helper primitives such as search_tools, execute_code, MCP, or sandbox internals in the automation prompt unless the user explicitly asked for those implementation details.
        8. The prompt may rely on the available workspace actions internally, but it should describe the desired business outcome in plain operational language. Do NOT describe JSON schemas, etc. in the prompt. These are implementation details which will be described at runtime.
        9. Mermaid should be concise and readable. Show the main workflow stages and decision points, not every implementation detail or helper call.
        10. Mermaid must be parse-safe: when a node label contains natural language, punctuation, parentheses, commas, slashes, or timestamps, wrap the label in double quotes. Prefer A["Schedule Trigger: 9:00 AM daily"] over A[Schedule Trigger: 9:00 AM daily].
        11. Keep Mermaid simple and conservative. Prefer plain flowchart nodes and edges; avoid syntax tricks unless required.
        12. Never invent unavailable actions, APIs, or credentials.
        13. Infer a short, descriptive automation name from the user request (max 60 chars).
        14. Choose ai_model_provider, ai_model_name, and network_access conservatively. Prefer OpenAI, the first-party default model, and mcp_only unless the request clearly needs something else.
        15. Infer the trigger type: "schedule" if the user mentions a recurring time/interval, "event" if they mention reacting to a webhook/event, or "manual" otherwise.
        16. If trigger_type is "schedule", produce a valid 5-field cron expression in schedule_cron (minute hour day-of-month month day-of-week). Examples: "0 9 * * *" = every day at 9 AM, "0 17 * * 5" = every Friday at 5 PM, "*/30 * * * *" = every 30 minutes. Otherwise set schedule_cron to null.
        17. If trigger_type is "event", set event_provider to the provider name (e.g. "github", "stripe") and event_type to the event (e.g. "issues.opened", "refund.created"). Otherwise set both event_provider and event_type to null.
        18. Include provider_recommendations when the request implies an external provider dependency. Each recommendation must include provider, reason, and confidence ("required" or "recommended").

        Return strict JSON only with this exact shape:
        {
          "name": "...",
          "prompt": "...",
          "description": "...",
          "mermaid_content": "...",
          "ai_model_provider": "openai" | "anthropic",
          "ai_model_name": "...",
          "network_access": "mcp_only" | "mcp_and_web",
          "trigger_type": "schedule" | "event" | "manual",
          "schedule_cron": "... | null",
          "event_provider": "... | null",
          "event_type": "... | null",
          "provider_recommendations": [
            { "provider": "...", "reason": "...", "confidence": "required" | "recommended" }
          ]
        }

        mermaid_content must contain valid Mermaid source without Markdown fences."
      `);
    });

    it("matches snapshot for buildAutomationQuestionGenerationMetaPrompt", () => {
      const prompt = buildAutomationQuestionGenerationMetaPrompt(
        "Triages GitHub issues every morning",
        [
          {
            name: "github.list_issues",
            description: "List open issues for a repository",
            capabilities: ["filter by label", "sort by updated_at"],
          },
        ],
      );

      expect(expandMetaPromptForSnapshot(prompt)).toMatchInlineSnapshot(`
        "You are generating a short clarification questionnaire before Keppo drafts an automation.

        Context:
        - User request: Triages GitHub issues every morning
        - The automation runs in a sandbox and can only use the workspace actions listed below.

        Available workspace actions:
        - github.list_issues: List open issues for a repository
          Capabilities: filter by label, sort by updated_at

        Requirements:
        1. Ask only the smallest set of questions needed to draft a reliable automation.
        2. Return at most 4 questions. Return fewer when the request is already specific enough.
        3. Focus only on missing details that materially affect the draft: trigger choice, output expectations, exception handling, provider usage, or operator preferences.
        4. Do not ask for information the user already gave you.
        5. Use only these input types: radio, checkbox, text.
        6. Text questions must be answerable with a short single-line response, never a paragraph.
        7. Radio and checkbox options must be concrete, concise, and operator-friendly.
        8. Do not ask about credentials, setup steps, or anything the builder can keep advisory later.
        9. If no clarifications are needed, return an empty questions array.

        Return strict JSON only with this exact shape:
        {
          "questions": [
            {
              "id": "...",
              "label": "...",
              "description": "... | null",
              "input_type": "radio" | "checkbox" | "text",
              "required": true | false,
              "options": [
                { "value": "...", "label": "...", "description": "... | null" }
              ] | null,
              "placeholder": "... | null"
            }
          ]
        }"
      `);
    });
  });

  describe("fenced json parsing", () => {
    it("parses fenced question payloads", () => {
      expect(
        parseQuestionGenerationResponse(
          '```json\n{"questions":[{"id":"target","label":"Target?","description":null,"input_type":"text","required":true,"options":null,"placeholder":"Team"}]}\n```',
        ),
      ).toEqual([
        {
          id: "target",
          label: "Target?",
          description: undefined,
          input_type: "text",
          required: true,
          options: [],
          placeholder: "Team",
        },
      ]);
    });

    it("parses fenced mermaid payloads without swallowing trailing prose", () => {
      expect(
        parseMermaidGenerationResponse(
          '```json\n{"mermaid_content":"flowchart TD\\nA-->B"}\n```\nExtra commentary',
        ),
      ).toBe("flowchart TD\nA-->B");
    });
  });

  it("builds a meta prompt with user request and available actions", () => {
    const prompt = buildAutomationGenerationMetaPrompt({
      userDescription: "Triages GitHub issues every morning",
      availableActions: [
        {
          name: "github.list_issues",
          description: "List open issues for a repository",
          capabilities: ["filter by label", "sort by updated_at"],
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

    expect(prompt).toContain("Triages GitHub issues every morning");
    expect(prompt).toContain("github.list_issues");
    expect(prompt).toContain("filter by label");
    expect(prompt).toContain("Resolved clarifications from the operator");
    expect(prompt).toContain("Where should the summary go?: Slack");
    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("trigger_type");
    expect(prompt).toContain("schedule_cron");
    expect(prompt).toContain("mermaid_content");
    expect(prompt).toContain("Do not mention internal tool names");
    expect(prompt).toContain("search_tools, execute_code");
    expect(prompt).toContain("Mermaid should be concise and readable");
    expect(prompt).toContain("Do not tell the automation to discover tools");
    expect(prompt).toContain("branch on missing/disabled tools");
  });

  it("builds a clarification questionnaire prompt", () => {
    const prompt = buildAutomationQuestionGenerationMetaPrompt(
      "Triages GitHub issues every morning",
      [
        {
          name: "github.list_issues",
          description: "List open issues for a repository",
          capabilities: ["filter by label", "sort by updated_at"],
        },
      ],
    );

    expect(prompt).toContain("short clarification questionnaire");
    expect(prompt).toContain("Return at most 4 questions");
    expect(prompt).toContain('"input_type": "radio" | "checkbox" | "text"');
    expect(prompt).toContain('"questions": [');
  });

  it("exports a strict json schema for structured outputs", () => {
    expect(automationGenerationJsonSchema.additionalProperties).toBe(false);
    expect(automationGenerationJsonSchema.required).toEqual(
      expect.arrayContaining([
        "name",
        "prompt",
        "description",
        "mermaid_content",
        "ai_model_provider",
        "ai_model_name",
        "network_access",
        "trigger_type",
        "schedule_cron",
        "event_provider",
        "event_type",
        "provider_recommendations",
      ]),
    );
  });

  it("exports a strict clarification questions schema", () => {
    expect(automationClarificationQuestionsJsonSchema.additionalProperties).toBe(false);
    expect(automationClarificationQuestionsJsonSchema.required).toEqual(["questions"]);
  });

  it("parses clarification questions and answers", () => {
    const questions = parseAutomationClarificationQuestionsPayload({
      questions: [
        {
          id: "delivery_target",
          label: "Where should the summary go?",
          description: "Choose one destination.",
          input_type: "radio",
          required: true,
          options: [
            {
              value: "slack",
              label: "Slack",
              description: null,
            },
            {
              value: "email",
              label: "Email",
              description: null,
            },
          ],
          placeholder: null,
        },
      ],
    });

    const answers = parseAutomationClarificationAnswersPayload(
      [
        {
          question_id: "delivery_target",
          value: "slack",
        },
      ],
      questions,
    );

    expect(questions).toEqual([
      {
        id: "delivery_target",
        label: "Where should the summary go?",
        description: "Choose one destination.",
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
    ]);
    expect(answers).toEqual([
      {
        question_id: "delivery_target",
        value: "slack",
      },
    ]);
    expect(summarizeAutomationClarifications(questions, answers)).toEqual([
      {
        question_id: "delivery_target",
        label: "Where should the summary go?",
        answer: "Slack",
      },
    ]);
  });

  it("summarizes checkbox answers with human-readable option labels", () => {
    const questions = parseAutomationClarificationQuestionsPayload({
      questions: [
        {
          id: "channels",
          label: "Which channels should receive updates?",
          description: null,
          input_type: "checkbox",
          required: true,
          options: [
            {
              value: "slack",
              label: "Slack",
              description: null,
            },
            {
              value: "email",
              label: "Email",
              description: null,
            },
          ],
          placeholder: null,
        },
      ],
    });

    const answers = parseAutomationClarificationAnswersPayload(
      [
        {
          question_id: "channels",
          value: ["slack", "email"],
        },
      ],
      questions,
    );

    expect(summarizeAutomationClarifications(questions, answers)).toEqual([
      {
        question_id: "channels",
        label: "Which channels should receive updates?",
        answer: "Slack, Email",
      },
    ]);
  });

  it("drops tampered closed-choice clarification answers", () => {
    const questions = parseAutomationClarificationQuestionsPayload({
      questions: [
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
        {
          id: "channels",
          label: "Which channels should receive updates?",
          input_type: "checkbox",
          required: false,
          options: [
            {
              value: "email",
              label: "Email",
            },
          ],
        },
      ],
    });

    expect(
      parseAutomationClarificationAnswersPayload(
        [
          {
            question_id: "delivery_target",
            value: "pagerduty",
          },
          {
            question_id: "channels",
            value: ["email", "sms"],
          },
        ],
        questions,
      ),
    ).toEqual([
      {
        question_id: "channels",
        value: ["email"],
      },
    ]);
  });

  it("parses question generation responses", () => {
    expect(
      parseQuestionGenerationResponse(
        JSON.stringify({
          questions: [
            {
              id: "trigger_style",
              label: "How should it start?",
              description: null,
              input_type: "radio",
              required: true,
              options: [
                { value: "schedule", label: "On a schedule", description: null },
                { value: "event", label: "From an event", description: null },
              ],
              placeholder: null,
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: "trigger_style",
        label: "How should it start?",
        input_type: "radio",
        required: true,
        options: [
          { value: "schedule", label: "On a schedule" },
          { value: "event", label: "From an event" },
        ],
      },
    ]);
  });

  it("parses direct JSON responses with extended fields", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        name: "Issue Triage Bot",
        prompt: "Do the thing",
        description: "Summarize the issue triage workflow.",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        trigger_type: "schedule",
        schedule_cron: "0 9 * * *",
        event_provider: null,
        event_type: null,
        provider_recommendations: [],
      }),
    );

    expect(parsed.prompt).toBe("Do the thing");
    expect(parsed.description).toBe("Summarize the issue triage workflow.");
    expect(parsed.mermaid_content).toContain("flowchart TD");
    expect(parsed.name).toBe("Issue Triage Bot");
    expect(parsed.ai_model_provider).toBe("openai");
    expect(parsed.ai_model_name).toBe("gpt-5.4");
    expect(parsed.network_access).toBe("mcp_only");
    expect(parsed.trigger_type).toBe("schedule");
    expect(parsed.schedule_cron).toBe("0 9 * * *");
    expect(parsed.provider_recommendations).toEqual([]);
  });

  it("parses event trigger responses", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        name: "Refund Notifier",
        prompt: "Notify on refund",
        description: "desc",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        trigger_type: "event",
        schedule_cron: null,
        event_provider: "stripe",
        event_type: "refund.created",
        provider_recommendations: [],
      }),
    );

    expect(parsed.trigger_type).toBe("event");
    expect(parsed.event_provider).toBe("stripe");
    expect(parsed.event_type).toBe("refund.created");
    expect(parsed.provider_recommendations).toEqual([
      {
        provider: "stripe",
        reason: "stripe is required for the inferred event trigger.",
        confidence: "required",
      },
    ]);
  });

  it("merges model and inferred provider recommendations", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        name: "Issue Triage Bot",
        prompt: "Review GitHub issues and summarize blockers",
        description: "desc",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        trigger_type: "manual",
        schedule_cron: null,
        event_provider: null,
        event_type: null,
        provider_recommendations: [
          {
            provider: "github",
            reason: "Needed to inspect issues.",
            confidence: "recommended",
          },
        ],
      }),
      {
        userDescription: "Review GitHub issues every morning",
        availableActions: [
          {
            name: "github.list_issues",
            description: "List repository issues",
          },
        ],
      },
    );

    expect(parsed.provider_recommendations).toEqual([
      {
        provider: "github",
        reason: "Needed to inspect issues.",
        confidence: "recommended",
      },
    ]);
  });

  it("parses fenced JSON responses", () => {
    const parsed = parseGenerationResponse(
      '```json\n{\n  "prompt": "Run checks",\n  "description": "desc",\n  "mermaid_content": "flowchart TD\\nA-->B",\n  "ai_model_provider": "openai",\n  "ai_model_name": "gpt-5.4",\n  "network_access": "mcp_only",\n  "trigger_type": "manual",\n  "schedule_cron": null,\n  "event_provider": null,\n  "event_type": null,\n  "provider_recommendations": []\n}\n```',
    );

    expect(parsed.prompt).toBe("Run checks");
    expect(parsed.description).toBe("desc");
    expect(parsed.trigger_type).toBe("manual");
    expect(parsed.name).toBe("Run checks");
  });

  it("defaults trigger_type to manual when missing", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        prompt: "Do something",
        description: "desc",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        schedule_cron: null,
        event_provider: null,
        event_type: null,
        provider_recommendations: [],
      }),
    );

    expect(parsed.trigger_type).toBe("manual");
    expect(parsed.schedule_cron).toBeUndefined();
  });

  it("derives name from prompt when name is missing", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        prompt: "Check all open GitHub issues daily",
        description: "desc",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        trigger_type: "manual",
        schedule_cron: null,
        event_provider: null,
        event_type: null,
        provider_recommendations: [],
      }),
    );

    expect(parsed.name).toBe("Check all open GitHub issues");
  });

  it("falls back to manual when cron is invalid", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        name: "Bad Cron Automation",
        prompt: "Do work",
        description: "desc",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        trigger_type: "schedule",
        schedule_cron: "not a cron",
        event_provider: null,
        event_type: null,
        provider_recommendations: [],
      }),
    );

    expect(parsed.trigger_type).toBe("manual");
    expect(parsed.schedule_cron).toBeUndefined();
  });

  it("falls back to manual when event fields are incomplete", () => {
    const parsed = parseGenerationResponse(
      JSON.stringify({
        name: "Missing Event",
        prompt: "Do work",
        description: "desc",
        mermaid_content: "flowchart TD\nA-->B",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        network_access: "mcp_only",
        trigger_type: "event",
        schedule_cron: null,
        event_provider: "github",
        event_type: null,
        provider_recommendations: [],
      }),
    );

    expect(parsed.trigger_type).toBe("manual");
    expect(parsed.event_provider).toBeUndefined();
  });

  it("rejects responses that still embed mermaid in the description", () => {
    expect(() =>
      parseGenerationResponse(
        JSON.stringify({
          name: "Issue Triage Bot",
          prompt: "Do the thing",
          description: "```mermaid\nflowchart TD\nA-->B\n```",
          mermaid_content: "flowchart TD\nA-->B",
          ai_model_provider: "openai",
          ai_model_name: "gpt-5.4",
          network_access: "mcp_only",
          trigger_type: "manual",
          schedule_cron: null,
          event_provider: null,
          event_type: null,
          provider_recommendations: [],
        }),
      ),
    ).toThrow(/Unable to parse generation response/);
  });

  it("rejects mermaid_content wrapped in markdown fences", () => {
    expect(() =>
      parseGenerationResponse(
        JSON.stringify({
          name: "Issue Triage Bot",
          prompt: "Do the thing",
          description: "Plain language summary",
          mermaid_content: "```mermaid\nflowchart TD\nA-->B\n```",
          ai_model_provider: "openai",
          ai_model_name: "gpt-5.4",
          network_access: "mcp_only",
          trigger_type: "manual",
          schedule_cron: null,
          event_provider: null,
          event_type: null,
          provider_recommendations: [],
        }),
      ),
    ).toThrow(/Unable to parse generation response/);
  });

  it("throws when response does not include valid JSON payload", () => {
    expect(() => parseGenerationResponse("not valid json")).toThrow(
      /Unable to parse generation response/,
    );
  });
});
