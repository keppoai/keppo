export type AutomationGenerationAction = {
  name: string;
  description: string;
  capabilities?: string[];
};

export type AutomationClarificationQuestionInputType = "radio" | "checkbox" | "text";

export type AutomationClarificationQuestionOption = {
  value: string;
  label: string;
  description?: string;
};

export type AutomationClarificationQuestion = {
  id: string;
  label: string;
  description?: string;
  input_type: AutomationClarificationQuestionInputType;
  required: boolean;
  options: AutomationClarificationQuestionOption[];
  placeholder?: string;
};

export type AutomationClarificationAnswer = {
  question_id: string;
  value: string | string[];
};

export type AutomationClarificationSummaryItem = {
  question_id: string;
  label: string;
  answer: string;
};

export type AutomationProviderRecommendation = {
  provider: string;
  reason: string;
  confidence: "required" | "recommended";
};

export type AutomationContextSnapshot = {
  automation_id?: string;
  name: string;
  description: string;
  mermaid_content: string;
  trigger_type: "schedule" | "event" | "manual";
  schedule_cron?: string | null;
  event_provider?: string | null;
  event_type?: string | null;
  ai_model_provider: "openai" | "anthropic";
  ai_model_name: string;
  network_access: "mcp_only" | "mcp_and_web";
  prompt: string;
};

export type ParsedAutomationGeneration = {
  prompt: string;
  description: string;
  mermaid_content: string;
  name: string;
  ai_model_provider: "openai" | "anthropic";
  ai_model_name: string;
  network_access: "mcp_only" | "mcp_and_web";
  trigger_type: "schedule" | "event" | "manual";
  schedule_cron?: string;
  event_provider?: string;
  event_type?: string;
  provider_recommendations: AutomationProviderRecommendation[];
};

export const automationMermaidJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mermaid_content: {
      type: "string",
      description: "Raw Mermaid diagram source for the workflow. Do not wrap in markdown fences.",
    },
  },
  required: ["mermaid_content"],
} as const;

export const automationGenerationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "Short automation name, maximum 60 characters.",
    },
    prompt: {
      type: "string",
      description:
        "Executable automation prompt with objective, ordered steps, safeguards, and expected output format.",
    },
    description: {
      type: "string",
      description:
        "Plain-language operator-facing summary only. Do not include Mermaid, markdown code fences, or raw diagram syntax.",
    },
    mermaid_content: {
      type: "string",
      description: "Raw Mermaid diagram source for the workflow. Do not wrap in markdown fences.",
    },
    ai_model_provider: {
      type: "string",
      enum: ["openai", "anthropic"],
      description: "AI model provider for the automation runtime.",
    },
    ai_model_name: {
      type: "string",
      description: "Model name to run for this automation.",
    },
    network_access: {
      type: "string",
      enum: ["mcp_only", "mcp_and_web"],
      description: "Whether the automation may access the web beyond connected tools.",
    },
    trigger_type: {
      type: "string",
      enum: ["schedule", "event", "manual"],
    },
    schedule_cron: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "5-field cron expression when trigger_type is schedule. Use null otherwise.",
    },
    event_provider: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Provider id when trigger_type is event. Use null otherwise.",
    },
    event_type: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Provider event name when trigger_type is event. Use null otherwise.",
    },
    provider_recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: {
            type: "string",
          },
          reason: {
            type: "string",
          },
          confidence: {
            type: "string",
            enum: ["required", "recommended"],
          },
        },
        required: ["provider", "reason", "confidence"],
      },
    },
  },
  required: [
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
  ],
} as const;

export const automationClarificationQuestionsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
            description: "Stable snake_case identifier for the answer field.",
          },
          label: {
            type: "string",
            description: "Operator-facing question text, maximum 120 characters.",
          },
          description: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "Optional short helper text.",
          },
          input_type: {
            type: "string",
            enum: ["radio", "checkbox", "text"],
          },
          required: {
            type: "boolean",
          },
          options: {
            anyOf: [
              {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    value: {
                      type: "string",
                    },
                    label: {
                      type: "string",
                    },
                    description: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                  },
                  required: ["value", "label", "description"],
                },
              },
              { type: "null" },
            ],
            description: "Required for radio/checkbox questions. Use null for text questions.",
          },
          placeholder: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "Short placeholder copy for text questions. Use null otherwise.",
          },
        },
        required: [
          "id",
          "label",
          "description",
          "input_type",
          "required",
          "options",
          "placeholder",
        ],
      },
    },
  },
  required: ["questions"],
} as const;

const sanitizeLine = (value: string): string => value.replace(/\s+/g, " ").trim();
const MERMAID_FENCE_RE = /```mermaid\b/i;
const GENERIC_FENCE_RE = /```/;
const QUESTION_LIMIT = 4;
const QUESTION_OPTION_LIMIT = 6;
const SHORT_TEXT_LIMIT = 160;
const QUESTION_LABEL_LIMIT = 120;
const QUESTION_DESCRIPTION_LIMIT = 180;
const QUESTION_PLACEHOLDER_LIMIT = 80;
const QUESTION_ID_RE = /[^a-z0-9]+/g;

const MERMAID_BLOCK_RE =
  /^\s*(flowchart|graph|sequenceDiagram|stateDiagram|erDiagram|journey|gantt|mindmap|timeline|gitGraph|classDiagram)\b/m;

const hasMermaidInDescription = (value: string): boolean => {
  return MERMAID_FENCE_RE.test(value) || MERMAID_BLOCK_RE.test(value);
};

const hasMarkdownFence = (value: string): boolean => GENERIC_FENCE_RE.test(value);

const normalizeActions = (
  actions: AutomationGenerationAction[],
): Array<{ name: string; description: string; capabilities: string[] }> => {
  return actions
    .map((action) => ({
      name: sanitizeLine(action.name),
      description: sanitizeLine(action.description),
      capabilities: (action.capabilities ?? []).map((capability) => sanitizeLine(capability)),
    }))
    .filter((action) => action.name.length > 0 && action.description.length > 0);
};

const renderActionCatalog = (
  actions: Array<{ name: string; description: string; capabilities: string[] }>,
): string => {
  if (actions.length === 0) {
    return "- No tools are currently available in this workspace. In the prompt, explicitly mention that no direct tool actions are possible and propose manual next steps.";
  }

  return actions
    .map((action) => {
      const capabilityText =
        action.capabilities.length > 0
          ? `\\n  Capabilities: ${action.capabilities.join(", ")}`
          : "\\n  Capabilities: not provided";
      return `- ${action.name}: ${action.description}${capabilityText}`;
    })
    .join("\\n");
};

const renderAutomationContext = (context: AutomationContextSnapshot): string => {
  return [
    `- Existing automation id: ${sanitizeLine(context.automation_id ?? "unknown") || "unknown"}`,
    `- Current name: ${sanitizeLine(context.name)}`,
    `- Current description: ${sanitizeLine(context.description) || "None"}`,
    `- Current trigger type: ${context.trigger_type}`,
    `- Current schedule: ${sanitizeLine(context.schedule_cron ?? "") || "None"}`,
    `- Current event provider: ${sanitizeLine(context.event_provider ?? "") || "None"}`,
    `- Current event type: ${sanitizeLine(context.event_type ?? "") || "None"}`,
    `- Current model provider: ${context.ai_model_provider}`,
    `- Current model: ${sanitizeLine(context.ai_model_name)}`,
    `- Current network access: ${context.network_access}`,
    `- Current prompt: ${sanitizeLine(context.prompt)}`,
    `- Current Mermaid: ${sanitizeLine(context.mermaid_content) || "None"}`,
  ].join("\\n");
};

const toQuestionId = (value: string, index: number): string => {
  const normalized = sanitizeLine(value)
    .toLowerCase()
    .replace(QUESTION_ID_RE, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return normalized.length > 0 ? normalized : `question_${index + 1}`;
};

const toOptionValue = (value: string, index: number): string => {
  const normalized = sanitizeLine(value)
    .toLowerCase()
    .replace(QUESTION_ID_RE, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return normalized.length > 0 ? normalized : `option_${index + 1}`;
};

const parseQuestionOption = (
  value: unknown,
  questionId: string,
  index: number,
): AutomationClarificationQuestionOption => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid option for clarification question ${questionId}`);
  }
  const record = value as Record<string, unknown>;
  const label =
    typeof record.label === "string"
      ? sanitizeLine(record.label).slice(0, QUESTION_LABEL_LIMIT)
      : "";
  if (label.length === 0) {
    throw new Error(`Clarification question ${questionId} has an empty option label`);
  }
  const optionValueSource =
    typeof record.value === "string" && sanitizeLine(record.value).length > 0
      ? record.value
      : label;
  const description =
    typeof record.description === "string"
      ? sanitizeLine(record.description).slice(0, QUESTION_DESCRIPTION_LIMIT)
      : "";
  return {
    value: toOptionValue(optionValueSource, index),
    label,
    ...(description.length > 0 ? { description } : {}),
  };
};

const parseQuestionRecord = (
  value: unknown,
  index: number,
): AutomationClarificationQuestion | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const label =
    typeof record.label === "string"
      ? sanitizeLine(record.label).slice(0, QUESTION_LABEL_LIMIT)
      : "";
  if (label.length === 0) {
    return null;
  }
  const inputType =
    record.input_type === "radio" ||
    record.input_type === "checkbox" ||
    record.input_type === "text"
      ? record.input_type
      : null;
  if (!inputType) {
    return null;
  }
  const idSource = typeof record.id === "string" ? record.id : label;
  const description =
    typeof record.description === "string"
      ? sanitizeLine(record.description).slice(0, QUESTION_DESCRIPTION_LIMIT)
      : "";
  const placeholder =
    typeof record.placeholder === "string"
      ? sanitizeLine(record.placeholder).slice(0, QUESTION_PLACEHOLDER_LIMIT)
      : "";
  const rawOptions = Array.isArray(record.options) ? record.options : [];
  const options =
    inputType === "text"
      ? []
      : rawOptions
          .slice(0, QUESTION_OPTION_LIMIT)
          .map((option, optionIndex) =>
            parseQuestionOption(option, toQuestionId(idSource, index), optionIndex),
          )
          .filter((option, optionIndex, all) => {
            return all.findIndex((entry) => entry.value === option.value) === optionIndex;
          });
  if (inputType !== "text" && options.length === 0) {
    return null;
  }
  return {
    id: toQuestionId(idSource, index),
    label,
    ...(description.length > 0 ? { description } : {}),
    input_type: inputType,
    required: record.required !== false,
    options,
    ...(inputType === "text" && placeholder.length > 0 ? { placeholder } : {}),
  };
};

const parseAnswerEntry = (
  questionId: string,
  value: unknown,
  questionsById: Map<string, AutomationClarificationQuestion>,
): AutomationClarificationAnswer | null => {
  const question = questionsById.get(questionId);
  if (!question) {
    return null;
  }

  const parseString = (entry: unknown): string => {
    return typeof entry === "string" ? sanitizeLine(entry).slice(0, SHORT_TEXT_LIMIT) : "";
  };

  const allowedOptionMap = new Map<string, string>();
  for (const option of question.options) {
    allowedOptionMap.set(option.value, option.value);
    allowedOptionMap.set(option.label.toLowerCase(), option.value);
  }

  if (question.input_type === "checkbox") {
    const values = (Array.isArray(value) ? value : [value])
      .map((entry) => parseString(entry))
      .map((entry) => {
        if (!entry) {
          return "";
        }
        const mapped = allowedOptionMap.get(entry) ?? allowedOptionMap.get(entry.toLowerCase());
        return mapped ?? "";
      })
      .filter((entry): entry is string => entry.length > 0)
      .filter((entry, index, all) => all.indexOf(entry) === index);
    return values.length > 0 ? { question_id: questionId, value: values } : null;
  }

  const first =
    typeof value === "string"
      ? parseString(value)
      : Array.isArray(value)
        ? parseString(value[0])
        : "";
  if (first.length === 0) {
    return null;
  }
  if (question.input_type === "radio") {
    const mapped = allowedOptionMap.get(first) ?? allowedOptionMap.get(first.toLowerCase());
    if (!mapped) {
      return null;
    }
    return { question_id: questionId, value: mapped };
  }
  return { question_id: questionId, value: first };
};

const parseClarificationQuestionArray = (value: unknown): AutomationClarificationQuestion[] => {
  const rawQuestions = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? ((value as Record<string, unknown>).questions ?? [])
      : [];
  if (!Array.isArray(rawQuestions)) {
    throw new Error("Clarification questions must be an array");
  }
  const questions = rawQuestions
    .slice(0, QUESTION_LIMIT)
    .map((question, index) => parseQuestionRecord(question, index))
    .filter((question): question is AutomationClarificationQuestion => question !== null)
    .filter((question, index, all) => {
      return all.findIndex((entry) => entry.id === question.id) === index;
    });
  return questions;
};

export const parseAutomationClarificationQuestionsPayload = (
  value: unknown,
): AutomationClarificationQuestion[] => {
  return parseClarificationQuestionArray(value);
};

export const parseAutomationClarificationAnswersPayload = (
  value: unknown,
  questions: AutomationClarificationQuestion[],
): AutomationClarificationAnswer[] => {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const rawEntries = Array.isArray(value)
    ? value.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        return {
          question_id:
            typeof record.question_id === "string" ? sanitizeLine(record.question_id) : "",
          value: record.value,
        };
      })
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([questionId, answerValue]) => ({
          question_id: sanitizeLine(questionId),
          value: answerValue,
        }))
      : [];

  if (!Array.isArray(rawEntries)) {
    throw new Error("Clarification answers must be an array or object");
  }

  return rawEntries
    .map((entry) => {
      if (!entry?.question_id) {
        return null;
      }
      return parseAnswerEntry(entry.question_id, entry.value, questionsById);
    })
    .filter((entry): entry is AutomationClarificationAnswer => entry !== null)
    .filter((entry, index, all) => {
      return all.findIndex((candidate) => candidate.question_id === entry.question_id) === index;
    });
};

export const summarizeAutomationClarifications = (
  questions: AutomationClarificationQuestion[],
  answers: AutomationClarificationAnswer[],
): AutomationClarificationSummaryItem[] => {
  const answerMap = new Map(answers.map((answer) => [answer.question_id, answer]));
  return questions.flatMap((question) => {
    const answer = answerMap.get(question.id);
    if (!answer) {
      return [];
    }
    const optionLabels = new Map(question.options.map((option) => [option.value, option.label]));
    const normalizeAnswerValue = (value: string): string => optionLabels.get(value) ?? value;
    const answerText = Array.isArray(answer.value)
      ? answer.value.map(normalizeAnswerValue).join(", ")
      : question.input_type === "text"
        ? answer.value
        : normalizeAnswerValue(answer.value);
    if (answerText.trim().length === 0) {
      return [];
    }
    return [
      {
        question_id: question.id,
        label: question.label,
        answer: answerText,
      },
    ];
  });
};

export const buildAutomationQuestionGenerationMetaPrompt = (
  userDescription: string,
  availableActions: AutomationGenerationAction[],
): string => {
  const normalizedDescription = sanitizeLine(userDescription);
  if (normalizedDescription.length === 0) {
    throw new Error("userDescription must not be empty");
  }

  const actions = normalizeActions(availableActions);
  const actionCatalog = renderActionCatalog(actions);

  return [
    "You are generating a short clarification questionnaire before Keppo drafts an automation.",
    "",
    "Context:",
    `- User request: ${normalizedDescription}`,
    "- The automation runs in a sandbox and can only use the workspace actions listed below.",
    "",
    "Available workspace actions:",
    actionCatalog,
    "",
    "Requirements:",
    "1. Ask only the smallest set of questions needed to draft a reliable automation.",
    "2. Return at most 4 questions. Return fewer when the request is already specific enough.",
    "3. Focus only on missing details that materially affect the draft: trigger choice, output expectations, exception handling, provider usage, or operator preferences.",
    "4. Do not ask for information the user already gave you.",
    "5. Use only these input types: radio, checkbox, text.",
    "6. Text questions must be answerable with a short single-line response, never a paragraph.",
    "7. Radio and checkbox options must be concrete, concise, and operator-friendly.",
    "8. Do not ask about credentials, setup steps, or anything the builder can keep advisory later.",
    "9. If no clarifications are needed, return an empty questions array.",
    "",
    "Return strict JSON only with this exact shape:",
    "{",
    '  "questions": [',
    "    {",
    '      "id": "...",',
    '      "label": "...",',
    '      "description": "... | null",',
    '      "input_type": "radio" | "checkbox" | "text",',
    '      "required": true | false,',
    '      "options": [',
    '        { "value": "...", "label": "...", "description": "... | null" }',
    "      ] | null,",
    '      "placeholder": "... | null"',
    "    }",
    "  ]",
    "}",
  ].join("\\n");
};

export const buildAutomationEditQuestionGenerationMetaPrompt = (args: {
  userDescription: string;
  availableActions: AutomationGenerationAction[];
  automationContext: AutomationContextSnapshot;
}): string => {
  const normalizedDescription = sanitizeLine(args.userDescription);
  if (normalizedDescription.length === 0) {
    throw new Error("userDescription must not be empty");
  }

  return [
    "You are generating a short clarification questionnaire before Keppo edits an existing automation.",
    "",
    "Requested change:",
    `- Operator request: ${normalizedDescription}`,
    "",
    "Current automation:",
    renderAutomationContext(args.automationContext),
    "",
    "Available workspace actions:",
    renderActionCatalog(normalizeActions(args.availableActions)),
    "",
    "Requirements:",
    "1. Ask only the smallest set of questions needed to safely update the existing automation.",
    "2. Return at most 4 questions.",
    "3. Ask only about details that materially change the draft relative to the existing automation.",
    "4. Prefer preserving the current automation when the operator did not request a change.",
    "5. If the requested change is already specific enough, return an empty questions array.",
    "",
    "Return strict JSON only with the same clarification-question shape used for creation.",
  ].join("\\n");
};

export const buildAutomationGenerationMetaPrompt = (args: {
  userDescription: string;
  availableActions: AutomationGenerationAction[];
  clarificationQuestions?: AutomationClarificationQuestion[];
  clarificationAnswers?: AutomationClarificationAnswer[];
}): string => {
  if (!args || typeof args !== "object") {
    throw new Error("automation generation arguments must be provided");
  }
  const normalizedDescription = sanitizeLine(args.userDescription);
  if (normalizedDescription.length === 0) {
    throw new Error("userDescription must not be empty");
  }

  const actions = normalizeActions(args.availableActions);
  const actionCatalog = renderActionCatalog(actions);
  const clarificationSummary = summarizeAutomationClarifications(
    args.clarificationQuestions ?? [],
    args.clarificationAnswers ?? [],
  );
  const clarificationCatalog =
    clarificationSummary.length > 0
      ? clarificationSummary.map((item) => `- ${item.label}: ${item.answer}`).join("\\n")
      : "- No extra clarifications were collected. Infer unresolved details conservatively.";

  return [
    "You are generating a production-ready autonomous automation configuration for Keppo.",
    "",
    "Context:",
    `- User request: ${normalizedDescription}`,
    "- The automation runs in a sandbox and can only use the workspace actions listed below.",
    "",
    "Resolved clarifications from the operator:",
    clarificationCatalog,
    "",
    "Available workspace actions:",
    actionCatalog,
    "",
    "Requirements:",
    "1. Produce a clear, executable automation prompt that focuses on business logic and operator intent, not implementation mechanics.",
    "2. Treat the resolved clarifications as higher-confidence than your own guesses. Use them when they materially shape the automation.",
    "3. Assume the listed workspace actions are already available. Do not tell the automation to discover tools, check whether tools are enabled, or branch on missing/disabled tools unless the user explicitly asked for setup or diagnostics.",
    "4. The prompt must include objective, step-by-step behavior, safeguards, and expected output format.",
    "5. Produce a concise human-facing description in plain language only.",
    "6. Produce Mermaid diagram source separately in mermaid_content.",
    "7. Do not mention internal tool names, APIs, or helper primitives such as search_tools, execute_code, MCP, or sandbox internals in the automation prompt unless the user explicitly asked for those implementation details.",
    "8. The prompt may rely on the available workspace actions internally, but it should describe the desired business outcome in plain operational language. Do NOT describe JSON schemas, etc. in the prompt. These are implementation details which will be described at runtime.",
    "9. Mermaid should be concise and readable. Show the main workflow stages and decision points, not every implementation detail or helper call.",
    '10. Mermaid must be parse-safe: when a node label contains natural language, punctuation, parentheses, commas, slashes, or timestamps, wrap the label in double quotes. Prefer A["Schedule Trigger: 9:00 AM daily"] over A[Schedule Trigger: 9:00 AM daily].',
    "11. Keep Mermaid simple and conservative. Prefer plain flowchart nodes and edges; avoid syntax tricks unless required.",
    "12. Never invent unavailable actions, APIs, or credentials.",
    "13. Infer a short, descriptive automation name from the user request (max 60 chars).",
    "14. Choose ai_model_provider, ai_model_name, and network_access conservatively. Prefer OpenAI, the first-party default model, and mcp_only unless the request clearly needs something else.",
    '15. Infer the trigger type: "schedule" if the user mentions a recurring time/interval, "event" if they mention reacting to a webhook/event, or "manual" otherwise.',
    '16. If trigger_type is "schedule", produce a valid 5-field cron expression in schedule_cron (minute hour day-of-month month day-of-week). Examples: "0 9 * * *" = every day at 9 AM, "0 17 * * 5" = every Friday at 5 PM, "*/30 * * * *" = every 30 minutes. Otherwise set schedule_cron to null.',
    '17. If trigger_type is "event", set event_provider to the provider name (e.g. "github", "stripe") and event_type to the event (e.g. "issues.opened", "refund.created"). Otherwise set both event_provider and event_type to null.',
    '18. Include provider_recommendations when the request implies an external provider dependency. Each recommendation must include provider, reason, and confidence ("required" or "recommended").',
    "",
    "Return strict JSON only with this exact shape:",
    "{",
    '  "name": "...",',
    '  "prompt": "...",',
    '  "description": "...",',
    '  "mermaid_content": "...",',
    '  "ai_model_provider": "openai" | "anthropic",',
    '  "ai_model_name": "...",',
    '  "network_access": "mcp_only" | "mcp_and_web",',
    '  "trigger_type": "schedule" | "event" | "manual",',
    '  "schedule_cron": "... | null",',
    '  "event_provider": "... | null",',
    '  "event_type": "... | null",',
    '  "provider_recommendations": [',
    '    { "provider": "...", "reason": "...", "confidence": "required" | "recommended" }',
    "  ]",
    "}",
    "",
    "mermaid_content must contain valid Mermaid source without Markdown fences.",
  ].join("\\n");
};

export const buildAutomationEditGenerationMetaPrompt = (args: {
  userDescription: string;
  availableActions: AutomationGenerationAction[];
  automationContext: AutomationContextSnapshot;
  clarificationQuestions?: AutomationClarificationQuestion[];
  clarificationAnswers?: AutomationClarificationAnswer[];
}): string => {
  const normalizedDescription = sanitizeLine(args.userDescription);
  if (normalizedDescription.length === 0) {
    throw new Error("userDescription must not be empty");
  }
  const clarificationSummary = summarizeAutomationClarifications(
    args.clarificationQuestions ?? [],
    args.clarificationAnswers ?? [],
  );
  const clarificationCatalog =
    clarificationSummary.length > 0
      ? clarificationSummary.map((item) => `- ${item.label}: ${item.answer}`).join("\\n")
      : "- No extra clarifications were collected. Preserve current values unless the request clearly implies a change.";

  return [
    "You are editing an existing Keppo automation. Produce a complete updated draft, not a patch.",
    "",
    "Requested change:",
    `- Operator request: ${normalizedDescription}`,
    "",
    "Current automation:",
    renderAutomationContext(args.automationContext),
    "",
    "Resolved clarifications from the operator:",
    clarificationCatalog,
    "",
    "Available workspace actions:",
    renderActionCatalog(normalizeActions(args.availableActions)),
    "",
    "Requirements:",
    "1. Preserve existing fields by default.",
    "2. Change only the parts needed to satisfy the operator request.",
    "3. Return a complete updated automation draft using the exact JSON shape used for creation.",
    "4. Keep the prompt executable and operator-focused.",
    "5. Keep the description plain-language only.",
    "6. Return Mermaid separately in mermaid_content.",
    "7. If trigger, model, or runtime settings do not need to change, keep them aligned with the current automation.",
    "8. Do not invent unavailable actions, APIs, or credentials.",
    "9. Mermaid should reflect the updated prompt and major workflow only.",
    "",
    "Return strict JSON only with the same JSON shape used for new automation generation.",
  ].join("\\n");
};

export const buildAutomationMermaidGenerationMetaPrompt = (args: { prompt: string }): string => {
  const normalizedPrompt = sanitizeLine(args.prompt);
  if (normalizedPrompt.length === 0) {
    throw new Error("prompt must not be empty");
  }

  return [
    "You are generating Mermaid for an existing Keppo automation prompt.",
    "",
    `- Current prompt: ${normalizedPrompt}`,
    "",
    "Requirements:",
    "1. Return Mermaid only in mermaid_content.",
    "2. Reflect the current prompt faithfully.",
    "3. Keep the diagram concise and readable.",
    "4. Use parse-safe labels with quotes when needed.",
    "5. Do not wrap the Mermaid in Markdown fences.",
    "",
    "Return strict JSON only with this exact shape:",
    "{",
    '  "mermaid_content": "..."',
    "}",
  ].join("\\n");
};

const VALID_CRON_RE =
  /^(\*|(\*\/\d+)|\d+(-\d+)?(,\d+(-\d+)?)*)( (\*|(\*\/\d+)|\d+(-\d+)?(,\d+(-\d+)?)*)){4}$/;

const isValidCron = (value: string): boolean => VALID_CRON_RE.test(value.trim());

const parseTriggerType = (value: unknown): "schedule" | "event" | "manual" => {
  if (value === "schedule" || value === "event" || value === "manual") {
    return value;
  }
  return "manual";
};

const deriveNameFromDescription = (userDescription: string): string => {
  return userDescription.split(/\s+/).slice(0, 5).join(" ");
};

const parseProviderRecommendation = (value: unknown): AutomationProviderRecommendation | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? sanitizeLine(record.provider) : "";
  const reason = typeof record.reason === "string" ? sanitizeLine(record.reason) : "";
  const confidence =
    record.confidence === "required" || record.confidence === "recommended"
      ? record.confidence
      : "recommended";
  if (provider.length === 0 || reason.length === 0) {
    return null;
  }
  return { provider, reason, confidence };
};

const inferProviderRecommendations = (
  parsed: {
    prompt: string;
    description: string;
    mermaid_content: string;
    name: string;
    event_provider?: string;
  },
  userDescription: string,
  availableActions: AutomationGenerationAction[],
): AutomationProviderRecommendation[] => {
  const providerMentions = new Map<string, AutomationProviderRecommendation>();
  const haystack = [
    userDescription,
    parsed.name,
    parsed.prompt,
    parsed.description,
    parsed.event_provider ?? "",
  ]
    .join(" ")
    .toLowerCase();

  for (const action of availableActions) {
    const provider = sanitizeLine(action.name.split(".")[0] ?? "").toLowerCase();
    if (provider.length === 0 || provider === "keppo") {
      continue;
    }
    if (!haystack.includes(provider)) {
      continue;
    }
    providerMentions.set(provider, {
      provider,
      reason: `The request references ${provider} capabilities from the workspace tool catalog.`,
      confidence: parsed.event_provider === provider ? "required" : "recommended",
    });
  }

  if (parsed.event_provider) {
    const provider = sanitizeLine(parsed.event_provider).toLowerCase();
    if (provider.length > 0) {
      providerMentions.set(provider, {
        provider,
        reason: `${provider} is required for the inferred event trigger.`,
        confidence: "required",
      });
    }
  }

  return [...providerMentions.values()].sort((left, right) => {
    if (left.confidence === right.confidence) {
      return left.provider.localeCompare(right.provider);
    }
    return left.confidence === "required" ? -1 : 1;
  });
};

const tryParseJson = (
  value: string,
  userDescription: string,
  availableActions: AutomationGenerationAction[],
): ParsedAutomationGeneration | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.prompt !== "string" ||
      typeof record.description !== "string" ||
      typeof record.mermaid_content !== "string" ||
      typeof record.ai_model_name !== "string"
    ) {
      return null;
    }
    const prompt = (record.prompt as string).trim();
    const description = (record.description as string).trim();
    const mermaidContent = (record.mermaid_content as string).trim();
    const aiModelProvider = record.ai_model_provider === "anthropic" ? "anthropic" : "openai";
    const aiModelName = (record.ai_model_name as string).trim();
    const networkAccess = record.network_access === "mcp_and_web" ? "mcp_and_web" : "mcp_only";
    if (prompt.length === 0 || description.length === 0 || mermaidContent.length === 0) {
      return null;
    }
    if (aiModelName.length === 0) {
      return null;
    }
    if (
      hasMermaidInDescription(description) ||
      hasMarkdownFence(description) ||
      hasMarkdownFence(mermaidContent)
    ) {
      return null;
    }

    const scheduleCron =
      typeof record.schedule_cron === "string"
        ? record.schedule_cron.trim()
        : record.schedule_cron === null
          ? null
          : undefined;
    const eventProvider =
      typeof record.event_provider === "string"
        ? record.event_provider.trim()
        : record.event_provider === null
          ? null
          : undefined;
    const eventType =
      typeof record.event_type === "string"
        ? record.event_type.trim()
        : record.event_type === null
          ? null
          : undefined;
    if (scheduleCron === undefined || eventProvider === undefined || eventType === undefined) {
      return null;
    }

    const name =
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim().slice(0, 60)
        : deriveNameFromDescription(prompt);

    const triggerType = parseTriggerType(record.trigger_type);

    const modelRecommendations = Array.isArray(record.provider_recommendations)
      ? record.provider_recommendations
          .map(parseProviderRecommendation)
          .filter((entry): entry is AutomationProviderRecommendation => entry !== null)
      : [];

    const result: ParsedAutomationGeneration = {
      prompt,
      description,
      mermaid_content: mermaidContent,
      name,
      ai_model_provider: aiModelProvider,
      ai_model_name: aiModelName,
      network_access: networkAccess,
      trigger_type: triggerType,
      provider_recommendations: modelRecommendations,
    };

    if (triggerType === "schedule") {
      if (typeof scheduleCron === "string" && scheduleCron && isValidCron(scheduleCron)) {
        result.schedule_cron = scheduleCron;
      } else {
        result.trigger_type = "manual";
      }
    }

    if (triggerType === "event") {
      if (
        typeof eventProvider === "string" &&
        eventProvider &&
        typeof eventType === "string" &&
        eventType
      ) {
        result.event_provider = eventProvider;
        result.event_type = eventType;
      } else {
        result.trigger_type = "manual";
      }
    }

    const inferredRecommendations = inferProviderRecommendations(
      result,
      userDescription,
      availableActions,
    );
    const recommendationMap = new Map<string, AutomationProviderRecommendation>();
    for (const recommendation of [...modelRecommendations, ...inferredRecommendations]) {
      const existing = recommendationMap.get(recommendation.provider);
      if (
        !existing ||
        (existing.confidence !== "required" && recommendation.confidence === "required")
      ) {
        recommendationMap.set(recommendation.provider, recommendation);
      }
    }
    result.provider_recommendations = [...recommendationMap.values()];

    return result;
  } catch {
    return null;
  }
};

export const parseGenerationResponse = (
  response: string,
  options?: {
    userDescription?: string;
    availableActions?: AutomationGenerationAction[];
  },
): ParsedAutomationGeneration => {
  const text = response.trim();
  if (text.length === 0) {
    throw new Error("Generation response is empty");
  }
  const userDescription = options?.userDescription ?? "";
  const availableActions = options?.availableActions ?? [];

  const fencedMatch = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fencedMatch?.[1]) {
    const parsed = tryParseJson(fencedMatch[1].trim(), userDescription, availableActions);
    if (parsed) {
      return parsed;
    }
  }

  const directParsed = tryParseJson(text, userDescription, availableActions);
  if (directParsed) {
    return directParsed;
  }

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const parsed = tryParseJson(
      text.slice(jsonStart, jsonEnd + 1),
      userDescription,
      availableActions,
    );
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Unable to parse generation response as JSON with prompt and description");
};

export const parseQuestionGenerationResponse = (
  response: string,
): AutomationClarificationQuestion[] => {
  const text = response.trim();
  if (text.length === 0) {
    throw new Error("Question generation response is empty");
  }

  const tryParseQuestions = (candidate: string): AutomationClarificationQuestion[] | null => {
    try {
      return parseClarificationQuestionArray(JSON.parse(candidate) as unknown);
    } catch {
      return null;
    }
  };

  const fencedMatch = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fencedMatch?.[1]) {
    const parsed = tryParseQuestions(fencedMatch[1].trim());
    if (parsed) {
      return parsed;
    }
  }

  const directParsed = tryParseQuestions(text);
  if (directParsed) {
    return directParsed;
  }

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const parsed = tryParseQuestions(text.slice(jsonStart, jsonEnd + 1));
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Unable to parse question generation response as JSON");
};

export const parseMermaidGenerationResponse = (response: string): string => {
  const text = response.trim();
  if (text.length === 0) {
    throw new Error("Generation response is empty");
  }

  const tryParseMermaid = (candidate: string): string | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const mermaidContent = (parsed as Record<string, unknown>).mermaid_content;
      if (typeof mermaidContent !== "string") {
        return null;
      }
      const normalized = mermaidContent.trim();
      if (normalized.length === 0 || hasMarkdownFence(normalized)) {
        return null;
      }
      return normalized;
    } catch {
      return null;
    }
  };

  const fencedMatch = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fencedMatch?.[1]) {
    const parsed = tryParseMermaid(fencedMatch[1].trim());
    if (parsed) {
      return parsed;
    }
  }

  const directParsed = tryParseMermaid(text);
  if (directParsed) {
    return directParsed;
  }

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const parsed = tryParseMermaid(text.slice(jsonStart, jsonEnd + 1));
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Unable to parse mermaid generation response as JSON");
};
