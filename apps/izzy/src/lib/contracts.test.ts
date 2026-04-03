import { describe, expect, it } from "vitest";
import {
  draftRequestSchema,
  clarificationQuestionGenerationSchema,
  issueDraftGenerationSchema,
  questionsGenerationSchema,
  questionsResponseSchema,
  questionsRequestSchema,
} from "./contracts";

describe("contracts", () => {
  it("requires at least one requested agent", () => {
    expect(() =>
      questionsRequestSchema.parse({
        prompt: "Add a new issue flow.",
        action: "plan",
        agents: [],
      }),
    ).toThrow();
  });

  it("accepts checkbox answers", () => {
    const parsed = draftRequestSchema.parse({
      prompt: "Create a better issue.",
      action: "do",
      agents: ["codex"],
      answers: {
        scope: ["ui", "api"],
      },
    });

    expect(parsed.answers.scope).toEqual(["ui", "api"]);
  });

  it("does not require context files from the model questions response", () => {
    const parsed = questionsGenerationSchema.parse({
      questions: [],
      imageNotes: ["Screenshot shows a blank loading state."],
    });

    expect(parsed.imageNotes).toHaveLength(1);
  });

  it("accepts nullable optional fields in the model question schema", () => {
    const parsed = clarificationQuestionGenerationSchema.parse({
      id: "scope",
      label: "Which scope matters most?",
      helpText: "Pick the highest-impact scope for the first version.",
      type: "textarea",
      required: true,
      options: null,
      placeholder: null,
    });

    expect(parsed.options).toBeNull();
    expect(parsed.placeholder).toBeNull();
  });

  it("still requires context files in the API questions response", () => {
    const parsed = questionsResponseSchema.parse({
      questions: [],
      contextFiles: ["docs/dev-setup.md"],
      imageNotes: [],
    });

    expect(parsed.contextFiles).toEqual(["docs/dev-setup.md"]);
  });

  it("requires suggested extra labels in the model draft schema", () => {
    const parsed = issueDraftGenerationSchema.parse({
      title: "Add Izzy GitHub App auth",
      summary: "Migrate Izzy auth to a GitHub App flow.",
      problem: "The OAuth app requests broader access than needed for a private issue repo.",
      desiredOutcome: "Izzy authenticates with a GitHub App and uses repo-restricted user tokens.",
      implementationNotes: ["Add a GitHub App provider.", "Store and refresh user tokens."],
      acceptanceCriteria: ["Users can sign in.", "Issue creation still works for the target repo."],
      repoContextNotes: ["Izzy is a standalone Next.js app under apps/izzy."],
      suggestedExtraLabels: [],
    });

    expect(parsed.suggestedExtraLabels).toEqual([]);
  });
});
