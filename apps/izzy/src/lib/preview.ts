import type { DraftResponse, QuestionsResponse } from "./contracts";
import {
  buildIssueLabels,
  parseActionFromSearchParams,
  parseAgentsFromSearchParams,
} from "./labels";

export const previewEnabled = (): boolean =>
  typeof process.env.IZZY_E2E_PREVIEW_LOGIN === "string" &&
  process.env.IZZY_E2E_PREVIEW_LOGIN.trim().length > 0 &&
  (() => {
    try {
      const origin = new URL(process.env.NEXTAUTH_URL ?? "");
      return origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
    } catch {
      return false;
    }
  })();

export const getPreviewGithubLogin = (): string | null =>
  previewEnabled() ? (process.env.IZZY_E2E_PREVIEW_LOGIN?.trim() ?? null) : null;

type SearchParams = Record<string, string | string[] | undefined>;

export const getPreviewSeed = (
  searchParams: SearchParams,
): {
  prompt: string;
  questions: QuestionsResponse["questions"];
  answers: Record<string, string | string[]>;
  draft: DraftResponse | null;
} | null => {
  if (!previewEnabled()) {
    return null;
  }
  const preview = Array.isArray(searchParams.preview)
    ? searchParams.preview[0]
    : searchParams.preview;
  if (preview !== "clarification") {
    return null;
  }

  const action = parseActionFromSearchParams(searchParams.action ?? searchParams.workflow);
  const agents = parseAgentsFromSearchParams(searchParams.agent);
  const selectedLabels = buildIssueLabels(action, agents);

  return {
    prompt:
      "Build a standalone issue-authoring app called Izzy that asks clarification questions and adds the correct workflow labels for Keppo.",
    questions: [
      {
        id: "scope",
        label: "Which outcome matters most for the first version?",
        helpText: "Pick the narrowest version that still makes issue creation meaningfully easier.",
        type: "radio",
        required: true,
        options: [
          {
            id: "workflow-labels-and-draft",
            label: "Draft plus workflow labels",
            description: "Focus on title, body, and label selection for /plan-issue and /do-issue.",
          },
          {
            id: "full-triage-helper",
            label: "Full triage helper",
            description: "Also try to infer additional repo labels and implementation notes.",
          },
        ],
      },
      {
        id: "constraints",
        label: "What constraints should the issue call out explicitly?",
        helpText: "Select every constraint the implementing agent should preserve.",
        type: "checkbox",
        required: true,
        options: [
          {
            id: "strict-allowlist",
            label: "Strict allowlist",
            description: "Only approved GitHub users can use the app.",
          },
          {
            id: "standalone-app",
            label: "Standalone Next.js app",
            description: "Do not couple the implementation back into Keppo shared runtime code.",
          },
          {
            id: "public-image-uploads",
            label: "Public image uploads",
            description:
              "Images can be attached, but the issue should warn that the URLs are public.",
          },
        ],
      },
      {
        id: "repo-context",
        label: "What repo context should Izzy lean on?",
        helpText: "Call out the most relevant context buckets for the draft issue.",
        type: "textarea",
        required: false,
        placeholder:
          "For example: docs/dev-setup, docs/self-hosting-setup, label workflow docs, security rules, selected workflow files...",
      },
    ],
    answers: {
      scope: "workflow-labels-and-draft",
      constraints: ["strict-allowlist", "standalone-app", "public-image-uploads"],
      "repo-context":
        "Use docs/github-label-workflows.md, AGENTS.md, docs/dev-setup.md, docs/self-hosting-setup.md, docs/rules/security.md, and the issue-agent workflow.",
    },
    draft: {
      draft: {
        title: "Add Izzy, a standalone issue-authoring app for keppo issue workflows",
        summary:
          "We need a standalone issue-authoring app that helps approved GitHub users produce higher-signal issues for keppoai/keppo.",
        problem:
          "Issue creation is manual today, which makes it easy to miss repo context, forget the /plan-issue or /do-issue label, or write prompts that are too vague for Codex or Claude to act on safely.",
        desiredOutcome:
          "Users should be able to describe a request once, answer a few clarification questions, review a stronger draft issue, choose labels, and create the issue with their own GitHub credentials.",
        suggestedExtraLabels: [],
      },
      bodyMarkdown: [
        "We need a standalone issue-authoring app that helps approved GitHub users produce higher-signal issues for keppoai/keppo.",
        "## Problem",
        "Issue creation is manual today, which makes it easy to miss repo context, forget the /plan-issue or /do-issue label, or write prompts that are too vague for Codex or Claude to act on safely.",
        "## Desired outcome",
        "Users should be able to describe a request once, answer a few clarification questions, review a stronger draft issue, choose labels, and create the issue with their own GitHub credentials.",
      ].join("\n\n"),
      selectedLabels,
      availableLabels: [
        "/plan-issue",
        "/do-issue",
        "?agent:codex",
        "?agent:claude",
        "?agent:gh-copilot",
        "needs-human:review-issue",
      ],
      contextFiles: [
        "docs/github-label-workflows.md",
        "docs/rules/security.md",
        "docs/dev-setup.md",
        "docs/self-hosting-setup.md",
      ],
      imageNotes: [
        "Annotated screenshots should be preserved as public attachment links in the final issue body.",
      ],
    },
  };
};
