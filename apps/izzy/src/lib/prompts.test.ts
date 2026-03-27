import { describe, expect, it } from "vitest";
import { buildDraftPrompt, buildQuestionsPrompt } from "./prompts";

const context = [
  {
    path: "docs/github-label-workflows.md",
    description: "GitHub labels",
    snippet: "Use /plan-issue and /do-issue.",
  },
];

describe("prompts", () => {
  it("includes repo context in the questions prompt", () => {
    const prompt = buildQuestionsPrompt({
      input: {
        prompt: "Need a plan issue authoring tool",
        action: "plan",
        agents: ["codex"],
        images: [],
      },
      context,
      imageNotes: [],
    });

    expect(prompt).toContain("/plan-issue");
  });

  it("includes answers in the draft prompt", () => {
    const prompt = buildDraftPrompt({
      input: {
        prompt: "Need a plan issue authoring tool",
        action: "plan",
        agents: ["codex"],
        images: [],
        answers: {
          scope: "ui and api",
        },
      },
      context,
      imageNotes: [],
    });

    expect(prompt).toContain("ui and api");
  });
});
